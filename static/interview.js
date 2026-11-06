/* AI interview page: getUserMedia preview, Web Speech API voice, text fallback */
const TOKEN = location.pathname.split("/").pop();
let TOTAL = 0, ANSWERED = 0, BUSY = false, RECOGNITION = null, RECORDING = false;

function toast(msg, type = "info") {
  const d = document.createElement("div");
  const color = type === "error" ? "border-red-500 bg-red-950" : type === "ok" ? "border-emerald-500 bg-emerald-950" : "border-slate-600 bg-slate-900";
  d.className = `${color} border rounded-xl px-4 py-3 text-sm shadow-lg`;
  d.textContent = msg;
  document.getElementById("toasts").appendChild(d);
  setTimeout(() => d.remove(), 4500);
}

async function api(url, opts = {}) {
  opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
  if (opts.body && typeof opts.body !== "string") opts.body = JSON.stringify(opts.body);
  const r = await fetch(url, opts);
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Request failed");
  return data;
}

function speak(text) {
  if (!document.getElementById("tts-on").checked || !("speechSynthesis" in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    speechSynthesis.speak(u);
  } catch {}
}

async function init() {
  let info;
  try { info = await api(`/api/interview/${TOKEN}`); }
  catch (e) {
    document.getElementById("loading").innerHTML = `<div class="text-red-400">${e.message}</div>`;
    return;
  }
  document.getElementById("loading").classList.add("hidden");
  if (info.completed) {
    document.getElementById("setup").classList.remove("hidden");
    document.getElementById("setup").innerHTML = `<h2 class="text-xl font-semibold mb-2">Interview already completed</h2><p class="text-slate-400 text-sm">This invite link has been used. Contact the recruiter if you believe this is a mistake.</p>`;
    return;
  }
  document.getElementById("setup").classList.remove("hidden");
  document.getElementById("vac-title").textContent = `${info.vacancy} — candidate: ${info.candidate}`;
  document.getElementById("hdr-info").textContent = `${info.candidate} · ${info.vacancy}`;
  document.getElementById("perm-btn").onclick = requestMedia;
  document.getElementById("start-btn").onclick = startInterview;
  document.getElementById("send-btn").onclick = () => submitAnswer();
  document.getElementById("answer-input").addEventListener("keydown", e => { if (e.key === "Enter") submitAnswer(); });
  document.getElementById("mic-btn").onclick = toggleMic;
}

async function requestMedia() {
  const st = document.getElementById("cam-status");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById("preview").srcObject = stream;
    st.innerHTML = '<span class="text-emerald-400">✓ Camera & microphone ready</span>';
    document.getElementById("perm-btn").classList.add("hidden");
    document.getElementById("start-btn").classList.remove("hidden");
  } catch (e) {
    st.innerHTML = `<span class="text-amber-400">Media access denied (${e.name}). You can still continue with typed answers.</span>`;
    document.getElementById("preview").outerHTML = '<div class="w-56 h-32 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-500 text-xs text-center p-2">No camera — text answers still work</div>';
    document.getElementById("perm-btn").classList.add("hidden");
    document.getElementById("start-btn").classList.remove("hidden");
  }
}

function setupRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    document.getElementById("mic-hint").textContent = "Voice input not available in this browser (use Chrome/Chromium). Type your answer instead.";
    document.getElementById("mic-btn").disabled = true;
    document.getElementById("mic-btn").classList.add("opacity-40");
    return;
  }
  RECOGNITION = new SR();
  RECOGNITION.lang = "en-US";
  RECOGNITION.continuous = true;
  RECOGNITION.interimResults = true;
  let finalText = "";
  RECOGNITION.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript + " ";
      else interim += e.results[i][0].transcript;
    }
    document.getElementById("answer-input").value = (finalText + interim).trim();
  };
  RECOGNITION.onend = () => { if (RECORDING) { try { RECOGNITION.start(); } catch {} } };
  RECOGNITION.onerror = (e) => {
    if (e.error === "not-allowed") { RECORDING = false; toast("Microphone blocked — type your answer", "error"); }
    document.getElementById("listening").classList.add("hidden");
  };
  RECOGNITION._final = () => finalText;
}

function toggleMic() {
  if (!RECOGNITION) setupRecognition();
  if (!RECOGNITION) return;
  if (!RECORDING) {
    finalReset();
    try { RECOGNITION.start(); } catch {}
    RECORDING = true;
    document.getElementById("mic-btn").textContent = "⏹ Stop & send";
    document.getElementById("mic-btn").classList.replace("bg-indigo-600", "bg-red-600");
    document.getElementById("listening").classList.remove("hidden");
  } else {
    RECORDING = false;
    try { RECOGNITION.stop(); } catch {}
    document.getElementById("mic-btn").textContent = "🎤 Answer by voice";
    document.getElementById("mic-btn").classList.replace("bg-red-600", "bg-indigo-600");
    document.getElementById("listening").classList.add("hidden");
    setTimeout(() => submitAnswer(), 400); // let final results flush
  }
}
function finalReset() {
  if (RECOGNITION && RECOGNITION._final) { /* fresh transcript per answer */ 
    const input = document.getElementById("answer-input");
    input.value = "";
  }
}

