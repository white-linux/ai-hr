/* Ishveren — recruiter dashboard + candidate area */
const CATS = ["Programmer", "Sales", "Manager", "Designer", "Marketing", "HR", "Other"];
let ME = null, VACS = [], CVS = [], SEL_VAC = null, POLL = null, EDIT_VAC = null;
let RESULTS = [], INVITES = [], REPORTS = {}, INVITE_FILTER = "all";

/* ---------- helpers ---------- */
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
const $ = (id) => document.getElementById(id);
const vacById = (id) => VACS.find(v => v.id === id) || null;
const aiCls = (s) => s == null ? "text-slate-500" : s >= 70 ? "text-red-400" : s >= 40 ? "text-amber-400" : "text-emerald-400";
const fitColor = (s) => s >= 75 ? "bg-emerald-500" : s >= 50 ? "bg-amber-500" : "bg-red-500";
const scoreCls = (s) => s >= 7 ? "text-emerald-400" : s >= 5 ? "text-amber-400" : "text-red-400";
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" }); } catch { return ""; } };

async function api(url, opts = {}) {
  const isForm = opts.body instanceof FormData;
  if (!isForm) opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
  if (opts.body && !isForm && typeof opts.body !== "string") opts.body = JSON.stringify(opts.body);
  let r;
  try { r = await fetch(url, opts); } catch { toast("Network error — is the server running?", "error"); throw new Error("network"); }
  if (r.status === 401 && !url.startsWith("/api/auth")) { location.reload(); throw new Error("auth"); }
  let data;
  try { data = await r.json(); } catch { data = {}; }
  if (!r.ok) {
    const msg = typeof data.detail === "string" ? data.detail : (r.statusText || "Request failed");
    if (!opts.silent) toast(msg, "error");
    throw new Error(msg);
  }
  return data;
}

function toast(msg, type = "info") {
  const d = document.createElement("div");
  const color = type === "error" ? "border-red-500/70 bg-red-950/95" : type === "ok" ? "border-emerald-500/70 bg-emerald-950/95" : "border-slate-600 bg-slate-900/95";
  d.className = `${color} border rounded-xl px-4 py-3 text-sm shadow-lg opacity-0 transition-opacity duration-300`;
  d.textContent = msg;
  $("toasts").appendChild(d);
  requestAnimationFrame(() => d.classList.replace("opacity-0", "opacity-100"));
  setTimeout(() => { d.classList.replace("opacity-100", "opacity-0"); setTimeout(() => d.remove(), 300); }, 4500);
}

function copyText(t) {
  (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject())
    .then(() => toast("Link copied to clipboard", "ok"))
    .catch(() => prompt("Copy the link:", t));
}

function modalHtml(html, wide = false) {
  closeModal();
  const m = document.createElement("div");
  m.id = "info-modal";
  m.className = "fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4";
  m.onclick = (e) => { if (e.target === m) closeModal(); };
  m.innerHTML = `<div class="bg-slate-900 border border-slate-700 rounded-2xl p-6 ${wide ? "max-w-3xl" : "max-w-lg"} w-full max-h-[88vh] overflow-y-auto shadow-2xl">${html}
    <div class="text-right mt-4"><button onclick="closeModal()" class="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">Close</button></div></div>`;
  document.body.appendChild(m);
}
function closeModal() {
  if (LIVE_TIMER) { clearInterval(LIVE_TIMER); LIVE_TIMER = null; }
  const m = $("info-modal"); if (m) m.remove();
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModal(); hideModal(); } });

const list = (arr, cls = "") => (arr || []).length ? `<ul class="list-disc ml-5 space-y-0.5 ${cls}">${arr.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<span class="text-slate-500">—</span>`;

/* ---------- auth ---------- */
let REG = false;
function setTab(reg) {
  REG = reg;
  $("tab-login").className = `flex-1 py-2 rounded-lg text-sm font-medium ${reg ? "text-slate-400" : "bg-indigo-600"}`;
  $("tab-reg").className = `flex-1 py-2 rounded-lg text-sm font-medium ${reg ? "bg-indigo-600" : "text-slate-400"}`;
  $("reg-name").classList.toggle("hidden", !reg);
  $("auth-btn").textContent = reg ? "Create account" : "Sign in";
}
$("tab-login").onclick = () => setTab(false);
$("tab-reg").onclick = () => setTab(true);
$("auth-form").onsubmit = async (e) => {
  e.preventDefault();
  const body = { email: $("f-email").value.trim(), password: $("f-pass").value, name: $("f-name").value.trim() };
  if (!body.email || !body.password) return toast("Enter email and password", "error");
  if (REG && body.password.length < 6) return toast("Password must be at least 6 characters", "error");
  $("auth-btn").disabled = true;
  try { await api(REG ? "/api/auth/register" : "/api/auth/login", { method: "POST", body }); location.reload(); }
  catch { $("auth-btn").disabled = false; }
};
async function logout() { await api("/api/auth/logout", { method: "POST" }).catch(() => {}); location.reload(); }

/* ---------- boot ---------- */
(async function boot() {
  for (const c of CATS) $("v-cat").insertAdjacentHTML("beforeend", `<option>${c}</option>`);
  try { ME = await api("/api/auth/me", { silent: true }); } catch { return; }
  $("auth-view").classList.add("hidden");
  $("app-view").classList.remove("hidden");
  $("user-label").textContent = `${ME.name} · ${ME.role === "ADMIN" ? "recruiter" : "candidate"}`;
  VACS = await api("/api/vacancies");
  if (ME.role === "ADMIN") initAdmin(); else initCandidate();
})();

