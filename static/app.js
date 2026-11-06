/* AI Recruiter dashboard logic */
let ME = null, VACS = [], CVS = [], SEL_VAC = null, POLL = null, EDIT_VAC = null;

async function api(url, opts = {}) {
  opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
  if (opts.body && typeof opts.body !== "string" && !(opts.body instanceof FormData)) opts.body = JSON.stringify(opts.body);
  const r = await fetch(url, opts);
  if (r.status === 401 && !url.startsWith("/api/auth")) { location.reload(); throw new Error("auth"); }
  let data;
  try { data = await r.json(); } catch { data = {}; }
  if (!r.ok) { toast(data.detail || r.statusText || "Request failed", "error"); throw new Error(data.detail || "err"); }
  return data;
}

function toast(msg, type = "info") {
  const d = document.createElement("div");
  const color = type === "error" ? "border-red-500 bg-red-950" : type === "ok" ? "border-emerald-500 bg-emerald-950" : "border-slate-600 bg-slate-900";
  d.className = `${color} border rounded-xl px-4 py-3 text-sm shadow-lg opacity-0 transition-opacity duration-300`;
  d.textContent = msg;
  document.getElementById("toasts").appendChild(d);
  requestAnimationFrame(() => d.classList.replace("opacity-0", "opacity-100"));
  setTimeout(() => { d.classList.replace("opacity-100", "opacity-0"); setTimeout(() => d.remove(), 300); }, 4500);
}

function copyText(t) { navigator.clipboard.writeText(t).then(() => toast("Copied to clipboard", "ok")); }

/* ---------- auth ---------- */
let REG = false;
function setTab(reg) {
  REG = reg;
  document.getElementById("tab-login").className = `flex-1 py-2 rounded-lg text-sm font-medium ${reg ? "bg-slate-800 text-slate-400" : "bg-indigo-600"}`;
  document.getElementById("tab-reg").className = `flex-1 py-2 rounded-lg text-sm font-medium ${reg ? "bg-indigo-600" : "bg-slate-800 text-slate-400"}`;
  document.getElementById("reg-name").classList.toggle("hidden", !reg);
  document.getElementById("auth-btn").textContent = reg ? "Create account" : "Sign in";
}
document.getElementById("tab-login").onclick = () => setTab(false);
document.getElementById("tab-reg").onclick = () => setTab(true);
document.getElementById("auth-btn").onclick = async () => {
  const body = { email: document.getElementById("f-email").value.trim(), password: document.getElementById("f-pass").value, name: document.getElementById("f-name").value.trim() };
  if (!body.email || !body.password) return toast("Enter email and password", "error");
  try {
    await api(REG ? "/api/auth/register" : "/api/auth/login", { method: "POST", body });
    location.reload();
  } catch {}
};

/* ---------- boot ---------- */
(async function boot() {
  const cats = ["Programmer", "Sales", "Manager", "Designer", "Marketing", "HR", "Other"];
  for (const c of cats) document.getElementById("v-cat").insertAdjacentHTML("beforeend", `<option>${c}</option>`);
  try { ME = await api("/api/auth/me"); } catch { return; }
  document.getElementById("auth-view").classList.add("hidden");
  document.getElementById("app-view").classList.remove("hidden");
  document.getElementById("user-label").textContent = `${ME.name} (${ME.role.toLowerCase()})`;
  VACS = await api("/api/vacancies");
  if (ME.role === "ADMIN") { initAdmin(); } else { initCandidate(); }
})();

function initAdmin() {
  document.getElementById("admin-view").classList.remove("hidden");
  loadCVs();
  renderVacs();
  loadInvites();
  renderChat([], null);
  document.getElementById("cv-upload").addEventListener("change", uploadCVs);
}

/* ---------- CV library ---------- */
async function loadCVs() {
  CVS = await api("/api/cvs");
  renderCVs();
}

