/* AI interview page: Nova avatar, getUserMedia + video recording, Web Speech API voice, text fallback */
const TOKEN = location.pathname.split("/").pop();
let TOTAL = 0, ANSWERED = 0, BUSY = false, RECOGNITION = null, RECORDING = false;
const LOCALES = { en: "en-US", ru: "ru-RU", az: "az-AZ" };
const PHRASES = {
  en: { first: "First question.", next: "Next question.", follow: "A follow-up.", done: "That's everything from my side, thank you! I'm preparing your report." },
  ru: { first: "Первый вопрос.", next: "Следующий вопрос.", follow: "Уточняющий вопрос.", done: "Это все вопросы, спасибо! Готовлю ваш отчёт." },
  az: { first: "Birinci sual.", next: "Növbəti sual.", follow: "Əlavə sual.", done: "Suallarım bu qədər idi, təşəkkür edirəm! Hesabatınızı hazırlayıram." },
};
let LANG = "en";
const T = (k) => (PHRASES[LANG] || PHRASES.en)[k];
let MEDIA_RECORDER = null, VIDEO_CHUNKS = [], CAM_STREAM = null, REC_UPLOADED = false;

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

/* ---------- Nova avatar ---------- */
function setAvatar(state) {
  for (const id of ["avatar", "avatar2"]) {
    const a = document.getElementById(id);
    if (!a) continue;
    a.classList.remove("state-idle", "state-listening", "state-speaking");
    a.classList.add(`state-${state}`);
    const lbl = a.querySelector(".state-label");
    if (lbl) lbl.textContent = state === "speaking" ? "speaking" : state === "listening" ? "listening…" : "idle";
  }
}

/* ---------- speech synthesis with pause/stop/repeat ---------- */
let LAST_TTS = "", TTS_PAUSED = false;
function speak(text, onDone) {
  LAST_TTS = text;
  if (!document.getElementById("tts-on").checked || !("speechSynthesis" in window)) { setAvatar("idle"); if (onDone) onDone(); return; }
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.04;
    u.lang = LOCALES[LANG] || "en-US";
    const voice = speechSynthesis.getVoices().find(v => v.lang && v.lang.toLowerCase().startsWith(LANG));
    if (voice) u.voice = voice;
    u.onstart = () => { TTS_PAUSED = false; setAvatar("speaking"); pauseBtnReset(); };
    u.onend = () => { setAvatar("idle"); pauseBtnReset(); if (onDone) onDone(); };
    u.onerror = () => { setAvatar("idle"); pauseBtnReset(); if (onDone) onDone(); };
    speechSynthesis.speak(u);
  } catch { setAvatar("idle"); }
}
function ttsRepeat() { if (LAST_TTS) { toast("Repeating…"); speak(LAST_TTS); } }
function ttsPause() {
  if (!("speechSynthesis" in window)) return;
  if (TTS_PAUSED) { speechSynthesis.resume(); TTS_PAUSED = false; pauseBtnReset(); setAvatar("speaking"); }
  else { speechSynthesis.pause(); TTS_PAUSED = true; pauseBtnPaused(); setAvatar("idle"); }
}
function ttsStop() { if ("speechSynthesis" in window) { speechSynthesis.cancel(); TTS_PAUSED = false; pauseBtnReset(); setAvatar("idle"); } }
function pauseBtnReset() { const b = document.getElementById("tts-pause"); b.textContent = "⏸ Pause"; }
function pauseBtnPaused() { const b = document.getElementById("tts-pause"); b.textContent = "▶ Resume"; }

/* ---------- video recording ---------- */
function startRecording() {
  if (!CAM_STREAM || !window.MediaRecorder) return;
  try {
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ? "video/webm;codecs=vp8" : "video/webm";
    MEDIA_RECORDER = new MediaRecorder(CAM_STREAM, { mimeType: mime });
    VIDEO_CHUNKS = [];
    MEDIA_RECORDER.ondataavailable = (e) => { if (e.data.size) VIDEO_CHUNKS.push(e.data); };
    MEDIA_RECORDER.start(1000);
    document.getElementById("rec-badge").classList.remove("hidden");
  } catch (e) { console.warn("recording unavailable", e); }
}

