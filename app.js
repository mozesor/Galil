let LEAGUE_DATA = null;

const APP_VERSION = '5.14';

const $ = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => Array.from(el.querySelectorAll(q));

const state = {
  activeTab: 'hub',
  activeOpponent: null,
  // כל משחקי הליגה (משמש לחישוב טבלה/סטטיסטיקות)
  allMatches: [],
  // משחקי הקבוצה שלנו בלבד (משמש ל"לוח", "מחזורים", "יריבות")
  matches: [],
  // כל הקבוצות בליגה (למפה/פילטר)
  opponents: [],
};

// ---------- Normalization (support multiple data.json schemas) ----------
function getDeep(obj, path){
  const parts = path.split('.');
  let cur = obj;
  for(const part of parts){
    if(cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function firstDefined(...vals){
  for(const v of vals){
    if(v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function toIntOrNull(v){
  if(v === null || v === undefined || v === '') return null;
  if(typeof v === 'number' && isFinite(v)) return v;
  const s = String(v).trim();
  if(!s) return null;
  if(/^-?\d+$/.test(s)){
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function teamNameFromTeamObj(teamObj){
  return firstDefined(
    getDeep(teamObj, 'one.name'),
    getDeep(teamObj, 'provider.name'),
    teamObj?.name,
  );
}

function extractRoundLabel(v){
  if(v == null) return '';
  const s = String(v).trim();
  if(!s) return '';
  if(s.includes('מחזור')) return s;
  // numeric
  const n = parseInt(s, 10);
  if(!Number.isNaN(n) && n > 0) return `מחזור ${n}`;
  return s;
}

function roundToNumber(v){
  if(v == null) return null;
  if(typeof v === 'number' && isFinite(v)) return v;
  const s = String(v).trim();
  if(!s) return null;
  // Try to extract digits from strings like "מחזור 2"
  const m = s.match(/(\d+)/);
  if(m){
    const n = parseInt(m[1], 10);
    return (!Number.isNaN(n) && n > 0) ? n : null;
  }
  const n = parseInt(s, 10);
  return (!Number.isNaN(n) && n > 0) ? n : null;
}

function normalizeDateToISO(v){
  const s = (v == null) ? '' : String(v).trim();
  if(!s) return '';

  // ISO datetime or ISO date
  if(s.includes('T') && s.length >= 10) return s.slice(0,10);
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD/MM/YYYY (or D/M/YY)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if(m){
    const dd = String(m[1]).padStart(2,'0');
    const mm = String(m[2]).padStart(2,'0');
    let yy = String(m[3]);
    if(yy.length === 2) yy = '20' + yy;
    return `${yy}-${mm}-${dd}`;
  }

  const dt = new Date(s);
  if(!isNaN(dt.getTime())) return dt.toISOString().slice(0,10);
  return s;
}

function normalizeTimeToHHMM(v){
  const s = (v == null) ? '' : String(v).trim();
  if(!s) return '';
  if(s.includes('T') && s.length >= 16) return s.slice(11,16);
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if(m){
    const hh = String(m[1]).padStart(2,'0');
    const mm = String(m[2]).padStart(2,'0');
    return `${hh}:${mm}`;
  }
  return s;
}


function normalizeMatches(raw){
  // Supports both shapes:
  // 1) data.json from our updater: { matches: [{home,away,home_goals,away_goals,round_number,round_name,date,time,location}] }
  // 2) raw VOLE API shape: { games: [{home:{team:{provider:{name}} , goals}, away:{...}} , date, round:{number,name}}] }
  const arr = Array.isArray(raw?.matches) ? raw.matches : (Array.isArray(raw?.games) ? raw.games : []);
  if (!arr || !arr.length) return [];

  const sample = arr[0] || {};
  const hasHomeGoals = Object.prototype.hasOwnProperty.call(sample, 'home_goals') || Object.prototype.hasOwnProperty.call(sample, 'away_goals');
  const hasHsAs = Object.prototype.hasOwnProperty.call(sample, 'hs') || Object.prototype.hasOwnProperty.call(sample, 'as');

  // Case A: already in UI-normalized format
  if (hasHsAs) {
    return arr.map(m => {
      const rn = roundToNumber(firstDefined(m.round_number, m.round, m.roundName, m.round_name));
      const date = normalizeDateToISO(m.date || '');
      const time = normalizeTimeToHHMM(m.time || '');
      return {
        ...m,
        date,
        time,
        round: rn,
        round_number: rn,
        hs: (()=>{ const n = toIntOrNull(m.hs); return (n != null && n >= 0) ? n : null; })(),
        as: (()=>{ const n = toIntOrNull(m.as); return (n != null && n >= 0) ? n : null; })(),
      };
    });
  }

  // Case B: produced by our updater (home_goals / away_goals)
  if (hasHomeGoals) {
    return arr.map(m => {
      const hsN = toIntOrNull(m.home_goals);
      const asN = toIntOrNull(m.away_goals);
      const hs = (hsN != null && hsN >= 0) ? hsN : null;
      const as = (asN != null && asN >= 0) ? asN : null;
      const roundNum = roundToNumber(firstDefined(m.round_number, m.round, m.round_name, m.roundName));
      const home = m.home || m.home_team || '';
      const away = m.away || m.away_team || '';
      const date = normalizeDateToISO(m.date || '');
      const time = normalizeTimeToHHMM(m.time || '');
      const id = m.id || `R${roundNum ?? 'X'}|${date}|${time}|${home}|${away}`.replace(/\s+/g,'_');
      return {
        id,
        home,
        away,
        hs, as,
        date,
        time,
        venue: m.location || m.venue || '',
        round: roundNum,
        round_number: roundNum,
      };
    });
  }

  // Case C: raw VOLE API games array
  return arr.map(g=>{
    const dt = new Date(g.date);
    const date = isFinite(dt) ? dt.toISOString().slice(0,10) : '';
    const time = isFinite(dt) ? dt.toISOString().slice(11,16) : '';
    const home = g.home?.team?.provider?.name || g.home?.team?.one?.name || '';
    const away = g.away?.team?.provider?.name || g.away?.team?.one?.name || '';
    const hsN = toIntOrNull(g.home?.goals);
    const asN = toIntOrNull(g.away?.goals);
    const hs = (hsN != null && hsN >= 0) ? hsN : null;
    const as = (asN != null && asN >= 0) ? asN : null;
    const round_number = roundToNumber(firstDefined(g.round?.number, g.round?.name));
    const id = String(g._id || g.id || '').trim() || `R${round_number ?? 'X'}|${date}|${time}|${home}|${away}`.replace(/\s+/g,'_');
    return { id, home, away, hs, as, date, time, venue:'', round: round_number, round_number };
  });
}


function normalizeStandings(raw){
  // expected output for UI: [{team, pts, gp, gd, gf, ga, w, d, l}]
  if(Array.isArray(raw?.standings) && raw.standings.length && raw.standings[0].team){
    return raw.standings;
  }
  if(Array.isArray(raw?.standings) && raw.standings.length && raw.standings[0].name){
    return raw.standings.map((t) => ({
      team: t.name,
      pts: t.points,
      gp: t.played,
      gd: t.gd,
      gf: t.gf,
      ga: t.ga,
      w: t.wins,
      d: t.draws,
      l: t.losses,
      has_logo: t.has_logo,
    }));
  }
  return [];
}

function normalizeMeta(raw){
  // keep existing keys if present
  const team = firstDefined(raw?.team, raw?.league?.name, raw?.league?.team, 'הפועל גליל עליון');
  const league = firstDefined(raw?.league, raw?.league?.name, raw?.league_name, raw?.source?.league_id);
  return {
    team: team,
    league: league,
    updated: firstDefined(raw?.updated, raw?.generated_at, raw?.updated_at, null),
  };
}

function normalizeData(raw){
  const meta = normalizeMeta(raw || {});
  const matches = normalizeMatches(raw || {});
  const standings = normalizeStandings(raw || {});
  return {
    ...raw,
    team: meta.team,
    league: meta.league,
    updated: meta.updated,
    matches,
    standings,
  };
}

function normName(s){
  return (s||'')
    .toString()
    // Remove directional markers + zero-width chars
    .replace(/[\u200B-\u200D\uFEFF\u2060\u200E\u200F\u202A-\u202E]/g,'')
    // Normalize whitespace + nbsp
    .replace(/\xa0/g,' ')
    .replace(/ /g,' ')
    // Normalize dash variants
    .replace(/[–—]/g,'-')
    // Remove Hebrew/latin quotes that sometimes differ between sources
    .replace(/[״"]/g,'')
    .replace(/\s+/g,' ')
    .trim();
}

// Normalize date/time for stable dedupe keys (supports YYYY-MM-DD, DD/MM/YYYY, ISO).
function normDateKey(d){
  let s = String(d || '').trim();
  if(!s) return '';
  if(s.includes('T')) s = s.split('T')[0].trim();
  // Accept DD/MM/YYYY and also D/M/YYYY -> YYYY-MM-DD
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m) {
    const dd = String(m[1]).padStart(2,'0');
    const mm = String(m[2]).padStart(2,'0');
    return `${m[3]}-${mm}-${dd}`;
  }
  // Already YYYY-MM-DD
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s;
}

function normTimeKey(t){
  let s = String(t || '').trim();
  if(!s) return '';
  if(s.length >= 5) s = s.slice(0,5);
  return s;
}

// Local day key for comparisons like "past matches".
// We normalize to local date instead of UTC to avoid edge-case day flips.
function todayISOlocal(){
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0,10);
}

function isPastNoResult(m){
  const d = normDateKey(m?.date);
  if(!d) return false;
  const hasScore = (m?.hs != null && m?.as != null);
  if(hasScore) return false;
  return d < todayISOlocal();
}

// Normalize team names for comparison (handles punctuation / abbreviations)
function normTeamKey(s){
  return normName(s)
    .replace(/["'׳״\.]/g, '')
    // Collapse sponsor / note suffixes that create false duplicates
    // Example: "מועדון הכדורגל מרום הגליל צו פיוס" == "מועדון הכדורגל מרום הגליל"
    .replace(/(^|\s)צו\s*פיוס(\s|$)/g, ' ')
    .replace(/\s+/g,' ')
    .trim();
}

function isMyTeam(name){
  const a = normTeamKey(name);
  const b = normTeamKey(LEAGUE_DATA.team);
  // Fast exact match
  if (a === b) return true;
  // Fallback: if both contain "גליל עליון" treat as same (handles "הפ'" vs "הפועל")
  if (a.includes('גליל עליון') && b.includes('גליל עליון')) return true;
  return false;
}

function getMyTeamDisplayName(){
  const base = normName(LEAGUE_DATA.team);
  if (normTeamKey(base).includes('גליל עליון')) return 'הפועל גליל עליון';
  return base;
}
function opponentOf(m){
  return isMyTeam(m.home) ? m.away : m.home;
}

let _CANON_TEAM_KEYS = null;
function buildCanonTeamKeys(){
  if(_CANON_TEAM_KEYS) return _CANON_TEAM_KEYS;
  const set = new Set();
  const add = (name)=>{
    const k = normTeamKey(name);
    if(k) set.add(k);
  };
  // Prefer standings as canonical list when present
  if(Array.isArray(LEAGUE_DATA?.standings)){
    for(const row of LEAGUE_DATA.standings){
      add(row?.team ?? row?.name ?? '');
    }
  }
  if(Array.isArray(LEAGUE_DATA?.matches)){
    for(const m of LEAGUE_DATA.matches){
      add(m?.home ?? '');
      add(m?.away ?? '');
    }
  }
  add(LEAGUE_DATA?.team ?? '');
  _CANON_TEAM_KEYS = Array.from(set);
  return _CANON_TEAM_KEYS;
}

function canonicalTeamKey(name){
  const k = normTeamKey(name);
  if(!k) return '';
  const canon = buildCanonTeamKeys();
  if(canon.includes(k)) return k;
  // Try to collapse sponsorship suffixes: pick the best substring match
  let best = k;
  let bestScore = 0;
  for(const ck of canon){
    if(!ck || ck === k) continue;
    if(k.includes(ck)){
      const score = ck.length;
      if(score > bestScore){ bestScore = score; best = ck; }
    } else if(ck.includes(k)){
      const score = k.length;
      if(score > bestScore){ bestScore = score; best = ck; }
    }
  }
  return best;
}

async function loadLeagueData(){
  const url = `data.json?cb=${Date.now()}`;
  const statusEl = document.getElementById('dataStatus');

  try{
    const res = await fetch(url, {cache:'no-store'});
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const raw = await res.json();
    const data = normalizeData(raw);
    if(!data || !Array.isArray(data.matches)) throw new Error('Invalid data.json');
    if(statusEl){
      const last = data.last_update || data.generated_at || raw?.generated_at;
      const lastTxt = last ? `עודכן: ${String(last).replace('T',' ').slice(0,19)}` : 'עודכן: —';
      statusEl.textContent = `נטען data.json • ${lastTxt} • v${APP_VERSION}`;
    }
    return data;
  }catch(err){
    if(statusEl){
      statusEl.textContent = 'לא הצלחתי לטעון data.json — בדוק שהקובץ קיים בריפו (root).';
    }
    if(window.LEAGUE_DATA) return window.LEAGUE_DATA;
    throw err;
  }
}


function matchNaturalKey(m){
  const d = normDateKey(m?.date);
  const t = normTimeKey(m?.time);
  const h = canonicalTeamKey(m?.home || '');
  const a = canonicalTeamKey(m?.away || '');
  const r = roundToNumber(firstDefined(m?.round_number, m?.round));

  // Special case: for our team's match list, sources sometimes duplicate the *same* game
  // with different IDs/round numbers, and one copy may have a score while the other is empty.
  // To prevent "two rows: one with result, one without", we collapse OUR games by:
  // date + time + opponent (order independent of home/away).
  const timePart = (t && t !== '00:00') ? t : '';
  const isOurs = isMyTeam(m?.home) || isMyTeam(m?.away);
  if(isOurs){
    const opp = canonicalTeamKey(opponentOf(m) || '');
    // IMPORTANT:
    // Different sources sometimes provide the same game with/without time.
    // If we include the time in the key, we can end up with two rows (one time=00:00).
    // For OUR matches, collapse primarily by date + opponent.
    if(d) return ['MY', d, opp].join('|');
    if(r != null) return ['MYR', r, opp].join('|');
    return ['MY', timePart, opp].join('|');
  }

  // Make key order-independent (some sources swap home/away)
  const pair = [h, a].filter(Boolean);
  pair.sort();
  const p1 = pair[0] || '';
  const p2 = pair[1] || '';

  // NOTE:
  // מקורות שונים לפעמים "מעבירים" משחק בין מחזור X למחזור Y,
  // אבל התאריך+שעה+קבוצות נשארים זהים. לכן כשיש תאריך ושעה אמיתית
  // אנחנו לא מכניסים את המחזור למפתח הכפילות.

  if(d && timePart){
    return [d, timePart, p1, p2].join('|');
  }
  // If the date is known but time is missing/empty on one source,
  // we still want to merge duplicates (some sources omit the time).
  if(d){
    return [d, p1, p2].join('|');
  }
  return [r ?? '', timePart, p1, p2].join('|');
}

function chooseBetterMatch(a, b){
  // Prefer a match that has a played score, then venue, then a known time.
  const aHasScore = (a.hs != null && a.as != null);
  const bHasScore = (b.hs != null && b.as != null);
  if(aHasScore !== bHasScore) return aHasScore ? a : b;

  const aHasVenue = !!(a.venue && String(a.venue).trim());
  const bHasVenue = !!(b.venue && String(b.venue).trim());
  if(aHasVenue !== bHasVenue) return aHasVenue ? a : b;

  const aHasTime = !!(a.time && a.time !== '00:00');
  const bHasTime = !!(b.time && b.time !== '00:00');
  if(aHasTime !== bHasTime) return aHasTime ? a : b;

  // Otherwise keep the one with the shorter ID (usually our stable Mxx IDs)
  const aId = String(a.id || '');
  const bId = String(b.id || '');
  if(aId && bId && aId.length !== bId.length) return (aId.length < bId.length) ? a : b;
  return a;
}

function mergeMatchFields(base, other){
  const out = {...base};
  // Fill missing fields
  if(out.hs==null && out.as==null && other.hs!=null && other.as!=null){
    out.hs = other.hs; out.as = other.as;
  }
  // Keep team names if one side is missing / worse
  if(!out.home && other.home) out.home = other.home;
  if(!out.away && other.away) out.away = other.away;
  if(!out.venue && other.venue) out.venue = other.venue;
  if((!out.time || out.time==='00:00') && other.time && other.time!=='00:00') out.time = other.time;
  if(!out.date && other.date) out.date = other.date;

  // Round: prefer an existing numeric round, otherwise take the other.
  const rnA = roundToNumber(firstDefined(out.round_number, out.round));
  const rnB = roundToNumber(firstDefined(other.round_number, other.round));
  const rn = (rnA != null) ? rnA : rnB;
  out.round = rn;
  out.round_number = rn;
  return out;
}

function dedupeMatches(list){
  const byKey = new Map();
  for(const m of (list || [])){
    if(!m) continue;
    const key = matchNaturalKey(m);
    const prev = byKey.get(key);
    if(!prev){
      byKey.set(key, m);
      continue;
    }
    const winner = chooseBetterMatch(prev, m);
    const loser = (winner === prev) ? m : prev;
    byKey.set(key, mergeMatchFields(winner, loser));
  }
  return Array.from(byKey.values());
}

function applyScores(){
  // Read-only: scores come only from data.json
  const merged = (LEAGUE_DATA.matches || []).map(m => {
    const c = {...m};

    // IMPORTANT: In some sources scores arrive as strings (e.g. "3").
    // If we keep them as strings, standings sums will CONCATENATE
    // (0 + "3" => "03"), creating huge fake totals.
    if (c.hs !== null && c.hs !== undefined) {
      const n = Number(c.hs);
      c.hs = Number.isFinite(n) ? n : null;
    }
    if (c.as !== null && c.as !== undefined) {
      const n = Number(c.as);
      c.as = Number.isFinite(n) ? n : null;
    }

    return c;
  });

  // Guard against duplicates (usually happens when the source changes IDs)
  const deduped = dedupeMatches(merged);

  // All league matches
  state.allMatches = deduped;

  // Only our team's matches
  state.matches = deduped
    .filter(m => isMyTeam(m.home) || isMyTeam(m.away));

  // All league teams (for map/filter) – prefer standings if available
  state.opponents = buildLeagueTeams();
}

function buildLeagueTeams(){
  const seen = new Set();
  const out = [];

  // 1) מה-standings אם קיים (הכי נקי)
  if(Array.isArray(LEAGUE_DATA.standingsSource) && LEAGUE_DATA.standingsSource.length){
    for(const row of LEAGUE_DATA.standingsSource){
      const name = String(row?.name ?? '').trim();
      if(!name) continue;
      if(isMyTeam(name)) continue;
      const k = normTeamKey(name);
      if(!k || seen.has(k)) continue;
      seen.add(k);
      out.push(name);
    }
  }

  // 2) גיבוי: מהמשחקים (במקרה שאין standings)
  if(!out.length){
    for(const m of (LEAGUE_DATA.matches || [])){
      for(const nm of [m.home, m.away]){
        const name = String(nm ?? '').trim();
        if(!name) continue;
        if(isMyTeam(name)) continue;
        const k = normTeamKey(name);
        if(!k || seen.has(k)) continue;
        seen.add(k);
        out.push(name);
      }
    }
  }

  // מיון עברית
  try{ out.sort(new Intl.Collator('he').compare); }catch(e){ out.sort(); }
  return out;
}

function fmtDate(v){
  // אם מגיע Date אובייקט (מהנורמליזציה) – פורמט מהיר ומדויק
  if(v instanceof Date && !isNaN(v.getTime())){
    const d = String(v.getDate()).padStart(2,'0');
    const m = String(v.getMonth()+1).padStart(2,'0');
    const y = v.getFullYear();
    return `${d}/${m}/${y}`;
  }
  // Supports: YYYY-MM-DD, ISO datetime, or DD/MM/YYYY
  const s = (v == null) ? '' : String(v).trim();
  if(!s) return '';

  // DD/MM/YYYY already
  if(s.includes('/') && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)){
    const [d,m,y] = s.split('/');
    return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
  }

  // ISO datetime or YYYY-MM-DD
  const isoDate = s.length >= 10 ? s.slice(0,10) : s;
  if(/^\d{4}-\d{2}-\d{2}$/.test(isoDate)){
    const [y,m,d] = isoDate.split('-');
    return `${d}/${m}/${y}`;
  }

  // Last resort: Date parsing
  const dt = new Date(s);
  if(!isNaN(dt.getTime())){
    const d = String(dt.getDate()).padStart(2,'0');
    const m = String(dt.getMonth()+1).padStart(2,'0');
    const y = dt.getFullYear();
    return `${d}/${m}/${y}`;
  }
  return '';
}

function fmtTime(v){
  // אם מגיע Date אובייקט – נחזיר HH:MM
  if(v instanceof Date && !isNaN(v.getTime())){
    const hh = String(v.getHours()).padStart(2,'0');
    const mm = String(v.getMinutes()).padStart(2,'0');
    return `${hh}:${mm}`;
  }
  // Supports: HH:MM, ISO datetime, or "HH:MM:SS" / "HH:MM:SSZ"
  const s = (v == null) ? '' : String(v).trim();
  if(!s || s === '00:00') return 'טרם נקבע';
  if(s.includes('T')){
    const m = s.match(/T(\d{2}:\d{2})/);
    if(m) return m[1];
  }
  const m = s.match(/^(\d{2}:\d{2})/);
  if(m) return m[1];
  return s;
}
function matchTitle(m){
  return `${m.home} — ${m.away}`;
}
function scoreText(m){
  if(m.hs==null || m.as==null) return '—';
  return `${m.hs}:${m.as}`;
}
function resultBadgeClass(m){
  if(m.hs==null || m.as==null) return '';
  const teamIsHome = isMyTeam(m.home);
  const gf = teamIsHome ? m.hs : m.as;
  const ga = teamIsHome ? m.as : m.hs;
  if(gf > ga) return 'good';
  if(gf < ga) return 'bad';
  return 'draw';
}

function uniqueOpponents(){
  const set = new Set();
  for(const m of state.matches){
    set.add(normName(opponentOf(m)));
  }
  return Array.from(set).filter(Boolean).sort((a,b)=>a.localeCompare(b,'he'));
}

function buildTabs(){
  $$('.tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $$('.tab').forEach(b=>b.classList.remove('is-active'));
      btn.classList.add('is-active');

      const tab = btn.dataset.tab;
      state.activeTab = tab;

      $$('.panel').forEach(p=>p.classList.remove('is-active'));
      $('#panel-' + tab).classList.add('is-active');

      if(tab==='table') renderTable();
      if(tab==='matches') renderMatches();
      if(tab==='hub') renderHub();
    });
  });
}

function shortName(name){
  const s = normName(name);
  return s.replace(/\s{2,}/g,' ').trim();
}

function makePill(label, opponent, active){
  const el = document.createElement('button');
  el.className = 'pill' + (active ? ' is-active' : '') + (opponent==null ? ' center' : '');
  el.textContent = label;
  el.addEventListener('click', ()=>{
    $$('.pill').forEach(p=>p.classList.remove('is-active'));
    el.classList.add('is-active');
    state.activeOpponent = opponent;
    renderVsList(opponent);
    $$('.node').forEach(n=>n.classList.remove('active'));
    if(opponent){
      const node = $$('.node').find(n=>n.dataset.opp === opponent);
      if(node) node.classList.add('active');
    }
  });
  return el;
}

function makeNode({x,y,name,meta,center=false,opponent=null}){
  const el = document.createElement('div');
  el.className = 'node' + (center ? ' center' : '');
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.innerHTML = `<div class="name">${name}</div><div class="meta">${meta||''}</div>`;
  if(opponent) el.dataset.opp = opponent;

  if(opponent){
    el.addEventListener('click', ()=>{
      state.activeOpponent = opponent;
      renderVsList(opponent);
      $$('.node').forEach(n=>n.classList.remove('active'));
      el.classList.add('active');
      $$('.pill').forEach(p=>{
        if(p.textContent === shortName(opponent)) p.classList.add('is-active');
        else if(p.textContent !== 'הכל') p.classList.remove('is-active');
      });
    });
  }
  return el;
}

function renderHub(){
  const hub = $('#hub');
  hub.innerHTML = '';

  // במפה אנחנו רוצים את כל הקבוצות בליגה (לא רק כאלה שכבר שיחקנו מולן)
  const opps = (state.opponents && state.opponents.length)
    ? state.opponents
    : uniqueOpponents();
  const w = hub.clientWidth || 700;
  const h = hub.clientHeight || 520;
  const cx = w/2, cy = h/2;
  const radius = Math.min(w,h) * 0.36;

  hub.appendChild(makeNode({
    x: cx,
    y: cy,
    name: getMyTeamDisplayName(),
    meta: 'הקבוצה שלנו',
    center: true
  }));

  const pills = $('#filterPills');
  pills.innerHTML = '';
  pills.appendChild(makePill('הכל', null, true));
  for(const o of opps) pills.appendChild(makePill(shortName(o), o, false));

  opps.forEach((name, i)=>{
    const angle = (Math.PI*2) * (i / opps.length);
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);

    const games = state.matches.filter(m => normName(opponentOf(m)) === normName(name));
    const played = games.filter(g=>g.hs!=null && g.as!=null).length;

    hub.appendChild(makeNode({
      x,y,name:shortName(name),
      meta: played ? `${played} משחקים עם תוצאה` : 'לחץ לצפייה',
      opponent:name
    }));
  });

  renderVsList(state.activeOpponent);
}

function renderVsList(opponent){
  const list = $('#vsList');
  const hint = $('#vsHint');

  const games = opponent
    ? state.matches.filter(m => normName(opponentOf(m)) === normName(opponent))
    : state.matches;

  hint.style.display = opponent ? 'none' : 'block';
  list.innerHTML = '';

  const sorted = [...games].sort((a,b)=>a.date.localeCompare(b.date));
  for(const m of sorted){
    const it = document.createElement('div');
    it.className = 'item';

    const cls = resultBadgeClass(m);
    it.innerHTML = `
      <div class="left">
        <div><strong>מחזור ${m.round}</strong> • ${fmtDate(m.date)} • ${fmtTime(m.time)}</div>
        <div class="tag">${matchTitle(m)}</div>
        <div class="tag">מגרש: ${m.venue || '—'}</div>
      </div>
      <div class="right"><span class="score-badge ${cls}">${scoreText(m)}</span></div>
    `;
    list.appendChild(it);
  }
}

function buildRoundSelect(){
  const sel = $('#roundSelect');
  const rounds = Array.from(new Set(state.matches.map(m=>m.round).filter(r=>typeof r==='number' && isFinite(r)))).sort((a,b)=>a-b);
  sel.innerHTML = `<option value="">כל המחזורים</option>` + rounds.map(r=>`<option value="${r}">מחזור ${r}</option>`).join('');
}

function renderMatches(){
  buildRoundSelect();
  const tbody = $('#matchesTable tbody');
  const q = ($('#search').value || '').trim().toLowerCase();
  const r = $('#roundSelect').value;

  const filtered = state.matches.filter(m=>{
    if(r && String(m.round) !== String(r)) return false;
    const hay = `${m.round} ${m.date} ${m.time} ${m.home} ${m.away} ${m.venue}`.toLowerCase();
    if(q && !hay.includes(q)) return false;
    return true;
  }).sort((a,b)=>a.date.localeCompare(b.date));

  tbody.innerHTML = '';
  for(const m of filtered){
    const tr = document.createElement('tr');
    const cls = resultBadgeClass(m);
    tr.innerHTML = `
      <td>${m.round}</td>
      <td>${fmtDate(m.date)}</td>
      <td>${fmtTime(m.time)}</td>
      <td><strong>${m.home}</strong> — <strong>${m.away}</strong></td>
      <td>${m.venue || '—'}</td>
      <td><span class="score-badge ${cls}">${scoreText(m)}</span></td>
    `;
    tbody.appendChild(tr);
  }
}

function computeTable(){
  const teams = new Map();
  function ensure(name){
    const key = normName(name);
    if(!teams.has(key)) teams.set(key, {name:key,p:0,w:0,d:0,l:0,gf:0,ga:0,pts:0});
    return teams.get(key);
  }

  for(const m of (state.allMatches && state.allMatches.length ? state.allMatches : state.matches)){
    if(m.hs==null || m.as==null) continue;
    const home = ensure(m.home);
    const away = ensure(m.away);

    home.p++; away.p++;
    home.gf += m.hs; home.ga += m.as;
    away.gf += m.as; away.ga += m.hs;

    if(m.hs > m.as){ home.w++; away.l++; home.pts += 3; }
    else if(m.hs < m.as){ away.w++; home.l++; away.pts += 3; }
    else { home.d++; away.d++; home.pts += 1; away.pts += 1; }
  }

  const arr = Array.from(teams.values()).map(t=>({...t, gd:t.gf - t.ga}));
  arr.sort((a,b)=>{
    if(b.pts!==a.pts) return b.pts-a.pts;
    if(b.gd!==a.gd) return b.gd-a.gd;
    return b.gf-a.gf;
  });
  return arr;
}

function renderTable(){
  const tbody = $('#leagueTable tbody');
  const rows = computeTable();
  tbody.innerHTML = '';
  rows.forEach((t, idx)=>{
    const isUs = isMyTeam(t.name);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx+1}</td>
      <td>${isUs ? '⭐ ' : ''}${t.name}</td>
      <td>${t.p}</td>
      <td>${t.w}</td>
      <td>${t.d}</td>
      <td>${t.l}</td>
      <td>${t.gf}-${t.ga}</td>
      <td>${t.gd}</td>
      <td><strong>${t.pts}</strong></td>
    `;
    tbody.appendChild(tr);
  });

  const src = document.getElementById('sourceStandings');
  if(src){
    src.innerHTML = '';
    (LEAGUE_DATA.standingsSource || []).forEach((t,i)=>{
    const it = document.createElement('div');
    it.className = 'item';
    it.innerHTML = `
      <div class="left">
        <div><strong>${i+1}. ${t.name}</strong></div>
        <div class="tag">נק׳: ${t.pts}</div>
      </div>
      <div class="right"><span class="score-badge">${t.pts}</span></div>
    `;
      src.appendChild(it);
    });
  }
}

function bindMatchControls(){
  $('#search').addEventListener('input', renderMatches);
  $('#roundSelect').addEventListener('change', renderMatches);
  $('#btnToday').addEventListener('click', ()=>{
    const now = new Date().toISOString().slice(0,10);
    const sorted = [...state.matches].sort((a,b)=>a.date.localeCompare(b.date));
    const next = sorted.find(m=>m.date >= now) || sorted[0];
    if(!next) return;
    $('[data-tab="matches"]').click();
    $('#search').value = next.date;
    renderMatches();
  });
}


async function boot(){
  LEAGUE_DATA = await loadLeagueData();
  applyScores();
  buildTabs();
  bindMatchControls();
  renderHub(); renderMatches(); renderTable();
}

window.addEventListener('resize', ()=>{
  if(state.activeTab==='hub') renderHub();
});

boot().catch(err=>{
  console.error(err);
  alert('שגיאה בטעינת הנתונים. בדוק שקיים data.json בריפו ושאין חסימת רשת.');
});
