"""Single LLM helper: all Z.ai calls go through chat() / chat_json()."""
import json
import os
import re

import httpx

API_KEY = (open(os.path.join(os.path.dirname(__file__), "API.txt")).read().strip()
           if os.path.exists(os.path.join(os.path.dirname(__file__), "API.txt")) else os.environ.get("ZAI_API_KEY", ""))
ENDPOINTS = [
    "https://api.z.ai/api/paas/v4",
    "https://api.z.ai/api/coding/paas/v4",
]
TIMEOUT = 90


def _model():
    return os.environ.get("ZAI_MODEL", "glm-4.6")


def _strip(text: str):
    """Strip markdown fences and extract first JSON object/array."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S).strip()
    for open_ch, close_ch in (("{", "}"), ("[", "]")):
        start = text.find(open_ch)
        if start == -1:
            continue
        depth = 0
        for i in range(start, len(text)):
            c = text[i]
            if c == open_ch:
                depth += 1
            elif c == close_ch:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        break
    return None


# GLM "thinking" mode makes answers ~3x slower (≈22s vs ≈7s per call); off by default.
THINKING = os.environ.get("ZAI_THINKING", "disabled")


def chat(messages, json_mode=False, temperature=0.4, max_retries=2, thinking=None):
    """Call Z.ai chat completions; retries, model fallback, endpoint fallback."""
    last_err = None
    thinking = thinking or THINKING
    models = [_model()]
    if models[0] != "glm-4.5":
        models.append("glm-4.5")
    for model in models:
        for ep in ENDPOINTS:
            url = ep + "/chat/completions"
            for attempt in range(max_retries):
                body = {
                    "model": model,
                    "messages": messages,
                    "temperature": temperature,
                }
                if json_mode:
                    body["response_format"] = {"type": "json_object"}
                if thinking in ("enabled", "disabled"):
                    body["thinking"] = {"type": thinking}
                try:
                    r = httpx.post(
                        url,
                        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
                        json=body, timeout=TIMEOUT,
                    )
                    if r.status_code == 400 and "thinking" in r.text.lower() and thinking:
                        thinking = None  # endpoint doesn't support the flag -> retry without it
                        continue
                    if r.status_code in (401, 402, 403):
                        last_err = f"{r.status_code}: {r.text[:200]}"
                        break  # try next endpoint
                    if r.status_code == 404 or "model" in r.text.lower() and r.status_code >= 400:
                        last_err = f"{r.status_code}: {r.text[:200]}"
                        break  # model error -> next endpoint/model
                    r.raise_for_status()
                    return r.json()["choices"][0]["message"]["content"]
                except (httpx.HTTPError, KeyError, IndexError) as e:
                    last_err = str(e)[:300]
                    if attempt < max_retries - 1:
                        import time
                        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"LLM call failed: {last_err}")


def chat_json(messages, temperature=0.2, thinking=None):
    """chat() that guarantees a parsed JSON object; asks for JSON and re-tries parsing."""
    msgs = list(messages)
    for i in range(2):
        text = chat(msgs, json_mode=(i == 0), temperature=temperature, thinking=thinking)
        data = _strip(text)
        if isinstance(data, dict):
            return data
        if isinstance(data, list):
            return {"items": data}
        msgs = msgs + [
            {"role": "assistant", "content": text[:2000]},
            {"role": "user", "content": "Your previous answer was not valid JSON. Reply with ONLY the raw JSON object, no prose, no markdown fences."},
        ]
    raise RuntimeError("LLM did not return valid JSON")


if not API_KEY:
    raise SystemExit("API.txt not found / empty — cannot start")