function stopRecordingAndUpload() {
  if (REC_UPLOADED || !MEDIA_RECORDER || MEDIA_RECORDER.state === "inactive") return Promise.resolve();
  REC_UPLOADED = true;
  document.getElementById("rec-badge").classList.add("hidden");
  return new Promise((resolve) => {
    MEDIA_RECORDER.onstop = async () => {
      const blob = new Blob(VIDEO_CHUNKS, { type: "video/webm" });
      if (!blob.size) return resolve();
      toast("Saving interview recording…");
      try {
        const fd = new FormData();
        fd.append("video", blob, "interview.webm");
        await fetch(`/api/interview/${TOKEN}/video`, { method: "POST", body: fd });
        toast("Recording saved ✓ (visible to the recruiter)", "ok");
      } catch { toast("Could not upload recording", "error"); }
      resolve();
    };
    MEDIA_RECORDER.stop();
  });
}

/* ---------- live frames + status polling (for admin viewer / remote stop) ---------- */
let INTERVIEW_OVER = false, FRAME_TIMER = null, STATUS_TIMER = null;

function startLiveTracking() {
  FRAME_TIMER = setInterval(() => {
    const v = document.getElementById("preview");
    if (INTERVIEW_OVER || !CAM_STREAM || !v.videoWidth) return;
    try {
      const c = document.createElement("canvas");
      c.width = 320; c.height = 240;
      c.getContext("2d").drawImage(v, 0, 0, 320, 240);
      c.toBlob((b) => {
        if (!b || INTERVIEW_OVER) return;
        const fd = new FormData();
        fd.append("frame", b, "frame.jpg");
        fetch(`/api/interview/${TOKEN}/frame`, { method: "POST", body: fd }).catch(() => {});
      }, "image/jpeg", 0.55);
    } catch {}
  }, 5000);
  STATUS_TIMER = setInterval(async () => {
    if (INTERVIEW_OVER || BUSY) return;
    try {
      const info = await api(`/api/interview/${TOKEN}`);
      if (info.completed) terminatedByRecruiter();
    } catch (e) { if (/not found/i.test(e.message)) terminatedByRecruiter(); }
  }, 8000);
}

function stopLiveTracking() {
  INTERVIEW_OVER = true;
  if (FRAME_TIMER) clearInterval(FRAME_TIMER);
  if (STATUS_TIMER) clearInterval(STATUS_TIMER);
}

async function exitInterview() {
  if (!confirm("Leave the interview? Your answers so far will be scored and sent to the recruiter.")) return;
  stopLiveTracking();
  ttsStop();
  toast("Leaving interview…");
  try { await api(`/api/interview/${TOKEN}/exit`, { method: "POST" }); } catch {}
  await stopRecordingAndUpload();
  document.getElementById("interview").classList.add("hidden");
  const f = document.getElementById("final");
  f.classList.remove("hidden");
  f.innerHTML = `<div class="text-center py-10">
    <div class="text-5xl mb-3">👋</div>
    <h2 class="text-xl font-semibold mb-2">You have left the interview</h2>
    <p class="text-slate-400 text-sm max-w-md mx-auto">Your partial answers were scored and saved. The recruiter can see your report and video recording. You can close this page now.</p>
  </div>`;
}

function terminatedByRecruiter() {
  if (INTERVIEW_OVER) return;
  stopLiveTracking();
  ttsStop();
  if (RECORDING) toggleMic();
  stopRecordingAndUpload();
  document.getElementById("interview").classList.add("hidden");
  const f = document.getElementById("final");
  f.classList.remove("hidden");
  f.innerHTML = `<div class="text-center py-10">
    <div class="text-5xl mb-3">🛑</div>
    <h2 class="text-xl font-semibold mb-2">Interview was ended by the recruiter</h2>
    <p class="text-slate-400 text-sm max-w-md mx-auto">Your answers so far have been scored and saved, together with the video recording. You can close this page now.</p>
  </div>`;
  window.scrollTo(0, 0);
}

