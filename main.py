"""FastAPI app: auth, CV upload, vacancies, analysis, chat-with-intents, invites, interviews."""
import contextlib
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time

import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlmodel import Session, select

import analysis
import llm
from models import (CATEGORIES, Analysis, CV, InterviewReport, Invite, User,
                    Vacancy, engine, get_session, hash_password, import_samples,
                    init_db, now, verify_password)

app = FastAPI(title="AI Recruiter")
SECRET = os.environ.get("HR_SECRET", "hr-demo-secret-2026")
COOKIE = "session"
RECORDINGS_DIR = os.path.join(os.path.dirname(__file__), "recordings")
os.makedirs(RECORDINGS_DIR, exist_ok=True)
UPLOADS_DIR = analysis.UPLOADS_DIR
os.makedirs(UPLOADS_DIR, exist_ok=True)
LANGS = {"en": "English", "ru": "Russian", "az": "Azerbaijani"}

# ---------------- helpers ----------------
def make_token(user: User):
    payload = f"{user.id}.{int(time.time()) + 60 * 60 * 24 * 7}.{user.role}"
    sig = hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def current_user(request: Request):
    tok = request.cookies.get(COOKIE, "")
    parts = tok.split(".")
    if len(parts) != 4:
        raise HTTPException(401, "Not logged in")
    payload = ".".join(parts[:3])
    sig = parts[3]
    if not hmac.compare_digest(hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest(), sig):
        raise HTTPException(401, "Bad session")
    uid, exp, role = parts[0], parts[1], parts[2]
    if int(exp) < time.time():
        raise HTTPException(401, "Session expired")
    with contextlib.closing(Session(engine)) as s:
        u = s.get(User, int(uid))
        if not u:
            raise HTTPException(401, "User gone")
        return u


def require_admin(u=Depends(current_user)):
    if u.role != "ADMIN":
        raise HTTPException(403, "Admin only")
    return u


def base_url(request: Request):
    return str(request.base_url).rstrip("/")


def _footprint_json(cv: CV):
    try:
        raw = json.loads(cv.github) if cv.github else None
    except Exception:
        return None
    if not isinstance(raw, dict) or "summary" not in raw:
        return None
    return {"summary": raw.get("summary", ""), "consistent": raw.get("consistent"), "links": raw.get("links", [])}


def cv_json(cv: CV):
    return {
        "id": cv.id, "filename": cv.filename, "category": cv.category,
        "name": cv.candidate_name, "email": cv.email, "skills": cv.skills_list(),
        "years_exp": cv.years_exp, "links": cv.links_list(),
        "ai_score": cv.ai_score, "ai_verdict": cv.ai_verdict, "ai_evidence": cv.evidence_list(),
        "github": (lambda raw: raw.get("github") if isinstance(raw, dict) and "github" in raw else raw)(json.loads(cv.github)) if cv.github else None,
        "footprint": _footprint_json(cv),
        "vacancy_id": cv.vacancy_id, "owner_id": cv.owner_id,
        "created_at": cv.created_at,
    }


# ---------------- CV text extraction & LLM parsing ----------------
def extract_text(filename: str, data: bytes) -> str:
    fn = filename.lower()
    if fn.endswith(".pdf"):
        from pypdf import PdfReader
        import io
        return "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(data)).pages)
    if fn.endswith(".docx"):
        import docx
        import io
        d = docx.Document(io.BytesIO(data))
        return "\n".join(p.text for p in d.paragraphs)
    return data.decode("utf-8", errors="ignore")


def parse_cv_text(text: str) -> dict:
    out = llm.chat_json([
        {"role": "system", "content": "You parse CVs. Return ONLY JSON."},
        {"role": "user", "content": f"Parse this CV.\nReturn JSON: {{\"category\": one of {CATEGORIES}, \"name\": \"\", \"email\": \"\", \"skills\": [\"...\"], \"years_experience\": number, \"links\": [{{\"type\": \"linkedin|github|portfolio\", \"url\": \"\"}}]}}\n\nCV:\n{text[:6000]}"},
    ])
    if out.get("category") not in CATEGORIES:
        out["category"] = "Other"
    skills = out.get("skills", [])
    if isinstance(skills, str):
        skills = [s.strip() for s in skills.split(",")]
    out["skills"] = [str(s) for s in skills if s][:25]
    links = []
    for l in out.get("links", []):
        if isinstance(l, dict) and l.get("url"):
            links.append({"type": l.get("type", "link"), "url": l["url"]})
        elif isinstance(l, str):
            links.append({"type": "link", "url": l})
    # regex fallback for links/emails the LLM missed
    for m in re.findall(r"https?://[^\s)\]}\"']+", text):
        if m not in [l["url"] for l in links]:
            t = "github" if "github.com" in m else ("linkedin" if "linkedin.com" in m else "link")
            links.append({"type": t, "url": m[:200]})
    em = re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", text)
    if em and not out.get("email"):
        out["email"] = em.group(0)
    out["links"] = links[:8]
    try:
        out["years_experience"] = float(out.get("years_experience") or 0)
    except Exception:
        out["years_experience"] = 0
    return out


def store_cv(s, filename, text, owner_id=None, data: bytes = None, vacancy_id=None):
    meta = parse_cv_text(text)
    cv = CV(filename=filename, text=text, owner_id=owner_id, vacancy_id=vacancy_id,
            category=meta.get("category", "Other"),
            candidate_name=meta.get("name") or "",
            email=meta.get("email") or "",
            years_exp=meta.get("years_experience") or 0)
    if data:
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", os.path.basename(filename))[-80:]
        cv.file_path = f"{secrets.token_hex(6)}_{safe}"
        with open(os.path.join(UPLOADS_DIR, cv.file_path), "wb") as fh:
            fh.write(data)
    cv.skills = json.dumps(meta.get("skills", []))
    cv.links = json.dumps(meta.get("links", []))
    if not cv.candidate_name:
        cv.candidate_name = os.path.splitext(filename)[0]
    s.add(cv)
    s.commit()
    s.refresh(cv)
    return cv