function initAdmin() {
  $("admin-view").classList.remove("hidden");
  $("videos-btn").classList.remove("hidden");
  loadCVs(); renderVacs(); loadInvites(); renderChat(); renderChips();
  $("cv-upload").addEventListener("change", (e) => { uploadCVs([...e.target.files]); e.target.value = ""; });
  $("cv-search").addEventListener("input", renderCVs);
  $("chat-form").onsubmit = (e) => { e.preventDefault(); sendChat(); };
  $("vac-form").onsubmit = (e) => { e.preventDefault(); saveVacancy(); };
  const dz = $("drop-zone");
  ["dragenter", "dragover"].forEach(ev => document.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("border-indigo-500", "text-indigo-300"); }));
  ["dragleave", "drop"].forEach(ev => document.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("border-indigo-500", "text-indigo-300"); }));
  document.addEventListener("drop", (e) => { const f = [...(e.dataTransfer?.files || [])]; if (f.length) uploadCVs(f); });
  setInterval(() => { if (!document.hidden) loadInvites(true); }, 10000);
}

function renderKPIs() {
  const done = INVITES.filter(i => i.completed);
  const live = INVITES.filter(i => i.live).length;
  const items = [
    ["CVs", CVS.length], ["Vacancies", VACS.filter(v => v.active).length],
    ["Interviews", INVITES.length], ["Completed", done.length], ["Hire", done.filter(i => i.decision === "HIRE").length],
  ];
  $("kpis").innerHTML = items.map(([k, v]) => `<span class="px-2.5 py-1 rounded-lg bg-slate-800/80 text-slate-400">${k} <b class="text-slate-100">${v}</b></span>`).join("")
    + (live ? `<span class="px-2.5 py-1 rounded-lg bg-emerald-900/70 text-emerald-300 animate-pulse">● ${live} live</span>` : "");
}

/* ---------- CV library ---------- */
async function loadCVs() { CVS = await api("/api/cvs"); renderCVs(); renderKPIs(); }

function renderCVs() {
  const box = $("cv-list");
  const filter = SEL_VAC ? (vacById(SEL_VAC) || {}).category : null;
  const q = $("cv-search").value.trim().toLowerCase();
  $("cv-count").textContent = `(${CVS.length})`;
  $("cv-filter-note").classList.toggle("hidden", !filter);
  $("cv-filter-note").innerHTML = filter ? `Filtered by vacancy category: <b>${esc(filter)}</b> · <button class="underline" onclick="selectVac(null)">show all</button>` : "";
  const invited = new Set(INVITES.filter(i => i.vacancy_id === SEL_VAC).map(i => i.cv_id));
  let html = "";
  for (const cat of CATS) {
    if (filter && cat !== filter) continue;
    const items = CVS.filter(c => c.category === cat && (!q || [c.name, c.filename, c.email, ...(c.skills || [])].join(" ").toLowerCase().includes(q)));
    if (!items.length) continue;
    html += `<div><div class="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">${cat} · ${items.length}</div><div class="space-y-1.5">`;
    for (const c of items) {
      const applied = c.vacancy_id ? vacById(c.vacancy_id) : null;
      html += `<div class="group bg-slate-800/50 hover:bg-slate-800 border border-transparent hover:border-slate-700 rounded-lg px-3 py-2 text-sm cursor-pointer" onclick="showCV(${c.id})">
        <div class="flex items-center justify-between gap-2">
          <span class="truncate font-medium">${esc(c.name || c.filename)}</span>
          <span class="${aiCls(c.ai_score)} text-[11px] font-semibold shrink-0" title="AI-generated probability">${c.ai_score == null ? "not scanned" : "AI " + c.ai_score + "%"}</span>
        </div>
        <div class="text-xs text-slate-500 truncate">${c.years_exp ? c.years_exp + " yrs · " : ""}${esc((c.skills || []).slice(0, 4).join(", ") || c.filename)}</div>
        ${applied ? `<div class="text-[11px] text-sky-400 mt-0.5">📨 applied: ${esc(applied.title)}</div>` : ""}
        <div class="flex gap-1.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          ${SEL_VAC ? `<button onclick="event.stopPropagation();inviteCV(${c.id})" class="text-[11px] px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600">${invited.has(c.id) ? "✓ Invited · copy" : "Invite"}</button>` : ""}
          <button onclick="event.stopPropagation();delCV(${c.id})" class="text-[11px] px-2 py-0.5 rounded bg-slate-700 hover:bg-red-700">Delete</button>
        </div>
      </div>`;
    }
    html += "</div></div>";
  }
  box.innerHTML = html || `<p class="text-slate-500 text-sm text-center py-6">${q ? "Nothing matches your search." : "No CVs" + (filter ? ` in category '${esc(filter)}'` : "") + ". Upload some!"}</p>`;
}

async function uploadCVs(files) {
  files = files.filter(f => /\.(pdf|docx|txt)$/i.test(f.name));
  if (!files.length) return toast("Only PDF, DOCX and TXT files are supported", "error");
  const st = $("upload-status");
  st.innerHTML = `<span class="spin">⚙</span> AI is parsing ${files.length} file(s): category, skills, experience, links…`;
  const fd = new FormData();
  files.forEach(f => fd.append("files", f));
  try {
    const data = await api("/api/cvs/upload", { method: "POST", body: fd });
    let ok = 0;
    for (const res of data.results) {
      if (res.error) toast(`${res.file}: ${res.error}`, "error");
      else { ok++; toast(`✓ ${res.cv.name} → ${res.cv.category}`, "ok"); }
    }
    st.textContent = ok ? `Added ${ok} CV(s).` : "";
    setTimeout(() => st.textContent = "", 4000);
  } catch { st.textContent = ""; }
  loadCVs();
}

async function delCV(id) {
  if (!confirm("Delete this CV and its analysis results?")) return;
  await api(`/api/cvs/${id}`, { method: "DELETE" });
  toast("CV deleted", "ok");
  loadCVs(); if (SEL_VAC) loadResults();
}

