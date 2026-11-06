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
SECRET = "hr-demo-secret-2026"
COOKIE = "session"
RECORDINGS_DIR = os.path.join(os.path.dirname(__file__), "recordings")
os.makedirs(RECORDINGS_DIR, exist_ok=True)

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


def cv_json(cv: CV):
    return {
        "id": cv.id, "filename": cv.filename, "category": cv.category,
        "name": cv.candidate_name, "email": cv.email, "skills": cv.skills_list(),
        "years_exp": cv.years_exp, "links": cv.links_list(),
        "ai_score": cv.ai_score, "ai_verdict": cv.ai_verdict, "ai_evidence": cv.evidence_list(),
        "github": (lambda raw: raw.get("github") if isinstance(raw, dict) and "github" in raw else raw)(json.loads(cv.github)) if cv.github else None,
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


def store_cv(s, filename, text, owner_id=None):
    meta = parse_cv_text(text)
    cv = CV(filename=filename, text=text, owner_id=owner_id,
            category=meta.get("category", "Other"),
            candidate_name=meta.get("name") or "",
            email=meta.get("email") or "",
            years_experience=meta.get("years_experience") or 0)
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
                cv = store_cv(s, f.filename, text)
                out.append({"file": f.filename, "cv": cv_json(cv)})
            except Exception as e:
                out.append({"file": f.filename, "error": str(e)[:150]})
    return {"results": out}


@app.post("/api/apply")
def apply(vacancy_id: int = Form(...), file: UploadFile = File(...), u: User = Depends(current_user)):
    data = file.file.read()
    text = extract_text(file.filename, data)
    if len(text.strip()) < 50:
        raise HTTPException(400, "Could not extract text from file")
    with contextlib.closing(Session(engine)) as s:
        cv = store_cv(s, file.filename, text, owner_id=u.id)
        return {"ok": True, "cv": cv_json(cv)}


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
    run_id = analysis.start_run(vid, cv_ids)
    return {"run_id": run_id, "cv_count": len(cv_ids)}


@app.get("/api/analyze/progress/{run_id}")
def progress(run_id: str, u: User = Depends(require_admin)):
    with analysis._lock:
        return analysis.RUNS.get(run_id, {"finished": True})


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
@app.post("/api/invites")
def create_invite(body: dict, request: Request, u: User = Depends(require_admin)):
    cv_id, vid = body.get("cv_id"), body.get("vacancy_id")
    if not cv_id or not vid:
        raise HTTPException(400, "cv_id and vacancy_id required")
    with contextlib.closing(Session(engine)) as s:
        if not s.get(CV, cv_id) or not s.get(Vacancy, vid):
            raise HTTPException(404, "CV or vacancy not found")
        inv = Invite(token=secrets.token_urlsafe(16), cv_id=cv_id, vacancy_id=vid, created_by=u.id)
        s.add(inv); s.commit(); s.refresh(inv)
        print(f"[email-log] Interview invite for CV #{cv_id}: {base_url(request)}/interview/{inv.token}")
        return {"id": inv.id, "token": inv.token, "link": f"{base_url(request)}/interview/{inv.token}"}


@app.get("/api/invites")
def list_invites(request: Request, u: User = Depends(require_admin)):
    with contextlib.closing(Session(engine)) as s:
        out = []
        for inv in s.exec(select(Invite).order_by(Invite.id.desc())).all():
            cv = s.get(CV, inv.cv_id)
            rep = s.exec(select(InterviewReport).where(InterviewReport.invite_id == inv.id)).first()
            out.append({
                "id": inv.id, "token": inv.token, "completed": inv.completed,
                "link": f"{base_url(request)}/interview/{inv.token}",
                "candidate": cv.candidate_name if cv else f"CV#{inv.cv_id}",
                "vacancy_id": inv.vacancy_id,
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
                out.append({"link": f"{base_url(request)}/interview/{inv.token}", "completed": inv.completed,
                            "vacancy_id": inv.vacancy_id, "cv_filename": cv.filename})
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
        }


@app.post("/api/interview/{token}/start")
def interview_start(token: str):
    iid, cv_id, vid, inv = _interview_invite(token)
    with contextlib.closing(Session(engine)) as s:
        inv = s.get(Invite, iid)
        vac = s.get(Vacancy, vid)
        cv = s.get(CV, cv_id)
        if inv.completed:
            raise HTTPException(400, "Interview already completed")
        questions = json.loads(inv.questions)
        if not questions:
            q = llm.chat_json([
                {"role": "system", "content": "You prepare AI interview questions. Mix basics and role-specific questions. Questions must be answerable by voice in 1-2 minutes."},
                {"role": "user", "content": f"Vacancy: {vac.title} — {vac.description}\nRequirements: {vac.requirements}\nCandidate skills: {', '.join(cv.skills_list())}\nCandidate CV (truncated): {cv.text[:2000]}\n\nGenerate 5-6 interview questions. Return JSON: {{\"questions\": [\"...\"]}}"},
            ])
            questions = [str(x) for x in q.get("questions", [])][:6]
            if not questions:
                questions = [f"Tell me about your experience relevant to {vac.title}.",
                             "What are your strongest skills?", "Describe a difficult project you completed."]
            inv.questions = json.dumps(questions)
            inv.state = json.dumps({"q_index": 0, "awaiting_followup": False})
            s.add(inv)
            rep = InterviewReport(invite_id=iid, cv_id=cv_id, vacancy_id=vid)
            s.add(rep)
            s.commit()
        intro = llm.chat([
            {"role": "system", "content": "You are Nova, a warm and lively AI interviewer with a bit of personality (like a friendly robot colleague). Introduce yourself by name in 3-5 short conversational sentences: welcome the candidate, mention the role, explain the format (5-6 questions answered by voice), reassure them and wish luck. Sound human and encouraging, not corporate."},
            {"role": "user", "content": f"Candidate {cv.candidate_name} is interviewing for {vac.title}."},
        ], temperature=0.7)
        return {"intro": intro, "question": questions[0], "total": len(questions)}


@app.post("/api/interview/{token}/answer")
def interview_answer(token: str, body: dict):
    iid, cv_id, vid, _ = _interview_invite(token)
    answer = (body.get("answer") or "").strip()
    if not answer:
        raise HTTPException(400, "Empty answer")
    with contextlib.closing(Session(engine)) as s:
        inv = s.get(Invite, iid)
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

        out = llm.chat_json([
            {"role": "system", "content": "You are Nova, a warm AI interviewer. React like a real human interviewer would in conversation: acknowledge something specific from the answer in 1-2 natural sentences (e.g. 'Oh, nice, the semaphore trick — that's exactly how you keep the pool from melting down.'). Score fairly: concise correct answers 6-8, wrong/vague 2-4, excellent 9-10."},
            {"role": "user", "content": f"Role: {vac.title}. Question: {q_text}\nCandidate answer: {answer}\n\nReturn JSON: {{\"score\": 0-10, \"feedback\": \"1-2 conversational sentences reacting to what was said\", \"followup\": null or \"one short probing question if the answer is vague, else null\"}}"},
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
            scores = [t.get("score", 5) for t in transcript if t.get("score") is not None]
            rep.total_score = round(sum(scores) / len(scores), 1) if scores else 0
            final = llm.chat_json([
                {"role": "system", "content": "You write final hiring reports. Be decisive."},
                {"role": "user", "content": f"Role: {vac.title}\nTranscript with scores: {json.dumps(transcript)[:5000]}\nCV summary: {cv.candidate_name}, skills: {', '.join(cv.skills_list())}\n\nReturn JSON: {{\"decision\": \"HIRE|CONSIDER|REJECT\", \"justification\": \"3-4 sentences\", \"strengths\": [\"...\"], \"weaknesses\": [\"...\"], \"areas\": [\"knowledge areas demonstrated\"]}}"},
            ])
            rep.decision = final.get("decision", "CONSIDER") if final.get("decision") in ("HIRE", "CONSIDER", "REJECT") else "CONSIDER"
            rep.justification = str(final.get("justification", ""))
            rep.strengths = json.dumps([str(x) for x in final.get("strengths", [])][:6])
            rep.weaknesses = json.dumps([str(x) for x in final.get("weaknesses", [])][:6])
            rep.areas = json.dumps([str(x) for x in final.get("areas", [])][:8])
            inv.completed = True
            s.add(inv)
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
def _exec_action(action, params, s, request, u):
    if action == "run_analysis":
        vid = params.get("vacancy_id")
        vac = s.get(Vacancy, int(vid)) if vid else None
        if not vac:
            return "Vacancy not found — nothing analyzed."
        cv_ids = [c.id for c in s.exec(select(CV).where(CV.category == vac.category)).all()]
        if not cv_ids:
            return f"No CVs in category '{vac.category}'."
        run_id = analysis.start_run(vac.id, cv_ids)
        return {"text": f"Started analysis for '{vac.title}' on {len(cv_ids)} CV(s). Watch the progress panel.", "run_id": run_id, "vacancy_id": vac.id}

    if action == "invite_best":
        vid = params.get("vacancy_id")
        vac = s.get(Vacancy, int(vid)) if vid else None
        if not vac:
            return "Vacancy not found."
        best = s.exec(select(Analysis).where(Analysis.vacancy_id == vac.id, Analysis.status == "done")
                      .order_by(Analysis.fit_score.desc())).first()
        if not best:
            return f"No completed analysis for '{vac.title}' yet. Run the analysis first."
        inv = Invite(token=secrets.token_urlsafe(16), cv_id=best.cv_id, vacancy_id=vac.id, created_by=u.id)
        s.add(inv); s.commit(); s.refresh(inv)
        link = f"{base_url(request)}/interview/{inv.token}"
        print(f"[email-log] Invite (best) for CV #{best.cv_id}: {link}")
        return {"text": f"Invited the best candidate for '{vac.title}' (fit {best.fit_score}/100). Interview link: {link}", "link": link}

    if action == "invite_candidate":
        cv = s.get(CV, int(params.get("cv_id", 0)))
        if not cv:
            return "Candidate not found."
        vac = None
        if params.get("vacancy_id"):
            vac = s.get(Vacancy, int(params["vacancy_id"]))
        elif params.get("vacancy_title"):
            vac = s.exec(select(Vacancy).where(Vacancy.title.ilike(f"%{params['vacancy_title']}%"))).first()
        if not vac:
            return "Vacancy not found — invite not created."
        inv = Invite(token=secrets.token_urlsafe(16), cv_id=cv.id, vacancy_id=vac.id, created_by=u.id)
        s.add(inv); s.commit(); s.refresh(inv)
        link = f"{base_url(request)}/interview/{inv.token}"
        return {"text": f"Invited {cv.candidate_name}. Interview link: {link}", "link": link}

    if action == "list_candidates":
        q = select(CV)
        if params.get("category") in CATEGORIES:
            q = q.where(CV.category == params["category"])
        cvs = s.exec(q).all()
        if not cvs:
            return "No CVs stored."
        lines = [f"- #{c.id} {c.candidate_name} ({c.category}, {c.years_exp} yrs, AI-score {c.ai_score if c.ai_score is not None else '?'})" for c in cvs]
        return "Stored candidates:\n" + "\n".join(lines[:15])

    if action == "show_report":
        vid = params.get("vacancy_id")
        rows = s.exec(select(Analysis).where(Analysis.vacancy_id == int(vid)) if vid else select(Analysis)).all()
        rows = [r for r in rows if r.status == "done"]
        rows.sort(key=lambda r: -(r.fit_score or 0))
        if not rows:
            return "No completed analysis results yet."
        lines = []
        for r in rows[:8]:
            cv = s.get(CV, r.cv_id)
            vac = s.get(Vacancy, r.vacancy_id)
            lines.append(f"- {cv.candidate_name} vs '{vac.title}': fit {r.fit_score}/100, AI-score {cv.ai_score} — {r.summary[:140]}")
        return "Top results:\n" + "\n".join(lines)

    return f"Unknown action '{action}'."


@app.post("/api/chat")
def chat(body: dict, request: Request, u: User = Depends(require_admin)):
    message = (body.get("message") or "").strip()
    if not message:
        raise HTTPException(400, "Empty message")
    with contextlib.closing(Session(engine)) as s:
        vacs = s.exec(select(Vacancy)).all()
        cvs = s.exec(select(CV)).all()
        context = {
            "vacancies": [{"id": v.id, "title": v.title, "category": v.category, "active": v.active} for v in vacs],
            "candidates": [{"id": c.id, "name": c.candidate_name, "category": c.category,
                            "fit_analyzed": bool(s.exec(select(Analysis).where(Analysis.cv_id == c.id, Analysis.status == "done")).first())}
                           for c in cvs[:30]],
            "selected_vacancy_id": body.get("vacancy_id"),
        }
        out = llm.chat_json([
            {"role": "system", "content": "You are an AI HR assistant with optional actions. Classify the user message.\n- intent 'chat': any question, opinion, or advice request → just answer in 'reply', action must be null.\n- intent 'action': ONLY explicit commands to DO something. Allowed actions: run_analysis {vacancy_id}, invite_best {vacancy_id}, invite_candidate {cv_id, vacancy_id}, list_candidates {category?}, show_report {vacancy_id?}. Multiple actions allowed as 'actions': [{action, params}, ...].\nWrite a short helpful 'reply' in all cases.\nCurrent data: " + json.dumps(context)},
            {"role": "user", "content": message},
        ])
        reply = out.get("reply", "")
        intent = out.get("intent", "chat")
        executed = []
        actions = out.get("actions") if isinstance(out.get("actions"), list) else ([{"action": out.get("action"), "params": out.get("params", {})}] if out.get("action") else [])
        run_id = None
        for act in actions:
            if not isinstance(act, dict) or not act.get("action") or act.get("action") == "null":
                continue
            try:
                res = _exec_action(act["action"], act.get("params", {}) or {}, s, request, u)
            except Exception as e:
                res = f"Action failed: {str(e)[:150]}"
            if isinstance(res, dict):
                executed.append({"action": act["action"], "text": res["text"], "link": res.get("link")})
                run_id = res.get("run_id") or run_id
            else:
                executed.append({"action": act["action"], "text": str(res)})
        return {"reply": reply, "intent": intent, "executed": executed, "run_id": run_id}


# ---------------- static ----------------
app.mount("/recordings", StaticFiles(directory=RECORDINGS_DIR), name="recordings")


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
