#!/usr/bin/env python3
"""
Считает слои анализа (методика METHOD.md) для каждого игрока и режима.
Вход: docs/data/<id>/{matches,agg,parsed}.json. Выход: docs/data/<id>/analysis.json.
Только стандартная библиотека. Все доверительные интервалы - Вилсона 95%,
тест на случайность - перестановочный (двусторонний).
"""
import json
import math
import os
import random
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data")
TZ_OFFSET_HOURS = 2  # Europe/Kiev зимой; летом +3. Для сессий и часов этого достаточно.
random.seed(7)

KEY_ITEMS = ["black_king_bar", "blink", "manta", "bfury", "desolator", "radiance", "maelstrom", "orchid",
             "diffusal_blade", "echo_sabre", "ultimate_scepter", "sange_and_yasha", "mjollnir", "satanic",
             "butterfly", "monkey_king_bar", "shadow_blade", "silver_edge", "hand_of_midas", "power_treads",
             "phase_boots", "arcane_boots", "travel_boots", "aghanims_shard", "glimmer_cape", "force_staff",
             "aether_lens", "guardian_greaves", "pipe", "crimson_guard", "heart", "assault", "skadi", "basher", "abyssal_blade"]
LANE_ROLE = {1: "сейфлейн", 2: "мид", 3: "оффлейн", 4: "лес", 0: "не определена", None: "не определена"}


def load(path, default):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def wilson(w, n, z=1.96):
    if n == 0:
        return 0.0, 0.0, 0.0
    p = w / n
    den = 1 + z * z / n
    c = p + z * z / (2 * n)
    adj = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return p, (c - adj) / den, (c + adj) / den


def perm_test(a, b, iters=3000):
    na, nb = len(a), len(b)
    if na == 0 or nb == 0:
        return None
    obs = abs(sum(a) / na - sum(b) / nb)
    pool = a + b
    cnt = 0
    for _ in range(iters):
        random.shuffle(pool)
        if abs(sum(pool[:na]) / na - sum(pool[na:]) / nb) >= obs - 1e-12:
            cnt += 1
    return (cnt + 1) / (iters + 1)


def local(ts):
    return datetime.fromtimestamp(ts, timezone(timedelta(hours=TZ_OFFSET_HOURS)))


def mode_of(m):
    if m["game_mode"] == 23:
        return "turbo"
    if m["game_mode"] == 18:
        return "ability_draft"
    if m["lobby_type"] == 7:
        return "ranked"
    if m["lobby_type"] == 0:
        return "normal"
    return "other"


def rows_to_dicts(matches):
    cols = matches["cols"]
    out = []
    for r in matches["rows"]:
        d = dict(zip(cols, r))
        if d.get("win") is None or d.get("start_time") is None:
            continue
        out.append(d)
    return out


def build_sessions(all_ms):
    asc = sorted(all_ms, key=lambda m: m["start_time"])
    sess = num = 0
    prev_end = None
    prev_res = None
    streak = 0
    for m in asc:
        if prev_end is None or m["start_time"] - prev_end > 3600:
            sess += 1
            num = 0
            prev_res = None
            streak = 0
        num += 1
        m["_session"], m["_game_no"], m["_prev"], m["_streak"] = sess, num, prev_res, streak
        r = bool(m["win"])
        prev_res = r
        streak = 0 if r else streak + 1
        prev_end = m["start_time"] + (m["duration"] or 0)


def group_rows(ms, key_fn, order=None):
    groups = defaultdict(list)
    for m in ms:
        k = key_fn(m)
        if k is not None:
            groups[k].append(int(m["win"]))
    keys = [k for k in order if k in groups] if order else sorted(groups)
    rows = []
    for k in keys:
        g = groups[k]
        rest = [x for kk, gg in groups.items() if kk != k for x in gg]
        p = perm_test(g, rest) if len(g) >= 5 and rest else None
        pr, lo, hi = wilson(sum(g), len(g))
        rows.append({"group": str(k), "n": len(g), "wins": sum(g), "wr": round(pr, 4), "lo": round(lo, 4), "hi": round(hi, 4),
                     "p": None if p is None else round(p, 4)})
    return rows


def table(title, section, rows, base):
    return {"title": title, "section": section, "base": round(base, 4), "rows": rows}


def dur_bucket(m):
    d = (m["duration"] or 0) / 60
    return "до 25 мин" if d < 25 else "25-35 мин" if d < 35 else "35-45 мин" if d < 45 else "больше 45 мин"