function showCV(id) {
  const c = CVS.find(x => x.id === id);
  if (!c) return;
  const r = RESULTS.find(x => x.cv.id === id);
  const links = (c.links || []).map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener" class="text-indigo-400 hover:underline">${esc(l.type)}</a>`).join(" · ") || "—";
  const gh = c.github && c.github.username ? `<div class="mt-3 p-3 bg-slate-800/60 rounded-lg text-xs">
      <b>GitHub @${esc(c.github.username)}</b>: ${c.github.error ? `<span class="text-amber-400">${esc(c.github.error)}</span>` : `${c.github.repos} repos · ${c.github.stars}★ · ${esc((c.github.languages || []).join(", "))}`}
      ${(c.github.top || []).map(t => `<div class="mt-1 text-slate-400">• ${esc(t.name)} — ${t.stars}★ ${esc(t.lang || "")} ${t.desc ? "· " + esc(t.desc) : ""}</div>`).join("")}
    </div>` : "";
  modalHtml(`<div class="flex items-start justify-between gap-3 mb-1">
      <h3 class="font-semibold text-lg">${esc(c.name || c.filename)}</h3>
      <span class="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 shrink-0">${esc(c.category)}</span></div>
    <div class="text-xs text-slate-400 mb-3">${c.years_exp} yrs · ${esc(c.email || "no email")} · ${esc(c.filename)} · links: ${links}</div>
    <div class="flex flex-wrap gap-1 mb-3">${(c.skills || []).map(s => `<span class="text-[11px] px-2 py-0.5 rounded-full bg-indigo-950 border border-indigo-900 text-indigo-200">${esc(s)}</span>`).join("") || '<span class="text-slate-500 text-sm">no skills parsed</span>'}</div>
    ${r && r.status === "done" ? fitBlock(r) : ""}
    <div class="text-sm mt-3"><b>AI-content detector:</b> <span class="${aiCls(c.ai_score)} font-semibold">${c.ai_score == null ? "not analyzed yet — run analysis" : c.ai_score + "/100 — " + esc(c.ai_verdict)}</span></div>
    ${(c.ai_evidence || []).length ? `<div class="text-xs text-slate-400 mt-1">${list(c.ai_evidence)}</div>` : ""}
    ${c.footprint && c.footprint.summary ? `<div class="text-sm mt-3"><b>Online footprint:</b> ${c.footprint.consistent === true ? '<span class="text-emerald-400">consistent with CV</span>' : c.footprint.consistent === false ? '<span class="text-amber-400">inconsistencies found</span>' : ""}<p class="text-xs text-slate-400 mt-1">${esc(c.footprint.summary)}</p>
      ${(c.footprint.links || []).map(l => `<div class="text-[11px] text-slate-500 truncate">• ${esc(l.type)}: ${esc(l.status)} — ${esc(l.note)}</div>`).join("")}</div>` : ""}
    ${gh}`, true);
}

function fitBlock(r) {
  return `<div class="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
    <div class="flex items-center justify-between text-sm mb-1"><b>Fit for “${esc((vacById(SEL_VAC) || {}).title || "")}”</b><b class="text-indigo-300">${r.fit_score}/100</b></div>
    <div class="bar mb-2"><i class="${fitColor(r.fit_score)}" style="width:${r.fit_score}%"></i></div>
    <p class="text-xs text-slate-300 mb-2">${esc(r.summary)}</p>
    <div class="grid sm:grid-cols-3 gap-3 text-xs">
      <div><div class="text-emerald-400 font-semibold mb-1">Strengths</div>${list(r.strengths, "text-slate-400")}</div>
      <div><div class="text-amber-400 font-semibold mb-1">Weaknesses</div>${list(r.weaknesses, "text-slate-400")}</div>
      <div><div class="text-red-400 font-semibold mb-1">Missing skills</div>${list(r.missing_skills, "text-slate-400")}</div>
    </div></div>`;
}

async function inviteCV(id) {
  if (!SEL_VAC) return toast("Select a vacancy first", "error");
  const res = await api("/api/invites", { method: "POST", body: { cv_id: id, vacancy_id: SEL_VAC } });
  toast(res.reused ? "Open invite already exists — link copied" : "Invite created — link copied", "ok");
  copyText(res.link);
  loadInvites();
}

async function inviteBest() {
  const best = RESULTS.find(r => r.status === "done");
  if (!best) return toast("Run the analysis first", "error");
  inviteCV(best.cv.id);
}

/* ---------- vacancies ---------- */
function renderVacs() {
  $("vac-list").innerHTML = VACS.map(v => {
    const n = CVS.filter(c => c.category === v.category).length;
    return `<div class="group rounded-lg p-3 cursor-pointer border transition-colors ${v.id === SEL_VAC ? "border-indigo-500 bg-indigo-950/40" : "border-slate-800 bg-slate-800/40 hover:bg-slate-800"}" onclick="selectVac(${v.id})">
      <div class="flex items-center justify-between gap-2">
        <span class="font-medium text-sm truncate">${esc(v.title)}</span>
        ${v.active ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/70 text-emerald-400">active</span>' : '<span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">closed</span>'}
      </div>
      <div class="flex items-center justify-between mt-0.5">
        <span class="text-xs text-slate-500">${esc(v.category)} · ${n} CV(s)</span>
        <span class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onclick="event.stopPropagation();editVacancy(${v.id})" class="text-[11px] px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600">Edit</button>
          <button onclick="event.stopPropagation();delVac(${v.id})" class="text-[11px] px-2 py-0.5 rounded bg-slate-700 hover:bg-red-700">Delete</button>
        </span>
      </div>
    </div>`;
  }).join("") || '<p class="text-slate-500 text-sm">No vacancies yet.</p>';
}

async function selectVac(id) {
  SEL_VAC = id;
  renderVacs(); renderCVs();
  $("results-vac").textContent = id ? "— " + ((vacById(id) || {}).title || "") : "";
  $("invite-best-btn").classList.add("hidden");
  if (!id) {
    RESULTS = [];
    $("stats-bar").innerHTML = "";
    $("results-list").innerHTML = '<div class="text-center text-slate-500 text-sm py-10">👉 Select a vacancy on the right to see ranked candidates.</div>';
    return;
  }
  await loadResults();
}

