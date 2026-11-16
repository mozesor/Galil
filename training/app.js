/* אימון אישי – אב-טיפוס. כל הנתונים נשמרים במכשיר בלבד (localStorage). */
(() => {
  'use strict';

  const STORE_KEY = 'imun.v1';
  const REST_SECONDS = 15;
  const DAY_NAMES = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

  const view = document.getElementById('view');
  const runEl = document.getElementById('run');
  const tabs = document.getElementById('tabs');

  let DATA = null;
  let drillById = {};
  let catById = {};
  let filter = { cat: 'all', level: 'all', q: '' };

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dayKey = (d = new Date()) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const mins = (sec) => Math.max(1, Math.round(sec / 60));
  const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const daysHe = (n) => (n === 1 ? 'יום אחד' : `${n} ימים`);
  const sumSeconds = (drills) => drills.reduce((a, d) => a + d.seconds, 0);

  // ---------- state ----------
  const blank = () => ({ favorites: [], history: [], activePlan: null, planDone: {} });
  let state = blank();
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    if (raw && typeof raw === 'object') state = Object.assign(blank(), raw);
  } catch (e) { /* storage unavailable or corrupt: start clean */ }
  const save = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  };

  const trainedDays = () => new Set(state.history.map((h) => h.date));
  function streak() {
    const days = trainedDays();
    const d = new Date();
    if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1); // today not done yet: streak still alive
    let n = 0;
    while (days.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  const totalMinutes = () => state.history.reduce((a, h) => a + h.minutes, 0);

  function nextSession() {
    const plan = DATA.plans.find((p) => p.id === state.activePlan);
    if (!plan) return null;
    const done = state.planDone[plan.id] || 0;
    const idx = done % plan.sessions.length;
    return { plan, idx, session: plan.sessions[idx], round: Math.floor(done / plan.sessions.length) + 1 };
  }
  const sessionDrills = (s) => s.drills.map((id) => drillById[id]).filter(Boolean);

  // ---------- small render pieces ----------
  function drillItem(d, n) {
    const cat = catById[d.cat];
    const fav = state.favorites.includes(d.id);
    return `<div class="item">
      ${n ? `<div class="num">${n}</div>` : `<div class="ico">${cat.icon}</div>`}
      <a class="grow" href="#/drill/${esc(d.id)}">
        <div class="t">${esc(d.title)}</div>
        <div><span class="tag">${esc(cat.name)}</span><span class="tag">${esc(DATA.levels[d.level])}</span><span class="tag">${clock(d.seconds)}</span></div>
      </a>
      <button class="fav ${fav ? 'on' : ''}" data-fav="${esc(d.id)}" aria-pressed="${fav}" aria-label="${fav ? 'הסרה מהאימון שלי' : 'הוספה לאימון שלי'}">${fav ? '★' : '☆'}</button>
    </div>`;
  }

  function videoHtml(d) {
    const v = (d.video || '').trim();
    const yt = v.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
    if (yt) {
      return `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0&playsinline=1" title="${esc(d.title)}" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
    }
    if (/^(https:\/\/|videos\/)[^\s"']+\.(mp4|webm|mov)$/i.test(v)) {
      return `<div class="video"><video src="${esc(v)}" controls loop muted playsinline preload="metadata"></video></div>`;
    }
    return `<div class="video"><div class="ph"><b>${catById[d.cat].icon}</b>סרטון ההדגמה יתווסף בקרוב</div></div>`;
  }

  function weekHtml() {
    const days = trainedDays();
    const today = new Date();
    let out = '';
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      out += `<div class="day ${days.has(dayKey(d)) ? 'on' : ''} ${i === 0 ? 'today' : ''}"><i></i>${DAY_NAMES[d.getDay()]}</div>`;
    }
    return `<div class="week" aria-label="שבעת הימים האחרונים">${out}</div>`;
  }

  // ---------- views ----------
  function viewHome() {
    const ns = nextSession();
    const favs = state.favorites.map((id) => drillById[id]).filter(Boolean);
    const s = streak();
    let hero;
    if (ns) {
      const drills = sessionDrills(ns.session);
      hero = `<div class="card hero">
        <div class="muted">${esc(ns.plan.title)} · אימון ${ns.idx + 1} מתוך ${ns.plan.sessions.length}${ns.round > 1 ? ` · סבב ${ns.round}` : ''}</div>
        <h3>${esc(ns.session.title)}</h3>
        <div class="muted">${drills.length} תרגילים · כ-${mins(sumSeconds(drills) + REST_SECONDS * (drills.length - 1))} דקות</div>
        <button class="btn block" data-start-plan>▶ התחל אימון</button>
      </div>`;
    } else {
      hero = `<div class="card hero">
        <h3>בוחרים תוכנית ומתחילים</h3>
        <p class="muted">תוכנית אימון נותנת לך אימון מוכן לכל יום, לפי הרמה שלך.</p>
        <a class="btn block" href="#/plans">בחירת תוכנית</a>
      </div>`;
    }
    return `<div class="head"><h1>שלום! 👋</h1><p>${s > 0 ? `רצף של ${daysHe(s)}. ממשיכים?` : 'אימון קצר היום שווה יותר מאימון ארוך מחר.'}</p></div>
      ${hero}
      <div class="stats">
        <div class="stat"><b>${s}</b><span>ימי רצף</span></div>
        <div class="stat"><b>${state.history.length}</b><span>אימונים</span></div>
        <div class="stat"><b>${totalMinutes()}</b><span>דקות</span></div>
      </div>
      ${weekHtml()}
      <h2>האימון שלי</h2>
      ${favs.length ? `<div class="card">
          <div class="spread"><div><b>${favs.length} תרגילים שסימנת</b><div class="muted">כ-${mins(sumSeconds(favs))} דקות</div></div>
          <button class="btn small" data-start-favs>▶ התחל</button></div>
        </div>${favs.map((d) => drillItem(d)).join('')}`
      : `<div class="card muted">סמנו תרגילים בכוכב ☆ כדי לבנות אימון משלכם.</div>`}`;
  }

  function viewDrills() {
    const q = filter.q.trim();
    const list = DATA.drills.filter((d) =>
      (filter.cat === 'all' || d.cat === filter.cat) &&
      (filter.level === 'all' || d.level === Number(filter.level)) &&
      (!q || d.title.includes(q) || catById[d.cat].name.includes(q)));
    const chip = (group, val, label) =>
      `<button class="chip ${String(filter[group]) === String(val) ? 'on' : ''}" data-filter="${group}" data-val="${esc(val)}" aria-pressed="${String(filter[group]) === String(val)}">${label}</button>`;
    return `<div class="head"><h1>תרגילים</h1><p>${DATA.drills.length} תרגילים בספרייה</p></div>
      <input class="search" type="search" placeholder="חיפוש תרגיל" aria-label="חיפוש תרגיל" value="${esc(filter.q)}">
      <div class="chips">${chip('cat', 'all', 'הכול')}${DATA.categories.map((c) => chip('cat', c.id, `${c.icon} ${esc(c.name)}`)).join('')}</div>
      <div class="chips">${chip('level', 'all', 'כל הרמות')}${DATA.levels.map((l, i) => chip('level', i, esc(l))).join('')}</div>
      <div id="list">${list.length ? list.map((d) => drillItem(d)).join('') : '<div class="empty">לא נמצאו תרגילים מתאימים.</div>'}</div>`;
  }

  function viewDrill(id) {
    const d = drillById[id];
    if (!d) return viewNotFound();
    const fav = state.favorites.includes(d.id);
    return `<a class="back" href="#/drills">→ חזרה לתרגילים</a>
      <div class="head"><h1>${esc(d.title)}</h1>
        <p><span class="tag">${esc(catById[d.cat].name)}</span><span class="tag">${esc(DATA.levels[d.level])}</span><span class="tag">${clock(d.seconds)}</span></p></div>
      ${videoHtml(d)}
      <div class="card"><h3>איך מבצעים</h3><ol class="steps">${d.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        <div class="muted">ציוד: ${esc(d.equipment)}</div></div>
      <button class="btn block" data-start-drill="${esc(d.id)}">▶ התחל תרגיל</button>
      <button class="btn ghost block" data-fav="${esc(d.id)}" aria-pressed="${fav}">${fav ? '★ באימון שלי' : '☆ הוספה לאימון שלי'}</button>`;
  }

  function viewPlans() {
    return `<div class="head"><h1>תוכניות אימון</h1><p>בחרו תוכנית לפי הרמה שלכם</p></div>
      ${DATA.plans.map((p) => {
        const active = state.activePlan === p.id;
        return `<a class="card" href="#/plan/${esc(p.id)}" style="display:block">
          <div class="spread"><h3>${esc(p.title)}</h3>${active ? '<span class="tag" style="color:var(--accent)">פעילה</span>' : ''}</div>
          <p class="muted">${esc(p.desc)}</p>
          <div style="margin-top:8px"><span class="tag">${esc(DATA.levels[p.level])}</span><span class="tag">${p.sessions.length} אימונים</span></div>
        </a>`;
      }).join('')}`;
  }

  function viewPlan(id) {
    const p = DATA.plans.find((x) => x.id === id);
    if (!p) return viewNotFound();
    const active = state.activePlan === p.id;
    const done = (state.planDone[p.id] || 0) % p.sessions.length;
    return `<a class="back" href="#/plans">→ חזרה לתוכניות</a>
      <div class="head"><h1>${esc(p.title)}</h1><p>${esc(p.desc)}</p></div>
      ${active ? '<a class="btn block" href="#/home">התוכנית פעילה · לאימון של היום</a>'
        : `<button class="btn block" data-activate="${esc(p.id)}">בחירה בתוכנית הזאת</button>`}
      ${p.sessions.map((s, i) => {
        const drills = sessionDrills(s);
        return `<h2><span class="num ${active && i < done ? 'done' : ''}" style="display:inline-grid;vertical-align:middle;margin-inline-end:6px">${active && i < done ? '✓' : i + 1}</span>${esc(s.title)}</h2>
          <div class="muted" style="margin-bottom:8px">${drills.length} תרגילים · כ-${mins(sumSeconds(drills))} דקות</div>
          ${drills.map((d, n) => drillItem(d, n + 1)).join('')}`;
      }).join('')}`;
  }

  function viewProgress() {
    const byCat = {};
    state.history.forEach((h) => (h.drills || []).forEach((id) => {
      const d = drillById[id];
      if (d) byCat[d.cat] = (byCat[d.cat] || 0) + d.seconds;
    }));
    const max = Math.max(1, ...Object.values(byCat));
    const recent = state.history.slice(-10).reverse();
    return `<div class="head"><h1>התקדמות</h1><p>כל הנתונים נשמרים במכשיר הזה בלבד</p></div>
      <div class="stats">
        <div class="stat"><b>${streak()}</b><span>ימי רצף</span></div>
        <div class="stat"><b>${state.history.length}</b><span>אימונים</span></div>
        <div class="stat"><b>${totalMinutes()}</b><span>דקות</span></div>
      </div>
      ${weekHtml()}
      <h2>זמן אימון לפי תחום</h2>
      <div class="card">${DATA.categories.map((c) => {
        const sec = byCat[c.id] || 0;
        return `<div class="bar"><div class="spread"><span>${c.icon} ${esc(c.name)}</span><span class="muted">${sec ? mins(sec) + ' דק׳' : '—'}</span></div>
          <div class="track"><div class="fill" style="width:${Math.round((sec / max) * 100)}%"></div></div></div>`;
      }).join('')}</div>
      <h2>אימונים אחרונים</h2>
      ${recent.length ? recent.map((h) => `<div class="item"><div class="ico">✅</div><div class="grow"><div class="t">${esc(h.title)}</div>
          <div class="muted">${esc(h.date.split('-').reverse().join('.'))} · ${h.minutes} דק׳ · ${(h.drills || []).length} תרגילים</div></div></div>`).join('')
        : '<div class="empty">עוד לא סיימתם אימון. האימון הראשון מחכה!</div>'}
      ${state.history.length || state.favorites.length || state.activePlan ? '<p style="text-align:center;margin-top:18px"><button class="link" data-reset>איפוס כל הנתונים</button></p>' : ''}`;
  }

  const viewNotFound = () => `<div class="empty">העמוד לא נמצא. <a class="link" href="#/home">חזרה לדף הבית</a></div>`;

  // ---------- router ----------
  function render(keepScroll) {
    const [, name = 'home', arg] = (location.hash || '#/home').split('/');
    const y = window.scrollY;
    const routes = {
      home: viewHome, drills: viewDrills, plans: viewPlans, progress: viewProgress,
      drill: () => viewDrill(decodeURIComponent(arg || '')),
      plan: () => viewPlan(decodeURIComponent(arg || '')),
    };
    view.innerHTML = (routes[name] || viewNotFound)();
    const tab = { drill: 'drills', plan: 'plans' }[name] || name;
    tabs.querySelectorAll('a').forEach((a) => {
      const on = a.dataset.tab === tab;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    window.scrollTo(0, keepScroll ? y : 0);
  }

  // ---------- events ----------
  view.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.fav) {
      const id = t.dataset.fav;
      const i = state.favorites.indexOf(id);
      if (i >= 0) state.favorites.splice(i, 1); else state.favorites.push(id);
      save(); render(true);
    } else if (t.dataset.filter) {
      filter[t.dataset.filter] = t.dataset.val;
      render(true);
    } else if (t.dataset.activate) {
      state.activePlan = t.dataset.activate;
      save(); location.hash = '#/home';
    } else if ('startPlan' in t.dataset) {
      const ns = nextSession();
      if (ns) startRun(`${ns.plan.title} · ${ns.session.title}`, sessionDrills(ns.session), ns.plan.id);
    } else if ('startFavs' in t.dataset) {
      startRun('האימון שלי', state.favorites.map((id) => drillById[id]).filter(Boolean));
    } else if (t.dataset.startDrill) {
      const d = drillById[t.dataset.startDrill];
      if (d) startRun(d.title, [d]);
    } else if ('reset' in t.dataset) {
      if (confirm('למחוק את כל ההיסטוריה, המועדפים והתוכנית הפעילה? אי אפשר לבטל את הפעולה.')) {
        state = blank(); save(); render();
      }
    }
  });
  view.addEventListener('input', (e) => {
    if (!e.target.classList.contains('search')) return;
    filter.q = e.target.value;
    const q = filter.q.trim();
    const list = DATA.drills.filter((d) =>
      (filter.cat === 'all' || d.cat === filter.cat) &&
      (filter.level === 'all' || d.level === Number(filter.level)) &&
      (!q || d.title.includes(q) || catById[d.cat].name.includes(q)));
    document.getElementById('list').innerHTML = list.length
      ? list.map((d) => drillItem(d)).join('') : '<div class="empty">לא נמצאו תרגילים מתאימים.</div>';
  });
  window.addEventListener('hashchange', () => render());

  // ---------- workout runner ----------
  let run = null;
  let ticker = null;
  let wakeLock = null;
  let audio = null;

  function beep(freq = 880, ms = 160) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.15, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + ms / 1000);
      o.connect(g).connect(audio.destination);
      o.start();
      o.stop(audio.currentTime + ms / 1000);
    } catch (e) { /* no audio available */ }
  }
  async function lockScreen(on) {
    try {
      if (on && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
      else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { /* not supported or denied */ }
  }

  function startRun(title, drills, planId) {
    if (!drills.length) return;
    run = { title, drills, planId: planId || null, i: 0, phase: 'work', left: drills[0].seconds * 1000, total: drills[0].seconds * 1000, last: Date.now(), paused: false, done: [], reps: 0 };
    runEl.hidden = false;
    document.body.style.overflow = 'hidden';
    lockScreen(true);
    drawRun();
    clearInterval(ticker);
    ticker = setInterval(tick, 200);
  }

  function setPhase(phase, ms) {
    run.phase = phase; run.left = ms; run.total = ms; run.last = Date.now();
  }

  function tick() {
    if (!run || run.finished) return;
    const now = Date.now();
    if (!run.paused) run.left -= now - run.last;
    run.last = now;
    if (run.left <= 0) advance(true);
    else updateClock();
  }

  // completed=true when the timer ran out, false when the player skipped
  function advance(completed) {
    if (run.phase === 'work') {
      if (completed) { run.done.push(run.drills[run.i].id); beep(880); }
      if (run.i >= run.drills.length - 1) return finishRun();
      setPhase('rest', REST_SECONDS * 1000);
    } else {
      run.i++; run.reps = 0;
      setPhase('work', run.drills[run.i].seconds * 1000);
      beep(1320);
    }
    drawRun();
  }

  function finishRun() {
    clearInterval(ticker);
    lockScreen(false);
    run.finished = true;
    const doneDrills = run.done.map((id) => drillById[id]);
    const minutes = doneDrills.length ? mins(sumSeconds(doneDrills)) : 0;
    const full = run.done.length === run.drills.length;
    if (doneDrills.length) {
      state.history.push({ date: dayKey(), title: run.title, minutes, drills: run.done.slice() });
      if (run.planId && full) state.planDone[run.planId] = (state.planDone[run.planId] || 0) + 1;
      save();
    }
    runEl.className = '';
    runEl.innerHTML = `<div class="wrap"><div class="done-box">
      <div class="big">${doneDrills.length ? '🏆' : '👟'}</div>
      <h2>${doneDrills.length ? 'כל הכבוד, האימון הושלם!' : 'האימון הופסק'}</h2>
      <p class="muted">${doneDrills.length ? `${doneDrills.length} מתוך ${run.drills.length} תרגילים · ${minutes} דקות · רצף של ${daysHe(streak())}` : 'לא הושלם אף תרגיל, אז האימון לא נשמר.'}</p>
      ${run.planId && doneDrills.length && !full ? '<p class="muted">דילגת על חלק מהתרגילים, אז האימון הזה יחכה לך שוב בתוכנית.</p>' : ''}
      <button class="btn block" data-run="close">סיום</button>
    </div></div>`;
  }

  function closeRun() {
    clearInterval(ticker);
    lockScreen(false);
    run = null;
    runEl.hidden = true;
    runEl.innerHTML = '';
    document.body.style.overflow = '';
    render();
  }

  function drawRun() {
    const d = run.drills[run.i];
    const rest = run.phase === 'rest';
    const next = run.drills[run.i + 1];
    runEl.className = rest ? 'rest' : '';
    const dots = run.drills.map((x, n) => `<i class="${run.done.includes(x.id) ? 'done' : n === run.i ? 'cur' : ''}"></i>`).join('');
    runEl.innerHTML = `<div class="wrap">
      <div class="top"><button class="x" data-run="quit" aria-label="יציאה מהאימון">✕</button>
        <div class="dots">${dots}</div><span class="muted">${run.i + 1}/${run.drills.length}</span></div>
      <div class="phase">${rest ? 'מנוחה · התרגיל הבא:' : esc(catById[d.cat].name)}</div>
      <h2>${esc(rest ? next.title : d.title)}</h2>
      ${videoHtml(rest ? next : d)}
      <div class="clock" id="clock" role="timer"></div>
      <div class="prog"><i id="prog"></i></div>
      ${rest ? `<div class="card"><ol class="steps">${next.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol><div class="muted">ציוד: ${esc(next.equipment)}</div></div>`
        : `<div class="reps"><button data-run="rep-" aria-label="הורדת חזרה">−</button><div><b id="reps">${run.reps}</b><div class="muted" style="text-align:center">חזרות</div></div><button data-run="rep+" aria-label="הוספת חזרה">+</button></div>
           <div class="card"><ol class="steps">${d.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>`}
      <div class="ctrl">
        <button class="btn ghost" data-run="skip">${rest ? 'דלג על מנוחה' : 'דלג'}</button>
        <button class="btn" data-run="pause" id="pauseBtn">${run.paused ? '▶ המשך' : '⏸ השהה'}</button>
        <button class="btn ghost" data-run="finish">סיים</button>
      </div></div>`;
    updateClock();
  }

  function updateClock() {
    const c = document.getElementById('clock');
    if (!c) return;
    c.textContent = clock(Math.max(0, Math.ceil(run.left / 1000)));
    document.getElementById('prog').style.width = `${Math.min(100, (1 - run.left / run.total) * 100)}%`;
  }

  runEl.addEventListener('click', (e) => {
    const t = e.target.closest('[data-run]');
    if (!t || !run) return;
    const a = t.dataset.run;
    if (a === 'close') closeRun();
    else if (a === 'quit') {
      if (!run.done.length || confirm('לצאת מהאימון? התרגילים שהושלמו יישמרו.')) finishRun();
    } else if (a === 'finish') finishRun();
    else if (a === 'skip') advance(false);
    else if (a === 'pause') {
      run.paused = !run.paused; run.last = Date.now();
      document.getElementById('pauseBtn').textContent = run.paused ? '▶ המשך' : '⏸ השהה';
    } else if (a === 'rep+' || a === 'rep-') {
      run.reps = Math.max(0, run.reps + (a === 'rep+' ? 1 : -1));
      document.getElementById('reps').textContent = run.reps;
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (run && !run.finished && document.visibilityState === 'visible') lockScreen(true);
  });

  // ---------- boot ----------
  fetch('data.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => {
      DATA = data;
      DATA.drills.forEach((d) => { drillById[d.id] = d; });
      DATA.categories.forEach((c) => { catById[c.id] = c; });
      state.favorites = state.favorites.filter((id) => drillById[id]);
      if (!DATA.plans.some((p) => p.id === state.activePlan)) state.activePlan = null;
      render();
    })
    .catch(() => {
      view.innerHTML = '<div class="empty">לא הצלחנו לטעון את התרגילים. בדקו את החיבור ורעננו את העמוד.<br>(בפתיחה מקומית צריך שרת, לא לחיצה כפולה על הקובץ.)</div>';
    });
})();