function renderCVs() {
  const box = document.getElementById("cv-list");
  const cats = ["Programmer", "Sales", "Manager", "Designer", "Marketing", "HR", "Other"];
  const filter = SEL_VAC ? (VACS.find(v => v.id === SEL_VAC) || {}).category : null;
  let html = "";
  for (const cat of cats) {
    if (filter && cat !== filter) continue;
    const items = CVS.filter(c => c.category === cat);
    if (!items.length) continue;
    html += `<div><div class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">${cat} (${items.length})</div><div class="space-y-1">`;
    for (const c of items) {
      const ai = c.ai_score;
      const aiCls = ai == null ? "text-slate-500" : ai >= 70 ? "text-red-400" : ai >= 40 ? "text-amber-400" : "text-emerald-400";
      html += `<div class="group bg-slate-800/60 hover:bg-slate-800 rounded-lg px-3 py-2 text-sm cursor-pointer" onclick="showCV(${c.id})">
        <div class="flex items-center justify-between gap-2">
          <span class="truncate font-medium">${esc(c.name || c.filename)}</span>
          <span class="${aiCls} text-xs font-semibold shrink-0">${ai == null ? "—" : "AI " + ai}</span>
        </div>
        <div class="text-xs text-slate-500 truncate">${esc(c.filename)}${c.years_exp ? " · " + c.years_exp + " yrs" : ""}${c.email ? " · " + esc(c.email) : ""}</div>
        <div class="hidden group-hover:flex gap-2 mt-1">
          <button onclick="event.stopPropagation();inviteCV(${c.id})" class="text-xs px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600">Invite</button>
          <button onclick="event.stopPropagation();delCV(${c.id})" class="text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-red-700">Delete</button>
        </div>
      </div>`;
    }
    html += "</div></div>";
  }
  box.innerHTML = html || `<p class="text-slate-500 text-sm">No CVs${filter ? " in category '" + filter + "'" : ""}.</p>`;
}

async function uploadCVs(e) {
  const files = [...e.target.files];
  if (!files.length) return;
  const st = document.getElementById("upload-status");
  st.innerHTML = `<span class="spin inline-block">⚙</span> Parsing ${files.length} file(s) with AI…`;
  const fd = new FormData();
  files.forEach(f => fd.append("files", f));
  const r = await fetch("/api/cvs/upload", { method: "POST", body: fd });
  st.textContent = "";
  if (!r.ok) { toast("Upload failed", "error"); return; }
  const data = await r.json();
  for (const res of data.results) {
    if (res.error) toast(`${res.file}: ${res.error}`, "error");
    else toast(`Parsed ${res.cv.name} → ${res.cv.category}`, "ok");
  }
  e.target.value = "";
  loadCVs();
}

async function delCV(id) {
  if (!confirm("Delete this CV?")) return;
  await api(`/api/cvs/${id}`, { method: "DELETE" });
  loadCVs();
}

function showCV(id) {
  const c = CVS.find(x => x.id === id);
  if (!c) return;
  const links = (c.links || []).map(l => `<a href="${esc(l.url)}" target="_blank" class="text-indigo-400 underline">${esc(l.type)}</a>`).join(" · ") || "—";
  const gh = c.github ? `<div class="mt-2 p-2 bg-slate-800/60 rounded-lg text-xs">
      <b>GitHub (@${esc(c.github.username || "")}):</b> ${c.github.error ? esc(c.github.error) : `${c.github.repos} repos · ${c.github.stars}★ · langs: ${esc((c.github.languages || []).join(", "))}`}
      ${(c.github.top || []).map(t => `<div class="mt-1 text-slate-400">• ${esc(t.name)} (${t.stars}★, ${esc(t.lang || "?")})</div>`).join("")}
    </div>` : "";
  modalHtml(`<h3 class="font-semibold text-lg mb-1">${esc(c.name || c.filename)}</h3>
    <div class="text-xs text-slate-400 mb-3">${c.category} · ${c.years_exp} yrs · ${esc(c.email || "no email")} · links: ${links}</div>
    <div class="mb-2"><b class="text-sm">Skills:</b> <span class="text-sm text-slate-300">${esc((c.skills || []).join(", ")) || "—"}</span></div>
    <div class="mb-2 text-sm"><b>AI detector:</b> <span class="${c.ai_score >= 70 ? "text-red-400" : c.ai_score >= 40 ? "text-amber-400" : "text-emerald-400"} font-semibold">${c.ai_score == null ? "not analyzed" : c.ai_score + "/100 — " + esc(c.ai_verdict)}</span></div>
    <ul class="text-xs text-slate-400 list-disc ml-5 space-y-0.5 mb-2">${(c.ai_evidence || []).map(e => `<li>${esc(e)}</li>`).join("")}</ul>
    ${gh}`);
}

