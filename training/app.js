/* Five Ball by Adam – אב-טיפוס. כל הנתונים נשמרים במכשיר בלבד (localStorage). */
(() => {
  'use strict';

  // The app is Hebrew-only; force RTL even when the host page does not set it.
  document.documentElement.lang = 'he';
  document.documentElement.dir = 'rtl';

  const STORE_KEY = 'fiveball.v1';
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
  const blank = () => ({ favorites: [], history: [], activePlan: null, planDone: {}, assigned: [], name: '', coach: '' });
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

  // ---------- team workouts shared by link ----------
  // A workout travels inside the link itself (no server): #/w/<base64url of JSON {t, c, d}>
  function encodeWorkout(title, coach, ids) {
    const json = JSON.stringify({ t: title, c: coach, d: ids });
    return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeWorkout(code) {
    try {
      const b64 = String(code).replace(/-/g, '+').replace(/_/g, '/');
      const o = JSON.parse(decodeURIComponent(escape(atob(b64))));
      const ids = (Array.isArray(o.d) ? o.d : []).filter((id) => drillById[id]).slice(0, 30);
      if (!ids.length) return null;
      return { code, title: String(o.t || 'אימון מהמאמן').slice(0, 60), coach: String(o.c || '').slice(0, 40), ids };
    } catch (e) { return null; }
  }
  const workoutLink = (code) => `${location.origin}${location.pathname}#/w/${code}`;
  const waLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
  let shareDraft = null;

  const SVG = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ICONS = {
    mastery: '<circle cx="12" cy="12" r="9"/><path d="M12 8l3.8 2.8-1.5 4.4H9.7l-1.5-4.4z"/>',
    touch: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    dribble: '<path d="M4 19c5 0 3-7 8-7s3-7 8-7"/>',
    pass: '<path d="M5 19L19 5M10 5h9v9"/>',
    shoot: '<path d="M3 19V6h18v13M3 11h18M9 6v13M15 6v13"/>',
    fit: '<path d="M13 3L5 14h6l-1 7 9-12h-6z"/>',
    coach: '<rect x="4" y="4" width="16" height="16"/><path d="M12 4v16M7.5 8.5l2 2m0-2l-2 2"/><circle cx="16" cy="15" r="1.6"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  };
  const icon = (id) => SVG(ICONS[id] || ICONS.mastery);
  const TICKER = '<span>FIVE BALL<i></i>מתאמנים<i></i>משתפרים<i></i>מנצחים<i></i>BY ADAM<i></i>כל יום<i></i></span>';

  // ---------- small render pieces ----------
  function drillItem(d, n) {
    const cat = catById[d.cat];
    const fav = state.favorites.includes(d.id);
    return `<div class="item">
      ${n ? `<div class="num">${n}</div>` : `<div class="ico">${icon(d.cat)}</div>`}
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
    const img = catById[d.cat].image;
    return `<div class="video"><div class="ph"${img ? ` style="background-image:url('${esc(img)}')"` : ''}><span>סרטון ההדגמה יתווסף בקרוב</span></div></div>`;
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
      hero = `<div class="card hero photo"><span class="five" aria-hidden="true">5</span>
        <div class="muted">${esc(ns.plan.title)} · אימון ${ns.idx + 1} מתוך ${ns.plan.sessions.length}${ns.round > 1 ? ` · סבב ${ns.round}` : ''}</div>
        <h3>${esc(ns.session.title)}</h3>
        <div class="muted">${drills.length} תרגילים · כ-${mins(sumSeconds(drills) + REST_SECONDS * (drills.length - 1))} דקות</div>
        <button class="btn block" data-start-plan>התחל אימון</button>
      </div>`;
    } else {
      hero = `<div class="card hero photo"><span class="five" aria-hidden="true">5</span>
        <h3>בוחרים תוכנית ומתחילים</h3>
        <p class="muted">תוכנית אימון נותנת לך אימון מוכן לכל יום, לפי הרמה שלך.</p>
        <a class="btn block" href="#/plans">בחירת תוכנית</a>
      </div>`;
    }
    return `<div class="brand"><img src="img/logo.jpg" alt="" width="52" height="52"><div class="name">FIVE <span>BALL</span><small>BY ADAM</small></div></div>
      <div class="head"><h1>מתאמנים עם אדם</h1><p>${s > 0 ? `רצף של ${daysHe(s)}. ממשיכים?` : 'אימון קצר היום שווה יותר מאימון ארוך מחר.'}</p></div>
      ${hero}
      <div class="ticker" aria-hidden="true"><div>${TICKER}${TICKER}</div></div>
      <div class="stats">
        <div class="stat"><b>${s}</b><span>ימי רצף</span></div>
        <div class="stat"><b>${state.history.length}</b><span>אימונים</span></div>
        <div class="stat"><b>${totalMinutes()}</b><span>דקות</span></div>
      </div>
      ${weekHtml()}
      ${assignedHtml()}
      <h2>האימון שלי</h2>
      ${favs.length ? `<div class="card">
          <div class="spread"><div><b>${favs.length} תרגילים שסימנת</b><div class="muted">כ-${mins(sumSeconds(favs))} דקות</div></div>
          <button class="btn small" data-start-favs>התחל</button></div>
          <a class="btn ghost block" href="#/share">מאמן? שליחת האימון לקבוצה</a>
        </div>${favs.map((d) => drillItem(d)).join('')}`
      : `<div class="card muted">סמנו תרגילים בכוכב ☆ כדי לבנות אימון משלכם.</div>`}`;
  }

  function assignedHtml() {
    const open = state.assigned.map((a) => ({ a, w: decodeWorkout(a.code) })).filter((x) => x.w && !x.a.done);
    if (!open.length) return '';
    return `<h2>מהמאמן</h2>${open.map(({ w }) => `<a class="item" href="#/w/${esc(w.code)}">
      <div class="ico">${icon('coach')}</div><div class="grow"><div class="t">${esc(w.title)}</div>
      <div class="muted">${w.coach ? esc(w.coach) + ' · ' : ''}${w.ids.length} תרגילים · מחכה לביצוע</div></div></a>`).join('')}`;
  }

  function viewShare() {
    const favs = state.favorites.map((id) => drillById[id]).filter(Boolean);
    if (!favs.length) {
      return `<a class="back" href="#/home">→ חזרה</a><div class="head"><h1>שליחת אימון לקבוצה</h1></div>
        <div class="card muted">קודם סמנו בכוכב ☆ את התרגילים שרוצים לשלוח, בעמוד התרגילים.</div>
        <a class="btn block" href="#/drills">לבחירת תרגילים</a>`;
    }
    let result = '';
    if (shareDraft) {
      const url = workoutLink(encodeWorkout(shareDraft.title, shareDraft.coach, favs.map((d) => d.id)));
      const text = `⚽ ${shareDraft.title}${shareDraft.coach ? ` (${shareDraft.coach})` : ''}\n${favs.length} תרגילים, כ-${mins(sumSeconds(favs))} דקות. לוחצים, מתאמנים ומדווחים כשמסיימים:\n${url}`;
      result = `<div class="card hero"><h3>הקישור מוכן</h3>
        <p class="muted">כל שחקן שיפתח אותו יקבל את האימון הזה. אין צורך בהרשמה.</p>
        <a class="btn block" id="waShare" href="${esc(waLink(text))}" target="_blank" rel="noopener">שליחה בוואטסאפ</a>
        <button class="btn ghost block" data-copy="${esc(url)}">העתקת הקישור</button></div>`;
    }
    return `<a class="back" href="#/home">→ חזרה</a>
      <div class="head"><h1>שליחת אימון לקבוצה</h1><p>התרגילים שסימנת בכוכב יישלחו כאימון אחד</p></div>
      <label class="muted" for="wTitle">שם האימון</label>
      <input class="search" id="wTitle" maxlength="60" value="${esc(shareDraft ? shareDraft.title : 'שיעורי בית לשבוע')}">
      <label class="muted" for="wCoach">שם המאמן או הקבוצה</label>
      <input class="search" id="wCoach" maxlength="40" value="${esc(shareDraft ? shareDraft.coach : state.coach)}" placeholder="לדוגמה: המאמן דני · ילדים ב׳">
      <button class="btn ${shareDraft ? 'ghost ' : ''}block" data-make-link>${shareDraft ? 'עדכון הקישור' : 'יצירת קישור'}</button>
      ${result}
      <h2>${favs.length} תרגילים · כ-${mins(sumSeconds(favs))} דקות</h2>
      ${favs.map((d, n) => drillItem(d, n + 1)).join('')}`;
  }

  function viewAssigned(code) {
    const w = decodeWorkout(code);
    if (!w) return `<div class="empty">הקישור לאימון לא תקין או שהתרגילים שבו כבר לא קיימים.<br><a class="link" href="#/home">לדף הבית</a></div>`;
    let rec = state.assigned.find((a) => a.code === code);
    if (!rec) { rec = { code, done: false }; state.assigned.push(rec); save(); }
    const drills = w.ids.map((id) => drillById[id]);
    return `<a class="back" href="#/home">→ לדף הבית</a>
      <div class="head"><h1>${esc(w.title)}</h1><p>${w.coach ? 'נשלח על ידי ' + esc(w.coach) + ' · ' : ''}${drills.length} תרגילים · כ-${mins(sumSeconds(drills) + REST_SECONDS * (drills.length - 1))} דקות</p></div>
      ${rec.done ? '<div class="card" style="border-color:var(--accent)">כבר ביצעת את האימון הזה. אפשר לבצע שוב.</div>' : ''}
      <button class="btn block" data-start-w="${esc(code)}">התחל אימון</button>
      <h2>התרגילים</h2>
      ${drills.map((d, n) => drillItem(d, n + 1)).join('')}`;
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
      <div class="chips">${chip('cat', 'all', 'הכול')}${DATA.categories.map((c) => chip('cat', c.id, esc(c.name))).join('')}</div>
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
      <button class="btn block" data-start-drill="${esc(d.id)}">התחל תרגיל</button>
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
        return `<div class="bar"><div class="spread"><span>${esc(c.name)}</span><span class="muted">${sec ? mins(sec) + ' דק׳' : '—'}</span></div>
          <div class="track"><div class="fill" style="width:${Math.round((sec / max) * 100)}%"></div></div></div>`;
      }).join('')}</div>
      <h2>אימונים אחרונים</h2>
      ${recent.length ? recent.map((h) => `<div class="item"><div class="ico">${icon('check')}</div><div class="grow"><div class="t">${esc(h.title)}</div>
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
      share: viewShare,
      w: () => viewAssigned(arg || ''),
    };
    if (name !== 'share') shareDraft = null;
    view.innerHTML = (routes[name] || viewNotFound)();
    const tab = { drill: 'drills', plan: 'plans', share: 'home', w: 'home' }[name] || name;
    tabs.querySelectorAll('a').forEach((a) => {
      const on = a.dataset.tab === tab;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    window.scrollTo(0, keepScroll ? y : 0);
    if (!keepScroll) { view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter'); }
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
    } else if (t.dataset.startW) {
      const w = decodeWorkout(t.dataset.startW);
      if (w) startRun(w.title, w.ids.map((id) => drillById[id]), null, w);
    } else if ('makeLink' in t.dataset) {
      const title = document.getElementById('wTitle').value.trim() || 'אימון מהמאמן';
      const coach = document.getElementById('wCoach').value.trim();
      state.coach = coach; save();
      shareDraft = { title, coach };
      render(true);
    } else if (t.dataset.copy) {
      const done = () => { t.textContent = 'הקישור הועתק ✓'; };
      if (navigator.clipboard) navigator.clipboard.writeText(t.dataset.copy).then(done, () => prompt('העתיקו את הקישור:', t.dataset.copy));
      else prompt('העתיקו את הקישור:', t.dataset.copy);
    } else if ('reset' in t.dataset) {
      if (confirm('למחוק את כל ההיסטוריה, המועדפים והתוכנית הפעילה? אי אפשר לבטל את הפעולה.')) {
        state = blank(); save(); render();
      }
    }
  });
  view.addEventListener('input', (e) => {
    if (e.target.type !== 'search') return;
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

  function startRun(title, drills, planId, assigned) {
    if (!drills.length) return;
    run = { title, drills, planId: planId || null, assigned: assigned || null, i: 0, phase: 'work', left: drills[0].seconds * 1000, total: drills[0].seconds * 1000, last: Date.now(), paused: false, done: [], reps: 0 };
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
      if (run.assigned && full) {
        const rec = state.assigned.find((a) => a.code === run.assigned.code);
        if (rec) rec.done = true;
      }
      save();
    }
    run.minutes = minutes;
    const report = run.assigned && doneDrills.length
      ? `<div class="card" style="text-align:start;margin-top:16px"><label class="muted" for="pName">השם שלך (כדי שהמאמן ידע מי סיים)</label>
          <input class="search" id="pName" maxlength="30" value="${esc(state.name)}" placeholder="שם ושם משפחה">
          <a class="btn block" id="waReport" href="${esc(reportLink())}" target="_blank" rel="noopener">דיווח למאמן בוואטסאפ</a></div>` : '';
    runEl.className = '';
    let burst = '';
    if (doneDrills.length) {
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * Math.PI * 2 + Math.random() * 0.4;
        const r = 110 + Math.random() * 150;
        burst += `<i style="--x:${Math.round(Math.cos(a) * r)}px;--y:${Math.round(Math.sin(a) * r)}px;--r:${Math.round(Math.random() * 540 - 270)}deg"></i>`;
      }
    }
    runEl.innerHTML = `<div class="wrap"><div class="done-box">
      ${burst ? `<div class="burst" aria-hidden="true">${burst}</div>` : ''}
      ${doneDrills.length ? '<div class="medal"><img src="img/thumbs.jpg" alt=""></div>' : '<div class="big">0</div>'}
      <h2>${doneDrills.length ? 'כל הכבוד, האימון הושלם!' : 'האימון הופסק'}</h2>
      <p class="muted">${doneDrills.length ? `${doneDrills.length} מתוך ${run.drills.length} תרגילים · ${minutes} דקות · רצף של ${daysHe(streak())}` : 'לא הושלם אף תרגיל, אז האימון לא נשמר.'}</p>
      ${run.planId && doneDrills.length && !full ? '<p class="muted">דילגת על חלק מהתרגילים, אז האימון הזה יחכה לך שוב בתוכנית.</p>' : ''}
      ${report}
      <button class="btn ${report ? 'ghost ' : ''}block" data-run="close">סיום</button>
    </div></div>`;
  }

  function reportLink() {
    const n = run.done.length;
    const who = state.name.trim() || 'שחקן';
    return waLink(`✅ ${who}: סיימתי את "${run.assigned.title}" – ${n} מתוך ${run.drills.length} תרגילים, ${run.minutes} דקות. רצף של ${daysHe(streak())}.`);
  }
  runEl.addEventListener('input', (e) => {
    if (e.target.id !== 'pName' || !run) return;
    state.name = e.target.value.slice(0, 30); save();
    document.getElementById('waReport').href = reportLink();
  });

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
      <div class="dial"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="56"/><circle id="ring" cx="60" cy="60" r="56" pathLength="100"/></svg>
        <div class="clock" id="clock" role="timer"></div></div>
      ${rest ? `<div class="card"><ol class="steps">${next.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol><div class="muted">ציוד: ${esc(next.equipment)}</div></div>`
        : `<div class="reps"><button data-run="rep-" aria-label="הורדת חזרה">−</button><div><b id="reps">${run.reps}</b><div class="muted" style="text-align:center">חזרות</div></div><button data-run="rep+" aria-label="הוספת חזרה">+</button></div>
           <div class="card"><ol class="steps">${d.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>`}
      <div class="ctrl">
        <button class="btn ghost" data-run="skip">${rest ? 'דלג על מנוחה' : 'דלג'}</button>
        <button class="btn" data-run="pause" id="pauseBtn">${run.paused ? 'המשך' : 'השהה'}</button>
        <button class="btn ghost" data-run="finish">סיים</button>
      </div></div>`;
    updateClock();
  }

  function updateClock() {
    const c = document.getElementById('clock');
    if (!c) return;
    c.textContent = clock(Math.max(0, Math.ceil(run.left / 1000)));
    const frac = Math.min(1, Math.max(0, run.left / run.total));
    document.getElementById('ring').style.strokeDashoffset = String(100 - frac * 100);
    runEl.classList.toggle('hot', run.phase === 'work' && run.left <= 5000);
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
      document.getElementById('pauseBtn').textContent = run.paused ? 'המשך' : 'השהה';
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
