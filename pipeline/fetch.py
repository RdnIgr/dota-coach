#!/usr/bin/env python3
"""
Сборщик OpenDota для всех игроков из players.json. Только стандартная библиотека.
Пишет компактные данные в docs/data/<account_id>/ - их читает сайт.

  python pipeline/fetch.py            - все игроки, все шаги
  python pipeline/fetch.py --details 0  - без деталей матчей (быстро)

Переменные окружения: OPENDOTA_API_KEY (необязательно), DETAILS_LAST_N (по умолчанию 60).
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data")
BASE = "https://api.opendota.com/api"
API_KEY = os.environ.get("OPENDOTA_API_KEY", "")
PAUSE = 1.05 if not API_KEY else 0.2
DETAILS_LAST_N = int(os.environ.get("DETAILS_LAST_N", "60"))
REPLAY_WINDOW_DAYS = 14

MATCH_COLS = ["match_id", "start_time", "duration", "lobby_type", "game_mode", "hero_id", "win",
              "kills", "deaths", "assists", "party_size", "is_radiant", "gpm", "xpm", "lh", "dn",
              "lane_role", "hero_damage", "tower_damage", "leaver", "avg_rank"]
PROJECT = ["player_slot", "radiant_win", "duration", "game_mode", "lobby_type", "hero_id", "start_time",
           "kills", "deaths", "assists", "average_rank", "party_size", "lane_role", "gold_per_min",
           "xp_per_min", "last_hits", "denies", "hero_damage", "tower_damage", "leaver_status"]
MODES = {"ranked": [("lobby_type", 7)], "normal": [("lobby_type", 0)], "turbo": [("game_mode", 23)]}
STATS = {"requests": 0, "errors": 0}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def api(path, params=None, method="GET", retries=4):
    params = list(params or [])
    if API_KEY:
        params.append(("api_key", API_KEY))
    url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    for attempt in range(retries):
        time.sleep(PAUSE)
        STATS["requests"] += 1
        req = urllib.request.Request(url, method=method, headers={"User-Agent": "dota-coach-pages/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                body = r.read().decode("utf-8")
                return r.status, (json.loads(body) if body else None)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 20 * (attempt + 1)
                log(f"429 {path}, пауза {wait}s")
                time.sleep(wait)
                continue
            STATS["errors"] += 1
            log(f"HTTP {e.code} {path}")
            return e.code, None
        except Exception as e:
            STATS["errors"] += 1
            log(f"ошибка {type(e).__name__} {path}: {e}")
            time.sleep(5 * (attempt + 1))
    return 0, None


def load(path, default):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def save(path, obj, pretty=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        if pretty:
            json.dump(obj, f, ensure_ascii=False, indent=1)
        else:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


# ---------- история ----------

def compact_match(m):
    slot = m.get("player_slot")
    is_rad = slot is not None and slot < 128
    win = (is_rad == bool(m.get("radiant_win"))) if m.get("radiant_win") is not None else None
    return [m.get("match_id"), m.get("start_time"), m.get("duration"), m.get("lobby_type"), m.get("game_mode"),
            m.get("hero_id"), (1 if win else 0) if win is not None else None, m.get("kills"), m.get("deaths"),
            m.get("assists"), m.get("party_size"), 1 if is_rad else 0, m.get("gold_per_min"), m.get("xp_per_min"),
            m.get("last_hits"), m.get("denies"), m.get("lane_role"), m.get("hero_damage"), m.get("tower_damage"),
            m.get("leaver_status"), m.get("average_rank")]


def fetch_matches(acc):
    params = [("significant", 0)] + [("project", p) for p in PROJECT]
    st, data = api(f"/players/{acc}/matches", params)
    if st != 200 or data is None:
        return None
    rows = [compact_match(m) for m in data]
    rows.sort(key=lambda r: -(r[1] or 0))
    return {"cols": MATCH_COLS, "rows": rows, "updated": int(time.time())}


# ---------- агрегаты ----------

def fetch_agg(acc):
    out = {}
    for mode, flt in MODES.items():
        d = {}
        for ep in ("heroes", "counts", "wl", "totals"):
            st, x = api(f"/players/{acc}/{ep}", flt)
            if st == 200:
                d[ep] = x
        for field in ("deaths", "duration", "gold_per_min", "kills", "assists"):
            st, x = api(f"/players/{acc}/histograms/{field}", flt)
            if st == 200:
                d["hist_" + field] = x
        if mode == "ranked":
            st, x = api(f"/players/{acc}/peers", flt)
            if st == 200:
                d["peers"] = [{k: p.get(k) for k in ("account_id", "personaname", "games", "win", "last_played")} for p in (x or [])[:40]]
        out[mode] = d
    return out


# ---------- детали матчей ----------

def at(series, i):
    return series[i] if series and len(series) > i else None


def extract_features(d, acc, npc_to_id):
    me = next((p for p in d.get("players", []) if p.get("account_id") == acc), None)
    if not me:
        return None
    parsed = d.get("version") is not None and me.get("gold_t") is not None
    is_rad = bool(me.get("isRadiant"))
    win = is_rad == bool(d.get("radiant_win"))
    f = {"match_id": d["match_id"], "parsed": parsed, "start_time": d.get("start_time"), "duration": d.get("duration"),
         "hero_id": me.get("hero_id"), "win": win, "lobby_type": d.get("lobby_type"), "game_mode": d.get("game_mode"),
         "kills": me.get("kills"), "deaths": me.get("deaths"), "assists": me.get("assists"),
         "gpm": me.get("gold_per_min"), "xpm": me.get("xp_per_min"), "lh": me.get("last_hits"),
         "hero_damage": me.get("hero_damage"), "tower_damage": me.get("tower_damage"),
         "lane_role": me.get("lane_role"), "lane": me.get("lane"), "is_roaming": me.get("is_roaming")}
    if not parsed:
        return f
    opp = [p for p in d["players"] if p.get("isRadiant") != is_rad and p.get("lane") == me.get("lane") and p.get("lane_role") in (1, 2, 3)]
    best = max(opp, key=lambda p: at(p.get("gold_t"), 10) or 0) if opp else None
    g5, g10, x10 = at(me.get("gold_t"), 5), at(me.get("gold_t"), 10), at(me.get("xp_t"), 10)
    f.update({"lh10": at(me.get("lh_t"), 10), "dn10": at(me.get("dn_t"), 10), "gold10": g10, "xp10": x10,
              "gd5": (g5 - at(best.get("gold_t"), 5)) if best and g5 is not None and at(best.get("gold_t"), 5) is not None else None,
              "gd10": (g10 - at(best.get("gold_t"), 10)) if best and g10 is not None and at(best.get("gold_t"), 10) is not None else None,
              "xd10": (x10 - at(best.get("xp_t"), 10)) if best and x10 is not None and at(best.get("xp_t"), 10) is not None else None,
              "lane_opponent": best.get("hero_id") if best else None,
              "lane_efficiency_pct": me.get("lane_efficiency_pct"), "obs": me.get("obs_placed") or 0,
              "sen": me.get("sen_placed") or 0, "obs_killed": me.get("observer_kills") or 0,
              "camps_stacked": me.get("camps_stacked") or 0, "rune_pickups": me.get("rune_pickups") or 0,
              "stuns": me.get("stuns"), "apm": me.get("actions_per_min"), "tp_bought": (me.get("purchase") or {}).get("tpscroll"),
              "benchmarks": {k: (v or {}).get("pct") for k, v in (me.get("benchmarks") or {}).items()}})
    my_npc = next((n for n, i in npc_to_id.items() if i == me.get("hero_id")), None)
    deaths = []
    for p in d["players"]:
        if p.get("isRadiant") != is_rad:
            for k in p.get("kills_log") or []:
                if k.get("key") == my_npc:
                    deaths.append([k.get("time"), p.get("hero_id")])
    deaths.sort()
    f["deaths_log"] = deaths
    f["early_deaths"] = sum(1 for t, _ in deaths if (t or 0) < 600)
    tf = d.get("teamfights") or []
    slot = me.get("player_slot")
    idx = slot if slot < 128 else slot - 128 + 5
    in_fight = 0
    fights_joined = 0
    for t in tf:
        pl = t.get("players") or []
        if idx < len(pl):
            in_fight += pl[idx].get("deaths", 0) or 0
            if (pl[idx].get("damage", 0) or 0) > 0 or (pl[idx].get("deaths", 0) or 0) > 0 or (pl[idx].get("healing", 0) or 0) > 0:
                fights_joined += 1
    f["teamfights"] = len(tf)
    f["fights_joined"] = fights_joined
    f["deaths_outside_fight"] = max(0, (me.get("deaths") or 0) - in_fight)
    items = {}
    for pr in me.get("purchase_log") or []:
        k = pr.get("key")
        if k and k not in items and not k.startswith("recipe"):
            items[k] = pr.get("time")
    f["items"] = items
    adv = d.get("radiant_gold_adv") or []
    sign = 1 if is_rad else -1
    mine = [sign * a for a in adv]
    f["max_lead"] = max(mine, default=0)
    f["min_lead"] = min(mine, default=0)
    f["thrown"] = (not win) and f["max_lead"] >= 5000
    f["comeback"] = win and f["min_lead"] <= -5000
    f["gold_adv"] = mine[::2] if len(mine) > 60 else mine  # каждые 2 минуты, если игра длинная
    return f


def fetch_details(acc, matches, parsed_store, npc_to_id):
    rows = [r for r in matches["rows"] if r[3] == 7][:DETAILS_LAST_N]
    now = time.time()
    got = requested = 0
    for r in rows:
        mid, start = str(r[0]), r[1] or 0
        rec = parsed_store.get(mid)
        if rec and rec.get("parsed"):
            continue
        age_days = (now - start) / 86400
        if rec and not rec.get("parsed") and age_days > REPLAY_WINDOW_DAYS and rec.get("checked"):
            continue  # старый неразобранный матч, больше не трогаем
        st, d = api(f"/matches/{mid}")
        if st != 200 or not d:
            continue
        feat = extract_features(d, acc, npc_to_id)
        if not feat:
            continue
        feat["checked"] = int(now)
        if not feat["parsed"] and age_days <= REPLAY_WINDOW_DAYS:
            last_req = (rec or {}).get("requested", 0)
            if now - last_req > 600:
                st2, job = api(f"/request/{mid}", method="POST")
                feat["requested"] = int(now)
                feat["request_status"] = st2
                requested += 1
        elif rec:
            feat["requested"] = rec.get("requested", 0)
        parsed_store[mid] = feat
        got += 1
    return got, requested


# ---------- константы ----------

def fetch_heroes_const():
    path = os.path.join(OUT, "heroes.json")
    cur = load(path, None)
    if cur and time.time() - cur.get("_updated", 0) < 7 * 86400:
        return cur
    st, d = api("/constants/heroes")
    if st != 200 or not d:
        return cur or {"_updated": 0}
    out = {"_updated": int(time.time())}
    for k, v in d.items():
        out[str(k)] = {"name": v.get("localized_name"), "npc": v.get("name"), "roles": v.get("roles"), "attr": v.get("primary_attr")}
    save(path, out)
    return out


def rank_name(tier):
    if not tier:
        return "без ранга"
    names = {1: "Herald", 2: "Guardian", 3: "Crusader", 4: "Archon", 5: "Legend", 6: "Ancient", 7: "Divine", 8: "Immortal"}
    return f"{names.get(tier // 10, '?')} {tier % 10}" if tier < 80 else "Immortal"


def main():
    args = sys.argv[1:]
    with_details = not ("--details" in args and args[args.index("--details") + 1] == "0")
    players = load(os.path.join(ROOT, "players.json"), [])
    heroes = fetch_heroes_const()
    npc_to_id = {v["npc"]: int(k) for k, v in heroes.items() if k != "_updated" and isinstance(v, dict)}
    index = []
    for p in players:
        acc = int(p["account_id"])
        pdir = os.path.join(OUT, str(acc))
        log(f"== {p['slug']} ({acc})")
        st, prof = api(f"/players/{acc}")
        prof = prof or {}
        profile = prof.get("profile") or {}
        matches = fetch_matches(acc)
        if matches is None:
            matches = load(os.path.join(pdir, "matches.json"), {"cols": MATCH_COLS, "rows": [], "updated": 0})
            log("история не получена, оставляю старую")
        n_all = len(matches["rows"])
        if n_all == 0:
            # Пробуем попросить OpenDota подтянуть историю (сработает, только если статистика открыта)
            api(f"/players/{acc}/refresh", method="POST")
        save(os.path.join(pdir, "matches.json"), matches)
        agg = fetch_agg(acc) if n_all else {}
        agg["profile"] = {"personaname": profile.get("personaname"), "avatar": profile.get("avatarfull"),
                          "steamid": profile.get("steamid"), "profileurl": profile.get("profileurl"),
                          "country": profile.get("loccountrycode"), "rank_tier": prof.get("rank_tier"),
                          "leaderboard_rank": prof.get("leaderboard_rank"), "mmr_estimate": prof.get("computed_mmr")}
        save(os.path.join(pdir, "agg.json"), agg)
        parsed_path = os.path.join(pdir, "parsed.json")
        parsed_store = load(parsed_path, {})
        if with_details and n_all:
            got, req = fetch_details(acc, matches, parsed_store, npc_to_id)
            log(f"детали: обновлено {got}, запрошен парс {req}, всего в хранилище {len(parsed_store)}")
            save(parsed_path, parsed_store)
        n_parsed = sum(1 for v in parsed_store.values() if v.get("parsed"))
        index.append({"slug": p["slug"], "account_id": acc, "steam_id64": p["steam_id64"],
                      "name": profile.get("personaname") or p["slug"], "avatar": profile.get("avatarfull"),
                      "rank_tier": prof.get("rank_tier"), "rank": rank_name(prof.get("rank_tier")),
                      "matches": n_all, "ranked": sum(1 for r in matches["rows"] if r[3] == 7),
                      "parsed": n_parsed, "exposed": n_all > 0,
                      "last_match": matches["rows"][0][1] if n_all else None})
        log(f"история {n_all} игр, разобрано {n_parsed}")
    save(os.path.join(OUT, "players.json"), {"players": index, "updated": int(time.time()), "requests": STATS["requests"], "errors": STATS["errors"]}, pretty=True)
    log(f"готово: запросов {STATS['requests']}, ошибок {STATS['errors']}")


if __name__ == "__main__":
    main()