def death_bucket(d):
    return "0-3" if d <= 3 else "4-6" if d <= 6 else "7-9" if d <= 9 else "10+"


def analyze_mode(ms, agg_mode, parsed, heroes, mode):
    n = len(ms)
    if n == 0:
        return None
    w = sum(m["win"] for m in ms)
    base = w / n
    T = []
    # --- слой 1
    last50 = sorted(ms, key=lambda m: -m["start_time"])[:50]
    def avg(key, sub=None):
        sub = sub if sub is not None else ms
        vals = [m[key] for m in sub if m.get(key) is not None]
        return (sum(vals) / len(vals)) if vals else None
    summary = {
        "n": n, "wins": w, "wr": base, "ci": wilson(w, n)[1:],
        "last50_n": len(last50), "last50_wins": sum(m["win"] for m in last50),
        "kills": avg("kills"), "deaths": avg("deaths"), "assists": avg("assists"),
        "kda": sum((m["kills"] + m["assists"]) / max(1, m["deaths"]) for m in ms) / n,
        "gpm": avg("gpm"), "xpm": avg("xpm"), "lh": avg("lh"), "hero_damage": avg("hero_damage"), "tower_damage": avg("tower_damage"),
        "duration_min": (avg("duration") or 0) / 60,
        "first": min(m["start_time"] for m in ms), "last": max(m["start_time"] for m in ms),
        "share_10plus": sum(1 for m in ms if m["deaths"] >= 10) / n,
        "share_le6": sum(1 for m in ms if m["deaths"] <= 6) / n,
        "distinct_heroes": len({m["hero_id"] for m in ms}),
        "top3_share": sum(c for _, c in Counter(m["hero_id"] for m in ms).most_common(3)) / n,
        "leaver_games": sum(1 for m in ms if m.get("leaver")),
        "deaths_in_wins": avg("deaths", [m for m in ms if m["win"]]),
        "deaths_in_losses": avg("deaths", [m for m in ms if not m["win"]]),
    }
    T.append(table("По месяцам", "layer1", group_rows(ms, lambda m: local(m["start_time"]).strftime("%Y-%m")), base))
    T.append(table("По длительности игры", "layer1", group_rows(ms, dur_bucket, ["до 25 мин", "25-35 мин", "35-45 мин", "больше 45 мин"]), base))
    T.append(table("Винрейт по числу смертей", "deaths", group_rows(ms, lambda m: death_bucket(m["deaths"]), ["0-3", "4-6", "7-9", "10+"]), base))
    T.append(table("Час старта", "habits", group_rows(ms, lambda m: f"{local(m['start_time']).hour:02d}:00"), base))
    wd = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
    T.append(table("День недели", "habits", group_rows(ms, lambda m: wd[local(m["start_time"]).weekday()], wd), base))
    T.append(table("Номер игры в сессии", "habits", group_rows(ms, lambda m: str(min(m["_game_no"], 5)) + ("+" if m["_game_no"] >= 5 else ""), ["1", "2", "3", "4", "5+"]), base))
    T.append(table("Предыдущая игра", "habits", group_rows(ms, lambda m: {None: "первая в сессии", True: "после победы", False: "после поражения"}[m["_prev"]], ["первая в сессии", "после победы", "после поражения"]), base))
    T.append(table("Серия поражений", "habits", group_rows(ms, lambda m: "2+ поражения подряд" if m["_streak"] >= 2 else "нет серии"), base))
    def party(m):
        ps = m.get("party_size")
        return "соло" if not ps or ps == 1 else f"пати из {ps}"
    T.append(table("Соло или пати", "habits", group_rows(ms, party, ["соло", "пати из 2", "пати из 3", "пати из 4", "пати из 5"]), base))
    T.append(table("Сторона карты", "habits", group_rows(ms, lambda m: "Radiant" if m["is_radiant"] else "Dire", ["Radiant", "Dire"]), base))
    T.append(table("Позиция (lane_role из истории)", "habits", group_rows([m for m in ms if m.get("lane_role")], lambda m: LANE_ROLE.get(m["lane_role"], "?"), ["сейфлейн", "мид", "оффлейн", "лес"]), base))

    # --- слой 2: герои (10+ игр в локальной истории)
    by_hero = defaultdict(list)
    for m in ms:
        by_hero[m["hero_id"]].append(m)
    hero_rows = []
    for h, g in by_hero.items():
        if len(g) < 10:
            continue
        hw = sum(m["win"] for m in g)
        p, lo, hi = wilson(hw, len(g))
        rest = [int(m["win"]) for hh, gg in by_hero.items() if hh != h for m in gg]
        pv = perm_test([int(m["win"]) for m in g], rest)
        lh = [m["lh"] / (m["duration"] / 60) for m in g if m.get("lh") is not None and m.get("duration")]
        roles = Counter(LANE_ROLE.get(m.get("lane_role")) for m in g if m.get("lane_role"))
        hero_rows.append({"hero_id": h, "hero": heroes.get(str(h), {}).get("name", str(h)), "n": len(g), "wins": hw,
                          "wr": round(p, 4), "lo": round(lo, 4), "hi": round(hi, 4), "p": None if pv is None else round(pv, 4),
                          "k": avg("kills", g), "d": avg("deaths", g), "a": avg("assists", g), "gpm": avg("gpm", g), "xpm": avg("xpm", g),
                          "lhpm": (sum(lh) / len(lh)) if lh else None, "last": max(m["start_time"] for m in g),
                          "roles": roles.most_common(2)})
    hero_rows.sort(key=lambda r: -r["n"])

    # --- слой 5: смерти
    deaths = {"in_wins": summary["deaths_in_wins"], "in_losses": summary["deaths_in_losses"]}

    # --- вся история из агрегатов OpenDota
    history = None
    if agg_mode and agg_mode.get("counts"):
        c = agg_mode["counts"]
        hn = sum(v["games"] for v in c.get("lobby_type", {}).values()) or sum(v["games"] for v in c.get("game_mode", {}).values())
        hw = sum(v["win"] for v in c.get("lobby_type", {}).values()) or sum(v["win"] for v in c.get("game_mode", {}).values())
        hbase = hw / hn if hn else 0
        history = {"n": hn, "wins": hw, "wr": hbase, "ci": wilson(hw, hn)[1:], "tables": []}
        ir = c.get("is_radiant", {})
        history["tables"].append(table("Сторона карты, вся история", "history",
                                       [dict(group=g, n=v["games"], wins=v["win"], wr=round(wilson(v["win"], v["games"])[0], 4), lo=round(wilson(v["win"], v["games"])[1], 4), hi=round(wilson(v["win"], v["games"])[2], 4), p=None)
                                        for g, v in (("Radiant", ir.get("1", {"games": 0, "win": 0})), ("Dire", ir.get("0", {"games": 0, "win": 0}))) if v["games"]], hbase))
        lr = {k: v for k, v in c.get("lane_role", {}).items() if k != "0"}
        if lr:
            history["tables"].append(table("Позиция в разобранных играх, вся история", "history",
                                           [dict(group=LANE_ROLE.get(int(k), k), n=v["games"], wins=v["win"], wr=round(wilson(v["win"], v["games"])[0], 4), lo=round(wilson(v["win"], v["games"])[1], 4), hi=round(wilson(v["win"], v["games"])[2], 4), p=None)
                                            for k, v in sorted(lr.items(), key=lambda kv: -kv[1]["games"])], hbase))
        hd = agg_mode.get("hist_deaths")
        if hd:
            b = {"0-3": [0, 0], "4-6": [0, 0], "7-9": [0, 0], "10+": [0, 0]}
            tot = 0
            for r in hd:
                b[death_bucket(r["x"])][0] += r["games"]
                b[death_bucket(r["x"])][1] += r["win"]
                tot += r["x"] * r["games"]
            history["tables"].append(table("Смерти за игру, вся история", "history",
                                           [dict(group=k, n=g, wins=ww, wr=round(wilson(ww, g)[0], 4), lo=round(wilson(ww, g)[1], 4), hi=round(wilson(ww, g)[2], 4), p=None) for k, (g, ww) in b.items()], hbase))
            history["deaths_avg"] = tot / hn if hn else None
            history["share_10plus"] = sum(r["games"] for r in hd if r["x"] >= 10) / hn if hn else None
            history["share_le6"] = sum(r["games"] for r in hd if r["x"] <= 6) / hn if hn else None
        hdur = agg_mode.get("hist_duration")
        if hdur:
            b = {"до 25 мин": [0, 0], "25-35 мин": [0, 0], "35-45 мин": [0, 0], "больше 45 мин": [0, 0]}
            for r in hdur:
                k = dur_bucket({"duration": r["x"]})
                b[k][0] += r["games"]
                b[k][1] += r["win"]
            history["tables"].append(table("Длительность, вся история", "history",
                                           [dict(group=k, n=g, wins=ww, wr=round(wilson(ww, g)[0], 4), lo=round(wilson(ww, g)[1], 4), hi=round(wilson(ww, g)[2], 4), p=None) for k, (g, ww) in b.items() if g], hbase))
        hh = agg_mode.get("heroes") or []
        history["heroes"] = [dict(hero_id=h["hero_id"], hero=heroes.get(str(h["hero_id"]), {}).get("name", str(h["hero_id"])), n=h["games"], wins=h["win"],
                                  wr=round(wilson(h["win"], h["games"])[0], 4), lo=round(wilson(h["win"], h["games"])[1], 4), hi=round(wilson(h["win"], h["games"])[2], 4), last=h.get("last_played"))
                             for h in sorted(hh, key=lambda x: -x["games"]) if h["games"] >= 15]
        tt = agg_mode.get("totals") or []
        tot = {t["field"]: (t["sum"] / t["n"] if t.get("n") else None) for t in tt if isinstance(t, dict) and "field" in t}
        history["averages"] = {k: tot.get(k) for k in ("kills", "deaths", "assists", "gold_per_min", "xp_per_min", "last_hits", "denies", "hero_damage", "tower_damage", "duration")}
        history["peers"] = agg_mode.get("peers")

    # --- разобранные матчи (слои 3, 4, 6, журнал)
    prows = [v for v in parsed.values() if v.get("parsed") and mode_of({"game_mode": v.get("game_mode"), "lobby_type": v.get("lobby_type")}) == mode]
    parsed_block = {"n": len(prows), "pending": sum(1 for v in parsed.values() if not v.get("parsed"))}
    if prows:
        def wr_of(sub):
            return {"n": len(sub), "wins": sum(1 for r in sub if r["win"]), "wr": (sum(1 for r in sub if r["win"]) / len(sub)) if sub else None}
        lane_won = [r for r in prows if r.get("gd10") is not None and r["gd10"] > 0]
        lane_lost = [r for r in prows if r.get("gd10") is not None and r["gd10"] <= 0]
        gd = [r["gd10"] for r in prows if r.get("gd10") is not None]
        parsed_block["lane"] = {
            "won": wr_of(lane_won), "lost": wr_of(lane_lost),
            "p": perm_test([int(r["win"]) for r in lane_won], [int(r["win"]) for r in lane_lost]),
            "gd10_avg": (sum(gd) / len(gd)) if gd else None,
            "gd10_wins": (lambda v: sum(v) / len(v) if v else None)([r["gd10"] for r in prows if r["win"] and r.get("gd10") is not None]),
            "gd10_losses": (lambda v: sum(v) / len(v) if v else None)([r["gd10"] for r in prows if not r["win"] and r.get("gd10") is not None]),
            "lh10_avg": (lambda v: sum(v) / len(v) if v else None)([r["lh10"] for r in prows if r.get("lh10") is not None]),
            "early_deaths_per_game": sum(r.get("early_deaths", 0) for r in prows) / len(prows),
            "early_killers": Counter(heroes.get(str(k), {}).get("name", str(k)) for r in prows for t, k in r.get("deaths_log", []) if (t or 0) < 600).most_common(6),
            "roles": Counter(LANE_ROLE.get(r.get("lane_role")) for r in prows).most_common(),
        }
        items = defaultdict(lambda: defaultdict(list))
        for r in prows:
            hname = heroes.get(str(r["hero_id"]), {}).get("name", str(r["hero_id"]))
            for it, t in (r.get("items") or {}).items():
                if it in KEY_ITEMS and t is not None and t > 0:
                    items[hname][it].append((t / 60, r["win"]))
        timings = []
        for hname, its in items.items():
            for it, lst in its.items():
                if len(lst) >= 3:
                    tw = [t for t, ww in lst if ww]
                    tl = [t for t, ww in lst if not ww]
                    timings.append({"hero": hname, "item": it, "n": len(lst), "avg": sum(t for t, _ in lst) / len(lst),
                                    "wins_avg": sum(tw) / len(tw) if tw else None, "losses_avg": sum(tl) / len(tl) if tl else None})
        timings.sort(key=lambda x: -x["n"])
        parsed_block["items"] = timings[:30]
        parsed_block["wards"] = {"obs": sum(r.get("obs", 0) for r in prows) / len(prows), "sen": sum(r.get("sen", 0) for r in prows) / len(prows),
                                 "obs_killed": sum(r.get("obs_killed", 0) for r in prows) / len(prows),
                                 "stacks": sum(r.get("camps_stacked", 0) for r in prows) / len(prows)}
        flags = {
            "смерть вне драки (3+ за игру)": lambda r: r.get("deaths_outside_fight", 0) >= 3,
            "больше 8 смертей": lambda r: (r.get("deaths") or 0) > 8,
            "2+ смерти до 10 минуты": lambda r: r.get("early_deaths", 0) >= 2,
            "кинутое преимущество 5k+": lambda r: r.get("thrown"),
            "линия проиграна (-500 золота на 10 мин)": lambda r: r.get("gd10") is not None and r["gd10"] <= -500,
            "мало боев (участие меньше половины)": lambda r: r.get("teamfights", 0) >= 4 and r.get("fights_joined", 0) < r["teamfights"] / 2,
        }
        journal = []
        for name, fn in flags.items():
            a = [int(r["win"]) for r in prows if fn(r)]
            b = [int(r["win"]) for r in prows if not fn(r)]
            journal.append({"flag": name, "n": len(a), "wins": sum(a), "wr": (sum(a) / len(a)) if a else None,
                            "n_without": len(b), "wr_without": (sum(b) / len(b)) if b else None, "p": perm_test(a, b) if a and b else None})
        parsed_block["journal"] = journal
        parsed_block["matches"] = sorted([{k: r.get(k) for k in ("match_id", "start_time", "duration", "hero_id", "win", "kills", "deaths", "assists", "gpm", "xpm", "lane_role",
                                                                   "lh10", "gd10", "xd10", "early_deaths", "deaths_outside_fight", "obs", "sen", "max_lead", "min_lead", "thrown", "comeback",
                                                                   "fights_joined", "teamfights", "lane_opponent", "benchmarks")} for r in prows], key=lambda r: -(r["start_time"] or 0))
        bm = defaultdict(list)
        for r in prows:
            for k, v in (r.get("benchmarks") or {}).items():
                if v is not None:
                    bm[k].append(v)
        parsed_block["benchmarks_avg_pct"] = {k: sum(v) / len(v) for k, v in bm.items()}

    # --- серии для графиков
    asc = sorted(ms, key=lambda m: m["start_time"])
    roll = []
    win_buf = []
    for m in asc[-400:]:
        win_buf.append(m["win"])
        if len(win_buf) > 30:
            win_buf.pop(0)
        if len(win_buf) >= 10:
            roll.append([m["start_time"], round(sum(win_buf) / len(win_buf), 3)])
    series = {"rolling30": roll}

    # --- автоматические находки (надежно: p < 0.01 и n >= 15)
    findings = []
    for t in T:
        for r in t["rows"]:
            if r["p"] is not None and r["p"] < 0.01 and r["n"] >= 15 and abs(r["wr"] - base) >= 0.08:
                findings.append({"table": t["title"], "group": r["group"], "n": r["n"], "wr": r["wr"], "base": base, "p": r["p"]})
    return {"summary": summary, "tables": T, "heroes": hero_rows, "deaths": deaths, "history": history,
            "parsed": parsed_block, "series": series, "findings": findings}


