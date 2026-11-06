"""Analysis pipeline: AI-content detector, online footprint, fit scoring."""
import io
import json
import math
import os
import re
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
from sqlmodel import select

import llm
from models import Analysis, CV, Vacancy, Session, engine, now

AI_PHRASES = [
    "passionate about", "leverage", "results-driven", "results driven", "spearheaded",
    "dynamic", "in today's fast-paced", "in today's fast paced", "fast-paced environment",
    "proven track record", "excellent communication skills", "team player",
    "think outside the box", "synergy", "meticulous", "seamlessly", "utilize",
    "cutting-edge", "unlock", "elevate", "foster", "delve", "robust",
    "align with the company", "excited to contribute", "strong background in",
]
CAMERA_MAKE_KEYS = ["Make", "Model", "Artist", "Software"]

RUNS = {}  # run_id -> {cv_id: {"step": n, "label": str, "done": bool}} ; also "finished": bool
_lock = threading.Lock()


# ---------------- Step 1: stylometric heuristics ----------------
def _sentences(text):
    return [s for s in re.split(r"[.!?]+", text) if len(s.split()) > 2]


def stylometry(text):
    words = re.findall(r"[a-zA-Z']+", text.lower())
    sents = _sentences(text)
    evidence, score = [], 0
    if not words or not sents:
        return 40, ["Not enough text to analyze"], []
    lens = [len(s.split()) for s in sents]
    mean = sum(lens) / len(lens)
    var = sum((x - mean) ** 2 for x in lens) / len(lens)
    burst = math.sqrt(var) / mean if mean else 0          # coefficient of variation
    ttr = len(set(words)) / len(words)
    low = text.lower()
    hits = [p for p in AI_PHRASES if p in low]
    per1000 = len(hits) / len(words) * 1000

    if burst < 0.35:
        score += 25
        evidence.append(f"Low sentence-length variance (burstiness {burst:.2f} < 0.35) — machine-uniform rhythm")
    elif burst > 0.65:
        score -= 10
        evidence.append(f"Human-like burstiness ({burst:.2f})")
    if ttr < 0.35 and len(words) > 200:
        score += 15
        evidence.append(f"Low type-token ratio ({ttr:.2f}) — repetitive vocabulary")
    if per1000 > 4:
        score += 30
        evidence.append(f"{len(hits)} typical AI phrases per 1000 words: {', '.join(hits[:6])}")
    elif hits:
        score += min(15, 4 * len(hits))
        evidence.append(f"AI-style phrases found: {', '.join(hits[:6])}")
    if mean > 24:
        score += 10
        evidence.append(f"Uniformly long sentences (avg {mean:.0f} words)")
    return max(0, min(100, score)), evidence, hits


# ---------------- Step 1b: image metadata (EXIF/XMP) ----------------
GENERATOR_SIGNATURES = ["midjourney", "dall-e", "dall.e", "stable diffusion", "stablediffusion",
                        "c2pa", "generated", "openai", "adobe firefly", "firefly", "flux", "imagen"]


def scan_pdf_images(content: bytes):
    """Extract images from PDF bytes and check EXIF/XMP for AI-generator signatures."""
    evidence, suspicion = [], 0
    try:
        from pypdf import PdfReader
        from PIL import Image
        reader = PdfReader(io.BytesIO(content))
        count = 0
        for page in reader.pages:
            for img in (page.images or []):
                count += 1
                try:
                    pil = Image.open(io.BytesIO(img.data))
                    meta = {}
                    if pil._getexif():  # EXIF
                        from PIL.ExifTags import TAGS
                        meta = {TAGS.get(k, k): str(v)[:80] for k, v in pil._getexif().items()}
                    xmp = ""
                    try:
                        xmp = pil.info.get("xmp", b"").decode("utf-8", "ignore")[:4000] if isinstance(pil.info.get("xmp"), bytes) else str(pil.info.get("xmp", ""))[:4000]
                    except Exception:
                        pass
                    blob = (json.dumps(meta) + xmp).lower()
                    for sig in GENERATOR_SIGNATURES:
                        if sig in blob:
                            suspicion += 40
                            evidence.append(f"AI-generator signature '{sig}' found in image metadata")
                    if not meta.get("Make") and not meta.get("Model"):
                        suspicion += 8
                        evidence.append(f"Image '{img.name}' has no camera EXIF (weak signal)")
                    else:
                        evidence.append(f"Image '{img.name}' has camera EXIF ({meta.get('Make','?')}) — likely real photo")
                except Exception:
                    continue
        if count == 0:
            evidence.append("No images in document (nothing to metadata-scan)")
    except Exception as e:
        evidence.append(f"Image scan failed: {str(e)[:80]}")
    return min(100, suspicion), evidence


