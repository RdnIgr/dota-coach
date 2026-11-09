#!/usr/bin/env python3
"""
Тренер на модели. Числа считает код (analyze.py / fetch.py), модель пишет выводы.

  python pipeline/coach.py report            - отчет тренера по игроку (когда нет отчета или прошло 30+ рейтинговых игр)
  python pipeline/coach.py report --force    - перегенерировать всем
  python pipeline/coach.py review            - разбор свежих матчей (последние 48 часов), которые уже разобраны OpenDota
  python pipeline/coach.py review --match 9080754345 --player 98795702   - разбор конкретного матча

Выход: docs/data/narrative/<id>.json, docs/data/<id>/reviews/<match_id>.json, docs/data/<id>/reviews.json, docs/data/<id>/coach_log.json
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ai  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data")
OD = "https://api.opendota.com/api"
OD_KEY = os.environ.get("OPENDOTA_API_KEY", "")
REVIEW_WINDOW_H = int(os.environ.get("REVIEW_WINDOW_HOURS", "48"))
REVIEW_MAX_PER_PLAYER = int(os.environ.get("REVIEW_MAX_PER_PLAYER", "4"))
REPORT_EVERY_GAMES = 30
TZ = timezone(timedelta(hours=2))
LANE = {1: "сейфлейн", 2: "мид", 3: "оффлейн", 4: "лес", 5: "роуминг"}
KEY_ITEMS = ["black_king_bar", "blink", "manta", "bfury", "desolator", "radiance", "maelstrom", "orchid", "diffusal_blade",
             "echo_sabre", "ultimate_scepter", "sange_and_yasha", "mjollnir", "satanic", "butterfly", "monkey_king_bar",
             "shadow_blade", "silver_edge", "hand_of_midas", "power_treads", "phase_boots", "arcane_boots", "travel_boots",
             "aghanims_shard", "glimmer_cape", "force_staff", "aether_lens", "guardian_greaves", "pipe", "crimson_guard",
             "heart", "assault", "skadi", "basher", "abyssal_blade", "bloodthorn", "sheepstick", "refresher", "octarine_core",
             "lotus_orb", "linken_sphere", "hurricane_pike", "solar_crest", "spirit_vessel", "mekansm", "shivas_guard", "harpoon", "nullifier", "greater_crit", "rapier"]

SYSTEM = """Ты тренер по Dota 2, который сидит рядом с игроком и разбирает его игры по данным. Пишешь по-русски: коротко, честно, с цифрой и конкретным действием, без воды. Игрок может не любить сленг - пиши «сапорт», «пятая позиция», «оффлейн», «мид», понятным языком. Не используй букву «ё», вместо тире ставь «-».

Правила методики, которые нельзя нарушать:
1. Сначала определи позицию и роль игрока (лейн, фарм до 10 минуты, варды, с кем стоял). Сапорта не суди по добитым и GPM - смотри варды, участие в драках, контроль, своевременность. Советы по предметам зависят от позиции.
2. Режимы не смешивай. Для турбо и обычных игр разбор короче и без советов про калибровку и рейтинг.
3. Все числа бери только из досье. Ничего не придумывай: ни проценты, ни тайминги, ни GPM. Если данных нет - прямо скажи, что их нет.
4. Выборка меньше 10 игр - это догадка, так и называй. Связь не равна причине: проигранная игра сама по себе дает больше смертей и поздние тайминги. Доверяй тому, что держится и на всей истории, и на свежих играх, и прошло тест на случайность (в досье это поле p и флаг holds_recent).
5. Не обещай ранг и винрейт. Обещаешь только честный разбор и проверку через фиксированное число игр.
6. Давай максимум конкретики. Поверхностная сводка из трех цифр игрока не устроит. Каждый совет - с метрикой, базой, целью и сроком проверки.
7. Отличай смерть-размен (спас кора, поставил вард под давлением) от смерти-ошибки (фарм без обзора, один на карте, поздний ТП). Если из данных нельзя понять, какая это смерть, скажи, что надо смотреть реплей.