/* ---------- init ---------- */
async function init() {
  let info;
  try { info = await api(`/api/interview/${TOKEN}`); }
  catch (e) { document.getElementById("loading").innerHTML = `<div class="text-red-400">${e.message}</div>`; return; }
  document.getElementById("loading").classList.add("hidden");
  if (info.completed) {
    document.getElementById("setup").classList.remove("hidden");
    document.getElementById("setup").innerHTML = `<div class="avatar state-idle mb-3"><div class="ring"></div><div class="head"><div class="antenna"></div><div class="eyes"><div class="eye"></div><div class="eye"></div></div><div class="mouth"><span></span><span></span><span></span><span></span><span></span></div></div><div class="state-label">Nova</div></div>
      <h2 class="text-xl font-semibold mb-2">Interview already completed</h2><p class="text-slate-400 text-sm">This invite link has been used. Contact the recruiter if you believe this is a mistake.</p>`;
    return;
  }
  document.getElementById("setup").classList.remove("hidden");
  LANG = info.lang || "en";
  document.getElementById("lang").value = LANG;
  document.getElementById("lang").onchange = (e) => { LANG = e.target.value; RECOGNITION = null; };
  if (info.answered > 0 || info.questions_total > 0) document.getElementById("start-btn").textContent = "▶ Continue interview";
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
    CAM_STREAM = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById("preview").srcObject = CAM_STREAM;
    st.innerHTML = '<span class="text-emerald-400">✓ Camera & microphone ready — the interview will be video recorded</span>';
    document.getElementById("perm-btn").classList.add("hidden");
    document.getElementById("start-btn").classList.remove("hidden");
  } catch (e) {
    st.innerHTML = `<span class="text-amber-400">Media access denied (${e.name}). You can continue with typed answers, but there will be no video recording.</span>`;
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
  RECOGNITION.lang = LOCALES[LANG] || "en-US";
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
  RECOGNITION.onstart = () => setAvatar("listening");
  RECOGNITION.onend = () => {
    if (RECORDING) { try { RECOGNITION.start(); } catch {} }
    else if (!speechSynthesis.speaking) setAvatar("idle");
  };
  RECOGNITION.onerror = (e) => {
    if (e.error === "not-allowed") { RECORDING = false; toast("Microphone blocked — type your answer", "error"); }
    document.getElementById("listening").classList.add("hidden");
  };
}

function toggleMic() {
  if (!RECOGNITION) setupRecognition();
  if (!RECOGNITION) return;
  if (!RECORDING) {
    ttsStop(); // don't record over Nova's voice
    document.getElementById("answer-input").value = "";
    try { RECOGNITION.start(); } catch {}
    RECORDING = true;
    document.getElementById("mic-btn").textContent = "⏹ Stop & send";
    document.getElementById("mic-btn").classList.replace("bg-indigo-600", "bg-red-600");
    document.getElementById("listening").classList.remove("hidden");
    setAvatar("listening");
  } else {
    RECORDING = false;
    try { RECOGNITION.stop(); } catch {}
    document.getElementById("mic-btn").textContent = "🎤 Answer by voice";
    document.getElementById("mic-btn").classList.replace("bg-red-600", "bg-indigo-600");
    document.getElementById("listening").classList.add("hidden");
    setTimeout(() => submitAnswer(), 400);
  }
}