def ai_detect(cv: CV, doc_bytes: bytes | None):
    """Combine stylometry + image metadata + LLM judge -> (0-100, verdict, evidence)."""
    h_score, h_evidence, _ = stylometry(cv.text)
    i_score, i_evidence = (scan_pdf_images(doc_bytes) if doc_bytes else (0, ["Binary not stored; image metadata skipped"]))
    evidence = h_evidence + i_evidence
    judge = {}
    try:
        judge = llm.chat_json([
            {"role": "system", "content": "You detect AI-generated CV text. Judge style: generic phrasing, lack of concrete numbers/names, template structure, buzzword density. Be calibrated: most human CVs score 10-40."},
            {"role": "user", "content": f"CV text (truncated):\n{cv.text[:5000]}\n\nLocal heuristics suggest {h_score}/100. Return JSON: {{\"probability\": 0-100, \"reasons\": [\"...\"]}}"},
        ])
    except Exception:
        judge = {"probability": h_score, "reasons": ["LLM judge unavailable, heuristics only"]}
    j_score = judge.get("probability", h_score)
    try:
        j_score = int(float(j_score))
    except Exception:
        j_score = h_score
    reasons = judge.get("reasons", [])
    if isinstance(reasons, list):
        evidence = [f"LLM judge: {r}" for r in reasons[:5]] + evidence
    final = max(0, min(100, round(0.5 * j_score + 0.35 * h_score + 0.15 * i_score)))
    if final >= 70:
        verdict = "Likely AI-generated"
    elif final >= 40:
        verdict = "Suspicious — mixed signals"
    else:
        verdict = "Likely human-written"
    return final, verdict, evidence[:12]


# ---------------- Step 2: online footprint ----------------
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}


def github_footprint(username):
    out = {"username": username, "repos": 0, "stars": 0, "languages": [], "top": [], "recent_push": None, "error": None}
    try:
        r = httpx.get(f"https://api.github.com/users/{username}", headers=UA, timeout=6,
                      follow_redirects=True)
        if r.status_code != 200:
            out["error"] = f"user not found ({r.status_code})"
            return out
        u = r.json()
        out["repos"] = u.get("public_repos", 0)
        out["recent_push"] = (u.get("updated_at") or "")[:10]
        r2 = httpx.get(f"https://api.github.com/users/{username}/repos?per_page=100&sort=updated",
                       headers=UA, timeout=8, follow_redirects=True)
        repos = r2.json() if r2.status_code == 200 else []
        repos = [x for x in repos if not x.get("fork")]
        out["stars"] = sum(x.get("stargazers_count", 0) for x in repos)
        langs = {}
        for x in repos:
            if x.get("language"):
                langs[x["language"]] = langs.get(x["language"], 0) + 1
        out["languages"] = [k for k, _ in sorted(langs.items(), key=lambda kv: -kv[1])[:6]]
        out["top"] = [{"name": x["name"], "stars": x["stargazers_count"], "lang": x.get("language"),
                       "desc": (x.get("description") or "")[:100],
                       "pushed": (x.get("pushed_at") or "")[:10]}
                      for x in sorted(repos, key=lambda x: -x.get("stargazers_count", 0))[:5]]
    except Exception as e:
        out["error"] = str(e)[:120]
    return out


def _github_user_from_links(links):
    for l in links:
        m = re.search(r"github\.com/([A-Za-z0-9_-]{2,39})", l.get("url", ""))
        if m:
            return m.group(1)
    return None