async function inviteCV(id) {
  if (!SEL_VAC) return toast("Select a vacancy first", "error");
  const res = await api("/api/invites", { method: "POST", body: { cv_id: id, vacancy_id: SEL_VAC } });
  toast("Invite created — link copied", "ok");
  copyText(res.link);
  loadInvites();
}

/* ---------- vacancies ---------- */
function renderVacs() {
  const box = document.getElementById("vac-list");
  box.innerHTML = VACS.map(v => `
    <div class="rounded-lg p-3 cursor-pointer border ${v.id === SEL_VAC ? "border-indigo-500 bg-indigo-950/40" : "border-slate-800 bg-slate-800/40 hover:bg-slate-800"}" onclick="selectVac(${v.id})">
      <div class="flex items-center justify-between">
        <span class="font-medium text-sm">${esc(v.title)}</span>
        ${v.active ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900 text-emerald-400">active</span>' : '<span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">off</span>'}
      </div>
      <div class="text-xs text-slate-500 mt-0.5">${v.category}</div>
      <div class="hidden group-hover:flex gap-2 mt-1">
        <button onclick="event.stopPropagation();editVacancy(${v.id})" class="text-xs px-2 py-0.5 rounded bg-slate-700">Edit</button>
        <button onclick="event.stopPropagation();delVac(${v.id})" class="text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-red-700">Delete</button>
      </div>
    </div>`).join("") || '<p class="text-slate-500 text-sm">No vacancies.</p>';
}

async function selectVac(id) {
  SEL_VAC = id;
  renderVacs();
  renderCVs();
  document.getElementById("results-vac").textContent = "— " + ((VACS.find(v => v.id === id) || {}).title || "");
  await loadResults();
}

function editVacancy(id) {
  EDIT_VAC = id;
  const v = id ? VACS.find(x => x.id === id) : null;
  document.getElementById("vac-modal-title").textContent = v ? "Edit vacancy" : "New vacancy";
  document.getElementById("v-title").value = v ? v.title : "";
  document.getElementById("v-cat").value = v ? v.category : "Programmer";
  document.getElementById("v-desc").value = v ? v.description : "";
  document.getElementById("v-req").value = v ? v.requirements : "";
  document.getElementById("v-active").checked = v ? v.active : true;
  document.getElementById("vac-modal").classList.remove("hidden");
}
function hideModal() { document.getElementById("vac-modal").classList.add("hidden"); }

async function saveVacancy() {
  const body = {
    title: document.getElementById("v-title").value, category: document.getElementById("v-cat").value,
    description: document.getElementById("v-desc").value, requirements: document.getElementById("v-req").value,
    active: document.getElementById("v-active").checked,
  };
  if (!body.title) return toast("Title required", "error");
  if (EDIT_VAC) await api(`/api/vacancies/${EDIT_VAC}`, { method: "PUT", body });
  else VACS = [...VACS, await api("/api/vacancies", { method: "POST", body })];
  hideModal(); toast("Saved", "ok");
  VACS = await api("/api/vacancies");
  renderVacs();
}

async function delVac(id) {
  if (!confirm("Delete vacancy?")) return;
  await api(`/api/vacancies/${id}`, { method: "DELETE" });
  VACS = await api("/api/vacancies");
  if (SEL_VAC === id) { SEL_VAC = null; document.getElementById("results-vac").textContent = ""; }
  renderVacs(); renderCVs();
}

/* ---------- analysis ---------- */
async function runAnalysis() {
  if (!SEL_VAC) return toast("Select a vacancy first", "error");
  try {
    const res = await api("/api/analyze", { method: "POST", body: { vacancy_id: SEL_VAC } });
    toast(`Analyzing ${res.cv_count} CV(s)…`, "ok");
    pollProgress(res.run_id);
  } catch {}
}