# ---------------- auth routes ----------------
class LoginBody(BaseModel):
    email: str
    password: str


class RegisterBody(LoginBody):
    name: str = ""


@app.post("/api/auth/login")
def login(body: LoginBody):
    with contextlib.closing(Session(engine)) as s:
        u = s.exec(select(User).where(User.email == body.email.strip().lower())).first()
        if not u or not verify_password(body.password, u.password_hash):
            raise HTTPException(401, "Invalid credentials")
        resp = JSONResponse({"id": u.id, "name": u.name, "email": u.email, "role": u.role})
        resp.set_cookie(COOKIE, make_token(u), httponly=True, samesite="lax")
        return resp


@app.post("/api/auth/register")
def register(body: RegisterBody):
    if not body.email or not body.password:
        raise HTTPException(400, "Email and password required")
    with contextlib.closing(Session(engine)) as s:
        if s.exec(select(User).where(User.email == body.email.strip().lower())).first():
            raise HTTPException(400, "Email already registered")
        u = User(name=body.name or body.email.split("@")[0], email=body.email.strip().lower(),
                 password_hash=hash_password(body.password), role="CANDIDATE")
        s.add(u); s.commit(); s.refresh(u)
        resp = JSONResponse({"id": u.id, "name": u.name, "email": u.email, "role": u.role})
        resp.set_cookie(COOKIE, make_token(u), httponly=True, samesite="lax")
        return resp


@app.post("/api/auth/logout")
def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE)
    return resp


@app.get("/api/auth/me")
def me(u: User = Depends(current_user)):
    return {"id": u.id, "name": u.name, "email": u.email, "role": u.role}


# ---------------- CVs ----------------
@app.post("/api/cvs/upload")
def upload_cvs(files: list[UploadFile] = File(...), u: User = Depends(require_admin)):
    out = []
    with contextlib.closing(Session(engine)) as s:
        for f in files:
            data = f.file.read()
            if len(data) > 10 * 1024 * 1024:
                out.append({"file": f.filename, "error": "too large (>10MB)"})
                continue
            try:
                text = extract_text(f.filename, data)
                if len(text.strip()) < 50:
                    raise ValueError("could not extract enough text")
                cv = store_cv(s, f.filename, text, data=data)
                out.append({"file": f.filename, "cv": cv_json(cv)})
            except Exception as e:
                out.append({"file": f.filename, "error": str(e)[:150]})
    return {"results": out}


@app.post("/api/apply")
def apply(vacancy_id: int = Form(...), file: UploadFile = File(...), u: User = Depends(current_user)):
    data = file.file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, "File too large (>10MB)")
    try:
        text = extract_text(file.filename, data)
    except Exception:
        raise HTTPException(400, "Could not read this file — use PDF, DOCX or TXT")
    if len(text.strip()) < 50:
        raise HTTPException(400, "Could not extract text from file")
    with contextlib.closing(Session(engine)) as s:
        vac = s.get(Vacancy, vacancy_id)
        if not vac or not vac.active:
            raise HTTPException(404, "Vacancy not found or closed")
        cv = store_cv(s, file.filename, text, owner_id=u.id, data=data, vacancy_id=vacancy_id)
        if not cv.candidate_name or cv.candidate_name == os.path.splitext(file.filename)[0]:
            cv.candidate_name = u.name
        if not cv.email:
            cv.email = u.email
        s.add(cv); s.commit(); s.refresh(cv)
        print(f"[apply] {u.email} applied to '{vac.title}' with CV #{cv.id}")
        return {"ok": True, "cv": cv_json(cv), "vacancy": vac.title}


@app.get("/api/my/applications")
def my_applications(u: User = Depends(current_user)):
    with contextlib.closing(Session(engine)) as s:
        out = []
        for cv in s.exec(select(CV).where(CV.owner_id == u.id).order_by(CV.id.desc())).all():
            vac = s.get(Vacancy, cv.vacancy_id) if cv.vacancy_id else None
            inv = s.exec(select(Invite).where(Invite.cv_id == cv.id)).first()
            status = "Interview completed" if inv and inv.completed else ("Invited to interview" if inv else "Under review")
            out.append({"cv_id": cv.id, "filename": cv.filename, "vacancy": vac.title if vac else "—",
                        "category": cv.category, "status": status, "created_at": cv.created_at})
        return out


@app.get("/api/cvs")
def list_cvs(category: str = None, u: User = Depends(require_admin)):
    with contextlib.closing(Session(engine)) as s:
        q = select(CV).order_by(CV.id)
        if category:
            q = q.where(CV.category == category)
        return [cv_json(c) for c in s.exec(q).all()]


@app.delete("/api/cvs/{cv_id}")
def del_cv(cv_id: int, u: User = Depends(require_admin)):
    with contextlib.closing(Session(engine)) as s:
        cv = s.get(CV, cv_id)
        if cv:
            for a in s.exec(select(Analysis).where(Analysis.cv_id == cv_id)).all():
                s.delete(a)
            if cv.file_path:
                with contextlib.suppress(OSError):
                    os.remove(os.path.join(UPLOADS_DIR, os.path.basename(cv.file_path)))
            s.delete(cv); s.commit()
    return {"ok": True}


# ---------------- vacancies ----------------
class VacancyBody(BaseModel):
    title: str
    category: str
    description: str = ""
    requirements: str = ""
    active: bool = True


@app.get("/api/vacancies")
def list_vacancies():
    with contextlib.closing(Session(engine)) as s:
        return [v.dict() for v in s.exec(select(Vacancy).order_by(Vacancy.id)).all()]


