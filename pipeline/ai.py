"""Минимальный клиент Anthropic Messages API на стандартной библиотеке. Ключ только из окружения."""
import json
import os
import re
import time
import urllib.error
import urllib.request

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2026-10-21"
MODEL = os.environ.get("COACH_MODEL", "claude-opus-5-5")


def api_key():
    k = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not k:
        raise RuntimeError("нет ANTHROPIC_API_KEY в окружении")
    return k


def ask(system, user, max_tokens=4000, model=None, retries=3):
    """Один запрос к модели. Возвращает (text, usage)."""
    body = {"model": model or MODEL, "max_tokens": max_tokens, "system": system,
            "messages": [{"role": "user", "content": user}]}
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    for attempt in range(retries):
        req = urllib.request.Request(API_URL, method="POST", data=data, headers={
            "x-api-key": api_key(), "anthropic-version": API_VERSION, "content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                d = json.loads(r.read().decode("utf-8"))
                text = "".join(c.get("text", "") for c in d.get("content", []) if c.get("type") == "text")
                usage = d.get("usage", {})
                usage["stop_reason"] = d.get("stop_reason")
                if d.get("stop_reason") == "max_tokens" and attempt < retries - 1:
                    body["max_tokens"] = int(body["max_tokens"] * 1.8)
                    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
                    continue
                return text, usage
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "ignore")[:300]
            if e.code in (429, 500, 502, 503, 529) and attempt < retries - 1:
                time.sleep(15 * (attempt + 1))
                continue
            raise RuntimeError(f"Anthropic API {e.code}: {msg}")
    raise RuntimeError("Anthropic API: не удалось получить ответ")


def _strip_comments(t):
    """Убирает // комментарии вне строк (модель иногда копирует их из схемы)."""
    out, in_str, esc, i = [], False, False, 0
    while i < len(t):
        c = t[i]
        if in_str:
            out.append(c)
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
                out.append(c)
            elif c == "/" and i + 1 < len(t) and t[i + 1] == "/":
                while i < len(t) and t[i] != "\n":
                    i += 1
                continue
            else:
                out.append(c)
        i += 1
    return "".join(out)


def extract_json(text, repair=True):
    """Достает JSON-объект из ответа; при битом синтаксисе чистит комментарии и просит модель починить."""
    t = text.strip()
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", t, re.S)
    if m:
        t = m.group(1)
    start, end = t.find("{"), t.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("в ответе нет JSON")
    t = t[start:end + 1]
    for cand in (t, _strip_comments(t), re.sub(r",\s*([}\]])", r"\1", _strip_comments(t))):
        try:
            return json.loads(cand)
        except Exception:
            pass
    if not repair:
        raise ValueError("JSON не разбирается")
    fixed, _ = ask("Ты чинишь синтаксис JSON. Верни тот же объект с тем же содержанием, но валидным JSON: экранируй кавычки внутри строк, убери комментарии и лишние запятые. Только JSON, без пояснений.",
                   t, max_tokens=6000)
    return extract_json(fixed, repair=False)
