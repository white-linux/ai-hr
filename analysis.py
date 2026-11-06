"""Analysis pipeline: AI-content detector, online footprint, fit scoring."""
import io
import json
import math
import re
import secrets
import threading
import time

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
        r = httpx.get(f"https://api.github.com/users/{username}", headers=UA, timeout=15,
                      follow_redirects=True)
        if r.status_code != 200:
            out["error"] = f"user not found ({r.status_code})"
            return out
        u = r.json()
        out["repos"] = u.get("public_repos", 0)
        out["recent_push"] = (u.get("updated_at") or "")[:10]
        r2 = httpx.get(f"https://api.github.com/users/{username}/repos?per_page=100&sort=updated",
                       headers=UA, timeout=20, follow_redirects=True)
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
                r = httpx.get(url, headers=UA, timeout=12, follow_redirects=True)
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
        {"role": "system", "content": "You are a rigorous technical recruiter. Score candidate-job fit honestly."},
        {"role": "user", "content": f"VACANCY: {vacancy.title} ({vacancy.category})\nDescription: {vacancy.description}\nRequirements: {vacancy.requirements}\n\nCANDIDATE: {cv.candidate_name}, {cv.years_exp} yrs experience\nSkills: {', '.join(cv.skills_list())}\nCV (truncated):\n{cv.text[:4000]}\n\nReturn JSON: {{\"fit_score\": 0-100, \"strengths\": [\"...\"], \"weaknesses\": [\"...\"], \"missing_skills\": [\"...\"], \"summary\": \"2-3 sentences\"}}"},
    ])
    try:
        out["fit_score"] = max(0, min(100, int(float(out.get("fit_score", 0)))))
    except Exception:
        out["fit_score"] = 50
    for k in ("strengths", "weaknesses", "missing_skills"):
        if not isinstance(out.get(k), list):
            out[k] = [str(out.get(k) or "")]
    return out


# ---------------- Pipeline runner (background thread) ----------------
def run_analysis(vacancy_id: int, cv_ids: list[int], run_id: str):
    def _set(cid, step, label, done=False):
        with _lock:
            RUNS.setdefault(run_id, {})[str(cid)] = {"step": step, "label": label, "done": done}

    with Session(engine) as s:
        vac = s.get(Vacancy, vacancy_id)
        for cid in cv_ids:
            try:
                cv = s.get(CV, cid)
                if not cv or not vac:
                    continue
                _set(cid, 1, "AI-content detection…")
                score, verdict, evid = ai_detect(cv, None)
                cv.ai_score, cv.ai_verdict, cv.ai_evidence = score, verdict, json.dumps(evid)
                s.add(cv); s.commit()

                _set(cid, 2, "Checking online footprint…")
                fp = footprint(cv)
                cv.github = json.dumps(fp)
                s.add(cv); s.commit()

                _set(cid, 3, "Scoring fit vs vacancy…")
                f = fit_score(cv, vac)
                existing = s.exec(select(Analysis).where(
                    Analysis.cv_id == cid, Analysis.vacancy_id == vacancy_id)).first()
                a = existing or Analysis(cv_id=cid, vacancy_id=vacancy_id)
                a.fit_score = f["fit_score"]
                a.strengths = json.dumps(f.get("strengths", []))
                a.weaknesses = json.dumps(f.get("weaknesses", []))
                a.missing_skills = json.dumps(f.get("missing_skills", []))
                a.summary = f.get("summary", "")
                a.footprint_summary = fp.get("summary", "")
                a.status = "done"
                a.updated_at = now()
                s.add(a); s.commit()
                _set(cid, 3, "Done", done=True)
            except Exception as e:
                _set(cid, 3, f"Error: {str(e)[:120]}", done=True)
                try:
                    existing = s.exec(select(Analysis).where(Analysis.cv_id == cid, Analysis.vacancy_id == vacancy_id)).first()
                    a = existing or Analysis(cv_id=cid, vacancy_id=vacancy_id)
                    a.status = "error"; a.updated_at = now(); s.add(a); s.commit()
                except Exception:
                    pass
    with _lock:
        RUNS.setdefault(run_id, {})["finished"] = True


def start_run(vacancy_id, cv_ids) -> str:
    run_id = f"run_{int(time.time())}_{secrets.token_hex(3)}"
    threading.Thread(target=run_analysis, args=(vacancy_id, cv_ids, run_id), daemon=True).start()
    return run_id