@app.post("/api/vacancies")
def add_vacancy(body: VacancyBody, u: User = Depends(require_admin)):
    if body.category not in CATEGORIES:
        raise HTTPException(400, "Bad category")
    with contextlib.closing(Session(engine)) as s:
        v = Vacancy(**body.dict())
        s.add(v); s.commit(); s.refresh(v)
        return v.dict()


@app.put("/api/vacancies/{vid}")
def edit_vacancy(vid: int, body: VacancyBody, u: User = Depends(require_admin)):
    with contextlib.closing(Session(engine)) as s:
        v = s.get(Vacancy, vid)
        if not v:
            raise HTTPException(404, "Vacancy not found")
        for k, val in body.dict().items():
            setattr(v, k, val)
        s.add(v); s.commit(); s.refresh(v)
        return v.dict()


@app.delete("/api/vacancies/{vid}")
def del_vacancy(vid: int, u: User = Depends(require_admin)):
    with contextlib.closing(Session(engine)) as s:
        v = s.get(Vacancy, vid)
        if v:
            s.delete(v); s.commit()
    return {"ok": True}


# ---------------- analysis ----------------
@app.post("/api/analyze")
def analyze(body: dict, u: User = Depends(require_admin)):
    vid = body.get("vacancy_id")
    if not vid:
        raise HTTPException(400, "vacancy_id required")
    with contextlib.closing(Session(engine)) as s:
        vac = s.get(Vacancy, vid)
        if not vac:
            raise HTTPException(404, "Vacancy not found")
        cv_ids = body.get("cv_ids")
        if not cv_ids:
            cv_ids = [c.id for c in s.exec(select(CV).where(CV.category == vac.category)).all()]
        if not cv_ids:
            raise HTTPException(400, f"No CVs in category '{vac.category}'")
    run_id = analysis.start_run(vid, cv_ids, force=bool(body.get("force")))
    return {"run_id": run_id, "cv_count": len(cv_ids)}


@app.get("/api/analyze/progress/{run_id}")
def progress(run_id: str, u: User = Depends(require_admin)):
    with analysis._lock:
        return dict(analysis.RUNS.get(run_id, {"finished": True}))


@app.get("/api/results/{vacancy_id}")
def results(vacancy_id: int, u: User = Depends(require_admin)):
    with contextlib.closing(Session(engine)) as s:
        rows = s.exec(select(Analysis).where(Analysis.vacancy_id == vacancy_id)).all()
        out = []
        for a in rows:
            cv = s.get(CV, a.cv_id)
            if not cv:
                continue
            out.append({
                "cv": cv_json(cv),
                "fit_score": a.fit_score, "status": a.status,
                "strengths": json.loads(a.strengths), "weaknesses": json.loads(a.weaknesses),
                "missing_skills": json.loads(a.missing_skills), "summary": a.summary,
                "footprint_summary": a.footprint_summary,
            })
        out.sort(key=lambda r: (r["status"] != "done", -(r["fit_score"] or 0)))
        fits = [r["fit_score"] for r in out if r["status"] == "done" and r["fit_score"] is not None]
        ais = [r["cv"]["ai_score"] for r in out if r["cv"]["ai_score"] is not None]
        stats = {
            "count": len(out), "avg_fit": round(sum(fits) / len(fits)) if fits else None,
            "avg_ai": round(sum(ais) / len(ais)) if ais else None,
            "skill_coverage": round(sum(1 for r in out if r["status"] == "done" and not r["missing_skills"]) / len(fits) * 100) if fits else None,
        }
        return {"results": out, "stats": stats}


# ---------------- invites ----------------
def make_invite(s, cv_id: int, vid: int, uid, base: str, lang: str = "en"):
    """Create an interview invite, or reuse the open (not started, not completed) one for the same CV+vacancy."""
    inv = s.exec(select(Invite).where(Invite.cv_id == cv_id, Invite.vacancy_id == vid,
                                      Invite.completed == False, Invite.progress == 0)).first()  # noqa: E712
    reused = bool(inv)
    if not inv:
        inv = Invite(token=secrets.token_urlsafe(16), cv_id=cv_id, vacancy_id=vid, created_by=uid,
                     state=json.dumps({"lang": lang if lang in LANGS else "en"}))
        s.add(inv); s.commit(); s.refresh(inv)
    link = f"{base}/interview/{inv.token}"
    cv = s.get(CV, cv_id)
    print(f"[email-log] Interview invite to {cv.email if cv and cv.email else 'CV #' + str(cv_id)}: {link}")
    return inv, link, reused


@app.post("/api/invites")
def create_invite(body: dict, request: Request, u: User = Depends(require_admin)):
    cv_id, vid = body.get("cv_id"), body.get("vacancy_id")
    if not cv_id or not vid:
        raise HTTPException(400, "cv_id and vacancy_id required")
    with contextlib.closing(Session(engine)) as s:
        if not s.get(CV, cv_id) or not s.get(Vacancy, vid):
            raise HTTPException(404, "CV or vacancy not found")
        inv, link, reused = make_invite(s, cv_id, vid, u.id, base_url(request), body.get("lang", "en"))
        return {"id": inv.id, "token": inv.token, "link": link, "reused": reused}


@app.delete("/api/invites/{iid}")
def del_invite(iid: int, u: User = Depends(require_admin)):
    with contextlib.closing(Session(engine)) as s:
        inv = s.get(Invite, iid)
        if inv:
            for r in s.exec(select(InterviewReport).where(InterviewReport.invite_id == iid)).all():
                s.delete(r)
            s.delete(inv); s.commit()
    return {"ok": True}