function pollProgress(runId) {
  if (POLL) clearInterval(POLL);
  document.getElementById("run-btn").innerHTML = '<span class="spin inline-block">⚙</span> Running…';
  POLL = setInterval(async () => {
    let p;
    try { p = await api(`/api/analyze/progress/${runId}`); } catch { return; }
    renderProgress(p);
    if (p.finished) {
      clearInterval(POLL); POLL = null;
      document.getElementById("run-btn").textContent = "▶ Run analysis";
      loadResults(); loadCVs();
      toast("Analysis complete", "ok");
    }
  }, 2000);
}

function renderProgress(p) {
  const rows = Object.entries(p).filter(([k]) => k !== "finished").map(([cid, v]) => {
    const c = CVS.find(x => x.id == cid) || {};
    const steps = ["🔍 AI detection", "🌐 Footprint", "🎯 Fit score"];
    return `<div class="bg-slate-800/60 rounded-lg px-3 py-2 text-sm flex items-center justify-between">
      <span class="truncate">${esc(c.name || c.filename || "CV #" + cid)}</span>
      <span class="text-xs ${v.done ? "text-emerald-400" : "text-indigo-300"}">${v.done ? "✓ done" : steps[v.step - 1] || v.label}</span>
    </div>`;
  }).join("");
  document.getElementById("results-list").innerHTML = rows || '<p class="text-slate-500 text-sm">Working…</p>';
}