async function startInterview() {
  document.getElementById("start-btn").innerHTML = '<span class="spin inline-block">⚙</span> Preparing…';
  try {
    const res = await api(`/api/interview/${TOKEN}/start`, { method: "POST", body: { lang: LANG } });
    LANG = res.lang || LANG;
    ANSWERED = res.answered || 0;
    startRecording();
    startLiveTracking();
    document.getElementById("setup").classList.add("hidden");
    document.getElementById("interview").classList.remove("hidden");
    TOTAL = res.total;
    document.getElementById("intro-text").textContent = res.intro;
    setQuestion(res.question, !!res.followup);
    speak(res.intro + " " + (ANSWERED ? "" : T("first") + " ") + res.question);
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
  document.getElementById("send-btn").disabled = true;
  document.getElementById("mic-btn").disabled = true;
  ttsStop();
  document.getElementById("send-btn").innerHTML = '<span class="spin inline-block">⚙</span>';
  const qText = document.getElementById("question-text").textContent.replace(/^Follow-up:\s*/, "");
  addTranscriptItem(`<div class="bg-slate-800/50 rounded-xl p-3 text-sm"><b class="text-slate-400 text-xs">YOU</b><div class="mt-1 text-slate-300">${answer.replace(/</g, "&lt;")}</div></div>`);
  input.value = "";
  setAvatar("idle");
  try {
    const res = await api(`/api/interview/${TOKEN}/answer`, { method: "POST", body: { answer, question: qText } });
    ANSWERED = res.answered;
    const cls = res.score >= 7 ? "text-emerald-400" : res.score >= 5 ? "text-amber-400" : "text-red-400";
    document.getElementById("feedback-box").classList.remove("hidden");
    document.getElementById("fb-score").textContent = `${res.score}/10 — `;
    document.getElementById("fb-score").className = `font-semibold ${cls}`;
    document.getElementById("fb-text").textContent = res.feedback || "";
    addTranscriptItem(`<div class="bg-indigo-950/40 border border-indigo-900 rounded-xl p-3 text-sm"><b class="text-indigo-300 text-xs">NOVA · ${res.score}/10</b><div class="mt-1 text-slate-300">${(res.feedback || "").replace(/</g, "&lt;")}</div></div>`);
    if (res.done) {
      await stopRecordingAndUpload();
      speak(`${res.feedback || ""} ${T("done")}`, () => finishInterview(res.report));
      return;
    }
    speak(`${res.feedback || ""} ${res.next_question ? T("next") : T("follow")} ${res.next_question || res.followup}`);
    setTimeout(() => setQuestion(res.next_question || res.followup, !res.next_question), 800);
  } catch (e) { toast(e.message, "error"); input.value = answer; }
  BUSY = false;
  document.getElementById("send-btn").disabled = false;
  document.getElementById("mic-btn").disabled = false;
  document.getElementById("send-btn").textContent = "Send";
}

async function finishInterview(report) {
  BUSY = false;
  stopLiveTracking();
  document.getElementById("send-btn").textContent = "Send";
  document.getElementById("interview").classList.add("hidden");
  const f = document.getElementById("final");
  f.classList.remove("hidden");
  const dcls = report.decision === "HIRE" ? "bg-emerald-900 text-emerald-400" : report.decision === "REJECT" ? "bg-red-900 text-red-400" : "bg-amber-900 text-amber-400";
  const verdictWord = report.decision === "HIRE" ? "Congratulations" : report.decision === "REJECT" ? "Unfortunately" : "Not bad at all";
  f.innerHTML = `
    <div class="avatar state-idle scale-[.62] -my-8"><div class="ring"></div><div class="head"><div class="antenna"></div><div class="eyes"><div class="eye"></div><div class="eye"></div></div><div class="mouth"><span></span><span></span><span></span><span></span><span></span></div></div><div class="state-label">interview complete</div></div>
    <h2 class="text-xl font-semibold mb-2 text-center">✅ Interview complete</h2>
    <div class="flex items-center justify-center gap-3 mb-3">
      <span class="text-3xl font-bold text-indigo-300">${report.total_score}/10</span>
      <span class="px-3 py-1 rounded-lg font-semibold ${dcls}">${report.decision}</span>
    </div>
    <p class="text-slate-300 text-sm mb-3 text-center italic">"${verdictWord} — ${report.justification.replace(/</g, "&lt;")}"</p>
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
    <p class="text-xs text-slate-500 mt-4 text-center">Your report and video recording have been sent to the recruiter. You can close this page.</p>`;
  window.scrollTo(0, 0);
}

init();
