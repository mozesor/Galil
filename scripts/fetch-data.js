const fs = require("fs/promises");
const path = require("path");

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
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} | ${text.slice(0, 180)}`);
  return JSON.parse(text);
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      referer: LEAGUE_URL,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return text;
}

/**
 * Extract game times from VOLE HTML page
 * This scrapes the actual display times from the website UI
 */
async function extractGameTimesFromHTML(roundNumber) {
  try {
    const url = `${LEAGUE_URL}?round=${roundNumber}`;
    console.log(`  Scraping times from HTML: round ${roundNumber}...`);
    
    const html = await fetchHtml(url);
    
    // Map to store provider_id -> time string (e.g., "14:20")
    const timeMap = new Map();
    
    // Parse HTML to extract game times
    // The HTML structure typically has game cards with time displays
    // We'll look for patterns like: <div class="time">14:20</div>
    
    // Extract game IDs and times using regex patterns
    // Pattern 1: Look for game provider IDs and nearby times
    const gameIdPattern = /data-game-id="(\d+)"|provider.*?id[\"']?\s*:\s*(\d+)/gi;
    const timePattern = /(\d{1,2}:\d{2})/g;
    
    // Split HTML into game sections
    const gameSections = html.split(/class=["']game|id=["']game/i);
    
    for (const section of gameSections) {
      // Try to find provider ID in this section
      const idMatch = section.match(/provider.*?id[\"']?\s*:\s*(\d+)|data-provider-id=["'](\d+)/i);
      if (!idMatch) continue;
      
      const providerId = parseInt(idMatch[1] || idMatch[2]);
      if (!providerId || providerId === -1) continue;
      
      // Look for time pattern in the next 500 characters
      const snippet = section.slice(0, 500);
      const timeMatch = snippet.match(/(\d{1,2}:\d{2})/);
      
      if (timeMatch) {
        const timeStr = timeMatch[1];
        // Validate it's a reasonable time (00:00-23:59)
        const [hours, mins] = timeStr.split(':').map(Number);
        if (hours >= 0 && hours < 24 && mins >= 0 && mins < 60) {
          timeMap.set(providerId, timeStr);
        }
      }
    }
    
    console.log(`  Found ${timeMap.size} game times in HTML for round ${roundNumber}`);
    return timeMap;
    
  } catch (error) {
    console.warn(`  Warning: Could not scrape times for round ${roundNumber}:`, error.message);
    return new Map();
  }
}

/**
 * Merge scraped HTML times into API game data
 */
function mergeGameTimes(games, timesByRound) {
  let mergedCount = 0;
  
  for (const game of games) {
    const roundNum = game?.round?.number;
    const providerId = game?.provider_id;
    
    if (!roundNum || !providerId || providerId === -1) continue;
    
    const timesMap = timesByRound.get(roundNum);
    if (!timesMap) continue;
    
    const timeStr = timesMap.get(providerId);
    if (!timeStr) continue;
    
    // Parse current date
    const currentDate = game.date ? new Date(game.date) : null;
    if (!currentDate || isNaN(currentDate.getTime())) continue;
    
    // Extract hours and minutes from scraped time
    const [hours, minutes] = timeStr.split(':').map(Number);
    
    // Create new date with scraped time (in local Israel timezone)
    // We need to set the time in UTC such that when displayed in Israel (UTC+2), it shows the correct time
    const year = currentDate.getUTCFullYear();
    const month = currentDate.getUTCMonth();
    const day = currentDate.getUTCDate();
    
    // Israel is UTC+2 (or UTC+3 in summer), let's use UTC+2 as baseline
    // If VOLE shows 14:20 in Israel time, we need to store it as 12:20 UTC
    const newDate = new Date(Date.UTC(year, month, day, hours - 2, minutes, 0, 0));
    
    game.date = newDate.toISOString();
    game.scraped_time = timeStr; // Mark that this time was scraped
    mergedCount++;
  }
  
  console.log(`✅ Merged ${mergedCount} game times from HTML scraping`);
  return games;
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
  const m = new Map();
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
  const nums = games.map(g => g?.round?.number).filter(n => typeof n === "number");
  const min = nums.length ? Math.min(...nums) : null;
  let shift = 0;
  if (min === 0) shift = 1;

  if (shift) {
    for (const g of games) {
      if (typeof g?.round?.number === "number") g.round.number += shift;
    }
    if (typeof leagueInfo.currentRoundNumber === "number") leagueInfo.currentRoundNumber += shift;
  }
  return shift;
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
  const outDataPath = path.join(__dirname, "..", "data.json");
  const outDebugPath = path.join(__dirname, "..", "debug_endpoints.json");

  console.log("🔄 Fetching data from VOLE API...");
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

    for (let n = 0; n <= maxTry; n++) {
      const url = `${ROUNDS_API}&${roundParam}=${n}`;
      try {
        const j = await fetchJson(url);
        const gamesRaw = getGames(j);
        tried.push({ url, ok: true, games: gamesRaw.length });

        if (!gamesRaw.length) emptyStreak++;
        else {
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

  // De-duplicate
  const map = new Map();
  for (const g of allGames) if (g?.id) map.set(g.id, g);
  let games = Array.from(map.values());
  games.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  const shift = normalizeRoundNumbersIfZeroBased(games, leagueInfo);

  // 🆕 SCRAPE GAME TIMES FROM HTML
  console.log("\n🌐 Scraping game times from VOLE website HTML...");
  const timesByRound = new Map();
  const roundsToScrape = buildRoundsFromGames(games).map(r => r.number);
  
  for (const roundNum of roundsToScrape) {
    const timesMap = await extractGameTimesFromHTML(roundNum);
    if (timesMap.size > 0) {
      timesByRound.set(roundNum, timesMap);
    }
    // Small delay to be nice to their server
    await new Promise(r => setTimeout(r, 300));
  }
  
  // Merge scraped times into game data
  games = mergeGameTimes(games, timesByRound);

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
      roundNumberShiftApplied: shift,
    },
    rounds,
    gamesCount: games.length,
    games,
    standings,
  };

  await fs.writeFile(outDataPath, JSON.stringify(out, null, 2), "utf8");
  await fs.writeFile(outDebugPath, JSON.stringify({ leagueInfo, roundParam, shift, tried }, null, 2), "utf8");

  console.log("\n✅ Saved data.json + debug_endpoints.json");
  console.log("✅ roundParamDetected:", roundParam);
  console.log("✅ roundNumberFixApplied:", shift);
  console.log("✅ games:", games.length, "| rounds:", rounds.length);
}

main().catch((e) => {
  console.error("❌ fetch failed:", e);
  process.exit(1);
});