@app.get("/api/invites")
def list_invites(request: Request, u: User = Depends(require_admin)):
    with contextlib.closing(Session(engine)) as s:
        out = []
        for inv in s.exec(select(Invite).order_by(Invite.id.desc())).all():
            cv = s.get(CV, inv.cv_id)
            vac = s.get(Vacancy, inv.vacancy_id)
            rep = s.exec(select(InterviewReport).where(InterviewReport.invite_id == inv.id)).first()
            fp = os.path.join(RECORDINGS_DIR, f"frames_{inv.id}.jpg")
            live = (not inv.completed) and os.path.exists(fp) and (time.time() - os.path.getmtime(fp)) < 30
            out.append({
                "id": inv.id, "token": inv.token, "completed": inv.completed, "live": live,
                "link": f"{base_url(request)}/interview/{inv.token}",
                "candidate": cv.candidate_name if cv else f"CV#{inv.cv_id}",
                "vacancy_id": inv.vacancy_id, "vacancy": vac.title if vac else "?",
                "cv_id": inv.cv_id, "created_at": inv.created_at, "answered": inv.progress,
                "report_id": rep.id if rep else None,
                "score": rep.total_score if rep else None,
                "decision": rep.decision if rep else None,
            })
        return out


@app.get("/api/my/invites")
def my_invites(request: Request, u: User = Depends(current_user)):
    with contextlib.closing(Session(engine)) as s:
        cvs = s.exec(select(CV).where(CV.owner_id == u.id)).all()
        out = []
        for cv in cvs:
            for inv in s.exec(select(Invite).where(Invite.cv_id == cv.id)).all():
                vac = s.get(Vacancy, inv.vacancy_id)
                out.append({"link": f"{base_url(request)}/interview/{inv.token}", "completed": inv.completed,
                            "vacancy_id": inv.vacancy_id, "vacancy": vac.title if vac else "?",
                            "cv_filename": cv.filename})
        return out


# ---------------- interview ----------------
def _interview_invite(token: str):
    with contextlib.closing(Session(engine)) as s:
        inv = s.exec(select(Invite).where(Invite.token == token)).first()
        if not inv:
            raise HTTPException(404, "Invite not found")
        return inv.id, inv.cv_id, inv.vacancy_id, inv


@app.get("/api/interview/{token}")
def interview_info(token: str):
    iid, cv_id, vid, inv = _interview_invite(token)
    with contextlib.closing(Session(engine)) as s:
        vac = s.get(Vacancy, vid)
        cv = s.get(CV, cv_id)
        return {
            "vacancy": vac.title if vac else "?", "candidate": cv.candidate_name if cv else "?",
            "completed": inv.completed,
            "questions_total": len(json.loads(inv.questions)),
            "answered": inv.progress,
            "lang": json.loads(inv.state or "{}").get("lang", "en"),
        }


@app.post("/api/interview/{token}/start")
def interview_start(token: str, body: dict = None):
    iid, cv_id, vid, inv = _interview_invite(token)
    body = body or {}
    with contextlib.closing(Session(engine)) as s:
        inv = s.get(Invite, iid)
        vac = s.get(Vacancy, vid)
        cv = s.get(CV, cv_id)
        if inv.completed:
            raise HTTPException(400, "Interview already completed")
        state = json.loads(inv.state or "{}")
        if body.get("lang") in LANGS and not json.loads(inv.questions):
            state["lang"] = body["lang"]
        lang = LANGS.get(state.get("lang", "en"), "English")
        questions = json.loads(inv.questions)
        if not questions:
            q = llm.chat_json([
                {"role": "system", "content": "You are a senior hiring manager preparing a structured voice interview. "
                 "Write 6 questions in increasing difficulty: 1 warm-up about the candidate's background, 3 role-specific technical/professional questions "
                 "tied to the vacancy requirements, 1 question probing a specific claim from the CV, 1 behavioural/situational question (STAR). "
                 "Each question must be answerable by voice in 1-2 minutes, one sentence, no multi-part questions. "
                 f"Write the questions in {lang}."},
                {"role": "user", "content": f"Vacancy: {vac.title} — {vac.description}\nRequirements: {vac.requirements}\nCandidate skills: {', '.join(cv.skills_list())}\nCandidate CV (truncated): {cv.text[:2000]}\n\nReturn JSON: {{\"questions\": [\"...\"]}}"},
            ])
            questions = [str(x).strip() for x in q.get("questions", []) if str(x).strip()][:6]
            if not questions:
                questions = [f"Tell me about your experience relevant to {vac.title}.",
                             "What are your strongest skills?", "Describe a difficult project you completed."]
            inv.questions = json.dumps(questions)
            state.update({"q_index": 0, "awaiting_followup": False})
            inv.state = json.dumps(state)
            s.add(inv)
            if not s.exec(select(InterviewReport).where(InterviewReport.invite_id == iid)).first():
                s.add(InterviewReport(invite_id=iid, cv_id=cv_id, vacancy_id=vid))
            s.commit()
        resume = inv.progress > 0 or state.get("awaiting_followup")
        qi = min(state.get("q_index", 0), len(questions) - 1)
        current = questions[qi]
        if state.get("awaiting_followup"):
            rep = s.exec(select(InterviewReport).where(InterviewReport.invite_id == iid)).first()
            tr = rep.transcript_list() if rep else []
            if tr and tr[-1].get("followup"):
                current = tr[-1]["followup"]
        try:
            intro = llm.chat([
                {"role": "system", "content": "You are Nova, a warm, professional AI interviewer. " + (
                    "The candidate reconnected to an interview already in progress: welcome them back in 1-2 short sentences and say you'll continue."
                    if resume else
                    "Introduce yourself by name in 3-4 short conversational sentences: welcome the candidate, mention the role, explain the format "
                    f"({len(questions)} questions answered by voice or text, possibly a short follow-up), reassure them.")
                 + f" Speak {lang}. Plain text only, no markdown, no emojis."},
                {"role": "user", "content": f"Candidate {cv.candidate_name} is interviewing for {vac.title}."},
            ], temperature=0.7)
        except Exception:
            intro = f"Hi {cv.candidate_name}, I'm Nova. Welcome to your interview for {vac.title}."
        return {"intro": intro, "question": current, "total": len(questions), "answered": inv.progress,
                "followup": bool(state.get("awaiting_followup")), "lang": state.get("lang", "en")}