def footprint(cv: CV):
    result = {"github": None, "links": [], "summary": "", "consistent": None}
    gh_user = _github_user_from_links(cv.links_list())
    # also try name-based guess when no link
    if not gh_user and cv.candidate_name:
        pass  # too noisy to guess; skip
    if gh_user:
        result["github"] = github_footprint(gh_user)
    for l in cv.links_list()[:4]:
        url = l.get("url", "")
        entry = {"url": url, "type": l.get("type", "link"), "status": "ok", "note": ""}
        if "linkedin.com" in url:
            entry["status"] = "blocked"
            entry["note"] = "LinkedIn blocks anonymous scraping (999) — marked not accessible"
        else:
            try:
                r = httpx.get(url, headers=UA, timeout=5, follow_redirects=True)
                if r.status_code == 200:
                    title = re.search(r"<title[^>]*>(.*?)</title>", r.text, re.S | re.I)
                    entry["note"] = ("reachable — " + title.group(1).strip()[:90]) if title else "reachable"
                else:
                    entry["status"] = f"http {r.status_code}"
                    entry["note"] = "not accessible — continuing"
            except Exception as e:
                entry["status"] = "unreachable"
                entry["note"] = f"not accessible ({str(e)[:60]}) — continuing"
        result["links"].append(entry)
    try:
        gh_brief = json.dumps(result["github"] or {"skipped": "no GitHub link in CV"})[:1500]
        links_brief = json.dumps(result["links"])[:800]
        claims = cv.text[:1500]
        out = llm.chat_json([
            {"role": "system", "content": "You assess a candidate's online footprint vs their CV claims. Be factual and brief."},
            {"role": "user", "content": f"Candidate: {cv.candidate_name}\nCV claims (truncated): {claims}\n\nGitHub data: {gh_brief}\nOther links: {links_brief}\n\nReturn JSON: {{\"summary\": \"3-4 sentences\", \"consistent\": true/false, \"notes\": [\"...\"]}}"},
        ])
        result["summary"] = out.get("summary", "")
        result["consistent"] = out.get("consistent")
        result["notes"] = out.get("notes", [])
    except Exception as e:
        result["summary"] = f"Footprint summary unavailable: {str(e)[:80]}"
    return result


# ---------------- Step 3: fit scoring ----------------
def fit_score(cv: CV, vacancy) -> dict:
    out = llm.chat_json([
        {"role": "system", "content": "You are a senior recruiter. Score candidate-job fit strictly against the stated requirements. Rubric: 85-100 meets all must-haves with proven depth; 70-84 meets most must-haves; 50-69 partial fit / notable gaps; 30-49 weak fit; <30 wrong profile. Required experience years are a must-have. Cite concrete evidence from the CV in strengths; never invent facts. missing_skills = requirements not evidenced in the CV."},
        {"role": "user", "content": f"VACANCY: {vacancy.title} ({vacancy.category})\nDescription: {vacancy.description}\nRequirements: {vacancy.requirements}\n\nCANDIDATE: {cv.candidate_name}, {cv.years_exp} yrs experience\nSkills: {', '.join(cv.skills_list())}\nCV (truncated):\n{cv.text[:4000]}\n\nReturn JSON: {{\"fit_score\": 0-100, \"strengths\": [\"...\"], \"weaknesses\": [\"...\"], \"missing_skills\": [\"...\"], \"summary\": \"2-3 sentences\"}}"},
    ], model=llm.FAST_MODEL)
    try:
        out["fit_score"] = max(0, min(100, int(float(out.get("fit_score", 0)))))
    except Exception:
        out["fit_score"] = 50
    for k in ("strengths", "weaknesses", "missing_skills"):
        if not isinstance(out.get(k), list):
            out[k] = [str(out.get(k) or "")]
    return out


def vacancy_hash(vac) -> str:
    import hashlib
    return hashlib.sha1(f"{vac.title}|{vac.category}|{vac.description}|{vac.requirements}".encode()).hexdigest()[:16]


# ---------------- Fast path: network checks in parallel + ONE LLM call ----------------
def _check_link(l):
    url = l.get("url", "")
    entry = {"url": url, "type": l.get("type", "link"), "status": "ok", "note": ""}
    if "linkedin.com" in url:
        entry.update(status="blocked", note="LinkedIn blocks anonymous scraping (999) — marked not accessible")
        return entry
    try:
        r = httpx.get(url, headers=UA, timeout=5, follow_redirects=True)
        if r.status_code == 200:
            title = re.search(r"<title[^>]*>(.*?)</title>", r.text, re.S | re.I)
            entry["note"] = ("reachable — " + title.group(1).strip()[:90]) if title else "reachable"
        else:
            entry.update(status=f"http {r.status_code}", note="not accessible — continuing")
    except Exception as e:
        entry.update(status="unreachable", note=f"not accessible ({str(e)[:60]}) — continuing")
    return entry


