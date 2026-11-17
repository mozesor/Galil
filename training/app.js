/* Five Ball by Adam – אב-טיפוס לפי מסמך האפיון: ספריית סרטונים בחמש קטגוריות, חיפוש, מועדפים, מעקב צפייה ואזור אישי.
   אין שרת: הפרופיל וההתקדמות נשמרים במכשיר בלבד (localStorage). */
(() => {
  'use strict';

  // The app is Hebrew-only; force RTL even when the host page does not set it.
  document.documentElement.lang = 'he';
  document.documentElement.dir = 'rtl';

  const STORE_KEY = 'fiveball.v2';
  const view = document.getElementById('view');
  const runEl = document.getElementById('run');
  const tabs = document.getElementById('tabs');
  // Second visual direction (b.html): lighter look where the coach speaks to the player in first person.
  const SKIN_B = document.documentElement.dataset.skin === 'b';
  const say = (html) => (SKIN_B ? `<div class="msg"><img src="img/avatar.jpg" alt="" width="48" height="48"><div class="bubble"><small>אדם</small><p>${html}</p></div></div>` : '');

  let DATA = null;
  const videoById = {};
  const catById = {};
  const seriesById = {};
  let search = { q: '', cat: 'all' };
  let levelFilter = 'all';

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dayKey = (d = new Date()) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  const daysHe = (n) => (n === 1 ? 'יום אחד' : `${n} ימים`);
  const videosHe = (n) => (n === 1 ? 'סרטון אחד' : `${n} סרטונים`);

  const SVG = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ICONS = {
    technique: '<circle cx="12" cy="12" r="9"/><path d="M12 8l3.8 2.8-1.5 4.4H9.7l-1.5-4.4z"/>',
    mentality: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    nutrition: '<path d="M12 21c-4 0-7-3-7-7 0-3 2-6 5-6 1 0 1.5.5 2 .5s1-.5 2-.5c3 0 5 3 5 6 0 4-3 7-7 7zM12 8c0-2 1-4 3-5"/>',
    tips: '<path d="M4 5h16v11H9l-5 4z"/>',
    prep: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
  };
  const icon = (id) => SVG(ICONS[id] || ICONS.technique);
  const CALM = Boolean(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const TICKER = '<span>FIVE BALL<i></i>לומדים<i></i>יוצאים למגרש<i></i>מיישמים<i></i>BY ADAM<i></i>כל יום<i></i></span>';

  // ---------- state ----------
  const blank = () => ({ profile: null, skipped: false, favorites: [], watched: {}, positions: {}, last: null, practice: {} });
  let state = blank();
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    if (raw && typeof raw === 'object') state = Object.assign(blank(), raw);
  } catch (e) { /* storage unavailable or corrupt: start clean */ }
  const save = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  };

  const isWatched = (id) => Boolean(state.watched[id]);
  const inCat = (cat) => DATA.videos.filter((v) => v.cat === cat);
  const inSeries = (sid) => DATA.videos.filter((v) => v.series === sid);
  const watchedIn = (list) => list.filter((v) => isWatched(v.id)).length;
  const pct = (list) => (list.length ? Math.round((watchedIn(list) / list.length) * 100) : 0);
  function markWatched(id) {
    if (!isWatched(id)) state.watched[id] = dayKey();
    delete state.positions[id];
    if (state.last === id) state.last = null;
    save();
  }
  function activeDays() {
    return new Set([...Object.values(state.watched), ...Object.keys(state.practice)]);
  }
  function streak() {
    const days = activeDays();
    const d = new Date();
    if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function nextInSeries(v) {
    const list = v.series ? inSeries(v.series) : inCat(v.cat);
    return list[list.findIndex((x) => x.id === v.id) + 1] || null;
  }
  function recommended() {
    const lvl = state.profile ? state.profile.level : null;
    const fresh = DATA.videos.filter((v) => !isWatched(v.id));
    const score = (v) => (v.cat === 'technique' && lvl !== null && v.level === lvl ? 0 : 1);
    const picks = [];
    const seen = new Set();
    // one per series / category first, so the row shows variety
    fresh.slice().sort((a, b) => score(a) - score(b)).forEach((v) => {
      const key = v.series || v.cat;
      if (!seen.has(key) && picks.length < 8) { seen.add(key); picks.push(v); }
    });
    return picks;
  }

  // ---------- render pieces ----------
  const metaTags = (v) => {
    const t = [];
    if (v.series) t.push(seriesById[v.series].name); else t.push(catById[v.cat].name);
    if (v.level !== undefined) t.push(DATA.levels[v.level]);
    t.push(clock(v.seconds));
    return t.map((x) => `<span class="tag">${esc(x)}</span>`).join('');
  };
  function videoRow(v, n) {
    const fav = state.favorites.includes(v.id);
    const done = isWatched(v.id);
    const lead = n
      ? `<div class="num ${done ? 'done' : ''}">${done ? '✓' : n}</div>`
      : `<div class="ico ${done ? 'done' : ''}">${done ? icon('check') : icon(v.cat)}</div>`;
    return `<div class="item">
      ${lead}
      <a class="grow" href="#/video/${esc(v.id)}"><div class="t">${esc(v.title)}</div><div>${metaTags(v)}</div></a>
      <button class="fav ${fav ? 'on' : ''}" data-fav="${esc(v.id)}" aria-pressed="${fav}" aria-label="${fav ? 'הסרה מהמועדפים' : 'הוספה למועדפים'}">${fav ? '★' : '☆'}</button>
    </div>`;
  }
  const thumb = (v) => (v.series && seriesById[v.series].image) || catById[v.cat].image;
  function videoCard(v) {
    return `<a class="vcard" href="#/video/${esc(v.id)}">
      <div class="thumb" style="--img:url('${esc(thumb(v))}')"><span>${clock(v.seconds)}</span></div>
      <div class="t">${esc(v.title)}</div><div class="muted">${esc(v.series ? seriesById[v.series].name : catById[v.cat].name)}</div></a>`;
  }
  function tile(c, wide) {
    const list = inCat(c.id);
    return `<a class="tile ${wide ? 'wide' : ''}" href="#/cat/${esc(c.id)}" style="--img:url('${esc(c.image)}');--p:${pct(list)}%">
      ${wide && !CALM ? '<video class="autovid" src="videos/tile-technique.mp4" poster="img/tile-technique.jpg" loop muted playsinline preload="auto" aria-hidden="true" tabindex="-1"></video>' : ''}
      <b>${esc(c.name)}</b><span>${esc(c.blurb)}</span><small>${watchedIn(list)} / ${list.length} נצפו</small></a>`;
  }
  function player(v) {
    const src = (v.video || '').trim();
    const yt = src.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
    if (yt) {
      return `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0&playsinline=1" title="${esc(v.title)}" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
    }
    if (/^(https:\/\/|videos\/)[^\s"']+\.(mp4|webm|mov)$/i.test(src)) {
      return `<div class="video"><video id="player" data-id="${esc(v.id)}" src="${esc(src)}" controls playsinline preload="metadata"></video></div>`;
    }
    return `<div class="video"><div class="ph" style="background-image:url('${esc(thumb(v))}')"><span>הסרטון יעלה בקרוב</span></div></div>`;
  }
  const head = (title, sub, back) => `${back ? `<a class="back" href="${back[0]}">→ ${esc(back[1])}</a>` : ''}
    <div class="head"><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div>`;
  const progressBar = (label, list) => `<div class="bar"><div class="spread"><span>${esc(label)}</span><span class="muted">${watchedIn(list)} / ${list.length}</span></div>
    <div class="track"><div class="fill" style="width:${pct(list)}%"></div></div></div>`;

  // ---------- views ----------
  function viewWelcome() {
    const p = state.profile || { name: '', age: '', level: 0, position: '' };
    const opts = (group, values, cur) => values.map(([val, label]) =>
      `<button type="button" class="chip ${String(cur) === String(val) ? 'on' : ''}" data-opt="${group}" data-val="${esc(val)}" aria-pressed="${String(cur) === String(val)}">${esc(label)}</button>`).join('');
    return `<div class="brand"><img src="img/logo.jpg" alt="" width="46" height="46"><div class="name">FIVE <span>BALL</span><small>BY ADAM</small></div></div>
      ${head(state.profile ? 'הפרופיל שלי' : 'בוא נכיר', 'כמה פרטים כדי להתאים לך סרטונים. אפשר לשנות בכל רגע.')}
      <form id="profileForm" autocomplete="off">
        <label class="muted" for="pfName">שם</label>
        <input class="search" id="pfName" maxlength="30" value="${esc(p.name)}" placeholder="איך קוראים לך?">
        <label class="muted">גיל</label>
        <div class="opts" data-group="age">${opts('age', [['8-10', '8–10'], ['11-13', '11–13'], ['14-16', '14–16'], ['17+', '17 ומעלה']], p.age)}</div>
        <label class="muted">רמה</label>
        <div class="opts" data-group="level">${opts('level', DATA.levels.map((l, i) => [i, l]), p.level)}</div>
        <label class="muted">עמדה</label>
        <div class="opts" data-group="position">${opts('position', [['שוער', 'שוער'], ['הגנה', 'הגנה'], ['קישור', 'קישור'], ['התקפה', 'התקפה']], p.position)}</div>
        <button class="btn block" type="submit">${state.profile ? 'שמירה' : 'מתחילים'}</button>
      </form>
      ${state.profile ? '' : '<p style="text-align:center"><button class="link" data-skip>דילוג בינתיים</button></p>'}
      <p class="muted" style="text-align:center;margin-top:14px">באב-טיפוס הפרופיל נשמר במכשיר הזה בלבד. הרשמה והתחברות מלאות יגיעו עם האפליקציה.</p>`;
  }

  function viewHomeB() {
    const name = state.profile && state.profile.name;
    const last = state.last && videoById[state.last] && !isWatched(state.last) ? videoById[state.last] : null;
    const feat = last || recommended()[0] || DATA.videos[0];
    const s = streak();
    const hi = name ? `היי ${esc(name)}, ` : '';
    const t = `<b>${esc(feat.title)}</b>`;
    const msg = last ? `${hi}עצרת באמצע ${t}. בוא נסגור אותו היום, אני איתך.`
      : s >= 2 ? `${hi}${daysHe(s)} ברצף. ככה בונים שחקן. היום ממשיכים עם ${t}.`
        : Object.keys(state.watched).length ? `${hi}טוב לראות אותך שוב. היום עובדים על ${t}, ${clock(feat.seconds)} בלבד.`
          : `${hi}טוב שבאת. מתחילים בקטן: ${t}, ${clock(feat.seconds)} בלבד, ואני איתך בכל שלב.`;
    const fav = state.favorites.includes(feat.id);
    const rec = recommended().filter((v) => v.id !== feat.id);
    const rows = DATA.categories.map((c) => {
      const list = inCat(c.id);
      return `<a class="row" href="#/cat/${esc(c.id)}"><img src="${esc(c.image)}" alt="" width="46" height="46"><div class="grow"><b>${esc(c.name)}</b><small>${esc(c.blurb)}</small></div><span class="ring" style="--p:${pct(list)}%"><i>${watchedIn(list)}</i></span></a>`;
    }).join('');
    return `<div class="topbar"><div class="wordmark">FIVE <i>BALL</i></div><div class="streakline">${s > 0 ? `רצף <b>${daysHe(s)}</b>` : 'by Adam'}</div></div>
      ${say(msg)}
      <div class="today">
        <a class="ph" href="#/video/${esc(feat.id)}"><img src="${esc(thumb(feat))}" alt=""><span>${esc(feat.series ? seriesById[feat.series].name : catById[feat.cat].name)}${feat.level !== undefined ? ' · ' + esc(DATA.levels[feat.level]) : ''}</span><em>${clock(feat.seconds)}</em></a>
        <h2>${esc(feat.title)}</h2>
        <p>${last ? 'ממשיכים מאיפה שעצרת' : 'הסרטון הבא שלך'}</p>
        <div class="cta"><a class="btn" href="#/video/${esc(feat.id)}">${last ? 'המשך צפייה' : 'מתחילים'}</a>
          <button class="btn sec" data-fav="${esc(feat.id)}" aria-pressed="${fav}" aria-label="${fav ? 'הסרה מהמועדפים' : 'הוספה למועדפים'}">${fav ? '★' : '☆'}</button></div>
      </div>
      <h2>ללמוד עם אדם</h2>
      <div class="rows">${rows}</div>
      ${rec.length ? `<h2>מומלצים בשבילך</h2><div class="hscroll">${rec.map(videoCard).join('')}</div>` : ''}`;
  }

  function viewHome() {
    if (SKIN_B) return viewHomeB();
    const name = state.profile && state.profile.name;
    const last = state.last && videoById[state.last] && !isWatched(state.last) ? videoById[state.last] : null;
    const feat = last || recommended()[0] || DATA.videos[0];
    const s = streak();
    const [tech, ...rest] = DATA.categories;
    const rec = recommended().filter((v) => v.id !== feat.id);
    return `<div class="brand"><img src="img/logo.jpg" alt="" width="46" height="46"><div class="name">FIVE <span>BALL</span><small>BY ADAM</small></div></div>
      <div class="head"><h1>${name ? `היי ${esc(name)}` : 'מתאמנים עם אדם'}</h1><p>${s > 0 ? `רצף של ${daysHe(s)}. ממשיכים?` : 'מוצאים תרגיל, לומדים אותו, יוצאים למגרש.'}</p></div>
      <div class="card hero photo"><span class="five" aria-hidden="true">5</span>
        <div class="muted">${last ? 'המשך צפייה' : 'מומלץ להתחיל כאן'} · ${esc(feat.series ? seriesById[feat.series].name : catById[feat.cat].name)}</div>
        <h3>${esc(feat.title)}</h3>
        <a class="btn block" href="#/video/${esc(feat.id)}">${last ? 'המשך צפייה' : 'צפייה בסרטון'}</a>
      </div>
      <div class="ticker" aria-hidden="true"><div>${TICKER}${TICKER}</div></div>
      <h2>קטגוריות</h2>
      <div class="tiles">${tile(tech, true)}${rest.map((c) => tile(c)).join('')}</div>
      <h2>הצצה לאפליקציה</h2>
      <div class="video tall"><video src="videos/promo.mp4" poster="img/promo-poster.jpg" controls playsinline preload="none" aria-label="סרטון היכרות עם Five Ball, 20 שניות, ללא קול"></video></div>
      ${rec.length ? `<h2>מומלצים בשבילך</h2><div class="hscroll">${rec.map(videoCard).join('')}</div>` : ''}`;
  }

  function viewCat(id) {
    const c = catById[id];
    if (!c) return viewNotFound();
    const list = inCat(id);
    const note = c.note ? `<div class="card muted">${esc(c.note)}</div>` : '';
    if (id !== 'technique') {
      return `${head(c.name, `${esc(c.blurb)} · ${videosHe(list.length)}`, ['#/home', 'דף הבית'])}${note}
        ${list.map((v, n) => videoRow(v, n + 1)).join('')}`;
    }
    const chip = (val, label) => `<button class="chip ${String(levelFilter) === String(val) ? 'on' : ''}" data-level="${val}" aria-pressed="${String(levelFilter) === String(val)}">${esc(label)}</button>`;
    const series = DATA.series.filter((s) => s.cat === id).map((s) => {
      const all = inSeries(s.id);
      const shown = levelFilter === 'all' ? all : all.filter((v) => v.level === Number(levelFilter));
      if (!shown.length) return '';
      return `<a class="item series" href="#/series/${esc(s.id)}" style="--p:${pct(all)}%">
        <div class="ico">${icon('technique')}</div>
        <div class="grow"><div class="t">${esc(s.name)}</div><div><span class="tag">${videosHe(shown.length)}</span><span class="tag">${watchedIn(all)} נצפו</span></div></div>
        <span class="chev" aria-hidden="true">‹</span></a>`;
    }).join('');
    return `${head(c.name, `${esc(c.blurb)} · ${videosHe(list.length)}`)}
      ${say('תתחיל משליטה בכדור. כל השאר נבנה עליה.')}
      <div class="chips">${chip('all', 'כל הרמות')}${DATA.levels.map((l, i) => chip(i, l)).join('')}</div>
      ${series || '<div class="empty">אין עדיין סדרות ברמה הזאת.</div>'}`;
  }

  function viewSeries(id) {
    const s = seriesById[id];
    if (!s) return viewNotFound();
    const list = inSeries(id);
    return `${head(s.name, `${videosHe(list.length)} · ${watchedIn(list)} נצפו`, ['#/cat/technique', 'טכניקה אישית'])}
      ${list.map((v, n) => videoRow(v, n + 1)).join('')}`;
  }

  function viewVideo(id) {
    const v = videoById[id];
    if (!v) return viewNotFound();
    const fav = state.favorites.includes(v.id);
    const done = isWatched(v.id);
    const next = nextInSeries(v);
    const back = v.series ? [`#/series/${v.series}`, seriesById[v.series].name] : [`#/cat/${v.cat}`, catById[v.cat].name];
    const note = catById[v.cat].note ? `<p class="muted" style="margin-top:10px">${esc(catById[v.cat].note)}</p>` : '';
    return `<a class="back" href="${back[0]}">→ ${esc(back[1])}</a>
      <div class="head"><h1>${esc(v.title)}</h1><p>${metaTags(v)}</p></div>
      ${player(v)}
      ${v.steps ? say('הדבר הכי חשוב כאן: ' + esc(v.steps[v.steps.length - 1])) : ''}
      ${v.desc ? `<div class="card"><p>${esc(v.desc)}</p>${note}</div>` : ''}
      ${v.steps ? `<div class="card"><h3>איך מבצעים</h3><ol class="steps">${v.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol><div class="muted">ציוד: ${esc(v.equipment)}</div></div>` : ''}
      ${v.steps ? `<button class="btn block" data-practice="${esc(v.id)}">יוצאים למגרש · טיימר ${clock(v.seconds)}</button>` : ''}
      <div class="pair">
        <button class="btn ghost" data-watched="${esc(v.id)}" aria-pressed="${done}">${done ? '✓ נצפה' : 'סימון כנצפה'}</button>
        <button class="btn ghost" data-fav="${esc(v.id)}" aria-pressed="${fav}">${fav ? '★ במועדפים' : '☆ למועדפים'}</button>
      </div>
      ${next ? `<h2>הבא בתור</h2>${videoRow(next)}` : ''}`;
  }

  const searchResults = () => {
    const q = search.q.trim();
    const list = DATA.videos.filter((v) => (search.cat === 'all' || v.cat === search.cat) &&
      (!q || v.title.includes(q) || (v.desc || '').includes(q) || catById[v.cat].name.includes(q) || (v.series && seriesById[v.series].name.includes(q))));
    if (!list.length) return '<div class="empty">לא נמצאו סרטונים. נסו מילה אחרת.</div>';
    return list.map((v) => videoRow(v)).join('');
  };
  function viewSearch() {
    const chip = (val, label) => `<button class="chip ${search.cat === val ? 'on' : ''}" data-scat="${esc(val)}" aria-pressed="${search.cat === val}">${esc(label)}</button>`;
    return `${head('חיפוש', `${videosHe(DATA.videos.length)} בספרייה`)}
      <input class="search" type="search" id="q" placeholder="כדרור, לחץ במשחק, חימום…" aria-label="חיפוש סרטון" value="${esc(search.q)}">
      <div class="chips">${chip('all', 'הכול')}${DATA.categories.map((c) => chip(c.id, c.name)).join('')}</div>
      <div id="list">${searchResults()}</div>`;
  }

  function viewMe() {
    const p = state.profile;
    const favs = state.favorites.map((id) => videoById[id]).filter(Boolean);
    const watched = Object.keys(state.watched).map((id) => videoById[id]).filter(Boolean)
      .sort((a, b) => (state.watched[b.id] > state.watched[a.id] ? 1 : -1));
    const last = state.last && videoById[state.last] && !isWatched(state.last) ? videoById[state.last] : null;
    const practices = Object.values(state.practice).reduce((a, n) => a + n, 0);
    const any = watched.length || favs.length || p || practices;
    return `${head('האזור האישי', p ? [p.name, p.age && `גיל ${p.age}`, DATA.levels[p.level], p.position].filter(Boolean).map(esc).join(' · ') : 'עוד לא מילאת פרופיל')}
      <a class="btn ghost small" href="#/profile">${p ? 'עריכת פרופיל' : 'יצירת פרופיל'}</a>
      <div class="stats" style="margin-top:22px">
        <div class="stat"><b>${watched.length}</b><span>נצפו</span></div>
        <div class="stat"><b>${streak()}</b><span>ימי רצף</span></div>
        <div class="stat"><b>${practices}</b><span>תרגולים במגרש</span></div>
      </div>
      ${say(streak() >= 2 ? `${daysHe(streak())} ברצף. ככה בונים שחקן, יום אחרי יום.` : watched.length ? 'התחלה טובה. עכשיו העיקר זה לחזור גם מחר.' : 'כל שחקן התחיל מהסרטון הראשון. אני מחכה לך שם.')}
      <h2>התקדמות</h2>
      <div class="card">${DATA.categories.map((c) => progressBar(c.name, inCat(c.id))).join('')}</div>
      ${last ? `<h2>המשך צפייה</h2>${videoRow(last)}` : ''}
      <h2>מועדפים</h2>
      ${favs.length ? favs.map((v) => videoRow(v)).join('') : '<div class="empty">סמנו סרטון בכוכב ☆ והוא יחכה לכם כאן.</div>'}
      <h2>נצפו לאחרונה</h2>
      ${watched.length ? watched.slice(0, 8).map((v) => videoRow(v)).join('') : '<div class="empty">עוד לא צפיתם בסרטון. הראשון מחכה בדף הבית.</div>'}
      ${any ? '<p style="text-align:center;margin-top:18px"><button class="link" data-reset>איפוס כל הנתונים</button></p>' : ''}`;
  }

  const viewNotFound = () => `<div class="empty">העמוד לא נמצא. <a class="link" href="#/home">חזרה לדף הבית</a></div>`;

  // ---------- router ----------
  function render(keepScroll) {
    let [, name = 'home', arg] = (location.hash || '#/home').split('/');
    arg = decodeURIComponent(arg || '');
    const onboarding = !state.profile && !state.skipped && name !== 'profile';
    const y = window.scrollY;
    const routes = {
      home: viewHome, search: viewSearch, me: viewMe, profile: viewWelcome,
      cat: () => viewCat(arg), series: () => viewSeries(arg), video: () => viewVideo(arg),
    };
    view.innerHTML = onboarding ? viewWelcome() : (routes[name] || viewNotFound)();
    tabs.hidden = onboarding;
    const tab = { cat: arg === 'technique' ? 'technique' : 'home', series: 'technique', profile: 'me',
      video: videoById[arg] && videoById[arg].cat === 'technique' ? 'technique' : 'home' }[name] || name;
    tabs.querySelectorAll('a').forEach((a) => {
      const on = a.dataset.tab === tab;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    window.scrollTo(0, keepScroll ? y : 0);
    if (!keepScroll) { view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter'); }
    if (name === 'video' && !onboarding && videoById[arg]) openedVideo(videoById[arg]);
    startAutoVideos();
  }

  // Background loops. iOS ignores the muted attribute on markup inserted with innerHTML, which
  // blocks autoplay, so set it as a property and start playback here. If the browser still
  // refuses (Low Power Mode, for example) start on the first touch; the poster shows meanwhile.
  function startAutoVideos() {
    view.querySelectorAll('.autovid').forEach((v) => {
      v.muted = true;
      v.defaultMuted = true;
      v.playsInline = true;
      const quiet = () => { const p = v.play(); if (p && p.catch) p.catch(() => {}); };
      const p = v.play();
      if (p && p.catch) p.catch(() => document.addEventListener('pointerdown', quiet, { once: true }));
    });
  }

  // Remember the last opened video, and resume / track real video files.
  function openedVideo(v) {
    if (!isWatched(v.id)) { state.last = v.id; save(); }
    const el = document.getElementById('player');
    if (!el) return;
    let lastSaved = 0;
    el.addEventListener('loadedmetadata', () => {
      const pos = state.positions[v.id];
      if (pos && pos < el.duration - 5) el.currentTime = pos;
    });
    el.addEventListener('timeupdate', () => {
      if (Math.abs(el.currentTime - lastSaved) < 5) return;
      lastSaved = el.currentTime;
      state.positions[v.id] = Math.floor(el.currentTime);
      if (el.duration && el.currentTime / el.duration > 0.9) markWatched(v.id); else save();
    });
    el.addEventListener('ended', () => { markWatched(v.id); render(true); });
  }

  // ---------- events ----------
  view.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (d.fav) {
      const i = state.favorites.indexOf(d.fav);
      if (i >= 0) state.favorites.splice(i, 1); else state.favorites.push(d.fav);
      save(); render(true);
    } else if (d.watched) {
      if (isWatched(d.watched)) { delete state.watched[d.watched]; save(); } else markWatched(d.watched);
      render(true);
    } else if (d.level !== undefined) {
      levelFilter = d.level; render(true);
    } else if (d.scat) {
      search.cat = d.scat; render(true);
    } else if (d.opt) {
      t.parentElement.querySelectorAll('.chip').forEach((c) => {
        c.classList.toggle('on', c === t); c.setAttribute('aria-pressed', String(c === t));
      });
    } else if ('skip' in d) {
      state.skipped = true; save(); location.hash = '#/home'; render();
    } else if (d.practice) {
      if (videoById[d.practice]) startRun(videoById[d.practice]);
    } else if ('reset' in d) {
      if (confirm('למחוק את הפרופיל, המועדפים וכל ההתקדמות? אי אפשר לבטל את הפעולה.')) {
        state = blank(); save(); location.hash = '#/home'; render();
      }
    }
  });
  view.addEventListener('submit', (e) => {
    if (e.target.id !== 'profileForm') return;
    e.preventDefault();
    const pick = (g) => { const el = e.target.querySelector(`[data-group="${g}"] .chip.on`); return el ? el.dataset.val : ''; };
    state.profile = {
      name: document.getElementById('pfName').value.trim().slice(0, 30),
      age: pick('age'), level: Number(pick('level') || 0), position: pick('position'),
    };
    save();
    if (location.hash === '#/home' || !location.hash) render(); else location.hash = '#/home';
  });
  view.addEventListener('input', (e) => {
    if (e.target.id !== 'q') return;
    search.q = e.target.value;
    document.getElementById('list').innerHTML = searchResults();
  });
  window.addEventListener('hashchange', () => render());

  // ---------- pitch timer ("יוצאים למגרש") ----------
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

  function startRun(v) {
    run = { v, left: v.seconds * 1000, total: v.seconds * 1000, last: Date.now(), paused: false, reps: 0 };
    runEl.hidden = false;
    runEl.className = '';
    document.body.style.overflow = 'hidden';
    lockScreen(true);
    runEl.innerHTML = `<div class="wrap">
      <div class="top"><button class="x" data-run="quit" aria-label="יציאה מהתרגול">✕</button>
        <div class="dots"><i class="cur"></i></div><span class="muted">${clock(v.seconds)}</span></div>
      <div class="phase">${esc(seriesById[v.series] ? seriesById[v.series].name : catById[v.cat].name)}</div>
      <h2>${esc(v.title)}</h2>
      <div class="dial"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="56"/><circle id="ring" cx="60" cy="60" r="56" pathLength="100"/></svg>
        <div class="clock" id="clock" role="timer"></div></div>
      <div class="reps"><button data-run="rep-" aria-label="הורדת חזרה">−</button><div><b id="reps">0</b><div class="muted" style="text-align:center">חזרות</div></div><button data-run="rep+" aria-label="הוספת חזרה">+</button></div>
      <div class="card"><ol class="steps">${v.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>
      <div class="ctrl two">
        <button class="btn" data-run="pause" id="pauseBtn">השהה</button>
        <button class="btn ghost" data-run="quit">סיים</button>
      </div></div>`;
    updateClock();
    clearInterval(ticker);
    ticker = setInterval(tick, 200);
  }
  function tick() {
    if (!run || run.finished) return;
    const now = Date.now();
    if (!run.paused) run.left -= now - run.last;
    run.last = now;
    if (run.left <= 0) finishRun(true); else updateClock();
  }
  function updateClock() {
    const c = document.getElementById('clock');
    if (!c) return;
    c.textContent = clock(Math.max(0, Math.ceil(run.left / 1000)));
    const frac = Math.min(1, Math.max(0, run.left / run.total));
    document.getElementById('ring').style.strokeDashoffset = String(100 - frac * 100);
    runEl.classList.toggle('hot', run.left <= 5000);
  }
  function finishRun(completed) {
    clearInterval(ticker);
    lockScreen(false);
    run.finished = true;
    runEl.className = '';
    if (completed) {
      beep(1320, 300);
      state.practice[dayKey()] = (state.practice[dayKey()] || 0) + 1;
      save();
    }
    let burst = '';
    if (completed) {
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * Math.PI * 2 + Math.random() * 0.4;
        const r = 110 + Math.random() * 150;
        burst += `<i style="--x:${Math.round(Math.cos(a) * r)}px;--y:${Math.round(Math.sin(a) * r)}px;--r:${Math.round(Math.random() * 540 - 270)}deg"></i>`;
      }
    }
    runEl.innerHTML = `<div class="wrap"><div class="done-box">
      ${burst ? `<div class="burst" aria-hidden="true">${burst}</div>` : ''}
      ${completed ? '<div class="medal"><img src="img/thumbs.jpg" alt=""></div>' : '<div class="big">0</div>'}
      <h2>${completed ? 'כל הכבוד, התרגול הושלם!' : 'התרגול הופסק'}</h2>
      <p class="muted">${completed ? `${esc(run.v.title)} · ${run.reps ? (run.reps === 1 ? 'חזרה אחת' : run.reps + ' חזרות') + ' · ' : ''}רצף של ${daysHe(streak())}` : 'התרגול לא נספר. אפשר לנסות שוב מתי שרוצים.'}</p>
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
    render(true);
  }
  runEl.addEventListener('click', (e) => {
    const t = e.target.closest('[data-run]');
    if (!t || !run) return;
    const a = t.dataset.run;
    if (a === 'close') closeRun();
    else if (a === 'quit') finishRun(false);
    else if (a === 'pause') {
      run.paused = !run.paused; run.last = Date.now();
      t.textContent = run.paused ? 'המשך' : 'השהה';
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
      DATA.videos.forEach((v) => { videoById[v.id] = v; });
      DATA.categories.forEach((c) => { catById[c.id] = c; });
      DATA.series.forEach((s) => { seriesById[s.id] = s; });
      state.favorites = state.favorites.filter((id) => videoById[id]);
      render();
    })
    .catch(() => {
      view.innerHTML = '<div class="empty">לא הצלחנו לטעון את הספרייה. בדקו את החיבור ורעננו את העמוד.<br>(בפתיחה מקומית צריך שרת, לא לחיצה כפולה על הקובץ.)</div>';
    });
})();