def _finalize(s, inv, rep, vac, cv, note=""):
    """Score whatever transcript exists and produce a final report (used on finish, admin stop, candidate exit)."""
    transcript = rep.transcript_list()
    scores = [t.get("score", 5) for t in transcript if t.get("score") is not None]
    rep.total_score = round(sum(scores) / len(scores), 1) if scores else 0
    answered_main = len([t for t in transcript if t.get("followup_of") is None])
    if transcript:
        final = llm.chat_json([
            {"role": "system", "content": "You write final hiring reports for a recruiter. Be decisive and evidence-based. "
             "Decision policy: average >= 7.5 and no critical gaps -> HIRE; 5.5-7.4 or interview incomplete -> CONSIDER; < 5.5 -> REJECT. "
             "Deviate from the policy only with an explicit reason in the justification. Reference specific answers. Write in English."},
            {"role": "user", "content": f"Role: {vac.title}\nAverage score: {rep.total_score}/10. Main questions answered: {answered_main}/{len(json.loads(inv.questions) or [])}. Interview may have ended early: {note}\nTranscript with scores: {json.dumps(transcript)[:5000]}\nCV summary: {cv.candidate_name}, skills: {', '.join(cv.skills_list())}\n\nReturn JSON: {{\"decision\": \"HIRE|CONSIDER|REJECT\", \"justification\": \"3-4 sentences\", \"strengths\": [\"...\"], \"weaknesses\": [\"...\"], \"areas\": [\"knowledge areas demonstrated\"]}}"},
        ])
        rep.decision = final.get("decision", "CONSIDER") if final.get("decision") in ("HIRE", "CONSIDER", "REJECT") else "CONSIDER"
        rep.justification = str(final.get("justification", ""))
        rep.strengths = json.dumps([str(x) for x in final.get("strengths", [])][:6])
        rep.weaknesses = json.dumps([str(x) for x in final.get("weaknesses", [])][:6])
        rep.areas = json.dumps([str(x) for x in final.get("areas", [])][:8])
    else:
        rep.decision = "CONSIDER"
        rep.justification = f"Interview ended before any answers were given ({note or 'no transcript'})."
        rep.strengths = "[]"; rep.weaknesses = "[]"; rep.areas = "[]"
    inv.completed = True
    s.add(rep); s.add(inv); s.commit()


@app.post("/api/interview/{token}/answer")
def interview_answer(token: str, body: dict):
    iid, cv_id, vid, _ = _interview_invite(token)
    answer = (body.get("answer") or "").strip()
    if not answer:
        raise HTTPException(400, "Empty answer")
    with contextlib.closing(Session(engine)) as s:
        inv = s.get(Invite, iid)
        if inv.completed:
            raise HTTPException(400, "Interview already completed")
        if not json.loads(inv.questions):
            raise HTTPException(400, "Interview not started")
        vac = s.get(Vacancy, vid)
        cv = s.get(CV, cv_id)
        rep = s.exec(select(InterviewReport).where(InterviewReport.invite_id == iid)).first()
        if not rep:
            rep = InterviewReport(invite_id=iid, cv_id=cv_id, vacancy_id=vid)
            s.add(rep); s.commit(); s.refresh(rep)
        questions = json.loads(inv.questions)
        state = json.loads(inv.state or "{}")
        qi = state.get("q_index", 0)
        transcript = rep.transcript_list()

        is_followup = bool(state.get("awaiting_followup"))
        q_text = transcript[-1].get("followup", "?") if is_followup and transcript else (questions[qi] if qi < len(questions) else "?")
        entry = {"q": q_text, "a": answer, "followup_of": qi if is_followup else None}

        lang = LANGS.get(state.get("lang", "en"), "English")
        out = llm.chat_json([
            {"role": "system", "content": "You are Nova, a warm but rigorous AI interviewer. React like a real human interviewer: acknowledge something specific "
             "from the answer in 1-2 natural sentences, without revealing the correct answer or the score. "
             "Scoring rubric (0-10): 0-2 off-topic/no answer/incorrect; 3-4 vague or mostly wrong; 5-6 partially correct, lacks depth or examples; "
             "7-8 correct and clear with a concrete example; 9-10 expert-level depth, trade-offs, real experience. "
             "Speech-to-text may contain recognition errors — judge the meaning, not the spelling. "
             "Ask a follow-up only if the answer is vague or too short to judge (and never for follow-up answers). "
             f"Write feedback and follow-up in {lang}."},
            {"role": "user", "content": f"Role: {vac.title}. Requirements: {vac.requirements[:500]}\nQuestion: {q_text}\nCandidate answer: {answer[:3000]}\n\nReturn JSON: {{\"score\": 0-10, \"feedback\": \"1-2 conversational sentences\", \"followup\": null or \"one short probing question\"}}"},
        ])
        try:
            score = max(0, min(10, float(out.get("score", 5))))
        except Exception:
            score = 5.0
        entry["score"] = round(score, 1)
        entry["feedback"] = str(out.get("feedback", ""))
        followup = out.get("followup")
        transcript.append(entry)

        next_q, done = None, False
        if not is_followup and followup and isinstance(followup, str) and len(followup) > 5:
            entry["followup"] = str(followup)[:300]
            state["awaiting_followup"] = True
            resp_q = str(followup)
        else:
            state["awaiting_followup"] = False
            state["q_index"] = qi + 1
            inv.progress = qi + 1
            if qi + 1 < len(questions):
                next_q = questions[qi + 1]
            else:
                done = True

        rep.transcript = json.dumps(transcript)
        inv.state = json.dumps(state)
        s.add(rep)
        s.add(inv)
        if done:
            _finalize(s, inv, rep, vac, cv)
            verdict_note = f"Interview complete. Final score: {rep.total_score}/10."
        else:
            verdict_note = ""
        s.commit()
        resp = {"score": entry["score"], "feedback": entry["feedback"],
                "followup": entry.get("followup"), "next_question": next_q, "done": done,
                "answered": inv.progress, "total": len(questions)}
        if done:
            resp["report"] = {"total_score": rep.total_score, "decision": rep.decision,
                              "justification": rep.justification, "strengths": json.loads(rep.strengths),
                              "weaknesses": json.loads(rep.weaknesses), "areas": json.loads(rep.areas),
                              "transcript": transcript}
        return resp