def footprint_fetch(cv: CV):
    """GitHub API + link checks, all in parallel, no LLM."""
    links = cv.links_list()[:4]
    gh_user = _github_user_from_links(cv.links_list())
    with ThreadPoolExecutor(max_workers=5) as ex:
        gh_f = ex.submit(github_footprint, gh_user) if gh_user else None
        link_res = list(ex.map(_check_link, links))
    return {"github": gh_f.result() if gh_f else None, "links": link_res, "summary": "", "consistent": None, "notes": []}


def score_all(cv: CV, vac, h_score: int, fp: dict) -> dict:
    """Single LLM call: AI-text judge + footprint consistency + fit scoring."""
    gh_brief = json.dumps(fp.get("github") or {"skipped": "no GitHub link in CV"})[:1200]
    links_brief = json.dumps(fp.get("links") or [])[:600]
    out = llm.chat_json([
        {"role": "system", "content": "You are a senior recruiter and CV-forensics expert. Answer fast and concisely in JSON.\n"
         "1) ai_probability 0-100 that the CV text is AI-generated (generic phrasing, no concrete numbers/names, template structure, buzzwords). Most human CVs score 10-40. ai_reasons must cite concrete features of the text itself (do not mention the local score).\n"
         "2) Footprint: compare GitHub/links data with CV claims.\n"
         "3) fit_score 0-100 vs vacancy requirements. Rubric: 85-100 meets all must-haves with proven depth; 70-84 most must-haves; 50-69 partial fit; 30-49 weak; <30 wrong profile. "
         "Required years of experience are a must-have. Use only evidence from the CV, never invent facts."},
        {"role": "user", "content": f"VACANCY: {vac.title} ({vac.category})\nDescription: {vac.description}\nRequirements: {vac.requirements}\n\n"
         f"CANDIDATE: {cv.candidate_name}, {cv.years_exp} yrs\nSkills: {', '.join(cv.skills_list())}\nCV:\n{cv.text[:3000]}\n\n"
         f"Local stylometry AI-score: {h_score}/100\nGitHub data: {gh_brief}\nOther links: {links_brief}\n\n"
         'Return JSON: {"ai_probability": 0-100, "ai_reasons": ["max 3 short"], "footprint_summary": "1-2 sentences", "consistent": true/false/null, '
         '"fit_score": 0-100, "strengths": ["max 4"], "weaknesses": ["max 3"], "missing_skills": ["..."], "summary": "2 sentences"}'},
    ], model=llm.FAST_MODEL)
    try:
        out["fit_score"] = max(0, min(100, int(float(out.get("fit_score", 0)))))
    except Exception:
        out["fit_score"] = 50
    for k in ("strengths", "weaknesses", "missing_skills", "ai_reasons"):
        if not isinstance(out.get(k), list):
            out[k] = [str(out[k])] if out.get(k) else []
    return out


def combine_ai(h_score, h_ev, i_score, i_ev, j_score, reasons):
    try:
        j_score = int(float(j_score))
    except Exception:
        j_score = h_score
    final = max(0, min(100, round(0.5 * j_score + 0.35 * h_score + 0.15 * i_score)))
    verdict = "Likely AI-generated" if final >= 70 else "Suspicious — mixed signals" if final >= 40 else "Likely human-written"
    evidence = [f"LLM judge: {r}" for r in reasons[:4]] + h_ev + i_ev
    return final, verdict, evidence[:12]


# ---------------- Pipeline runner (background thread) ----------------
UPLOADS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
WORKERS = int(os.environ.get("ANALYSIS_WORKERS", "8"))


def _doc_bytes(cv: CV):
    if cv.file_path and cv.file_path.lower().endswith(".pdf"):
        p = os.path.join(UPLOADS_DIR, os.path.basename(cv.file_path))
        if os.path.exists(p):
            with open(p, "rb") as f:
                return f.read()
    return None


