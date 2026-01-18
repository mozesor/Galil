#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Update data.json from VOLE public API.

The VOLE site (vole.one.co.il) is a Next.js app and sometimes blocks or changes
the rendered HTML for automation/bots. But the *site itself* fetches match data
from public JSON endpoints (seen in DevTools → Network), e.g.:

  https://vole.one.co.il/api/leagues/rounds?league_id=1276&round=11

This script uses those endpoints to pull **all rounds** (past + future), merge
them into data.json, and keep the existing schema that app.js expects.

Output schema (data.json):
  {
    "team": "הפועל גליל עליון",
    "last_update": "2026-01-16 19:05",
    "matches": [
      {"id": "...", "round": "מחזור 11", "date": "16/01/2026", "time": "10:30",
       "home": "...", "away": "...", "venue": "...", "hs": 2, "as": 1}
    ],
    "standings": [... optional ...]
  }

Environment variables:
  VOLE_LEAGUE_ID      (default: 1276)
  DATA_FILE           (default: data.json)
  TZ                  (default: Asia/Jerusalem)
  MAX_ROUNDS          (default: 60)
  DEBUG               (default: 0)
"""

from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests


@dataclass
class Match:
    id: str
    round: str
    dt: datetime
    date: str
    time: str
    home: str
    away: str
    venue: str
    hs: int | None
    as_: int | None


def _debug(msg: str) -> None:
    if os.getenv("DEBUG", "0") == "1":
        print(f"DEBUG: {msg}")


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://vole.one.co.il/",
            "Origin": "https://vole.one.co.il",
        }
    )
    return s


def _safe_get(d: dict, path: list[str], default: str = "") -> str:
    cur: object = d
    for key in path:
        if not isinstance(cur, dict) or key not in cur:
            return default
        cur = cur[key]
    return cur if isinstance(cur, str) else default


def clean_team_name(name: str) -> str:
    """Normalize team names to prevent duplicates from punctuation / invisible chars.

    Notes:
      - VOLE uses Hebrew quotes/apostrophes (״, ׳) inconsistently (e.g. הפ׳ / הפ)
      - Some games include suffix like "צו פיוס" (court order) that should NOT create a new team.
    """
    s = str(name or "")

    # Common whitespace variants
    s = s.replace(" ", " ")

    # Dash variants (include non‑breaking hyphen too)
    s = s.replace("–", "-").replace("—", "-").replace("‑", "-")

    # Remove common quote/apostrophe variants
    s = (
        s.replace("׳", "")   # ׳
         .replace("״", "")  # ״
         .replace('"', "")
         .replace("'", "")
         .replace("`", "")
         .replace("’", "")
    )

    # Normalize dot spacing ("ה. מטה" vs "ה.מטה")
    s = re.sub(r"\s*\.\s*", ".", s)

    # Strip common club prefixes that may or may not appear across endpoints
    # Examples: "הפ׳ גליל עליון" / "הפ גליל עליון" / "ה.מטה אשר" / "מטה אשר"
    s = s.strip()
    s = re.sub(r"^(הפועל|הפ|ה\.|ה|מכבי|מ\.|מ\.ס\.|מ\.כ\.|מ\s)\s*", "", s)

    # Remove invisible / directional marks
    s = re.sub(r"[​-‍﻿⁠‎‏‪-‮]", "", s)

    # Remove suffixes that should not change identity
    s = re.sub(r"\s*צו\s*פיוס\s*$", "", s)

    # Collapse whitespace
    s = re.sub(r"\s+", " ", s).strip()
    return s

def extract_score(game: dict) -> tuple[int | None, int | None]:
    """Best-effort score extraction from VOLE payloads.

    VOLE has used multiple shapes over time (goals, score objects, result strings).
    This tries several common variants and returns (home, away) or (None, None).
    """

    def to_int(v: object) -> int | None:
        """Parse an integer score from common VOLE shapes (int or numeric-ish string)."""
        if v is None:
            return None
        if isinstance(v, int):
            return v
        if isinstance(v, str):
            s = v.strip()
            # Sometimes values come as "3 " or "03" or embedded like "3 goals"
            m = re.search(r"\d+", s)
            if not m:
                return None
            try:
                return int(m.group(0))
            except Exception:
                return None
        return None

    def try_top_level() -> tuple[int | None, int | None]:
        # A) direct keys
        hs = to_int(game.get('homeScore') or game.get('home_score') or game.get('homeGoals') or game.get('home_goals') or game.get('hs') or game.get('goals_home'))
        aw = to_int(game.get('awayScore') or game.get('away_score') or game.get('awayGoals') or game.get('away_goals') or game.get('as') or game.get('goals_away'))
        if isinstance(hs, int) and hs >= 0 and isinstance(aw, int) and aw >= 0:
            return hs, aw

        # B) nested result dicts like {result:{home:3, away:1}} or {final:{...}}
        for key in ('result', 'final', 'final_result', 'match_result', 'game_result'):
            obj = game.get(key)
            if isinstance(obj, dict):
                hs2 = to_int(obj.get('home') or obj.get('hs') or obj.get('homeScore') or obj.get('home_score'))
                aw2 = to_int(obj.get('away') or obj.get('as') or obj.get('awayScore') or obj.get('away_score'))
                if isinstance(hs2, int) and hs2 >= 0 and isinstance(aw2, int) and aw2 >= 0:
                    return hs2, aw2

        return None, None

    # 0) Top-level variants (some payloads don't nest scores)
    hs0, aw0 = try_top_level()
    if isinstance(hs0, int) and isinstance(aw0, int):
        return hs0, aw0

    # 1) Nested home/away dictionaries
    h = game.get('home') if isinstance(game.get('home'), dict) else {}
    a = game.get('away') if isinstance(game.get('away'), dict) else {}

    for hk, ak in [('goals','goals'), ('score','score'), ('result','result')]:
        hs = to_int(h.get(hk))
        aw = to_int(a.get(ak))
        if isinstance(hs, int) and hs >= 0 and isinstance(aw, int) and aw >= 0:
            return hs, aw

    # 2) Top-level score object
    sc = game.get('score')
    if isinstance(sc, dict):
        hs = to_int(sc.get('home') or sc.get('hs') or sc.get('homeScore') or sc.get('home_score') or sc.get('homeGoals') or sc.get('home_goals'))
        aw = to_int(sc.get('away') or sc.get('as') or sc.get('awayScore') or sc.get('away_score') or sc.get('awayGoals') or sc.get('away_goals'))
        if isinstance(hs, int) and hs >= 0 and isinstance(aw, int) and aw >= 0:
            return hs, aw

    # 3) Result as a string like "2:1" or "2-1" (sometimes nested or prefixed)
    for key in ('result', 'score', 'final_score', 'game_result', 'display_result', 'displayScore', 'display_score'):
        v = game.get(key)
        if isinstance(v, str):
            # Accept various dash glyphs in score strings
            mm = re.search(r'(\d+)\s*[:\-–—‑]\s*(\d+)', v)
            if mm:
                return int(mm.group(1)), int(mm.group(2))


    # 4) Recursive fallback: walk the payload and search for any place that stores
    #    numeric home/away scores under varying keys.
    def walk(obj: object):
        if isinstance(obj, dict):
            # common dict forms
            # {home: 3, away: 1}
            if 'home' in obj and 'away' in obj:
                h = to_int(obj.get('home'))
                a = to_int(obj.get('away'))
                if isinstance(h, int) and isinstance(a, int) and h >= 0 and a >= 0:
                    return (h, a)
            # {homeScore: 3, awayScore: 1} etc
            h = to_int(obj.get('homeScore') or obj.get('home_score') or obj.get('homeGoals') or obj.get('home_goals') or obj.get('hs') or obj.get('goals_home'))
            a = to_int(obj.get('awayScore') or obj.get('away_score') or obj.get('awayGoals') or obj.get('away_goals') or obj.get('as') or obj.get('goals_away'))
            if isinstance(h, int) and isinstance(a, int) and h >= 0 and a >= 0:
                return (h, a)

            for v in obj.values():
                res = walk(v)
                if res:
                    return res
        elif isinstance(obj, list):
            for v in obj:
                res = walk(v)
                if res:
                    return res
        elif isinstance(obj, str):
            # Avoid treating dates/times as scores (e.g. "2026-01-21" or "18:50").
            # Volleyball match result is typically 3:x or x:3 where x is 0-2.
            mm = re.search(r'\b([0-3])\s*[:\-]\s*([0-3])\b', obj)
            if mm:
                a = int(mm.group(1))
                b = int(mm.group(2))
                if a == 3 or b == 3:
                    return (a, b)
            return None

    res = walk(game)
    if res:
        return res[0], res[1]

    return None, None

def fetch_round_json(sess: requests.Session, league_id: int, round_no: int) -> dict | None:
    url = f"https://vole.one.co.il/api/leagues/rounds?league_id={league_id}&round={round_no}"
    try:
        r = sess.get(url, timeout=25)
    except Exception as e:
        _debug(f"GET failed {url}: {e}")
        return None

    if r.status_code != 200:
        _debug(f"GET {url} status={r.status_code}")
        return None

    try:
        return r.json()
    except Exception as e:
        _debug(f"JSON parse failed {url}: {e}")
        return None


def parse_games(payload: dict, tz: ZoneInfo) -> list[Match]:
    games = payload.get("games")
    if not isinstance(games, list):
        return []

    out: list[Match] = []
    for g in games:
        if not isinstance(g, dict):
            continue

        mid = str(g.get("_id") or g.get("id") or "").strip()

        # Round name/number
        round_name = _safe_get(g, ["round", "name"], "")
        round_num = g.get("round", {}).get("number") if isinstance(g.get("round"), dict) else None
        if not round_name:
            round_name = f"מחזור {round_num}" if isinstance(round_num, int) else "מחזור"

        # Teams
        home = (
            _safe_get(g, ["home", "team", "provider", "name"], "")
            or _safe_get(g, ["home", "team", "name"], "")
            or _safe_get(g, ["home", "name"], "")
        )
        away = (
            _safe_get(g, ["away", "team", "provider", "name"], "")
            or _safe_get(g, ["away", "team", "name"], "")
            or _safe_get(g, ["away", "name"], "")
        )

        # Aggressive normalization to avoid duplicates caused by invisible characters
        # or dash variants (some providers return RTL marks / NBSP, etc.)
        home = clean_team_name(home)
        away = clean_team_name(away)

        # Date/time
        dt_raw = g.get("date") or g.get("game_date") or g.get("datetime")
        if not isinstance(dt_raw, str) or not dt_raw:
            continue
        try:
            # Most responses are ISO like 2026-01-16T08:30:00.000Z
            iso = dt_raw.replace("Z", "+00:00")
            dt_utc = datetime.fromisoformat(iso)
            if dt_utc.tzinfo is None:
                dt_utc = dt_utc.replace(tzinfo=timezone.utc)
            dt = dt_utc.astimezone(tz)
        except Exception:
            continue

        # Keep ISO date for frontend robustness (YYYY-MM-DD)
        date_s = dt.strftime("%Y-%m-%d")
        time_s = dt.strftime("%H:%M")

        # Venue is not always exposed in the API
        venue = (
            _safe_get(g, ["place", "name"], "")
            or _safe_get(g, ["stadium", "name"], "")
            or ""
        )

        # Score: best-effort extraction (VOLE uses multiple shapes over time)
        hs, as_ = extract_score(g)

        if not mid:
            # Stable-ish synthetic ID
            mid = f"{round_num or round_name}|{date_s}|{time_s}|{home}|{away}".replace(" ", "_")

        out.append(
            Match(
                id=mid,
                round=round_name,
                dt=dt,
                date=date_s,
                time=time_s,
                home=home,
                away=away,
                venue=venue,
                hs=hs,
                as_=as_,
            )
        )

    return out


def load_data(path: str) -> dict:
    if not os.path.exists(path):
        return {"team": "", "last_update": "", "matches": []}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_data(path: str, data: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def merge_matches(existing: list[dict], incoming: list[Match]) -> list[dict]:
    def _norm_date(s: str) -> str:
        """Normalize a date string to YYYY-MM-DD.

        Older versions of this project stored dates as DD/MM/YYYY.
        If we don't normalize, we may keep duplicates (same game) because
        existing and incoming keys won't match.
        """
        s = (s or "").strip()
        if not s:
            return ""
        # Sometimes we might get full ISO date-times – keep only the date part.
        if "T" in s:
            s = s.split("T", 1)[0].strip()
        # Already canonical
        try:
            datetime.strptime(s, "%Y-%m-%d")
            return s
        except Exception:
            pass
        # Legacy format
        try:
            return datetime.strptime(s, "%d/%m/%Y").strftime("%Y-%m-%d")
        except Exception:
            return s

    def _norm_time(s: str) -> str:
        s = (s or "").strip()
        if not s:
            return ""
        # Accept HH:MM:SS
        if len(s) >= 5:
            s = s[:5]
        return s

    def _norm_team(s: str) -> str:
        # Normalize aggressively for matching: remove punctuation and ALL whitespace
        # so variants like 'מ.ס. קרית' vs 'מ.ס.קרית' collapse.
        s = clean_team_name(s)
        s = s.replace('.', '')
        s = s.replace("'", '').replace('\u05f3', '').replace('\u05f4', '').replace('\"', '')
        s = re.sub(r'[\u05be\u2013\u2014-]+', '', s)
        s = re.sub(r'\s+', '', s).strip()
        return s

    # Build a canonical set from existing names so we can collapse sponsorship suffixes
    canon_set: set[str] = set()
    for m in existing:
        if not isinstance(m, dict):
            continue
        canon_set.add(_norm_team(str(m.get("home", ""))))
        canon_set.add(_norm_team(str(m.get("away", ""))))

    for im in incoming:
        canon_set.add(_norm_team(im.home))
        canon_set.add(_norm_team(im.away))
    canon_set = {c for c in canon_set if c}

    def _canon_team(key: str) -> str:
        """Collapse variants like 'X ... sponsor' -> 'X' when a known canonical substring exists."""
        k = key or ""
        if not k:
            return k
        best = k
        best_score = 0
        for ck in canon_set:
            if not ck or ck == k:
                continue
            # Prefer a known canonical substring (usually the base team name)
            if ck in k:
                score = len(ck)
                if score > best_score:
                    best_score = score
                    best = ck
        return best

    def _round_num(v: object) -> int | None:
        if isinstance(v, int) and v > 0:
            return v
        if isinstance(v, str):
            import re

            m = re.search(r"(\d+)", v)
            if m:
                n = int(m.group(1))
                return n if n > 0 else None
        return None

    def _team_pair(home: str, away: str) -> tuple[str, str]:
        h = _canon_team(_norm_team(home))
        a = _canon_team(_norm_team(away))
        pair = sorted([h, a])
        p1, p2 = (pair + ["", ""])[0], (pair + ["", ""])[1]
        return p1, p2

    def _keys(date: str, time: str, home: str, away: str, rnd: object) -> list[str]:
        """Return multiple candidate natural keys.

        In practice, the source sometimes emits *two* rows for the same game:
        one row with score and another without, or with missing/changed round.
        To merge these reliably, we generate several keys and match on any of them.
        """
        d = _norm_date(date)
        t = _norm_time(time)
        r = _round_num(rnd)
        p1, p2 = _team_pair(home, away)

        out: list[str] = []
        if d and t and t != "00:00":
            out.append(f"DT|{d}|{t}|{p1}|{p2}")
        if d:
            out.append(f"D|{d}|{p1}|{p2}")
        if r is not None:
            out.append(f"R|{r}|{p1}|{p2}")
        if d and r is not None:
            out.append(f"DR|{d}|{r}|{p1}|{p2}")
        return out

    def _quality(x: dict) -> tuple[int, int, int, int]:
        # (has_score, has_venue, has_time, prefer_shorter_names)
        hs, as_ = x.get("hs"), x.get("as")
        has_score = 1 if isinstance(hs, int) and isinstance(as_, int) else 0
        has_venue = 1 if str(x.get("venue", "")).strip() else 0
        t = str(x.get("time", "")).strip()
        has_time = 1 if t and t != "00:00" else 0
        nm = f"{x.get('home','')}|{x.get('away','')}"
        prefer_shorter = -len(nm)
        return (has_score, has_venue, has_time, prefer_shorter)

    # Build a canonical set of matches using multi-key matching.
    # This dedupes BOTH existing duplicates and duplicates inside the fresh incoming payload.
    by_id: dict[str, dict] = {}
    key_to_id: dict[str, str] = {}

    def _merge_into(base: dict, cand: dict) -> dict:
        """Merge cand into base, keeping the most complete information."""
        out = dict(base)

        # Prefer scored row for score
        if isinstance(cand.get("hs"), int) and isinstance(cand.get("as"), int):
            out["hs"], out["as"] = cand.get("hs"), cand.get("as")
        else:
            out.setdefault("hs", cand.get("hs"))
            out.setdefault("as", cand.get("as"))

        # Venue: keep any non-empty
        if str(cand.get("venue", "")).strip() and not str(out.get("venue", "")).strip():
            out["venue"] = cand.get("venue")

        # Date/time: prefer non-empty and non-00:00 time
        if str(cand.get("date", "")).strip() and not str(out.get("date", "")).strip():
            out["date"] = cand.get("date")
        ct = str(cand.get("time", "")).strip()
        ot = str(out.get("time", "")).strip()
        if ct and ct != "00:00" and (not ot or ot == "00:00"):
            out["time"] = ct

        # Round: prefer an explicit numeric round if base is missing
        if out.get("round") in (None, "", 0) and cand.get("round") not in (None, "", 0):
            out["round"] = cand.get("round")

        # Home/away: pick the version with better overall quality
        if _quality(cand) > _quality(out):
            out["home"] = cand.get("home", out.get("home"))
            out["away"] = cand.get("away", out.get("away"))
            if cand.get("round") not in (None, "", 0):
                out["round"] = cand.get("round")
            if str(cand.get("date", "")).strip():
                out["date"] = cand.get("date")
            if str(cand.get("time", "")).strip():
                out["time"] = cand.get("time")

        return out

    def _upsert(match_dict: dict) -> None:
        # Find existing canonical record by ANY candidate key
        keys = _keys(str(match_dict.get("date", "")), str(match_dict.get("time", "")), str(match_dict.get("home", "")), str(match_dict.get("away", "")), match_dict.get("round"))
        hit_id = None
        for k in keys:
            if k in key_to_id:
                hit_id = key_to_id[k]
                break

        if hit_id is None:
            mid = str(match_dict.get("id") or f"M{len(by_id) + 1}")
            match_dict["id"] = mid
            by_id[mid] = match_dict
            for k in keys:
                key_to_id[k] = mid
            return

        # Merge into existing
        base = by_id.get(hit_id, {})
        merged = _merge_into(base, match_dict)
        merged["id"] = hit_id
        by_id[hit_id] = merged
        for k in keys:
            key_to_id.setdefault(k, hit_id)

    # 1) Normalize and upsert existing matches first
    for m in existing:
        if not isinstance(m, dict):
            continue
        mm = dict(m)
        d0 = _norm_date(str(mm.get("date", "")))
        t0 = _norm_time(str(mm.get("time", "")))
        if d0:
            mm["date"] = d0
        if t0:
            mm["time"] = t0
        _upsert(mm)

    # 2) Upsert incoming matches (dedupes duplicates inside the payload too)
    for m in incoming:
        mid = str(m.id)
        prev = by_id.get(mid, {})

        prev_hs = prev.get("hs")
        prev_as = prev.get("as")
        hs_out = m.hs if isinstance(m.hs, int) else (prev_hs if isinstance(prev_hs, int) else None)
        as_out = m.as_ if isinstance(m.as_, int) else (prev_as if isinstance(prev_as, int) else None)

        _upsert(
            {
                "id": mid,
                "round": m.round,
                "date": _norm_date(m.date),
                "time": _norm_time(m.time),
                "home": m.home,
                "away": m.away,
                "venue": m.venue or prev.get("venue") or "",
                "hs": hs_out,
                "as": as_out,
            }
        )

    # Sort by date+time
    def _parse_dt(x: dict) -> datetime:
        d = str(x.get("date", ""))
        t = str(x.get("time", ""))
        for fmt in ("%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M"):
            try:
                return datetime.strptime(f"{d} {t}", fmt)
            except Exception:
                pass
        return datetime(1970, 1, 1)

    return sorted(by_id.values(), key=_parse_dt)


def main() -> int:
    league_id = int(os.getenv("VOLE_LEAGUE_ID", "1276"))
    data_file = os.getenv("DATA_FILE", "data.json")
    tz_name = os.getenv("TZ", "Asia/Jerusalem")
    max_rounds = int(os.getenv("MAX_ROUNDS", "60"))
    tz = ZoneInfo(tz_name)

    sess = _session()

    all_matches: list[Match] = []
    consecutive_empty = 0
    seen_any = False

    for rnd in range(1, max_rounds + 1):
        payload = fetch_round_json(sess, league_id, rnd)
        if not payload:
            consecutive_empty += 1
            if seen_any and consecutive_empty >= 6:
                break
            continue

        matches = parse_games(payload, tz)
        # Some VOLE deployments appear to be 0-indexed for the first round.
        # If round=1 returns nothing, try round=0 once.
        if rnd == 1 and not matches:
            payload0 = fetch_round_json(sess, league_id, 0)
            if payload0:
                matches0 = parse_games(payload0, tz)
                if matches0:
                    matches = matches0

        if not matches:
            consecutive_empty += 1
            if seen_any and consecutive_empty >= 6:
                break
            continue

        seen_any = True
        consecutive_empty = 0
        all_matches.extend(matches)

    data = load_data(data_file)
    data.setdefault("team", os.getenv("TEAM_NAME", "הפ׳ גליל עליון"))
    data.setdefault("matches", [])

    old_matches = data.get("matches", [])

    # Drop legacy placeholder fixtures (old format) so we don't end up with
    # duplicates when we merge with VOLE API data.
    old_matches = [
        m for m in old_matches
        if not (isinstance(m.get("round"), (int, float)) or re.match(r"^M\d+$", str(m.get("id", ""))))
    ]
    new_matches = merge_matches(old_matches, all_matches)

    def _canon(obj):
        try:
            return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        except Exception:
            return str(obj)

    # Only update data.json if something actually changed.
    if _canon(new_matches) == _canon(old_matches):
        print(f"No changes: {data_file} (matches unchanged) league_id={league_id}")
        return 0

    data["matches"] = new_matches
    data["last_update"] = datetime.now(tz).strftime("%Y-%m-%d %H:%M")

    # Help debugging in the UI
    data["standingsSource"] = data.get("standingsSource") or "vole-api (rounds endpoint)"

    save_data(data_file, data)

    print(f"Updated {data_file}: matches={len(data['matches'])} league_id={league_id}")
    if not all_matches:
        print("WARNING: No matches pulled from VOLE API. Site might be blocking GitHub runners.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