function editVacancy(id) {
  EDIT_VAC = id;
  const v = id ? vacById(id) : null;
  $("vac-modal-title").textContent = v ? "Edit vacancy" : "New vacancy";
  $("v-title").value = v ? v.title : "";
  $("v-cat").value = v ? v.category : "Programmer";
  $("v-desc").value = v ? v.description : "";
  $("v-req").value = v ? v.requirements : "";
  $("v-active").checked = v ? v.active : true;
  $("vac-modal").classList.remove("hidden");
  setTimeout(() => $("v-title").focus(), 50);
}
function hideModal() { $("vac-modal").classList.add("hidden"); }

async function saveVacancy() {
  const body = { title: $("v-title").value.trim(), category: $("v-cat").value, description: $("v-desc").value.trim(), requirements: $("v-req").value.trim(), active: $("v-active").checked };
  if (!body.title) return toast("Title is required", "error");
  try {
    if (EDIT_VAC) await api(`/api/vacancies/${EDIT_VAC}`, { method: "PUT", body });
    else await api("/api/vacancies", { method: "POST", body });
  } catch { return; }
  hideModal(); toast("Vacancy saved", "ok");
  VACS = await api("/api/vacancies");
  renderVacs(); renderCVs(); renderKPIs();
  if (SEL_VAC) $("results-vac").textContent = "— " + ((vacById(SEL_VAC) || {}).title || "");
}

async function delVac(id) {
  if (!confirm("Delete this vacancy?")) return;
  await api(`/api/vacancies/${id}`, { method: "DELETE" });
  VACS = await api("/api/vacancies");
  if (SEL_VAC === id) selectVac(null); else { renderVacs(); renderCVs(); }
  renderKPIs();
}

/* ---------- analysis ---------- */
async function runAnalysis(force = false) {
  if (!SEL_VAC) return toast("Select a vacancy first", "error");
  if (force && !confirm("Full re-scan: re-run AI detection and online footprint for every CV (slower). Continue?")) return;
  try {
    const res = await api("/api/analyze", { method: "POST", body: { vacancy_id: SEL_VAC, force } });
    toast(`Analyzing ${res.cv_count} CV(s) — results appear as soon as each CV is ready`, "ok");
    pollProgress(res.run_id, SEL_VAC);
  } catch {}
}

function pollProgress(runId, vacId) {
  if (POLL) clearInterval(POLL);
  $("run-btn").disabled = true;
  $("run-btn").innerHTML = '<span class="spin">⚙</span> Running…';
  $("progress-wrap").classList.remove("hidden");
  const tick = async () => {
    let p;
    try { p = await api(`/api/analyze/progress/${runId}`, { silent: true }); } catch { return; }
    if (!(vacId && vacId !== SEL_VAC)) { const pend = renderProgress(p); if (!p.finished) loadResults(pend); }
    if (p.finished) {
      clearInterval(POLL); POLL = null;
      $("run-btn").disabled = false;
      $("run-btn").textContent = "▶ Run analysis";
      $("progress-wrap").classList.add("hidden");
      const errs = Object.values(p).filter(v => v && v.error).length;
      toast(errs ? `Analysis finished with ${errs} error(s)` : "Analysis complete", errs ? "error" : "ok");
      if (p.invite) {
        toast(`🏆 Invited ${p.invite.candidate} (fit ${p.invite.fit}/100) — link copied`, "ok");
        copyText(p.invite.link);
        pushAI(`🏆 Analysis done — invited the best candidate <b>${esc(p.invite.candidate)}</b> (fit ${p.invite.fit}/100).\n<span class="text-indigo-300">${esc(p.invite.link)}</span>`);
      }
      if (p.followup_error) toast(p.followup_error, "error");
      await loadCVs(); loadResults(); loadInvites();
    }
  };
  tick();
  POLL = setInterval(tick, 1500);
}

function renderProgress(p) {
  const entries = Object.entries(p).filter(([k, v]) => /^\d+$/.test(k) && v && typeof v === "object");
  const total = entries.length || 1;
  const units = entries.reduce((a, [, v]) => a + (v.done ? 3 : Math.max(0, v.step - 1)), 0);
  const pct = Math.round(units / (total * 3) * 100);
  $("progress-bar").style.width = pct + "%";
  $("progress-pct").textContent = pct + "%";
  $("progress-label").textContent = `Analyzing ${entries.filter(([, v]) => v.done).length}/${entries.length} CVs`;
  const steps = ["AI detection", "Footprint", "AI scoring"];
  const pending = entries.filter(([, v]) => !v.done);
  const html = pending.map(([cid, v]) => {
    const c = CVS.find(x => x.id == cid) || {};
    const dots = steps.map((s, i) => {
      const st = v.done && !v.error ? "done" : v.step > i + 1 ? "done" : v.step === i + 1 ? "run" : "wait";
      return `<span class="flex items-center gap-1 ${st === "done" ? "text-emerald-400" : st === "run" ? "text-indigo-300" : "text-slate-600"}">${st === "done" ? "✓" : st === "run" ? '<span class="spin">◌</span>' : "○"} ${s}</span>`;
    }).join("");
    return `<div class="bg-slate-800/50 rounded-lg px-3 py-2 text-sm">
      <div class="flex items-center justify-between gap-2"><span class="truncate font-medium">${esc(c.name || "CV #" + cid)}</span>
      <span class="text-[11px] text-indigo-300 truncate">${esc(v.label)}</span></div>
      <div class="flex gap-3 text-[11px] mt-1">${dots}</div></div>`;
  }).join("");
  return { ids: new Set(pending.map(([cid]) => Number(cid))), html };
}