def main():
    heroes = load(os.path.join(OUT, "heroes.json"), {})
    idx = load(os.path.join(OUT, "players.json"), {"players": []})
    for p in idx.get("players", []):
        acc = str(p["account_id"])
        pdir = os.path.join(OUT, acc)
        matches = load(os.path.join(pdir, "matches.json"), None)
        agg = load(os.path.join(pdir, "agg.json"), {})
        parsed = load(os.path.join(pdir, "parsed.json"), {})
        if not matches or not matches.get("rows"):
            save(os.path.join(pdir, "analysis.json"), {"account_id": int(acc), "generated": int(time.time()), "modes": {}, "empty": True})
            print(acc, "нет данных")
            continue
        all_ms = rows_to_dicts(matches)
        build_sessions(all_ms)
        modes = {}
        for mode in ("ranked", "normal", "turbo"):
            ms = [m for m in all_ms if mode_of(m) == mode]
            res = analyze_mode(ms, agg.get(mode), parsed, heroes, mode)
            if res:
                modes[mode] = res
        save(os.path.join(pdir, "analysis.json"), {"account_id": int(acc), "generated": int(time.time()), "profile": agg.get("profile"),
                                                   "total_matches": len(all_ms), "modes": modes})
        print(acc, "готово:", {k: v["summary"]["n"] for k, v in modes.items()})


if __name__ == "__main__":
    main()