async function loadResults() {
  if (!SEL_VAC) return;
  const data = await api(`/api/results/${SEL_VAC}`);
  const box = document.getElementById("results-list");
  const st = document.getElementById("stats-bar");
  if (!data.results.length) { box.innerHTML = '<p class="text-slate-500 text-sm">No analysis yet. Click "Run analysis".</p>'; st.innerHTML = ""; return; }
  const s = data.stats;
  st.innerHTML = [s.count + " analyzed", s.avg_fit != null ? `avg fit ${s.avg_fit}` : null, s.avg_ai != null ? `avg AI-score ${s.avg_ai}` : null, s.skill_coverage != null ? `full skill coverage ${s.skill_coverage}%` : null]
    .filter(Boolean).map(x => `<span class="px-2 py-1 rounded bg-slate-800 text-slate-300">${x}</span>`).join("");
  box.innerHTML = data.results.map((r, i) => {
    const c = r.cv;
    const best = r.status === "done" && i === data.results.findIndex(x => x.status === "done");
    const aiCls = c.ai_score == null ? "text-slate-500" : c.ai_score >= 70 ? "text-red-400" : c.ai_score >= 40 ? "text-amber-400" : "text-emerald-400";
    return `<div class="rounded-xl p-3 border ${best ? "border-amber-500 bg-amber-950/20" : "border-slate-800 bg-slate-800/40"}">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          ${best ? '<span class="text-amber-400">🏆</span>' : `<span class="text-slate-600 text-xs">#${i + 1}</span>`}
          <span class="font-medium truncate">${esc(c.name)}</span>
          <span class="${aiCls} text-xs">AI ${c.ai_score ?? "?"}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="font-bold ${r.status === "done" ? "text-indigo-300" : "text-slate-500"}">${r.status === "done" ? r.fit_score + "/100" : r.status}</span>
          <button onclick="inviteCV(${c.id})" class="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600">Invite</button>
        </div>
      </div>
      ${r.status === "done" ? `<div class="text-xs text-slate-400 mt-1">${esc(r.summary || "")}</div>
      <div class="text-xs mt-1"><span class="text-emerald-400">+ ${(r.strengths || []).slice(0, 3).map(esc).join("; ")}</span></div>
      ${r.missing_skills && r.missing_skills.length ? `<div class="text-xs text-red-400 mt-0.5">missing: ${esc(r.missing_skills.join(", "))}</div>` : ""}` : ""}
    </div>`;
  }).join("");
}

/* ---------- invites & reports ---------- */
async function loadInvites() {
  const invites = await api("/api/invites");
  const reports = await api("/api/reports");
  REPORTS = {};
  reports.forEach(r => REPORTS[r.id] = r);
  const box = document.getElementById("invite-list");
  let html = "";
  for (const inv of invites) {
    const rep = reports.find(r => r.id === inv.report_id);
    html += `<div class="bg-slate-800/50 rounded-lg p-2.5">
      <div class="flex items-center justify-between gap-2">
        <span class="font-medium truncate">${esc(inv.candidate)}</span>
        ${inv.completed ? `<span class="text-xs px-1.5 py-0.5 rounded ${inv.decision === "HIRE" ? "bg-emerald-900 text-emerald-400" : inv.decision === "REJECT" ? "bg-red-900 text-red-400" : "bg-amber-900 text-amber-400"}">${inv.decision || "done"} · ${inv.score ?? "?"}/10</span>` : '<span class="text-xs text-slate-500">pending</span>'}
      </div>
      <div class="flex items-center gap-2 mt-1">
        <input readonly value="${inv.link}" class="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-400">
        <button onclick="copyText('${inv.link}')" class="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600">Copy</button>
      </div>
      ${rep ? `<button onclick="showReport(${rep.id})" class="mt-1 text-xs text-indigo-400 underline">View report & transcript</button>` : ""}
    </div>`;
  }
  box.innerHTML = html || '<p class="text-slate-500">No invites yet. Invite a candidate from the CV list or results.</p>';
}

let REPORTS = {};

function showReport(id) {
  const r = REPORTS[id];
  if (!r) return;
  modalHtml(`<h3 class="font-semibold text-lg mb-1">Interview report — ${esc(r.candidate)} <span class="text-sm text-slate-400">(${esc(r.vacancy)})</span></h3>
    <div class="mb-2"><span class="font-bold text-indigo-300">${r.total_score}/10</span>
      <span class="ml-2 px-2 py-0.5 rounded text-xs ${r.decision === "HIRE" ? "bg-emerald-900 text-emerald-400" : r.decision === "REJECT" ? "bg-red-900 text-red-400" : "bg-amber-900 text-amber-400"}">${r.decision}</span></div>
    <p class="text-sm text-slate-300 mb-2">${esc(r.justification)}</p>
    <div class="text-xs text-slate-400 mb-2"><b>Strengths:</b> ${(r.strengths || []).map(esc).join("; ")}<br><b>Weaknesses:</b> ${(r.weaknesses || []).map(esc).join("; ")}</div>
    <div class="text-xs text-slate-400 mb-2"><b>Areas:</b> ${(r.areas || []).map(esc).join(", ")}</div>
    <div class="max-h-64 overflow-y-auto space-y-2 mt-3 border-t border-slate-700 pt-3">
      ${(r.transcript || []).map(t => `<div class="text-sm bg-slate-800/60 rounded-lg p-2">
        <div class="text-slate-300"><b>Q:</b> ${esc(t.q)}</div>
        <div class="text-slate-400 mt-0.5"><b>A:</b> ${esc(t.a)}</div>
        <div class="mt-1 text-xs ${t.score >= 7 ? "text-emerald-400" : t.score >= 5 ? "text-amber-400" : "text-red-400"}">Score: ${t.score}/10 — ${esc(t.feedback || "")}</div>
      </div>`).join("")}
    </div>`);
}

/* ---------- chat ---------- */
function renderChat(log, busy) {
  const box = document.getElementById("chat-log");
  if (!log.length && !busy) box.innerHTML = `<div class="text-slate-500 text-xs leading-relaxed">Hi! I'm your HR assistant. Ask me anything ("what strengths should a programmer have?") or give explicit commands ("start analysis for the Python Developer vacancy and invite the best candidate").</div>`;
  box.innerHTML = log.map(m => m.role === "user"
    ? `<div class="flex justify-end"><div class="bg-indigo-700/70 rounded-2xl rounded-br-sm px-4 py-2 max-w-[85%]">${esc(m.text)}</div></div>`
    : `<div class="flex justify-start"><div class="bg-slate-800 rounded-2xl rounded-bl-sm px-4 py-2 max-w-[85%] whitespace-pre-wrap">${m.text}</div></div>`
  ).join("") + (busy ? `<div class="flex justify-start"><div class="bg-slate-800 rounded-2xl px-4 py-2 text-slate-400 text-xs"><span class="spin inline-block">⚙</span> thinking…</div></div>` : "");
  box.scrollTop = box.scrollHeight;
}

const CHAT_LOG = [];
async function sendChat() {
  const inp = document.getElementById("chat-input");
  const msg = inp.value.trim();
  if (!msg) return;
  inp.value = "";
  CHAT_LOG.push({ role: "user", text: msg });
  renderChat(CHAT_LOG, true);
  try {
    const res = await api("/api/chat", { method: "POST", body: { message: msg, vacancy_id: SEL_VAC } });
    let text = res.reply || "(no reply)";
    for (const ex of res.executed || []) {
      text += `\n\n✅ <b class="text-emerald-400">Executed: ${esc(ex.action)}</b>\n${esc(ex.text).replace(/(https?:\/\/[^\s]+)/g, '<span class="text-indigo-300">$1</span>')}`;
      if (ex.link) text += ` <button onclick="copyText('${ex.link}')" class="underline text-xs">copy link</button>`;
    }
    if (!(res.executed || []).length && res.intent === "chat") text += `\n<span class="text-[10px] text-slate-500">chat only — no action executed</span>`;
    CHAT_LOG.push({ role: "ai", text });
    renderChat(CHAT_LOG, false);
    if (res.run_id) { pollProgress(res.run_id); }
    loadCVs();
  } catch { renderChat(CHAT_LOG, false); }
}

/* ---------- candidate ---------- */
async function initCandidate() {
  document.getElementById("cand-view").classList.remove("hidden");
  const sel = document.getElementById("apply-vac");
  sel.innerHTML = VACS.filter(v => v.active).map(v => `<option value="${v.id}">${esc(v.title)} (${v.category})</option>`).join("");
  const invites = await api("/api/my/invites").catch(() => []);
  document.getElementById("my-invites").innerHTML = invites.length
    ? invites.map(i => `<div class="bg-slate-800/50 rounded-lg p-2.5 flex items-center gap-2"><span class="truncate flex-1 text-xs">${i.link}</span><button onclick="copyText('${i.link}')" class="text-xs px-2 py-1 rounded bg-slate-700">Copy</button>${i.completed ? '<span class="text-xs text-emerald-400">completed</span>' : '<a href="' + i.link + '" class="text-xs px-2 py-1 rounded bg-indigo-600">Open</a>'}</div>`).join("")
    : '<p class="text-slate-500 text-sm">No invites yet.</p>';
}

async function applyJob() {
  const f = document.getElementById("apply-file").files[0];
  if (!f) return toast("Choose a file", "error");
  const st = document.getElementById("apply-status");
  st.innerHTML = '<span class="spin inline-block">⚙</span> Uploading & parsing…';
  const fd = new FormData();
  fd.append("vacancy_id", document.getElementById("apply-vac").value);
  fd.append("file", f);
  const r = await fetch("/api/apply", { method: "POST", body: fd });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { st.innerHTML = ""; return toast(data.detail || "Upload failed", "error"); }
  st.innerHTML = `<span class="text-emerald-400">✓ Application submitted — parsed as ${data.cv.category}. The team will review it.</span>`;
  toast("Application submitted", "ok");
}

/* ---------- modal helper ---------- */
function modalHtml(html) {
  let m = document.getElementById("info-modal");
  if (m) m.remove();
  m = document.createElement("div");
  m.id = "info-modal";
  m.className = "fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4";
  m.onclick = (e) => { if (e.target === m) m.remove(); };
  m.innerHTML = `<div class="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto">${html}
    <div class="text-right mt-3"><button onclick="document.getElementById('info-modal').remove()" class="px-4 py-1.5 rounded-lg bg-slate-800 text-sm">Close</button></div></div>`;
  document.body.appendChild(m);
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