Отвечай строго одним JSON-объектом по заданной схеме, без markdown и без текста вне JSON."""


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def load(path, default):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def od(path, params=None, method="GET"):
    params = list(params or [])
    if OD_KEY:
        params.append(("api_key", OD_KEY))
    url = OD + path + ("?" + urllib.parse.urlencode(params) if params else "")
    time.sleep(1.05 if not OD_KEY else 0.2)
    req = urllib.request.Request(url, method=method, headers={"User-Agent": "dota-coach-pages/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            body = r.read().decode("utf-8")
            return r.status, (json.loads(body) if body else None)
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:
        log("OpenDota ошибка", type(e).__name__, e)
        return 0, None


def hero_names():
    h = load(os.path.join(OUT, "heroes.json"), {})
    names = {int(k): v.get("name") for k, v in h.items() if k != "_updated" and isinstance(v, dict)}
    npc = {v.get("npc"): int(k) for k, v in h.items() if k != "_updated" and isinstance(v, dict) and v.get("npc")}
    return names, npc


def players_index():
    return load(os.path.join(OUT, "players.json"), {"players": []})["players"]


def dts(ts):
    return datetime.fromtimestamp(ts, TZ).strftime("%d.%m.%Y %H:%M") if ts else "-"


def mm(sec):
    sec = int(sec or 0)
    return f"{sec // 60}:{sec % 60:02d}"


# ====================== отчет по игроку ======================

def player_dossier(p, an, prev):
    modes = an.get("modes", {})
    r = modes.get("ranked")
    if not r:
        return None
    s, rec = r["summary"], r.get("recent", {})

    def tbl(title, src=r["tables"]):
        t = next((t for t in src if t["title"] == title), None)
        return [{k: row[k] for k in ("group", "n", "wins", "wr", "lo", "hi", "p")} for row in t["rows"]] if t else None
    d = {
        "игрок": {"ник": p["name"], "ранг": p.get("rank"), "account_id": p["account_id"], "всего_игр_в_истории": p.get("matches")},
        "режим": "рейтинг (lobby_type 7)",
        "все_игры_режима": {"n": s["n"], "винрейт": round(s["wr"], 3), "ДИ95": [round(x, 3) for x in s["ci"]], "период": [dts(s["first"]), dts(s["last"])],
                            "K_D_A": [round(s["kills"], 1), round(s["deaths"], 1), round(s["assists"], 1)], "KDA": round(s["kda"], 2),
                            "GPM": s.get("gpm") and round(s["gpm"]), "XPM": s.get("xpm") and round(s["xpm"]), "добитых_за_игру": s.get("lh") and round(s["lh"]),
                            "средняя_игра_мин": round(s["duration_min"], 1), "доля_игр_10плюс_смертей": round(s["share_10plus"], 3), "доля_игр_6_и_меньше": round(s["share_le6"], 3),
                            "разных_героев": s["distinct_heroes"], "доля_топ3_героев": round(s["top3_share"], 3), "покинутых_игр": s.get("leaver_games"),
                            "смертей_в_победах": s.get("deaths_in_wins") and round(s["deaths_in_wins"], 1), "смертей_в_поражениях": s.get("deaths_in_losses") and round(s["deaths_in_losses"], 1)},
        "последние_150": {"n": rec.get("n"), "винрейт": rec.get("wr") and round(rec["wr"], 3), "ДИ95": rec.get("ci") and [round(x, 3) for x in rec["ci"]], "период": [dts(rec.get("first")), dts(rec.get("last"))],
                          "смертей": rec.get("deaths") and round(rec["deaths"], 1), "доля_10плюс": rec.get("share_10plus") and round(rec["share_10plus"], 3),
                          "разных_героев": rec.get("distinct_heroes"), "доля_топ3": rec.get("top3_share") and round(rec["top3_share"], 3),
                          "герои": rec.get("heroes"), "смерти_таблица": tbl("Винрейт по числу смертей", rec.get("tables", [])), "пати_таблица": tbl("Соло или пати", rec.get("tables", []))},
        "последние_50": {"побед": s["last50_wins"], "игр": s["last50_n"]},
        "таблицы_все_игры": {k: tbl(k) for k in ("Винрейт по числу смертей", "По длительности игры", "Соло или пати", "Сторона карты", "Номер игры в сессии", "Предыдущая игра", "Серия поражений", "Час старта", "Позиция (lane_role из истории)")},
        "надежные_находки": r.get("findings"),
        "герои_10плюс_игр": [{k: (round(v, 3) if isinstance(v, float) else v) for k, v in h.items() if k in ("hero", "n", "wins", "wr", "lo", "hi", "p", "k", "d", "a", "gpm", "xpm", "lhpm", "recent_n", "recent_wins", "roles")} for h in r["heroes"][:30]],
        "разобранные_реплеи": {k: v for k, v in (r.get("parsed") or {}).items() if k != "matches"},
        "последние_разобранные_матчи": (r.get("parsed") or {}).get("matches", [])[:12],
        "другие_режимы": {m: {"n": modes[m]["summary"]["n"], "винрейт": round(modes[m]["summary"]["wr"], 3), "смертей": round(modes[m]["summary"]["deaths"], 1)} for m in ("normal", "turbo") if m in modes},
    }
    if r.get("history"):
        H = r["history"]
        d["агрегаты_OpenDota_вся_история"] = {"n": H["n"], "винрейт": round(H["wr"], 3), "герои_15плюс": H.get("heroes", [])[:30], "средние": H.get("averages"),
                                              "тиммейты_топ": (H.get("peers") or [])[:8]}
    if prev:
        d["предыдущий_отчет"] = {k: prev.get(k) for k in ("report_date", "verdict", "plan", "hero_pool", "check_date", "report_games_at")}
        d["рейтинговых_игр_с_прошлого_отчета"] = s["n"] - (prev.get("report_games_at") or s["n"])
    return d


REPORT_SCHEMA = """{
 "role": "позиция и роль игрока, как ты их определил, с опорой на данные (1-2 предложения)",
 "verdict": "главное в 2-4 предложениях с цифрами: форма, главный фактор поражений, второй фактор",
 "pluses": [{"title": "короткий заголовок", "text": "абзац с цифрами и количеством игр"}],
 "minuses": [{"title": "...", "text": "абзац с цифрой, количеством игр и силой эффекта"}],
 "noise": ["что НЕ является закономерностью и почему (шум, маленькая выборка, не прошло тест)"],
 "plan": [{"title": "...", "metric": "что меряем", "base": "текущее значение с выборкой", "target": "цель на 30 рейтинговых игр", "how": "конкретное действие; если совет не из данных, а из общей практики - так и напиши"}],
 "hero_pool": {"keep": ["герои на 30 игр - только с выборкой 15+ игр и винрейтом не ниже базы"], "drop": ["герои, которые системно сливают на 15+ играх"]},
 "questions": ["2-3 вопроса игроку, без ответа на которые разбор неполный"],
 "_требования": "pluses 2-3 штуки; minuses ровно 3 по убыванию важности; noise 2-4 строки; plan ровно 3; внутри строк двойные кавычки экранируй или используй «елочки»",
 "plan_review": "если в досье есть предыдущий отчет и план - честная оценка: какие метрики плана изменились и как, что сработало, что снять; иначе null",
 "check_date": "через сколько игр и примерно когда проверка, исходя из темпа игрока"
}"""


def make_report(p, an, prev, force=False):
    r = an.get("modes", {}).get("ranked")
    if not r:
        return None, "нет рейтинговых игр"
    n = r["summary"]["n"]
    if prev and not force:
        since = n - (prev.get("report_games_at") or 0)
        if prev.get("report_games_at") and since < REPORT_EVERY_GAMES:
            return None, f"с прошлого отчета {since} игр, нужно {REPORT_EVERY_GAMES}"
    d = player_dossier(p, an, prev)
    if not d:
        return None, "нет досье"
    if n < 20:
        return None, "меньше 20 рейтинговых игр - отчет будет догадкой"
    user = ("Составь первый полный отчет тренера по игроку (или очередной, если есть предыдущий) по разделу 7 методики: общая картина, где силен, где теряет игры, план на 30 рейтинговых игр. "
            "Все числа - только из досье ниже. Верни JSON строго по схеме:\n" + REPORT_SCHEMA + "\n\nДОСЬЕ:\n" + json.dumps(d, ensure_ascii=False))
    text, usage = ai.ask(SYSTEM, user, max_tokens=9000)
    try:
        rep = ai.extract_json(text)
    except Exception:
        save(os.path.join(OUT, "narrative", "history", f"{p['account_id']}-raw-{int(time.time())}.txt.json"), {"raw": text})
        raise
    missing = [k for k in ("verdict", "pluses", "minuses", "plan") if not rep.get(k)]
    if missing or usage.get("stop_reason") == "max_tokens":
        raise RuntimeError(f"отчет неполный: нет {missing}, stop_reason={usage.get('stop_reason')}")
    rep.update({"display_name": p["name"], "rank": p.get("rank"), "report_date": datetime.now(TZ).strftime("%d.%m.%Y"),
                "source": "ai", "model": ai.MODEL, "generated": int(time.time()), "report_games_at": n, "usage": usage})
    return rep, "ok"


def cmd_report(force=False, only=None):
    heroes, _ = hero_names()
    for p in players_index():
        acc = str(p["account_id"])
        if only and acc != str(only):
            continue
        an = load(os.path.join(OUT, acc, "analysis.json"), None)
        if not an or an.get("empty"):
            log(acc, "нет данных")
            continue
        prev_path = os.path.join(OUT, "narrative", f"{acc}.json")
        prev = load(prev_path, None)
        try:
            rep, why = make_report(p, an, prev, force)
        except Exception as e:
            log(acc, "ошибка отчета:", e)
            continue
        if not rep:
            log(acc, "отчет не нужен:", why)
            continue
        if prev:
            hist_path = os.path.join(OUT, "narrative", "history", f"{acc}-{prev.get('generated', 0)}.json")
            save(hist_path, prev)
        save(prev_path, rep)
        logp = os.path.join(OUT, acc, "coach_log.json")
        lg = load(logp, [])
        lg.append({"date": rep["report_date"], "games_at": rep["report_games_at"], "verdict": rep.get("verdict"), "plan_review": rep.get("plan_review"), "model": ai.MODEL})
        save(logp, lg)
        log(acc, "отчет записан, токены:", rep.get("usage"))


# ====================== разбор матча ======================

def match_dossier(M, acc, names, npc_to_id, an):
    me = next((x for x in M["players"] if x.get("account_id") == acc), None)
    if not me:
        return None
    parsed = M.get("version") is not None and me.get("gold_t") is not None
    is_rad = bool(me.get("isRadiant"))
    win = is_rad == bool(M.get("radiant_win"))
    tracked = {pl["account_id"]: pl["name"] for pl in players_index()}

    def at(s, i):
        return s[i] if s and len(s) > i else None

    def prow(x):
        t = tracked.get(x.get("account_id"))
        return {"герой": names.get(x.get("hero_id"), x.get("hero_id")), "кто": t or ("этот игрок" if x is me else None), "сторона": "Radiant" if x["player_slot"] < 128 else "Dire",
                "линия": LANE.get(x.get("lane_role")), "уровень": x.get("level"), "KDA": [x.get("kills"), x.get("deaths"), x.get("assists")],
                "добитых": x.get("last_hits"), "GPM": x.get("gold_per_min"), "XPM": x.get("xp_per_min"), "золото_всего": x.get("total_gold"),
                "урон_героям": x.get("hero_damage"), "урон_башням": x.get("tower_damage"), "лечение": x.get("hero_healing"), "обс_сен": [x.get("obs_placed"), x.get("sen_placed")],
                "предметы_в_конце": [k for k in (M.get("items_const") or [])] or None}
    d = {"матч": {"id": M["match_id"], "дата": dts(M.get("start_time")), "длительность": mm(M.get("duration")), "режим": "турбо" if M.get("game_mode") == 23 else "рейтинг" if M.get("lobby_type") == 7 else "обычная",
                  "счет": f"Radiant {M.get('radiant_score')} - {M.get('dire_score')} Dire", "победили": "Radiant" if M.get("radiant_win") else "Dire", "реплей_разобран": parsed},
         "игрок": {"ник": tracked.get(acc), "герой": names.get(me["hero_id"]), "сторона": "Radiant" if is_rad else "Dire", "итог": "победа" if win else "поражение",
                   "KDA": [me.get("kills"), me.get("deaths"), me.get("assists")], "GPM": me.get("gold_per_min"), "XPM": me.get("xp_per_min"), "добитых_денаев": [me.get("last_hits"), me.get("denies")],
                   "lane_role": LANE.get(me.get("lane_role")), "роуминг": me.get("is_roaming"), "пати": me.get("party_size")},
         "таблица": [prow(x) for x in M["players"]]}
    # своя норма на герое и в режиме
    mode = "turbo" if M.get("game_mode") == 23 else "ranked" if M.get("lobby_type") == 7 else "normal"
    r = (an or {}).get("modes", {}).get(mode)
    if r:
        hr = next((h for h in r["heroes"] if h["hero_id"] == me["hero_id"]), None)
        d["своя_норма"] = {"режим": mode, "игр_в_режиме": r["summary"]["n"], "винрейт": round(r["summary"]["wr"], 3),
                           "средние_K_D_A": [round(r["summary"]["kills"], 1), round(r["summary"]["deaths"], 1), round(r["summary"]["assists"], 1)],
                           "средний_GPM": r["summary"].get("gpm") and round(r["summary"]["gpm"]),
                           "на_этом_герое": hr and {"игр": hr["n"], "винрейт": hr["wr"], "K_D_A": [round(hr["k"], 1), round(hr["d"], 1), round(hr["a"], 1)], "GPM": hr.get("gpm") and round(hr["gpm"]), "позиции": hr.get("roles")},
                           "текущий_план_тренера": None}
        nar = load(os.path.join(OUT, "narrative", f"{acc}.json"), None)
        if nar:
            d["своя_норма"]["текущий_план_тренера"] = [{"title": x.get("title"), "target": x.get("target")} for x in nar.get("plan", [])]
    if not parsed:
        return d
    opp = [x for x in M["players"] if (x["player_slot"] < 128) != is_rad and x.get("lane") == me.get("lane") and x.get("lane_role") in (1, 2, 3)]
    best = max(opp, key=lambda x: at(x.get("gold_t"), 10) or 0) if opp else None
    d["линия_10_минут"] = {"добитых_денаев_10": [at(me.get("lh_t"), 10), at(me.get("dn_t"), 10)], "золото_10": at(me.get("gold_t"), 10), "опыт_10": at(me.get("xp_t"), 10),
                           "соперник_по_линии": best and names.get(best["hero_id"]), "золото_соперника_10": best and at(best.get("gold_t"), 10), "опыт_соперника_10": best and at(best.get("xp_t"), 10),
                           "золото_5": at(me.get("gold_t"), 5), "золото_соперника_5": best and at(best.get("gold_t"), 5), "эффективность_линии_pct": me.get("lane_efficiency_pct")}
    tfs = M.get("teamfights") or []
    my_npc = next((n for n, i in npc_to_id.items() if i == me["hero_id"]), None)
    deaths = []
    for x in M["players"]:
        if (x["player_slot"] < 128) != is_rad:
            for k in x.get("kills_log") or []:
                if k.get("key") == my_npc:
                    t = k.get("time") or 0
                    deaths.append((t, {"минута": mm(t), "убил": names.get(x["hero_id"]), "в_драке": any(t >= f["start"] - 5 and t <= f["end"] + 5 for f in tfs)}))
    deaths.sort(key=lambda x: x[0])
    d["смерти_игрока"] = [x[1] for x in deaths]
    if len(deaths) != (me.get("deaths") or 0):
        d["примечание_по_смертям"] = f"В логах убийств найдено {len(deaths)} смертей из {me.get('deaths')} - остальные от крипов, башен, Рошана или без записи в логе."
    kills = sorted(me.get("kills_log") or [], key=lambda k: k.get("time") or 0)
    d["убийства_игрока"] = [{"минута": mm(k.get("time")), "убил": names.get(npc_to_id.get(k.get("key")), k.get("key"))} for k in kills][:25]
    items = {}
    for pr in me.get("purchase_log") or []:
        if pr.get("key") in KEY_ITEMS and pr["key"] not in items:
            items[pr["key"]] = mm(pr.get("time"))
    d["ключевые_предметы_время"] = items
    slot = me["player_slot"]
    idx = slot if slot < 128 else slot - 128 + 5
    fights = []
    for f in tfs:
        pl = f.get("players") or []
        dr = sum((x.get("deaths") or 0) for x in pl[:5])
        dd = sum((x.get("deaths") or 0) for x in pl[5:])
        gr = sum((x.get("gold_delta") or 0) for x in pl[:5])
        gd = sum((x.get("gold_delta") or 0) for x in pl[5:])
        mine = pl[idx] if idx < len(pl) else {}
        fights.append({"минута": mm(f["start"]), "секунд": f["end"] - f["start"], "смерти_Radiant_Dire": [dr, dd],
                       "золото_своей_команды": (gr - gd) if is_rad else (gd - gr),
                       "игрок": {"участвовал": bool((mine.get("damage") or 0) > 0 or (mine.get("deaths") or 0) > 0 or (mine.get("healing") or 0) > 0),
                                 "урон": mine.get("damage"), "смертей": mine.get("deaths"), "убийств": len(mine.get("killed") or {})},
                       "умерли": [names.get(M["players"][i]["hero_id"]) for i, x in enumerate(pl) if (x.get("deaths") or 0) > 0 and i < len(M["players"])]})
    d["командные_драки"] = fights
    adv = M.get("radiant_gold_adv") or []
    mine_adv = [a if is_rad else -a for a in adv]
    d["золото_своей_команды_по_минутам"] = {str(i): v for i, v in enumerate(mine_adv) if i % 2 == 0 or i == len(mine_adv) - 1}
    d["макс_преимущество"] = max(mine_adv, default=0)
    d["макс_отставание"] = min(mine_adv, default=0)
    d["карта"] = {"обсерверов": me.get("obs_placed"), "сентри": me.get("sen_placed"), "снято_вардов": me.get("observer_kills"), "стаков": me.get("camps_stacked"),
                  "рун": me.get("rune_pickups"), "ТП_куплено": (me.get("purchase") or {}).get("tpscroll"), "APM": me.get("actions_per_min"), "драк_всего": len(tfs),
                  "драк_с_участием": sum(1 for f in fights if f["игрок"]["участвовал"])}
    d["бенчмарки_перцентиль_на_герое"] = {k: (v or {}).get("pct") for k, v in (me.get("benchmarks") or {}).items()}
    objs = []
    for o in M.get("objectives") or []:
        if o.get("type") in ("CHAT_MESSAGE_FIRSTBLOOD", "CHAT_MESSAGE_ROSHAN_KILL", "building_kill", "CHAT_MESSAGE_AEGIS"):
            objs.append({"минута": mm(o.get("time")), "тип": o.get("type"), "ключ": o.get("key"), "команда": o.get("team"), "слот": o.get("player_slot")})
    d["объекты"] = objs[:40]
    return d


REVIEW_SCHEMA = """{
 "position": "позиция игрока в этой игре и по каким признакам ты ее определил",
 "verdict": "2-4 предложения: что решило игру для этого игрока, с цифрами из досье",
 "timeline": [{"phase": "линия (0-10)", "text": "..."}, {"phase": "мидгейм (10-25)", "text": "..."}, {"phase": "поздняя (25+)", "text": "..."}],
 "deaths": "разбор смертей по минутам: какие похожи на размен, какие на ошибку (один на карте, без обзора, без ТП), где нужен реплей, чтобы сказать точно",
 "key_moments": ["1-2 момента с минутой, где другое решение могло изменить игру, и что делать в такой ситуации в следующий раз"],
 "advice": [{"what": "что делать", "why": "почему, с цифрой из этой игры", "metric": "что меряем в следующих 10 играх"}],
 "_требования": "timeline ровно 3 фазы; advice ровно 3; внутри строк двойные кавычки экранируй или используй «елочки»",
 "severity": "низкая | средняя | высокая - насколько игра этого игрока повлияла на исход",
 "short": "одна строка до 90 символов для списка разборов"
}"""


def make_review(M, acc, names, npc_to_id, an):
    d = match_dossier(M, acc, names, npc_to_id, an)
    if not d:
        return None
    mode_note = "Это турбо или обычная игра - разбор короче, без советов про калибровку." if d["матч"]["режим"] != "рейтинг" else ""
    user = ("Разбери один матч для указанного игрока по разделу 5 методики: позиция, хронология, смерти, сравнение со своей нормой, вывод и три правки. "
            + mode_note + " Все числа только из досье. Верни JSON строго по схеме:\n" + REVIEW_SCHEMA + "\n\nДОСЬЕ:\n" + json.dumps(d, ensure_ascii=False))
    text, usage = ai.ask(SYSTEM, user, max_tokens=7000)
    rev = ai.extract_json(text)
    if not rev.get("verdict") or usage.get("stop_reason") == "max_tokens":
        raise RuntimeError(f"разбор неполный, stop_reason={usage.get('stop_reason')}")
    rev.update({"match_id": M["match_id"], "account_id": acc, "hero_id": next(x["hero_id"] for x in M["players"] if x.get("account_id") == acc),
                "win": d["игрок"]["итог"] == "победа", "start_time": M.get("start_time"), "duration": M.get("duration"), "mode": d["матч"]["режим"],
                "parsed": d["матч"]["реплей_разобран"], "kda": d["игрок"]["KDA"], "model": ai.MODEL, "generated": int(time.time()), "usage": usage})
    return rev


def save_review(acc, rev):
    pdir = os.path.join(OUT, str(acc))
    save(os.path.join(pdir, "reviews", f"{rev['match_id']}.json"), rev)
    idx_path = os.path.join(pdir, "reviews.json")
    idx = [x for x in load(idx_path, []) if x["match_id"] != rev["match_id"]]
    idx.append({k: rev.get(k) for k in ("match_id", "start_time", "hero_id", "win", "mode", "short", "severity", "kda", "generated")})
    idx.sort(key=lambda x: -(x.get("start_time") or 0))
    save(idx_path, idx[:200])


def cmd_review(match_id=None, player=None):
    names, npc_to_id = hero_names()
    now = time.time()
    for p in players_index():
        acc = p["account_id"]
        if player and str(acc) != str(player):
            continue
        if not p.get("exposed"):
            continue
        an = load(os.path.join(OUT, str(acc), "analysis.json"), None)
        done = {x["match_id"] for x in load(os.path.join(OUT, str(acc), "reviews.json"), [])}
        if match_id:
            cands = [int(match_id)]
        else:
            st, rec = od(f"/players/{acc}/recentMatches")
            if st != 200 or not rec:
                log(acc, "recentMatches недоступны")
                continue
            cands = [m["match_id"] for m in rec if now - (m.get("start_time") or 0) < REVIEW_WINDOW_H * 3600 and m["match_id"] not in done]
        made = 0
        for mid in cands:
            if made >= REVIEW_MAX_PER_PLAYER:
                break
            st, M = od(f"/matches/{mid}")
            if st != 200 or not M:
                continue
            parsed = M.get("version") is not None and (M.get("players") or [{}])[0].get("gold_t") is not None
            if not parsed:
                if now - (M.get("start_time") or 0) < 14 * 86400:
                    od(f"/request/{mid}", method="POST")
                    log(acc, mid, "не разобран, запросил парс")
                continue
            try:
                rev = make_review(M, acc, names, npc_to_id, an)
            except Exception as e:
                log(acc, mid, "ошибка разбора:", e)
                continue
            if rev:
                save_review(acc, rev)
                made += 1
                log(acc, mid, "разбор записан:", rev.get("short"), rev.get("usage"))
        if not cands:
            log(acc, "новых матчей для разбора нет")


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else "review"
    if not os.environ.get("ANTHROPIC_API_KEY", "").strip():
        log("ANTHROPIC_API_KEY не задан - тренер на модели пропущен (добавь секрет в репозитории: Settings -> Secrets and variables -> Actions)")
        return

    def opt(name):
        return args[args.index(name) + 1] if name in args and args.index(name) + 1 < len(args) else None
    if cmd == "report":
        cmd_report(force="--force" in args, only=opt("--player"))
    elif cmd == "review":
        cmd_review(match_id=opt("--match"), player=opt("--player"))
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