def _analyze_one(vacancy_id: int, cid: int, run_id: str, force: bool = False):
    def _set(step, label, done=False, error=False):
        with _lock:
            RUNS.setdefault(run_id, {})[str(cid)] = {"step": step, "label": label, "done": done, "error": error}

    with Session(engine) as s:
        vac = s.get(Vacancy, vacancy_id)
        cv = s.get(CV, cid)
        if not cv or not vac:
            _set(3, "Skipped (not found)", done=True, error=True)
            return
        try:
            cached = cv.ai_score is not None and bool(cv.github) and not force
            _set(1, "AI-content detection…")
            h_score, h_ev, _ = stylometry(cv.text)
            i_score, i_ev = 0, []
            if not cached:
                b = _doc_bytes(cv)
                i_score, i_ev = scan_pdf_images(b) if b else (0, ["Original file not stored (seed/text CV); image metadata skipped"])

            _set(2, "Checking online footprint…")
            if cached:
                fp = json.loads(cv.github)
                f = fit_score(cv, vac)   # AI-score & footprint don't depend on the vacancy — reuse them
            else:
                fp = footprint_fetch(cv)
                _set(3, "AI scoring (AI-text, footprint, fit)…")
                f = score_all(cv, vac, h_score, fp)
                cv.ai_score, cv.ai_verdict, ev = combine_ai(h_score, h_ev, i_score, i_ev, f.get("ai_probability", h_score), f.get("ai_reasons", []))
                cv.ai_evidence = json.dumps(ev)
                fp["summary"] = str(f.get("footprint_summary", ""))
                fp["consistent"] = f.get("consistent")
                cv.github = json.dumps(fp)
                s.add(cv); s.commit()

            _set(3, "Scoring fit vs vacancy…")
            a = s.exec(select(Analysis).where(Analysis.cv_id == cid, Analysis.vacancy_id == vacancy_id)).first() \
                or Analysis(cv_id=cid, vacancy_id=vacancy_id)
            a.fit_score = f["fit_score"]
            a.strengths = json.dumps(f.get("strengths", []))
            a.weaknesses = json.dumps(f.get("weaknesses", []))
            a.missing_skills = json.dumps(f.get("missing_skills", []))
            a.summary = f.get("summary", "")
            a.footprint_summary = fp.get("summary", "")
            a.status = "done"
            a.vac_hash = vacancy_hash(vac)
            a.updated_at = now()
            s.add(a); s.commit()
            _set(3, "Done", done=True)
        except Exception as e:
            _set(3, f"Error: {str(e)[:120]}", done=True, error=True)
            try:
                s.rollback()
                a = s.exec(select(Analysis).where(Analysis.cv_id == cid, Analysis.vacancy_id == vacancy_id)).first() \
                    or Analysis(cv_id=cid, vacancy_id=vacancy_id)
                a.status = "error"; a.updated_at = now(); s.add(a); s.commit()
            except Exception:
                pass


def run_analysis(vacancy_id: int, cv_ids: list[int], run_id: str, on_done=None, force=False):
    """Analyze CVs in parallel (LLM/network bound), then call on_done(run_id) e.g. to auto-invite the best."""
    with ThreadPoolExecutor(max_workers=max(1, WORKERS)) as ex:
        list(ex.map(lambda cid: _analyze_one(vacancy_id, cid, run_id, force), cv_ids))
    if on_done:
        try:
            extra = on_done(run_id) or {}
            with _lock:
                RUNS.setdefault(run_id, {}).update(extra)
        except Exception as e:
            with _lock:
                RUNS.setdefault(run_id, {})["followup_error"] = str(e)[:150]
    with _lock:
        RUNS.setdefault(run_id, {})["finished"] = True


def start_run(vacancy_id, cv_ids, on_done=None, force=False) -> str:
    run_id = f"run_{int(time.time())}_{secrets.token_hex(3)}"
    with _lock:
        RUNS[run_id] = {str(c): {"step": 0, "label": "Queued", "done": False, "error": False} for c in cv_ids}
        RUNS[run_id]["vacancy_id"] = vacancy_id
    threading.Thread(target=run_analysis, args=(vacancy_id, cv_ids, run_id, on_done, force), daemon=True).start()
    return run_id
