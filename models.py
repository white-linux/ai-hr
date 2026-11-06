"""SQLModel models + DB setup + seeding."""
import hashlib
import json
import os
import secrets
from datetime import datetime, timezone

from sqlmodel import Field, SQLModel, Session, create_engine, select

DB_PATH = os.path.join(os.path.dirname(__file__), "hr.db")
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})

CATEGORIES = ["Programmer", "Sales", "Manager", "Designer", "Marketing", "HR", "Other"]


def now():
    return datetime.now(timezone.utc).isoformat()


def hash_password(pw: str, salt: str = None):
    salt = salt or secrets.token_hex(8)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 100_000).hex()
    return f"{salt}${h}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        salt = stored.split("$")[0]
        return secrets.compare_digest(hash_password(pw, salt), stored)
    except Exception:
        return False


class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    email: str = Field(index=True, unique=True)
    password_hash: str
    role: str = "CANDIDATE"  # ADMIN | CANDIDATE
    created_at: str = Field(default_factory=now)


class CV(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    owner_id: int | None = None  # candidate user, if registered
    filename: str
    category: str = "Other"
    candidate_name: str = ""
    email: str = ""
    skills: str = "[]"       # JSON list
    years_exp: float = 0
    links: str = "[]"        # JSON list of {type,url}
    text: str = ""
    ai_score: int | None = None       # 0-100 probability AI-generated
    ai_verdict: str = ""
    ai_evidence: str = "[]"           # JSON list
    github: str = ""                  # JSON footprint summary
    created_at: str = Field(default_factory=now)

    def skills_list(self):
        try:
            return json.loads(self.skills)
        except Exception:
            return []

    def links_list(self):
        try:
            return json.loads(self.links)
        except Exception:
            return []

    def evidence_list(self):
        try:
            return json.loads(self.ai_evidence)
        except Exception:
            return []


class Vacancy(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    title: str
    category: str
    description: str = ""
    requirements: str = ""
    active: bool = True
    created_at: str = Field(default_factory=now)


class Analysis(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    cv_id: int = Field(index=True)
    vacancy_id: int = Field(index=True)
    fit_score: int | None = None
    strengths: str = "[]"
    weaknesses: str = "[]"
    missing_skills: str = "[]"
    summary: str = ""
    footprint_summary: str = ""
    status: str = "pending"  # pending | running | done | error
    updated_at: str = Field(default_factory=now)


class Invite(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    token: str = Field(index=True, unique=True)
    cv_id: int
    vacancy_id: int
    created_by: int | None = None
    created_at: str = Field(default_factory=now)
    questions: str = "[]"      # JSON list of question strings
    progress: int = 0          # answered question count
    state: str = "{}"          # JSON flow state {q_index, awaiting_followup}
    completed: bool = False


class InterviewReport(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    invite_id: int
    cv_id: int
    vacancy_id: int
    transcript: str = "[]"     # JSON [{q, a, score, feedback}]
    total_score: float = 0     # 0-10
    decision: str = ""         # HIRE | CONSIDER | REJECT
    justification: str = ""
    strengths: str = "[]"
    weaknesses: str = "[]"
    areas: str = "[]"
    video_path: str = ""       # filename of recorded interview video (recordings/)
    created_at: str = Field(default_factory=now)

    def transcript_list(self):
        try:
            return json.loads(self.transcript)
        except Exception:
            return []


def get_session():
    with Session(engine) as s:
        yield s


def init_db(seed=True):
    SQLModel.metadata.create_all(engine)
    # tiny migration for DBs created before the video_path column existed
    with engine.begin() as conn:
        from sqlalchemy import text
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(interviewreport)"))]
        if "video_path" not in cols:
            conn.execute(text("ALTER TABLE interviewreport ADD COLUMN video_path VARCHAR DEFAULT ''"))
    if not seed:
        return
    with Session(engine) as s:
        if not s.exec(select(User).where(User.role == "ADMIN")).first():
            s.add(User(name="Admin", email="admin", password_hash=hash_password("admin123"), role="ADMIN"))
        if not s.exec(select(Vacancy)).first():
            for v in [
                Vacancy(title="Python Developer", category="Programmer",
                        description="Backend developer for our data platform. Works with APIs, databases and automation.",
                        requirements="Python, FastAPI or Django, SQL, REST APIs, Git, testing, Linux basics, 2+ years experience."),
                Vacancy(title="Sales Manager", category="Sales",
                        description="Lead B2B sales for our SaaS product, manage pipeline and close deals.",
                        requirements="B2B sales experience, CRM (HubSpot/Salesforce), negotiation, cold outreach, 3+ years experience."),
                Vacancy(title="Project Manager", category="Manager",
                        description="Coordinate software delivery teams, own timelines and stakeholder communication.",
                        requirements="Agile/Scrum, planning, risk management, communication, Jira, 3+ years experience."),
                Vacancy(title="UI Designer", category="Designer",
                        description="Design clean, modern interfaces for web and mobile products.",
                        requirements="Figma, design systems, prototyping, UX research basics, portfolio required."),
            ]:
                s.add(v)
        s.commit()
        if not s.exec(select(CV)).first():
            import_samples(s)


def import_samples(s: Session):
    """Parse ./samples/*.txt through the same LLM categorizer used for uploads."""
    from main import parse_cv_text  # late import to avoid cycle
    samples_dir = os.path.join(os.path.dirname(__file__), "samples")
    if not os.path.isdir(samples_dir):
        return
    for fn in sorted(os.listdir(samples_dir)):
        if not fn.lower().endswith((".txt", ".pdf", ".docx")):
            continue
        path = os.path.join(samples_dir, fn)
        try:
            if fn.endswith(".txt"):
                text = open(path, encoding="utf-8", errors="ignore").read()
            elif fn.endswith(".pdf"):
                from pypdf import PdfReader
                text = "\n".join((p.extract_text() or "") for p in PdfReader(path).pages)
            else:
                import docx as _docx
                text = "\n".join(p.text for p in _docx.Document(path).paragraphs)
            if len(text.strip()) < 50:
                continue
            meta = parse_cv_text(text)
            s.add(CV(filename=fn, text=text, category=meta.get("category", "Other"),
                     candidate_name=meta.get("name", ""), email=meta.get("email", ""),
                     skills=json.dumps(meta.get("skills", [])), years_exp=meta.get("years_experience", 0) or 0,
                     links=json.dumps(meta.get("links", []))))
        except Exception as e:
            print(f"[seed] skipped {fn}: {e}")
    s.commit()