@app.post("/api/interview/{token}/video")
async def interview_video(token: str, video: UploadFile = File(...)):
    """Save the recorded interview video and link it to the report."""
    iid, cv_id, vid, _ = _interview_invite(token)
    data = await video.read()
    if not data:
        raise HTTPException(400, "Empty video")
    fn = f"interview_{iid}_{secrets.token_hex(4)}.webm"
    with open(os.path.join(RECORDINGS_DIR, fn), "wb") as f:
        f.write(data)
    with contextlib.closing(Session(engine)) as s:
        rep = s.exec(select(InterviewReport).where(InterviewReport.invite_id == iid)).first()
        if rep:
            rep.video_path = fn
            s.add(rep); s.commit()
    print(f"[video] saved {fn} ({len(data) // 1024} KB) for invite {iid}")
    return {"ok": True, "video": f"/recordings/{fn}"}


def _finalize_partial(token: str, note: str):
    """Finalize an interview early (admin stop or candidate exit) and return basic info."""
    iid, cv_id, vid, _ = _interview_invite(token)
    with contextlib.closing(Session(engine)) as s:
        inv = s.get(Invite, iid)
        if inv.completed:
            return {"ok": True, "already_done": True}
        vac, cv = s.get(Vacancy, vid), s.get(CV, cv_id)
        rep = s.exec(select(InterviewReport).where(InterviewReport.invite_id == iid)).first()
        if not rep:
            rep = InterviewReport(invite_id=iid, cv_id=cv_id, vacancy_id=vid)
            s.add(rep); s.commit(); s.refresh(rep)
        _finalize(s, inv, rep, vac, cv, note=note)
        return {"ok": True, "answered": inv.progress, "decision": rep.decision, "score": rep.total_score}


@app.post("/api/interview/{token}/stop")
def interview_stop(token: str, u: User = Depends(require_admin)):
    """Admin terminates the ongoing interview; partial answers are scored into a report."""
    res = _finalize_partial(token, "terminated by the recruiter from the admin panel")
    print(f"[interview] admin stopped {token}: {res}")
    return res


@app.post("/api/interview/{token}/exit")
def interview_exit(token: str):
    """Candidate leaves the interview early; partial answers are scored into a report."""
    res = _finalize_partial(token, "candidate left the interview early")
    print(f"[interview] candidate exited {token}: {res}")
    return res


@app.post("/api/interview/{token}/frame")
async def interview_frame(token: str, frame: UploadFile = File(...)):
    """Candidate page uploads a live camera snapshot for the admin 'connect' viewer."""
    iid, _, _, inv = _interview_invite(token)
    if inv.completed:
        raise HTTPException(400, "Interview finished")
    data = await frame.read()
    if data:
        with open(os.path.join(RECORDINGS_DIR, f"frames_{iid}.jpg"), "wb") as f:
            f.write(data)
    return {"ok": True}


@app.get("/api/interview/{token}/live")
def interview_live(token: str, u: User = Depends(require_admin)):
    """Admin live view: latest camera frame + progress."""
    iid, cv_id, vid, inv = _interview_invite(token)
    fp = os.path.join(RECORDINGS_DIR, f"frames_{iid}.jpg")
    has = os.path.exists(fp) and (time.time() - os.path.getmtime(fp)) < 30
    with contextlib.closing(Session(engine)) as s:
        cv, vac = s.get(CV, cv_id), s.get(Vacancy, vid)
        return {
            "candidate": cv.candidate_name if cv else "?", "vacancy": vac.title if vac else "?",
            "completed": inv.completed, "answered": inv.progress,
            "questions": len(json.loads(inv.questions)),
            "frame": f"/recordings/frames_{iid}.jpg?t={int(os.path.getmtime(fp))}" if has else None,
        }


@app.get("/api/recordings")
def recordings(u: User = Depends(require_admin)):
    """Video folder: all interview recordings with candidate/vacancy context."""
    with contextlib.closing(Session(engine)) as s:
        out = []
        for fn in sorted(os.listdir(RECORDINGS_DIR), reverse=True):
            if fn.startswith("frames_"):
                continue
            p = os.path.join(RECORDINGS_DIR, fn)
            if not os.path.isfile(p):
                continue
            rep = s.exec(select(InterviewReport).where(InterviewReport.video_path == fn)).first()
            cv = s.get(CV, rep.cv_id) if rep else None
            vac = s.get(Vacancy, rep.vacancy_id) if rep else None
            out.append({
                "file": fn, "url": f"/recordings/{fn}",
                "size_kb": round(os.path.getsize(p) / 1024),
                "candidate": cv.candidate_name if cv else "unknown",
                "vacancy": vac.title if vac else "?",
                "decision": rep.decision if rep else None,
                "score": rep.total_score if rep else None,
                "date": time.strftime("%Y-%m-%d %H:%M", time.localtime(os.path.getmtime(p))),
            })
        return out