async function loadResults(pend = null) {
  if (!SEL_VAC) return;
  const vid = SEL_VAC;
  let data;
  try { data = await api(`/api/results/${vid}`, { silent: !!pend }); } catch { return; }
  if (vid !== SEL_VAC || (!pend && POLL)) return;
  // while a run is active, hide stale rows of CVs that are still being (re)analyzed
  RESULTS = pend ? data.results.filter(r => !pend.ids.has(r.cv.id)) : data.results;
  const box = $("results-list"), st = $("stats-bar");
  const pendHtml = pend && pend.html ? `<div class="space-y-2 mb-2">${pend.html}</div>` : "";
  if (!RESULTS.length && pend) { box.innerHTML = pendHtml || '<p class="text-slate-500 text-sm">Working…</p>'; return; }
  if (!RESULTS.length) {
    st.innerHTML = "";
    $("invite-best-btn").classList.add("hidden");
    const n = CVS.filter(c => c.category === (vacById(vid) || {}).category).length;
    box.innerHTML = `<div class="text-center text-slate-500 text-sm py-10">No analysis yet for this vacancy (${n} CV(s) in category).<br>Click <b class="text-emerald-400">▶ Run analysis</b>.</div>`;
    return;
  }
  const s = data.stats;
  const stat = (label, val, hint) => `<div class="rounded-lg bg-slate-800/60 px-3 py-2" title="${hint}"><div class="text-slate-500">${label}</div><div class="text-base font-semibold text-slate-100">${val ?? "—"}</div></div>`;
  st.innerHTML = stat("Analyzed", s.count, "CVs analyzed for this vacancy") + stat("Avg fit", s.avg_fit != null ? s.avg_fit + "/100" : null, "Average fit score")
    + stat("Avg AI-score", s.avg_ai != null ? s.avg_ai + "%" : null, "Average AI-generated probability") + stat("Full coverage", s.skill_coverage != null ? s.skill_coverage + "%" : null, "Share of candidates with no missing skills");
  const invited = new Map(INVITES.filter(i => i.vacancy_id === vid).map(i => [i.cv_id, i]));
  const bestIdx = RESULTS.findIndex(x => x.status === "done");
  $("invite-best-btn").classList.toggle("hidden", bestIdx < 0);
  box.innerHTML = pendHtml + RESULTS.map((r, i) => {
    const c = r.cv, best = i === bestIdx, inv = invited.get(c.id);
    const invLabel = inv ? (inv.completed ? `✓ ${inv.decision || "done"}` : "✓ Invited") : "Invite";
    return `<div class="rounded-xl p-3 border cursor-pointer hover:border-slate-600 transition-colors ${best ? "border-amber-500/70 bg-amber-950/20" : "border-slate-800 bg-slate-800/40"}" onclick="showCV(${c.id})">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 min-w-0">
          <span class="w-6 text-center shrink-0">${best ? "🏆" : `<span class="text-slate-500 text-xs">#${i + 1}</span>`}</span>
          <span class="font-medium truncate">${esc(c.name)}</span>
          <span class="${aiCls(c.ai_score)} text-[11px] shrink-0" title="AI-generated probability">AI ${c.ai_score ?? "?"}%</span>
          ${c.footprint && c.footprint.consistent === false ? '<span class="text-[11px] text-amber-400 shrink-0" title="Footprint inconsistent with CV">⚠ footprint</span>' : ""}
        </div>
        <div class="flex items-center gap-2 shrink-0">
          ${r.status === "done" ? `<div class="w-24 hidden sm:block"><div class="bar"><i class="${fitColor(r.fit_score)}" style="width:${r.fit_score}%"></i></div></div><span class="font-bold text-indigo-300 w-14 text-right">${r.fit_score}/100</span>` : `<span class="text-xs text-red-400">${esc(r.status)}</span>`}
          <button onclick="event.stopPropagation();inviteCV(${c.id})" class="text-xs px-2 py-1 rounded ${inv ? "bg-slate-700 hover:bg-slate-600" : "bg-emerald-700 hover:bg-emerald-600"}">${invLabel}</button>
        </div>
      </div>
      ${r.status === "done" ? `<div class="text-xs text-slate-400 mt-1.5 line-clamp-2">${esc(r.summary || "")}</div>
      ${r.missing_skills && r.missing_skills.length ? `<div class="text-[11px] text-red-400/90 mt-1 truncate">missing: ${esc(r.missing_skills.join(", "))}</div>` : '<div class="text-[11px] text-emerald-400/90 mt-1">all key requirements covered</div>'}` : ""}
    </div>`;
  }).join("");
}

/* ---------- invites & reports ---------- */
const STATUS_META = {
  pending: { label: "⏳ Pending", cls: "bg-slate-700 text-slate-300" },
  inprogress: { label: "🎙 In progress", cls: "bg-indigo-900 text-indigo-300" },
  HIRE: { label: "✅ HIRE", cls: "bg-emerald-900 text-emerald-400" },
  CONSIDER: { label: "⚠ CONSIDER", cls: "bg-amber-900 text-amber-400" },
  REJECT: { label: "❌ REJECT", cls: "bg-red-900 text-red-400" },
};
function inviteStatus(inv) {
  if (inv.completed) return inv.decision || "CONSIDER";
  return inv.answered > 0 || inv.live ? "inprogress" : "pending";
}

async function loadInvites(silent = false) {
  try {
    const [invites, reports] = await Promise.all([api("/api/invites", { silent }), api("/api/reports", { silent })]);
    INVITES = invites;
    REPORTS = {}; reports.forEach(r => REPORTS[r.id] = r);
  } catch { return; }
  renderInvites(); renderKPIs();
}

function setInviteFilter(k) { INVITE_FILTER = k; renderInvites(); }

function renderInvites() {
  const counts = { all: INVITES.length, pending: 0, inprogress: 0, HIRE: 0, CONSIDER: 0, REJECT: 0 };
  INVITES.forEach(i => counts[inviteStatus(i)]++);
  $("invite-stats").innerHTML = Object.entries(counts).map(([k, n]) => {
    const meta = k === "all" ? { label: "All", cls: "bg-slate-800 text-slate-200" } : STATUS_META[k];
    return `<button onclick="setInviteFilter('${k}')" class="px-2 py-1 rounded-lg ${meta.cls} ${INVITE_FILTER === k ? "ring-2 ring-indigo-400" : "opacity-70 hover:opacity-100"}">${meta.label} · ${n}</button>`;
  }).join("");
  const shown = INVITES.filter(i => INVITE_FILTER === "all" || inviteStatus(i) === INVITE_FILTER);
  $("invite-list").innerHTML = shown.map(inv => {
    const st = STATUS_META[inviteStatus(inv)];
    const rep = REPORTS[inv.report_id];
    return `<div class="bg-slate-800/50 rounded-lg p-2.5 border ${inv.live ? "border-emerald-700" : "border-transparent"}">
      <div class="flex items-center justify-between gap-2">
        <span class="font-medium truncate">${esc(inv.candidate)}</span>
        <span class="text-[11px] px-1.5 py-0.5 rounded shrink-0 ${st.cls}">${st.label}${inv.completed && inv.score != null ? " · " + inv.score + "/10" : ""}</span>
      </div>
      <div class="text-[11px] text-slate-500 mt-0.5">${esc(inv.vacancy)} · ${fmtDate(inv.created_at)}${!inv.completed && inv.answered ? ` · answered ${inv.answered}` : ""}</div>
      <div class="flex flex-wrap gap-1.5 mt-1.5">
        ${!inv.completed ? `<button onclick="copyText('${esc(inv.link)}')" class="text-[11px] px-2 py-1 rounded bg-slate-700 hover:bg-slate-600">🔗 Copy link</button>
          <button onclick="connectLive('${esc(inv.token)}')" class="text-[11px] px-2 py-1 rounded ${inv.live ? "bg-emerald-700 hover:bg-emerald-600 animate-pulse" : "bg-slate-700 hover:bg-slate-600"}">👁 ${inv.live ? "LIVE" : "Watch"}</button>
          ${inv.answered || inv.live ? `<button onclick="stopInterview('${esc(inv.token)}')" class="text-[11px] px-2 py-1 rounded bg-slate-700 hover:bg-red-700">⏹ Stop</button>` : `<button onclick="delInvite(${inv.id})" class="text-[11px] px-2 py-1 rounded bg-slate-700 hover:bg-red-700">✕ Revoke</button>`}` : ""}
        ${rep && inv.completed ? `<button onclick="showReport(${rep.id})" class="text-[11px] px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600">📋 Report${rep.video ? " · 🎥" : ""}</button>` : ""}
      </div>
    </div>`;
  }).join("") || '<p class="text-slate-500 text-sm text-center py-6">No interviews here yet.<br><span class="text-xs">Invite candidates from the ranking.</span></p>';
}

async function delInvite(id) {
  if (!confirm("Revoke this invite? The link will stop working.")) return;
  await api(`/api/invites/${id}`, { method: "DELETE" });
  loadInvites();
}

async function stopInterview(token) {
  if (!confirm("Stop this interview? Partial answers will be scored into a report.")) return;
  try {
    const res = await api(`/api/interview/${token}/stop`, { method: "POST" });
    toast(res.already_done ? "Interview was already finished" : `Interview stopped — ${res.decision}, ${res.score}/10`, "ok");
  } catch {}
  loadInvites();
}

let LIVE_TIMER = null;
function connectLive(token) {
  modalHtml(`<h3 class="font-semibold text-lg mb-1">👁 Live interview</h3>
    <div id="live-info" class="text-sm text-slate-400 mb-2">Connecting…</div>
    <div id="live-frame" class="w-full aspect-video bg-black rounded-xl border border-slate-700 flex items-center justify-center text-slate-500 text-sm mb-2">waiting for candidate's camera…</div>
    <div class="flex items-center justify-between"><p class="text-xs text-slate-500">Snapshot from the candidate's camera, refreshed every ~5 s.</p>
    <button onclick="stopInterview('${esc(token)}')" class="text-xs px-3 py-1.5 rounded-lg bg-red-800 hover:bg-red-700">⏹ Stop interview</button></div>`);
  const poll = async () => {
    let d;
    try { d = await api(`/api/interview/${token}/live`, { silent: true }); } catch { return; }
    const box = $("live-info");
    if (!box) { clearInterval(LIVE_TIMER); LIVE_TIMER = null; return; }
    if (d.completed) {
      box.innerHTML = `<span class="text-emerald-400">Interview finished — ${esc(d.candidate)} answered ${d.answered}/${d.questions}.</span>`;
      $("live-frame").innerHTML = '<span class="text-slate-500 text-sm">stream ended</span>';
      clearInterval(LIVE_TIMER); LIVE_TIMER = null; loadInvites();
      return;
    }
    box.innerHTML = `${esc(d.candidate)} · ${esc(d.vacancy)} — answered <b class="text-indigo-300">${d.answered}/${d.questions || "?"}</b>`;
    const img = $("live-frame");
    if (d.frame) { img.innerHTML = `<img src="${esc(d.frame)}" class="w-full h-full object-cover rounded-xl">`; img.dataset.hadFrame = "1"; }
    else if (img.dataset.hadFrame !== "1") img.innerHTML = '<span class="text-slate-500 text-sm">candidate camera not visible yet…</span>';
  };
  poll();
  LIVE_TIMER = setInterval(poll, 2500);
}

async function showVideos() {
  let vids = [];
  try { vids = await api("/api/recordings"); } catch { return; }
  const items = vids.map(v => `
    <div class="bg-slate-800/50 rounded-xl p-3">
      <video src="${esc(v.url)}" controls preload="metadata" class="w-full rounded-lg bg-black max-h-56"></video>
      <div class="flex items-center justify-between mt-2 gap-2">
        <div class="min-w-0">
          <div class="text-sm font-medium truncate">${esc(v.candidate)} <span class="text-slate-500 text-xs">· ${esc(v.vacancy)}</span></div>
          <div class="text-xs text-slate-500">${esc(v.date)} · ${v.size_kb} KB${v.decision ? ` · <b>${esc(v.decision)}</b> ${v.score ?? "?"}/10` : ""}</div>
        </div>
        <button onclick="confirmDeleteVideo('${esc(v.file)}')" class="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-red-700 shrink-0">🗑</button>
      </div>
    </div>`).join("");
  modalHtml(`<h3 class="font-semibold text-lg mb-3">🎥 Interview recordings</h3>
    <div class="grid sm:grid-cols-2 gap-3">${items}</div>${items ? "" : '<p class="text-slate-500 text-sm">No recordings yet. Videos appear after candidates finish their interviews.</p>'}`, true);
}

async function confirmDeleteVideo(file) {
  if (!confirm("Delete this recording?")) return;
  await api(`/api/recordings/${encodeURIComponent(file)}`, { method: "DELETE" });
  showVideos();
}

function showReport(id) {
  const r = REPORTS[id];
  if (!r) return;
  const dcls = r.decision === "HIRE" ? "bg-emerald-900 text-emerald-400" : r.decision === "REJECT" ? "bg-red-900 text-red-400" : "bg-amber-900 text-amber-400";
  modalHtml(`<div class="flex items-start justify-between gap-3 mb-3">
      <div><h3 class="font-semibold text-lg">${esc(r.candidate)}</h3><div class="text-sm text-slate-400">${esc(r.vacancy)} · interview report</div></div>
      <div class="text-right shrink-0"><div class="text-2xl font-bold ${scoreCls(r.total_score)}">${r.total_score}/10</div><span class="px-2 py-0.5 rounded text-xs font-semibold ${dcls}">${esc(r.decision || "—")}</span></div>
    </div>
    <p class="text-sm text-slate-300 mb-3 p-3 rounded-lg bg-slate-800/50">${esc(r.justification)}</p>
    <div class="grid sm:grid-cols-3 gap-3 text-xs mb-3">
      <div><div class="text-emerald-400 font-semibold mb-1">Strengths</div>${list(r.strengths, "text-slate-400")}</div>
      <div><div class="text-amber-400 font-semibold mb-1">Weaknesses</div>${list(r.weaknesses, "text-slate-400")}</div>
      <div><div class="text-indigo-300 font-semibold mb-1">Knowledge areas</div>${list(r.areas, "text-slate-400")}</div>
    </div>
    ${r.video ? `<div class="mb-3"><div class="text-xs font-semibold mb-1">🎥 Recording</div><video src="${esc(r.video)}" controls preload="metadata" class="w-full rounded-lg border border-slate-700 max-h-72 bg-black"></video></div>` : ""}
    <div class="text-xs font-semibold mb-2 border-t border-slate-700 pt-3">Transcript</div>
    <div class="space-y-2">
      ${(r.transcript || []).map((t, i) => `<div class="text-sm bg-slate-800/60 rounded-lg p-3 ${t.followup_of != null ? "ml-6 border-l-2 border-amber-700" : ""}">
        <div class="flex justify-between gap-2"><div class="text-slate-200"><b>${t.followup_of != null ? "Follow-up" : "Q" + (i + 1)}:</b> ${esc(t.q)}</div><span class="font-bold shrink-0 ${scoreCls(t.score)}">${t.score}/10</span></div>
        <div class="text-slate-400 mt-1"><b>A:</b> ${esc(t.a)}</div>
        <div class="mt-1 text-xs text-slate-500 italic">${esc(t.feedback || "")}</div>
      </div>`).join("") || '<p class="text-slate-500 text-sm">No answers were given.</p>'}
    </div>`, true);
}

/* ---------- chat ---------- */
let CHAT_LOG = [], CHAT_BUSY = false;
const CHIPS = [
  "Who is the best candidate for this vacancy?",
  "Run analysis for this vacancy and invite the best candidate",
  "List all Programmer candidates",
  "Show the report",
  "Which CVs look AI-generated?",
  "What should I ask a Sales Manager in an interview?",
];
function renderChips() {
  $("chat-chips").innerHTML = CHIPS.map((c, i) => `<button type="button" class="chip" onclick="useChip(${i})">${esc(c)}</button>`).join("");
}
function useChip(i) { $("chat-input").value = CHIPS[i]; sendChat(); }
function clearChat() { CHAT_LOG = []; renderChat(); }
function pushAI(html) { CHAT_LOG.push({ role: "ai", html, plain: html.replace(/<[^>]+>/g, "") }); renderChat(); }

function renderChat() {
  const box = $("chat-log");
  if (!CHAT_LOG.length && !CHAT_BUSY) {
    box.innerHTML = `<div class="text-slate-500 text-xs leading-relaxed p-3 rounded-lg bg-slate-800/30">👋 I'm your HR assistant. I know your vacancies, CVs, fit scores and interview results.<br>
      Ask questions (“who fits best for Python Developer?”) or give explicit commands (“run analysis for Python Developer and invite the best candidate”). I reply in your language.</div>`;
    return;
  }
  box.innerHTML = CHAT_LOG.map(m => m.role === "user"
    ? `<div class="flex justify-end"><div class="bg-indigo-700/70 rounded-2xl rounded-br-sm px-4 py-2 max-w-[85%] whitespace-pre-wrap">${esc(m.text)}</div></div>`
    : `<div class="flex justify-start"><div class="bg-slate-800 rounded-2xl rounded-bl-sm px-4 py-2 max-w-[85%] whitespace-pre-wrap">${m.html}</div></div>`
  ).join("") + (CHAT_BUSY ? `<div class="flex justify-start"><div class="bg-slate-800 rounded-2xl px-4 py-2 text-slate-400 text-xs"><span class="spin">⚙</span> thinking…</div></div>` : "");
  box.scrollTop = box.scrollHeight;
}

async function sendChat() {
  const inp = $("chat-input");
  const msg = inp.value.trim();
  if (!msg || CHAT_BUSY) return;
  inp.value = "";
  const history = CHAT_LOG.slice(-8).map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.role === "user" ? m.text : m.plain }));
  CHAT_LOG.push({ role: "user", text: msg });
  CHAT_BUSY = true; $("chat-send").disabled = true; renderChat();
  try {
    const res = await api("/api/chat", { method: "POST", body: { message: msg, vacancy_id: SEL_VAC, history } });
    let html = esc(res.reply || "(no reply)");
    for (const ex of res.executed || []) {
      html += `\n\n<span class="text-emerald-400 font-semibold">⚡ ${esc(ex.action.replace(/_/g, " "))}</span>\n${esc(ex.text).replace(/(https?:\/\/[^\s]+)/g, '<span class="text-indigo-300 break-all">$1</span>')}`;
      if (ex.link) html += ` <button onclick="copyText('${esc(ex.link)}')" class="underline text-xs text-slate-400">copy link</button>`;
    }
    if (!(res.executed || []).length && res.intent === "chat") html += `\n<span class="text-[10px] text-slate-500">💬 answer only — no action executed</span>`;
    CHAT_BUSY = false;
    CHAT_LOG.push({ role: "ai", html, plain: [res.reply, ...(res.executed || []).map(e => `[executed ${e.action}] ${e.text}`)].join("\n") });
    renderChat();
    const ran = (res.executed || []).find(e => e.action === "run_analysis");
    if (res.run_id) {
      const vMatch = VACS.find(v => ran && ran.text.includes(`'${v.title}'`));
      if (vMatch && vMatch.id !== SEL_VAC) await selectVac(vMatch.id);
      pollProgress(res.run_id, SEL_VAC);
    }
    if ((res.executed || []).some(e => e.link)) loadInvites();
  } catch { CHAT_BUSY = false; renderChat(); }
  $("chat-send").disabled = false;
  inp.focus();
}

/* ---------- candidate ---------- */
let APPLY_VAC = null;
async function initCandidate() {
  $("cand-view").classList.remove("hidden");
  const open = VACS.filter(v => v.active);
  APPLY_VAC = open[0] ? open[0].id : null;
  renderCandVacs();
  $("apply-file").addEventListener("change", (e) => { $("apply-file-name").textContent = e.target.files[0] ? e.target.files[0].name : "Choose CV file…"; });
  loadCandidateData();
}

function renderCandVacs() {
  const open = VACS.filter(v => v.active);
  $("cand-vacs").innerHTML = open.map(v => `<button onclick="APPLY_VAC=${v.id};renderCandVacs()" class="text-left rounded-xl p-3 border transition-colors ${v.id === APPLY_VAC ? "border-indigo-500 bg-indigo-950/40" : "border-slate-800 bg-slate-800/40 hover:bg-slate-800"}">
    <div class="font-medium text-sm">${esc(v.title)}</div><div class="text-xs text-slate-500 mb-1">${esc(v.category)}</div>
    <div class="text-xs text-slate-400 line-clamp-2">${esc(v.description)}</div></button>`).join("") || '<p class="text-slate-500 text-sm">No open vacancies right now.</p>';
}

async function loadCandidateData() {
  const [apps, invites] = await Promise.all([api("/api/my/applications").catch(() => []), api("/api/my/invites").catch(() => [])]);
  $("my-apps").innerHTML = apps.map(a => `<div class="bg-slate-800/50 rounded-lg p-3 flex items-center justify-between gap-2">
      <div class="min-w-0"><div class="font-medium truncate">${esc(a.vacancy)}</div><div class="text-xs text-slate-500 truncate">${esc(a.filename)} · ${fmtDate(a.created_at)}</div></div>
      <span class="text-xs px-2 py-0.5 rounded shrink-0 ${a.status.startsWith("Invited") ? "bg-indigo-900 text-indigo-300" : a.status.startsWith("Interview") ? "bg-emerald-900 text-emerald-400" : "bg-slate-700 text-slate-300"}">${esc(a.status)}</span>
    </div>`).join("") || '<p class="text-slate-500 text-sm">No applications yet.</p>';
  $("my-invites").innerHTML = invites.map(i => `<div class="bg-slate-800/50 rounded-lg p-3 flex items-center gap-2">
      <div class="flex-1 min-w-0"><div class="font-medium">${esc(i.vacancy)}</div><div class="text-xs text-slate-500 truncate">${esc(i.link)}</div></div>
      ${i.completed ? '<span class="text-xs text-emerald-400">✓ completed</span>' : `<a href="${esc(i.link)}" class="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-medium">▶ Start interview</a>`}
    </div>`).join("") || '<p class="text-slate-500 text-sm">No invites yet — you will see interview links here once a recruiter invites you.</p>';
}

async function applyJob() {
  const f = $("apply-file").files[0];
  if (!APPLY_VAC) return toast("Choose a vacancy", "error");
  if (!f) return toast("Choose a CV file", "error");
  const st = $("apply-status");
  $("apply-btn").disabled = true;
  st.innerHTML = '<span class="spin">⚙</span> Uploading & parsing your CV…';
  const fd = new FormData();
  fd.append("vacancy_id", APPLY_VAC);
  fd.append("file", f);
  try {
    const data = await api("/api/apply", { method: "POST", body: fd });
    st.innerHTML = `<span class="text-emerald-400">✓ Application for “${esc(data.vacancy)}” submitted. The recruiting team will review it.</span>`;
    toast("Application submitted", "ok");
    $("apply-file").value = ""; $("apply-file-name").textContent = "Choose CV file…";
    loadCandidateData();
  } catch { st.innerHTML = ""; }
  $("apply-btn").disabled = false;
}
