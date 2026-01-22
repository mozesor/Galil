const fs = require("fs/promises");

const LEAGUE_ID = 1276;
const BASE = "https://vole.one.co.il";
const LEAGUE_URL = `${BASE}/league/${LEAGUE_ID}`;
const ROUNDS_API = `${BASE}/api/leagues/rounds?league_id=${LEAGUE_ID}`;
const ROUND_PARAM_CANDIDATES = ["round", "number", "round_number", "roundNumber"];

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "application/json,text/plain,*/*",
      referer: LEAGUE_URL,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} | ${text.slice(0, 140)}`);
  return JSON.parse(text);
}

function getGames(j) {
  if (!j) return [];
  if (Array.isArray(j.games)) return j.games;
  if (Array.isArray(j)) return j;
  return [];
}

function getLeagueInfo(j) {
  const league = j?.league || {};
  return {
    id: league?.id || null,
    name: league?.name || null,
    currentRoundName: league?.round?.name || null,
    currentRoundNumber: league?.round?.number ?? null,
    season_id: league?.season_id ?? null,
  };
}

function normTeam(side) {
  const t = side?.team;
  return {
    id: t?._id ?? null,
    provider_id: t?.provider?.id ?? null,
    name: t?.provider?.name ?? t?.one?.name ?? null,
    has_logo: !!t?.has_logo,
    stats: t?.stats ?? null,
  };
}

function normalizeGame(g) {
  return {
    id: g?._id ?? null,
    provider_id: g?.provider?.id ?? null,
    date: g?.date ?? null,
    is_finished: !!g?.is_finished,
    round: {
      name: g?.round?.name ?? null,
      number: g?.round?.number ?? null,
      type: g?.round?.type ?? null,
    },
    venue: g?.court?.name ?? g?.court?.one?.name ?? null,
    home: { ...normTeam(g?.home), goals: g?.home?.goals ?? null },
    away: { ...normTeam(g?.away), goals: g?.away?.goals ?? null },
  };
}

function buildStandingsFromGames(games) {
  const map = new Map();

  for (const g of games) {
    for (const side of ["home", "away"]) {
      const t = g?.[side];
      const st = t?.stats;
      if (!t?.provider_id || !st) continue;
      map.set(t.provider_id, {
        provider_id: t.provider_id,
        name: t.name,
        games: st.games,
        wins: st.wins,
        draws: st.draws,
        losses: st.losses,
        gf: st.goals?.for,
        ga: st.goals?.against,
        gd: st.goals?.difference,
        points: st.points,
      });
    }
  }

  const arr = Array.from(map.values());
  arr.sort((a, b) => {
    const pa = a.points ?? -999, pb = b.points ?? -999;
    if (pb !== pa) return pb - pa;
    const gda = a.gd ?? -999, gdb = b.gd ?? -999;
    if (gdb !== gda) return gdb - gda;
    const gfa = a.gf ?? -999, gfb = b.gf ?? -999;
    return gfb - gfa;
  });

  return arr.map((x, i) => ({ rank: i + 1, ...x }));
}

function buildRoundsFromGames(games) {
  const m = new Map(); // roundNumber -> count
  for (const g of games) {
    const n = g?.round?.number;
    if (typeof n !== "number") continue;
    m.set(n, (m.get(n) || 0) + 1);
  }
  return Array.from(m.entries())
    .map(([number, gamesCount]) => ({ number, name: `מחזור ${number}`, gamesCount }))
    .sort((a, b) => a.number - b.number);
}

function normalizeRoundNumbersIfZeroBased(games, leagueInfo) {
  // ✅ תיקון חכם: לפעמים ה-API מחזיר round.number שמתחיל מ-0,
  // ובמקביל round.name הוא "מחזור 1". לפעמים number הוא string.
  // המטרה: לאחד את המספור כך שיתחיל מ-1 ויתאים למה שמוצג באתר.

  function toInt(v) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const m = v.match(/-?\d+/);
      if (m) return Number(m[0]);
    }
    return null;
  }

  function numFromName(name) {
    if (typeof name !== "string") return null;
    const m = name.match(/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  // 1) ננסה להסיק מספור נכון לפי name ("מחזור X") כשאפשר
  let touched = false;
  for (const g of games) {
    if (!g || !g.round) continue;
    const n = toInt(g.round.number);
    const nn = numFromName(g.round.name);
    if (nn != null) {
      // אם יש לנו name-num והוא שונה (לדוגמה name=2, number=1) – נעדיף את name-num
      if (n == null || nn !== n) {
        g.round.number = nn;
        touched = true;
      }
    } else if (n != null) {
      g.round.number = n; // ננרמל string->number
    }
  }

  // 2) אם עדיין יש 0-based (מינימום 0) – נבצע shift +1
  const nums = games
    .map(g => toInt(g?.round?.number))
    .filter(n => typeof n === "number" && Number.isFinite(n));
  const min = nums.length ? Math.min(...nums) : null;

  let shift = 0;
  if (min === 0) shift = 1;

  if (shift) {
    for (const g of games) {
      const n = toInt(g?.round?.number);
      if (n != null) g.round.number = n + shift;
    }
  }

  // 3) גם לליג־אינפו (אם יש)
  const curN = toInt(leagueInfo.currentRoundNumber);
  const curNN = numFromName(leagueInfo.currentRoundName);
  if (curNN != null && (curN == null || curNN !== curN)) {
    leagueInfo.currentRoundNumber = curNN;
  } else if (curN != null) {
    leagueInfo.currentRoundNumber = curN + shift;
  }

  // אם השתמשנו ב-name או ביצענו shift – נחזיר 1 כדי לסמן שבוצע תיקון
  return (touched || shift) ? 1 : 0;
}


async function detectRoundParam() {
  for (const p of ROUND_PARAM_CANDIDATES) {
    for (const n of [0, 1, 2, 3]) {
      try {
        const j = await fetchJson(`${ROUNDS_API}&${p}=${n}`);
        if (getGames(j).length) return p;
      } catch {}
    }
  }
  return null;
}

async function main() {
  // Save HTML for debugging
  const html = await (await fetch(LEAGUE_URL, { headers: { "user-agent": "Mozilla/5.0" } })).text();
  await fs.writeFile("../league.html", html, "utf8");

  const baseResp = await fetchJson(ROUNDS_API);
  const leagueInfo = getLeagueInfo(baseResp);

  const roundParam = await detectRoundParam();
  const tried = [];
  let allGames = [];

  if (!roundParam) {
    const games = getGames(baseResp).map(normalizeGame);
    allGames = games;
    tried.push({ url: ROUNDS_API, ok: true, games: games.length });
  } else {
    const maxTry = Math.max(leagueInfo.currentRoundNumber || 0, 80);
    let emptyStreak = 0;
    let anyFound = false;

    // נתחיל מ-0 (כמו קודם) כדי לא לפספס, ונבצע "shift" בסוף אם צריך
    for (let n = 0; n <= maxTry; n++) {
      const url = `${ROUNDS_API}&${roundParam}=${n}`;
      try {
        const j = await fetchJson(url);
        const gamesRaw = getGames(j);
        tried.push({ url, ok: true, games: gamesRaw.length });

        if (!gamesRaw.length) {
          emptyStreak++;
        } else {
          emptyStreak = 0;
          anyFound = true;
          allGames.push(...gamesRaw.map(normalizeGame));
        }

        if (anyFound && emptyStreak >= 8) break;
        await new Promise(r => setTimeout(r, 120));
      } catch (e) {
        tried.push({ url, ok: false, error: String(e) });
      }
    }
  }

  // de-dup
  const map = new Map();
  for (const g of allGames) if (g?.id) map.set(g.id, g);
  const games = Array.from(map.values());
  games.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  // ✅ fix zero-based rounds
  const shift = normalizeRoundNumbersIfZeroBased(games, leagueInfo);

  const standings = buildStandingsFromGames(games);
  const rounds = buildRoundsFromGames(games);

  const out = {
    league: {
      id: leagueInfo.id,
      name: leagueInfo.name,
      league_id_param: LEAGUE_ID,
      season_id: leagueInfo.season_id ?? null,
      currentRoundNumber: leagueInfo.currentRoundNumber ?? null,
      currentRoundName: leagueInfo.currentRoundName ?? null,
    },
    fetchedAt: new Date().toISOString(),
    api: {
      rounds: ROUNDS_API,
      roundParamDetected: roundParam,
      roundNumberFixApplied: shift, // 0 או 1
    },
    rounds,
    gamesCount: games.length,
    games,
    standings,
  };

  await fs.writeFile("../data.json", JSON.stringify(out, null, 2), "utf8");
  await fs.writeFile("../debug_endpoints.json", JSON.stringify({ leagueInfo, roundParam, tried, shift }, null, 2), "utf8");

  console.log("✅ Saved data.json + debug_endpoints.json");
  console.log("✅ roundParamDetected:", roundParam);
  console.log("✅ roundNumberFixApplied:", shift);
  console.log("✅ games:", games.length, "| rounds:", rounds.length);
}

main().catch((e) => {
  console.error("❌ fetch failed:", e);
  process.exit(1);
});