@app.delete("/api/recordings/{filename}")
def del_recording(filename: str, u: User = Depends(require_admin)):
    if "/" in filename or "\\" in filename or not filename.startswith("interview_"):
        raise HTTPException(400, "Bad filename")
    p = os.path.join(RECORDINGS_DIR, filename)
    if os.path.exists(p):
        os.remove(p)
    with contextlib.closing(Session(engine)) as s:
        for rep in s.exec(select(InterviewReport).where(InterviewReport.video_path == filename)).all():
            rep.video_path = ""
            s.add(rep)
        s.commit()
    return {"ok": True}


# ---------------- reports (admin) ----------------
@app.get("/api/reports")
def reports(u: User = Depends(require_admin)):
    with contextlib.closing(Session(engine)) as s:
        out = []
        for r in s.exec(select(InterviewReport).order_by(InterviewReport.id.desc())).all():
            cv, vac, inv = s.get(CV, r.cv_id), s.get(Vacancy, r.vacancy_id), s.get(Invite, r.invite_id)
            out.append({
                "id": r.id, "candidate": cv.candidate_name if cv else "?",
                "vacancy": vac.title if vac else "?", "completed": inv.completed if inv else False,
                "total_score": r.total_score, "decision": r.decision,
                "justification": r.justification, "strengths": json.loads(r.strengths),
                "weaknesses": json.loads(r.weaknesses), "areas": json.loads(r.areas),
                "video": f"/recordings/{r.video_path}" if r.video_path else None,
                "transcript": r.transcript_list(),
            })
        return out


# ---------------- chat assistant with intents ----------------
def _find_vacancy(s, params, fallback_id=None):
    vid = params.get("vacancy_id") or fallback_id
    vac = None
    with contextlib.suppress(Exception):
        vac = s.get(Vacancy, int(vid)) if vid else None
    if not vac and params.get("vacancy_title"):
        vac = s.exec(select(Vacancy).where(Vacancy.title.ilike(f"%{params['vacancy_title']}%"))).first()
    return vac


def _invite_best_after(vacancy_id: int, uid: int, base: str):
    """Callback for chained 'run analysis, then invite the best' commands."""
    def cb(run_id):
        with contextlib.closing(Session(engine)) as s:
            best = s.exec(select(Analysis).where(Analysis.vacancy_id == vacancy_id, Analysis.status == "done")
                          .order_by(Analysis.fit_score.desc())).first()
            if not best:
                return {"followup_error": "No candidate could be scored, nobody invited."}
            cv = s.get(CV, best.cv_id)
            inv, link, _ = make_invite(s, best.cv_id, vacancy_id, uid, base)
            return {"invite": {"candidate": cv.candidate_name if cv else f"CV #{best.cv_id}",
                               "fit": best.fit_score, "link": link}}
    return cb


def _exec_action(action, params, s, request, u, ctx):
    if action == "run_analysis":
        vac = _find_vacancy(s, params, ctx.get("selected_vacancy_id"))
        if not vac:
            return "Vacancy not found — nothing analyzed."
        cv_ids = [c.id for c in s.exec(select(CV).where(CV.category == vac.category)).all()]
        if not cv_ids:
            return f"No CVs in category '{vac.category}'."
        on_done = _invite_best_after(vac.id, u.id, base_url(request)) if ctx.get("then_invite") == vac.id else None
        run_id = analysis.start_run(vac.id, cv_ids, on_done=on_done)
        ctx["pending_run"] = vac.id
        extra = " The best candidate will be invited automatically when it finishes." if on_done else ""
        return {"text": f"Started analysis for '{vac.title}' on {len(cv_ids)} CV(s).{extra}", "run_id": run_id, "vacancy_id": vac.id}

    if action == "invite_best":
        vac = _find_vacancy(s, params, ctx.get("selected_vacancy_id"))
        if not vac:
            return "Vacancy not found."
        if ctx.get("pending_run") == vac.id:
            return {"text": f"Will invite the best candidate for '{vac.title}' as soon as the analysis completes."}
        best = s.exec(select(Analysis).where(Analysis.vacancy_id == vac.id, Analysis.status == "done")
                      .order_by(Analysis.fit_score.desc())).first()
        if not best:
            return f"No completed analysis for '{vac.title}' yet. Run the analysis first."
        cv = s.get(CV, best.cv_id)
        inv, link, reused = make_invite(s, best.cv_id, vac.id, u.id, base_url(request))
        return {"text": f"{'Re-used open invite for' if reused else 'Invited'} the best candidate for '{vac.title}': "
                        f"{cv.candidate_name if cv else ''} (fit {best.fit_score}/100). Interview link: {link}", "link": link}

    if action == "invite_candidate":
        cv = None
        with contextlib.suppress(Exception):
            cv = s.get(CV, int(params.get("cv_id", 0)))
        if not cv and params.get("candidate_name"):
            cv = s.exec(select(CV).where(CV.candidate_name.ilike(f"%{params['candidate_name']}%"))).first()
        if not cv:
            return "Candidate not found."
        vac = _find_vacancy(s, params, ctx.get("selected_vacancy_id"))
        if not vac:
            return "Vacancy not found — invite not created."
        inv, link, reused = make_invite(s, cv.id, vac.id, u.id, base_url(request))
        return {"text": f"{'Re-used open invite for' if reused else 'Invited'} {cv.candidate_name} to '{vac.title}'. Interview link: {link}", "link": link}

    if action == "list_candidates":
        q = select(CV)
        if params.get("category") in CATEGORIES:
            q = q.where(CV.category == params["category"])
        cvs = s.exec(q).all()
        if not cvs:
            return "No CVs stored."
        lines = [f"- #{c.id} {c.candidate_name} ({c.category}, {c.years_exp:g} yrs, AI-score {c.ai_score if c.ai_score is not None else '?'})" for c in cvs]
        return "Stored candidates:\n" + "\n".join(lines[:20])

    if action == "show_report":
        vac = _find_vacancy(s, params, None)
        rows = s.exec(select(Analysis).where(Analysis.vacancy_id == vac.id) if vac else select(Analysis)).all()
        rows = [r for r in rows if r.status == "done"]
        rows.sort(key=lambda r: -(r.fit_score or 0))
        if not rows:
            return "No completed analysis results yet."
        lines = []
        for r in rows[:8]:
            cv, v = s.get(CV, r.cv_id), s.get(Vacancy, r.vacancy_id)
            if cv and v:
                lines.append(f"- {cv.candidate_name} vs '{v.title}': fit {r.fit_score}/100, AI-score {cv.ai_score} — {r.summary[:140]}")
        return "Top results:\n" + "\n".join(lines)

    return f"Unknown action '{action}'."