async function startInterview() {
  document.getElementById("start-btn").innerHTML = '<span class="spin inline-block">⚙</span> Preparing…';
  try {
    const res = await api(`/api/interview/${TOKEN}/start`, { method: "POST" });
    document.getElementById("setup").classList.add("hidden");
    document.getElementById("interview").classList.remove("hidden");
    TOTAL = res.total;
    document.getElementById("intro-text").textContent = res.intro;
    setQuestion(res.question, false);
    speak(res.intro + " First question. " + res.question);
  } catch (e) {
    toast(e.message, "error");
    document.getElementById("start-btn").textContent = "▶ Start interview";
  }
}

function setQuestion(q, isFollowup) {
  document.getElementById("question-text").innerHTML =
    (isFollowup ? '<span class="text-amber-400 text-sm">Follow-up:</span> ' : "") + q.replace(/</g, "&lt;");
  document.getElementById("answer-input").value = "";
  updateProgress();
}

function updateProgress() {
  document.getElementById("q-progress").textContent = TOTAL ? `Question ${Math.min(ANSWERED + 1, TOTAL)} / ${TOTAL}` : "";
}

function addTranscriptItem(html) {
  document.getElementById("transcript").insertAdjacentHTML("beforeend", html);
}

async function submitAnswer() {
  if (BUSY) return;
  const input = document.getElementById("answer-input");
  const answer = input.value.trim();
  if (!answer) return toast("Say or type an answer first", "error");
  BUSY = true;
  document.getElementById("send-btn").innerHTML = '<span class="spin inline-block">⚙</span>';
  const qText = document.getElementById("question-text").textContent.replace(/^Follow-up:\s*/, "");
  addTranscriptItem(`<div class="bg-slate-800/50 rounded-xl p-3 text-sm"><b class="text-slate-400 text-xs">YOU</b><div class="mt-1 text-slate-300">${answer.replace(/</g, "&lt;")}</div></div>`);
  input.value = "";
  try {
    const res = await api(`/api/interview/${TOKEN}/answer`, { method: "POST", body: { answer, question: qText } });
    ANSWERED = res.answered;
    const cls = res.score >= 7 ? "text-emerald-400" : res.score >= 5 ? "text-amber-400" : "text-red-400";
    document.getElementById("feedback-box").classList.remove("hidden");
    document.getElementById("fb-score").textContent = `${res.score}/10 — `;
    document.getElementById("fb-score").className = `font-semibold ${cls}`;
    document.getElementById("fb-text").textContent = res.feedback || "";
    speak(`Score ${res.score} out of 10. ${res.feedback || ""}`);
    if (res.done) return finishInterview(res.report);
    setTimeout(() => {
      setQuestion(res.next_question || res.followup, !res.next_question);
      speak((res.next_question ? "Next question. " : "A follow-up. ") + (res.next_question || res.followup));
    }, 1200);
  } catch (e) { toast(e.message, "error"); }
  BUSY = false;
  document.getElementById("send-btn").textContent = "Send";
}

async function finishInterview(report) {
  document.getElementById("interview").classList.add("hidden");
  const f = document.getElementById("final");
  f.classList.remove("hidden");
  const dcls = report.decision === "HIRE" ? "bg-emerald-900 text-emerald-400" : report.decision === "REJECT" ? "bg-red-900 text-red-400" : "bg-amber-900 text-amber-400";
  f.innerHTML = `
    <h2 class="text-xl font-semibold mb-2">✅ Interview complete</h2>
    <div class="flex items-center gap-3 mb-3">
      <span class="text-3xl font-bold text-indigo-300">${report.total_score}/10</span>
      <span class="px-3 py-1 rounded-lg font-semibold ${dcls}">${report.decision}</span>
    </div>
    <p class="text-slate-300 text-sm mb-3">${report.justification.replace(/</g, "&lt;")}</p>
    <div class="text-xs text-slate-400 mb-1"><b>Strengths:</b> ${(report.strengths || []).map(x => x.replace(/</g, "&lt;")).join("; ")}</div>
    <div class="text-xs text-slate-400 mb-1"><b>Weaknesses:</b> ${(report.weaknesses || []).map(x => x.replace(/</g, "&lt;")).join("; ")}</div>
    <div class="text-xs text-slate-400 mb-4"><b>Knowledge areas:</b> ${(report.areas || []).map(x => x.replace(/</g, "&lt;")).join(", ")}</div>
    <h3 class="font-semibold mb-2 text-sm">Per-question breakdown</h3>
    <div class="space-y-2">${(report.transcript || []).filter(t => t.followup_of == null).map(t => `
      <div class="bg-slate-800/60 rounded-lg p-3 text-sm">
        <div class="font-medium">${t.q.replace(/</g, "&lt;")}</div>
        <div class="text-slate-400 text-xs mt-1">Your answer: ${t.a.slice(0, 200).replace(/</g, "&lt;")}</div>
        <div class="text-xs mt-1 ${t.score >= 7 ? "text-emerald-400" : t.score >= 5 ? "text-amber-400" : "text-red-400"}">${t.score}/10 — ${t.feedback.replace(/</g, "&lt;")}</div>
      </div>`).join("")}</div>
    <p class="text-xs text-slate-500 mt-4">Your report has been sent to the recruiter. You can close this page.</p>`;
  window.scrollTo(0, 0);
}

init();