CHAT_SYSTEM = """You are Ishveren's AI HR assistant for a recruiter. You answer professionally and concisely, and you can execute actions.
Reply in the same language the user writes in.

Classify every message:
- intent "chat": questions, opinions, advice, explanations, analysis of the data below → answer in "reply"; "actions" MUST be [].
- intent "action": ONLY explicit imperative commands to DO something (run, start, invite, list, show).

Allowed actions (executed in the given order):
- run_analysis {vacancy_id}
- invite_best {vacancy_id}
- invite_candidate {cv_id, vacancy_id}
- list_candidates {category?}
- show_report {vacancy_id?}
Resolve vacancy/candidate names to ids using the data below. If the user says "this vacancy", use selected_vacancy_id.
If a command is ambiguous or the target does not exist, do not guess — use intent "chat" and ask a short clarifying question.
For "chat" answers you may use the analysis/interview data below (fit scores, AI-scores, decisions) to give concrete recommendations.
Keep replies under 120 words, plain text (simple "- " bullet lists allowed, no markdown headings or bold).

Return ONLY JSON: {"intent": "chat"|"action", "actions": [{"action": "...", "params": {...}}], "reply": "..."}

Current data: """


@app.post("/api/chat")
def chat(body: dict, request: Request, u: User = Depends(require_admin)):
    message = (body.get("message") or "").strip()
    if not message:
        raise HTTPException(400, "Empty message")
    history = [m for m in (body.get("history") or []) if isinstance(m, dict) and m.get("role") in ("user", "assistant")][-8:]
    with contextlib.closing(Session(engine)) as s:
        vacs = s.exec(select(Vacancy)).all()
        cvs = s.exec(select(CV)).all()
        done = s.exec(select(Analysis).where(Analysis.status == "done")).all()
        fits = {}
        for a in done:
            fits.setdefault(a.cv_id, {})[a.vacancy_id] = a.fit_score
        reports = {r.cv_id: r for r in s.exec(select(InterviewReport)).all() if r.decision}
        context = {
            "vacancies": [{"id": v.id, "title": v.title, "category": v.category, "active": v.active} for v in vacs],
            "candidates": [{"id": c.id, "name": c.candidate_name, "category": c.category, "years": c.years_exp,
                            "ai_score": c.ai_score, "fit_by_vacancy_id": fits.get(c.id, {}),
                            "interview": ({"decision": reports[c.id].decision, "score": reports[c.id].total_score} if c.id in reports else None)}
                           for c in cvs[:60]],
            "selected_vacancy_id": body.get("vacancy_id"),
        }
        msgs = [{"role": "system", "content": CHAT_SYSTEM + json.dumps(context, ensure_ascii=False)}]
        msgs += [{"role": m["role"], "content": str(m.get("content", ""))[:1500]} for m in history]
        msgs.append({"role": "user", "content": message})
        try:
            out = llm.chat_json(msgs)
        except Exception as e:
            raise HTTPException(502, f"AI is unavailable right now: {str(e)[:120]}")
        reply = str(out.get("reply", "") or "")
        intent = out.get("intent", "chat")
        actions = out.get("actions") if isinstance(out.get("actions"), list) else (
            [{"action": out.get("action"), "params": out.get("params", {})}] if out.get("action") else [])
        actions = [a for a in actions if isinstance(a, dict) and a.get("action") and a.get("action") != "null"]
        if intent == "chat":
            actions = []
        ctx = {"selected_vacancy_id": body.get("vacancy_id")}
        # chained "analyze X ... invite best for X" → invite after the background run finishes
        names = [a["action"] for a in actions]
        if "run_analysis" in names and "invite_best" in names:
            ra = actions[names.index("run_analysis")]
            vac = _find_vacancy(s, ra.get("params") or {}, ctx["selected_vacancy_id"])
            if vac:
                ctx["then_invite"] = vac.id
        executed, run_id = [], None
        for act in actions:
            try:
                res = _exec_action(act["action"], act.get("params") or {}, s, request, u, ctx)
            except Exception as e:
                res = f"Action failed: {str(e)[:150]}"
            if isinstance(res, dict):
                executed.append({"action": act["action"], "text": res["text"], "link": res.get("link")})
                run_id = res.get("run_id") or run_id
            else:
                executed.append({"action": act["action"], "text": str(res)})
        return {"reply": reply, "intent": intent, "executed": executed, "run_id": run_id}


# ---------------- static ----------------
@app.get("/recordings/{filename}")
def get_recording(filename: str, u: User = Depends(require_admin)):
    """Recordings and live frames are admin-only (they contain candidates' video)."""
    if "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(400, "Bad filename")
    p = os.path.join(RECORDINGS_DIR, filename)
    if not os.path.isfile(p):
        raise HTTPException(404, "Not found")
    return FileResponse(p, headers={"Cache-Control": "no-store"})


@app.get("/interview/{token}")
def interview_page(token: str):
    return FileResponse(os.path.join("static", "interview.html"))


app.mount("/", StaticFiles(directory="static", html=True), name="static")


@app.on_event("startup")
def startup():
    init_db(seed=True)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
