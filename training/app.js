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
  const blank = () => ({ profile: null, skipped: false, favorites: [], watched: {}, positions: {}, last: null, practice: {}, overrides: {}, bannerOff: false });
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
  const thumb = (v) => v.image || (v.series && seriesById[v.series].image) || catById[v.cat].image;
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
      <p class="muted" style="text-align:center;margin-top:14px">באתר ההדגמה הפרופיל נשמר במכשיר הזה בלבד. <a class="link" href="#/signup">כך תיראה ההרשמה באפליקציה</a></p>`;
  }

  // ---------- landing page: what the app is, who Adam is, and the way into the demo ----------
  function viewLanding() {
    const inApp = Boolean(state.profile || state.skipped);
    const go = inApp ? ['#/home', 'חזרה להדגמה'] : ['#/profile', 'לנסות את ההדגמה'];
    const cta = (cls = '') => `<a class="lp-btn ${cls}" href="${go[0]}">${go[1]}</a>`;
    const jump = (id, label) => `<a href="#/about" data-scroll="${id}">${label}</a>`;
    const feat = (img, alt, kicker, title, text) => `<div class="lp-row">
        <div class="lp-phone"><img src="img/shots/${img}.jpg" alt="${alt}" width="750" height="1334" loading="lazy"></div>
        <div class="lp-txt"><div class="lp-kicker">${kicker}</div><h3>${title}</h3><p>${text}</p></div></div>`;
    const q = (t, a) => `<details class="lp-q"><summary>${t}</summary><p>${a}</p></details>`;
    const check = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11"/><path d="M7 12.5l3.2 3.2L17 9"/></svg>';
    const brand = '<div class="brand"><img src="img/logo.jpg" alt="" width="46" height="46"><div class="name">FIVE <span>BALL</span><small>BY ADAM</small></div></div>';
    return `<div class="lp">
      <header class="lp-nav">${brand}
        <nav aria-label="בדף הזה">${jump('lp-what', 'מה באפליקציה')}${jump('lp-adam', 'המאמן')}${jump('lp-parents', 'להורים')}${jump('lp-faq', 'שאלות')}</nav>
        ${cta('small')}</header>

      <section class="lp-hero">
        <div class="lp-hero-txt">
          <div class="lp-soon"><i></i>האפליקציה בפיתוח · בקרוב בחנויות</div>
          <h1>אימון כדורגל אישי עם המאמן אדם</h1>
          <p class="lp-lead">סרטוני טכניקה קצרים בעברית, לילדים ולנוער. מוצאים תרגיל, לומדים אותו, ויוצאים למגרש.</p>
          <div class="lp-actions">${cta()}${jump('lp-what', 'מה יש באפליקציה')}</div>
          <div class="lp-stores"><span>App Store</span><span>Google Play</span><em>בקרוב</em></div>
        </div>
        <div class="lp-hero-img"><img src="img/kick.jpg" alt="אדם בועט בכדור באימון" width="1200" height="1500"></div>
      </section>

      <div class="lp-facts"><div><b>5</b><span>תחומי אימון</span></div><div><b>10</b><span>סדרות טכניקה</span></div><div><b>3</b><span>רמות קושי</span></div><div><b>עברית</b><span>כל התוכן</span></div></div>

      <section class="lp-sec lp-light" id="lp-what">
        <div class="lp-in">
          <div class="lp-kicker">מה יש באפליקציה</div>
          <h2>לומדים תרגיל, ויוצאים לתרגל אותו</h2>
          ${feat('library', 'מסך הספרייה: עשר סדרות של טכניקה אישית, עם סינון לפי רמה', 'הספרייה', 'כל הטכניקה, לפי נושא ורמה', 'שליטה בכדור, כדרור, מסירות, נגיעה ראשונה, בעיטות, רגל חלשה ועוד. בכל נושא מתחילים מהבסיס ומתקדמים: מתחיל, מתקדם, מקצוען.')}
          ${feat('drill', 'מסך תרגיל: סרטון, שלבי ביצוע וכפתור טיימר למגרש', 'התרגיל', 'סרטון קצר, שלבים ברורים וטיימר', 'בכל תרגיל אדם מראה ומסביר. מתחת לסרטון יש שלבי ביצוע וציוד, וכפתור אחד שמפעיל טיימר כדי לתרגל בפועל.')}
          ${feat('progress', 'מסך האזור האישי: סרטונים שנצפו, ימי רצף ותרגולים במגרש', 'ההתקדמות', 'רואים כמה התאמנו, וממשיכים מאיפה שעצרו', 'סרטונים שנצפו, ימי רצף, תרגולים במגרש ומועדפים. הכול במקום אחד, כדי שיהיה קל להתמיד.')}
          <p class="lp-also">חוץ מטכניקה אישית יהיו באפליקציה גם מנטליות, תזונה (תוכן חינוכי כללי), טיפים משחקנים והכנה לשחקן.</p>
        </div>
      </section>

      <section class="lp-sec lp-adam" id="lp-adam">
        <div class="lp-adam-photo"><img src="img/ready.jpg" alt="אדם באימון על המגרש" width="1200" height="675" loading="lazy"></div>
        <div class="lp-adam-txt">
          <div class="lp-kicker">המאמן</div>
          <h2>אדם מלמד כל תרגיל בעצמו</h2>
          <p>אדם הוא מאמן כדורגל ושחקן פעיל, שמאמן קבוצות ושחקנים באופן אישי. ב-Five Ball הוא מראה, מסביר, ומכוון לטעויות הנפוצות.</p>
          <p>הגישה שלו: מקצועי, אבל גם אח גדול שמלווה. בלי קיצורי דרך, ובגובה העיניים.</p>
        </div>
      </section>

      <section class="lp-sec lp-cap"><div class="lp-in">
        <span class="lp-tag">בקרוב</span>
        <h2>הקפטן נותן ציון על הביצוע</h2>
        <p>מקבלים משימה, מצלמים את עצמכם מבצעים אותה, ומקבלים ציון ודגשים לשיפור. הקפטן הוא בינה מלאכותית שעוזרת להתמיד בין האימונים, ולא מחליפה מאמן.</p>
        <a class="lp-link" href="#/captain">איך זה יעבוד</a>
      </div></section>

      <section class="lp-sec lp-light" id="lp-parents"><div class="lp-in">
        <div class="lp-kicker">להורים</div>
        <h2>כך האפליקציה מתוכננת</h2>
        <ul class="lp-list">
          <li>${check}<div><b>הורה מאשר</b>שחקנים צעירים מתחילים רק אחרי אישור של הורה.</div></li>
          <li>${check}<div><b>מעט מידע</b>שם פרטי, קבוצת גיל, רמה ועמדה. בלי כתובת ובלי תאריך לידה מלא.</div></li>
          <li>${check}<div><b>בלי צ'אט ובלי פרסומות</b>אין שיחות בין משתמשים ואין מודעות.</div></li>
          <li>${check}<div><b>סרטונים לא מתפרסמים</b>סרטון שהילד מעלה לקפטן נבדק ונמחק.</div></li>
          <li>${check}<div><b>תזונה כתוכן חינוכי</b>מידע כללי, לא ייעוץ אישי.</div></li>
        </ul>
      </div></section>

      <section class="lp-sec" id="lp-faq"><div class="lp-in lp-narrow">
        <div class="lp-kicker">שאלות נפוצות</div>
        <h2>מה כדאי לדעת</h2>
        ${q('מתי האפליקציה עולה לחנויות?', 'האפליקציה בפיתוח ועדיין אין תאריך השקה. בינתיים אפשר לנסות את ההדגמה כאן באתר.')}
        ${q('כמה זה יעלה?', 'המחיר עוד לא נקבע. התוכנית היא שחלק מהתוכן יהיה פתוח בחינם, ושאר הספרייה במנוי חודשי או שנתי.')}
        ${q('לאילו גילאים זה מתאים?', 'לילדים ולנוער מגיל 8 בערך, ולכל מי שרוצה לשפר טכניקה אישית. בכל נושא יש שלוש רמות.')}
        ${q('צריך ציוד מיוחד?', 'לרוב התרגילים מספיקים כדור ומעט מקום. לחלק צריך קיר או כמה קונוסים, וזה כתוב בכל תרגיל.')}
        ${q('הסרטונים באתר אמיתיים?', 'עדיין לא. זה אתר הדגמה: מבנה הספרייה והמסכים אמיתיים, והסרטונים של אדם נמצאים בצילום.')}
      </div></section>

      <section class="lp-close"><div class="lp-in">
        <h2>רוצים לראות איך זה מרגיש?</h2>
        <p>ההדגמה פתוחה, בלי הרשמה ובלי תשלום.</p>
        ${cta('dark')}
      </div></section>

      <footer class="lp-foot"><div class="lp-in">${brand}
        <nav aria-label="קישורים">${jump('lp-what', 'מה באפליקציה')}${jump('lp-adam', 'המאמן')}${jump('lp-parents', 'להורים')}${jump('lp-faq', 'שאלות נפוצות')}<a href="#/captain">הקפטן</a></nav>
        <p>אתר הדגמה. האפליקציה בפיתוח.</p></div></footer>
    </div>`;
  }

  function viewHome() {
    const name = state.profile && state.profile.name;
    const last = state.last && videoById[state.last] && !isWatched(state.last) ? videoById[state.last] : null;
    const feat = last || recommended()[0] || DATA.videos[0];
    const s = streak();
    const [tech, ...rest] = DATA.categories;
    const rec = recommended().filter((v) => v.id !== feat.id);
    return `<div class="brand"><img src="img/logo.jpg" alt="" width="46" height="46"><div class="name">FIVE <span>BALL</span><small>BY ADAM</small></div></div>
      ${state.bannerOff ? '' : '<div class="demobar"><span><b>אתר הדגמה</b> · הסרטונים עדיין בצילום, והאפליקציה בדרך לחנויות. <a class="link" href="#/about">מה זה Five Ball?</a></span><button data-banner-off aria-label="סגירת ההודעה">✕</button></div>'}
      <div class="head"><h1>${name ? `היי ${esc(name)}` : 'האימון שלך מתחיל כאן'}</h1><p>${s > 0 ? `רצף של ${daysHe(s)}. ממשיכים?` : 'מוצאים תרגיל, לומדים אותו, יוצאים למגרש.'}</p></div>
      <div class="card hero photo"><span class="five" aria-hidden="true">5</span>
        <div class="muted">${last ? 'המשך צפייה' : 'מומלץ להתחיל כאן'} · ${esc(feat.series ? seriesById[feat.series].name : catById[feat.cat].name)}</div>
        <div class="h3" role="heading" aria-level="2">${esc(feat.title)}</div>
        <a class="btn block" href="#/video/${esc(feat.id)}">${last ? 'המשך צפייה' : 'צפייה בסרטון'}</a>
      </div>
      <div class="ticker" aria-hidden="true"><div>${TICKER}${TICKER}</div></div>
      <h2>קטגוריות</h2>
      <div class="tiles">${tile(tech, true)}${rest.map((c) => tile(c)).join('')}</div>
      <a class="card captain" href="#/captain"><div class="muted">בקרוב · בינה מלאכותית</div><div class="h3" role="heading" aria-level="3">הקפטן נותן לך ציון</div><p>מקבלים משימה, מצלמים את עצמכם מבצעים אותה, ומקבלים ציון ודגשים לשיפור.</p><span class="more">איך זה עובד ‹</span></a>
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
    const series = DATA.series.filter((s) => s.cat === id).map((s, si) => {
      const all = inSeries(s.id);
      const shown = levelFilter === 'all' ? all : all.filter((v) => v.level === Number(levelFilter));
      if (!shown.length) return '';
      return `<a class="item series" href="#/series/${esc(s.id)}" style="--p:${pct(all)}%">
        <div class="idx">${String(si + 1).padStart(2, '0')}</div>
        <div class="grow"><div class="t">${esc(s.name)}</div><div><span class="tag">${videosHe(shown.length)}</span><span class="tag">${watchedIn(all)} נצפו</span></div></div>
        <span class="chev" aria-hidden="true">‹</span></a>`;
    }).join('');
    return `${head(c.name, `${esc(c.blurb)} · ${videosHe(list.length)}`)}
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
      ${v.desc ? `<div class="card"><p>${esc(v.desc)}</p>${note}</div>` : ''}
      ${v.steps ? `<div class="card"><h2 class="h3 plain">איך מבצעים</h2><ol class="steps">${v.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol><div class="muted">ציוד: ${esc(v.equipment)}</div></div>` : ''}
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
      <h2>התקדמות</h2>
      <div class="card">${DATA.categories.map((c) => progressBar(c.name, inCat(c.id))).join('')}</div>
      ${last ? `<h2>המשך צפייה</h2>${videoRow(last)}` : ''}
      <h2>מועדפים</h2>
      ${favs.length ? favs.map((v) => videoRow(v)).join('') : '<div class="empty">סמנו סרטון בכוכב ☆ והוא יחכה לכם כאן.</div>'}
      <h2>נצפו לאחרונה</h2>
      ${watched.length ? watched.slice(0, 8).map((v) => videoRow(v)).join('') : '<div class="empty">עוד לא צפיתם בסרטון. הראשון מחכה בדף הבית.</div>'}
      <a class="item" href="#/about"><div class="grow"><div class="t">מה זה Five Ball</div><div class="muted">על האפליקציה ועל אדם</div></div><span class="chev" aria-hidden="true">‹</span></a>
      <h2>מסכי האפליקציה</h2>
      <p class="muted" style="margin-bottom:8px">מסכים שיהיו באפליקציה המלאה. כאן הם להדגמה בלבד.</p>
      ${DEMOS.map(([href, t, d]) => `<a class="item" href="${href}"><div class="grow"><div class="t">${t}</div><div class="muted">${d}</div></div><span class="chev" aria-hidden="true">‹</span></a>`).join('')}
      ${any ? '<p style="text-align:center;margin-top:18px"><button class="link" data-reset>איפוס כל הנתונים</button></p>' : ''}`;
  }

  function viewCaptain() {
    const step = (n, t, d) => `<div class="item"><div class="num">${n}</div><div class="grow"><div class="t">${t}</div><div class="muted">${d}</div></div></div>`;
    return `${head('הקפטן', 'המאמן החכם של Five Ball · בקרוב באפליקציה', ['#/home', 'דף הבית'])}
      <div class="card"><p>הקפטן הוא בינה מלאכותית שמלווה את השחקן בין האימונים. הוא נותן משימות, בודק סרטונים שהשחקן מעלה, ועונה על שאלות. הוא לא מחליף את אדם או את המאמן בקבוצה, אלא עוזר להתמיד ולדעת על מה לעבוד.</p></div>
      <h2>איך זה עובד</h2>
      ${step(1, 'מקבלים משימה', 'הקפטן בוחר תרגיל אחד לפי הרמה, עם סרטון ושלבי ביצוע.')}
      ${step(2, 'מצלמים ומעלים', 'מתרגלים, מבקשים ממישהו לצלם כ-20 שניות מהצד, ומעלים את הסרטון.')}
      ${step(3, 'מקבלים ציון ודגשים', 'ציון מ-1 עד 10, מה נעשה טוב ומה לשפר. ציון 6 ומעלה פותח את המשימה הבאה.')}
      <h2>כך נראית תשובה</h2>
      <div class="card sample"><span class="eg">דוגמה</span>
        <div class="scorebox"><div class="n">8</div><div><b>ביצוע יפה!</b><div class="muted">נגיעות סוליה במקום · ניסיון שני</div></div></div>
        <h3>מה עשית טוב</h3><ol class="steps"><li>הכדור נשאר קרוב לגוף לאורך כל התרגיל.</li><li>עמדת על קצות האצבעות והקצב היה קבוע.</li></ol>
        <h3>מה לשפר</h3><ol class="steps"><li>הרם את הראש כל כמה נגיעות במקום להסתכל על הכדור.</li><li>כופף קצת יותר את הברכיים.</li></ol>
        <h3>הצעד הבא</h3><p>אותו תרגיל, דקה אחת, כשאתה סופר בקול כמה פעמים הרמת את הראש.</p>
      </div>
      <h2>שאל את הקפטן</h2>
      <div class="card sample"><span class="eg">דוגמה</span>
        <p><b>שחקן:</b> אני מתרגש מאוד לפני משחקים. מה עושים?</p>
        <p style="margin-top:10px"><b>הקפטן:</b> זה קורה גם לשחקנים מקצוענים, וזה סימן שאכפת לך. נסה שלוש נשימות איטיות לפני העלייה למגרש, ותתרכז רק בפעולה הראשונה שלך במשחק. כדאי לצפות בסרטון "לחץ במשחק" בקטגוריית המנטליות.</p>
      </div>
      <h2>חשוב לדעת</h2>
      <div class="card"><ol class="steps">
        <li>הציון הוא הערכה של בינה מלאכותית לפי הסרטון, ולא שיפוט של מאמן.</li>
        <li>העלאת סרטון של ילד תדרוש אישור הורים, והסרטונים לא יפורסמו.</li>
        <li>הקפטן לא נותן ייעוץ רפואי או תזונה אישית. בכאב או פציעה פונים להורה, למאמן או לרופא.</li>
      </ol></div>
      <p class="muted" style="text-align:center;margin-top:14px">הקפטן עדיין לא פעיל באתר ההדגמה הזה. הדוגמאות למעלה ממחישות איך הוא יעבוד.</p>`;
  }

  // ---------- demo screens (sign-up, parental consent, subscription, content management) ----------
  // These show how the full app will look. Nothing typed here is stored or sent anywhere,
  // except the content edits in the management screen, which stay on this device.
  const DEMOS = [
    ['#/signup', 'הרשמה והתחברות', 'כך נכנסים לאפליקציה'],
    ['#/consent', 'אישור הורים', 'לשחקנים צעירים, לפני שמתחילים'],
    ['#/plans', 'מנויים', 'חינם, חודשי ושנתי'],
    ['#/admin', 'ניהול תוכן', 'המסך של אדם: עריכת סרטונים'],
  ];
  const demoFlag = (text) => `<div class="demoflag"><b>מסך הדגמה</b><span>${text}</span></div>`;
  const YOUNG = ['8-10', '11-13'];
  let demo = { mode: 'new', sent: false, plan: 'year', edit: null, q: '' };

  function viewSignup() {
    const isNew = demo.mode === 'new';
    const tab = (m, label) => `<button class="chip ${demo.mode === m ? 'on' : ''}" data-mode="${m}" aria-pressed="${demo.mode === m}">${label}</button>`;
    return `${head(isNew ? 'הרשמה' : 'התחברות', isNew ? 'חשבון אחד שומר את ההתקדמות בכל מכשיר.' : 'טוב לראות אותך שוב.', ['#/me', 'האזור האישי'])}
      ${demoFlag('שום פרט שמקלידים כאן לא נשמר ולא נשלח.')}
      <div class="chips">${tab('new', 'הרשמה')}${tab('login', 'התחברות')}</div>
      <form id="demoSignup" autocomplete="off">
        <button type="button" class="btn ghost block" data-demo-next>המשך עם Apple</button>
        <button type="button" class="btn ghost block" data-demo-next>המשך עם Google</button>
        <div class="or"><span>או</span></div>
        <label class="muted" for="suMail">אימייל</label>
        <input class="search" id="suMail" type="email" inputmode="email" dir="ltr" placeholder="name@example.com">
        <label class="muted" for="suPass">סיסמה</label>
        <input class="search" id="suPass" type="password" dir="ltr" placeholder="לפחות 8 תווים">
        ${isNew ? '<p class="muted" style="margin-top:14px">בהרשמה מאשרים את תנאי השימוש ואת מדיניות הפרטיות. לשחקנים עד גיל 13 נדרש גם אישור הורה.</p>' : '<p style="margin-top:10px"><span class="link">שכחתי סיסמה</span></p>'}
        <button class="btn block" type="submit">${isNew ? 'יצירת חשבון' : 'כניסה'}</button>
      </form>
      <p class="muted" style="text-align:center;margin-top:14px">${isNew ? 'אחרי ההרשמה: פרטי השחקן, אישור הורה לצעירים, ובחירת מנוי.' : 'אחרי הכניסה חוזרים בדיוק למקום שבו עצרת.'}</p>`;
  }

  function viewConsent() {
    const p = state.profile;
    const who = p && p.name ? esc(p.name) : 'השחקן';
    const young = p && YOUNG.includes(p.age);
    const checks = [
      'אני ההורה או האפוטרופוס של השחקן ומאשר/ת לו להשתמש באפליקציה.',
      'קראתי את תנאי השימוש ואת מדיניות הפרטיות.',
      'אני מאשר/ת העלאת סרטוני אימון לבדיקת הקפטן. הסרטון נבדק ונמחק, ולא מפורסם.',
    ];
    if (demo.sent) {
      return `${head('אישור הורים', 'הבקשה נשלחה', ['#/me', 'האזור האישי'])}
        ${demoFlag('לא נשלחה הודעה אמיתית.')}
        <div class="card sample"><span class="eg">דוגמה</span><h3>ממתינים לאישור</h3>
          <p>שלחנו להורה קישור לאישור. עד שהוא מאשר, ${who} יכול לצפות בסרטונים החינמיים בלבד, בלי להעלות סרטונים ובלי לרכוש מנוי.</p></div>
        <div class="card sample"><span class="eg">דוגמה</span><h3>מה ההורה רואה</h3>
          <p>"${who} ביקש להצטרף ל-Five Ball by Adam. באפליקציה: סרטוני אימון, מעקב התקדמות ומשימות. אין צ'אט בין משתמשים ואין פרסומות."</p>
          <div class="pair"><span class="btn ghost">לא מאשר/ת</span><span class="btn">מאשר/ת</span></div></div>
        <a class="btn block" href="#/plans">המשך למנויים</a>
        <p style="text-align:center"><button class="link" data-consent-back>חזרה לטופס</button></p>`;
    }
    return `${head('אישור הורים', young ? `${who} בגיל ${esc(p.age)}, ולכן צריך אישור של הורה.` : 'לשחקנים עד גיל 13, לפני שמתחילים.', ['#/me', 'האזור האישי'])}
      ${demoFlag('שום פרט שמקלידים כאן לא נשמר ולא נשלח.')}
      <div class="card"><p>אנחנו רוצים שההורים יידעו במה הילד משתמש. לכן שחקנים צעירים מתחילים רק אחרי שהורה אישר.</p></div>
      <form id="demoConsent" autocomplete="off">
        <label class="muted" for="pcName">שם ההורה</label>
        <input class="search" id="pcName" maxlength="30" placeholder="שם מלא">
        <label class="muted" for="pcPhone">טלפון או אימייל של ההורה</label>
        <input class="search" id="pcPhone" dir="ltr" placeholder="050-0000000">
        <div class="checks">${checks.map((c, i) => `<label><input type="checkbox" ${i < 2 ? 'required' : ''}><span>${c}${i === 2 ? ' <em>(לא חובה)</em>' : ''}</span></label>`).join('')}</div>
        <button class="btn block" type="submit">שליחת בקשה להורה</button>
      </form>
      <p class="muted" style="text-align:center;margin-top:14px">הגיל המדויק שמתחתיו נדרש אישור, ונוסח האישור, ייקבעו עם עורך דין.</p>`;
  }

  function viewPlans() {
    const plans = [
      ['free', 'חינם', 'בלי תשלום', ['סדרה אחת מלאה בטכניקה אישית', 'סרטון לדוגמה מכל קטגוריה', 'מעקב צפייה ומועדפים']],
      ['month', 'חודשי', 'המחיר ייקבע', ['כל הספרייה: טכניקה, מנטליות, תזונה, טיפים והכנה', 'סרטונים חדשים כל שבוע', 'משימות וציונים מהקפטן']],
      ['year', 'שנתי', 'המחיר ייקבע', ['כל מה שבמנוי החודשי', 'מחיר נמוך יותר לחודש', 'תשלום אחד לשנה']],
    ];
    return `${head('מנויים', 'מתחילים בחינם. משדרגים כשרוצים את כל הספרייה.', ['#/me', 'האזור האישי'])}
      ${demoFlag('המחירים עוד לא נקבעו ושום תשלום לא מתבצע.')}
      ${plans.map(([id, name, price, list]) => `<button class="plan ${demo.plan === id ? 'on' : ''}" data-plan="${id}" aria-pressed="${demo.plan === id}">
        <div class="spread"><b>${name}</b><span class="price">${price}</span></div>
        ${id === 'year' ? '<span class="badge">הכי משתלם</span>' : ''}
        <ul>${list.map((x) => `<li>${x}</li>`).join('')}</ul></button>`).join('')}
      <button class="btn block" data-buy>${demo.plan === 'free' ? 'ממשיכים בחינם' : 'שבוע ניסיון בחינם'}</button>
      <p class="muted" style="text-align:center;margin-top:14px">${demo.plan === 'free' ? 'אפשר לשדרג בכל רגע.' : 'אפשר לבטל בכל רגע בהגדרות החנות. התשלום נעשה דרך חשבון ההורה ב-App Store או ב-Google Play.'}</p>`;
  }

  function viewAdmin() {
    const changed = Object.keys(state.overrides).filter((id) => videoById[id]);
    if (demo.edit && videoById[demo.edit]) {
      const v = videoById[demo.edit];
      const lv = v.level !== undefined ? `<label class="muted">רמה</label>
        <div class="opts" data-group="alevel">${DATA.levels.map((l, i) => `<button type="button" class="chip ${v.level === i ? 'on' : ''}" data-opt="alevel" data-val="${i}" aria-pressed="${v.level === i}">${esc(l)}</button>`).join('')}</div>` : '';
      return `<button class="back" data-admin-close>→ ניהול תוכן</button>
        <div class="head"><h1>עריכת סרטון</h1><p>${metaTags(v)}</p></div>
        <form id="adminForm" autocomplete="off" data-id="${esc(v.id)}">
          <label class="muted" for="adTitle">שם הסרטון</label>
          <input class="search" id="adTitle" maxlength="60" value="${esc(v.title)}">
          ${lv}
          <label class="muted" for="adVideo">קישור לסרטון (YouTube או קובץ mp4)</label>
          <input class="search" id="adVideo" dir="ltr" inputmode="url" value="${esc(v.video || '')}" placeholder="https://youtu.be/...">
          <button class="btn block" type="submit">שמירה</button>
        </form>
        ${state.overrides[v.id] ? `<p style="text-align:center"><button class="link" data-admin-undo="${esc(v.id)}">ביטול השינויים בסרטון הזה</button></p>` : ''}
        <p class="muted" style="text-align:center;margin-top:14px">אחרי השמירה אפשר לפתוח את הסרטון באתר ולראות איך הוא נראה לשחקן.</p>`;
    }
    const q = demo.q.trim();
    const list = DATA.videos.filter((v) => !q || v.title.includes(q) || (v.series && seriesById[v.series].name.includes(q)) || catById[v.cat].name.includes(q));
    return `${head('ניהול תוכן', 'המסך של אדם', ['#/me', 'האזור האישי'])}
      ${demoFlag('השינויים נשמרים במכשיר הזה בלבד. כדי לעדכן את האתר לכולם, שולחים אותם בוואטסאפ.')}
      <div class="card">${DATA.categories.map((c) => `<div class="bar"><div class="spread"><span>${esc(c.name)}</span><span class="muted">${inCat(c.id).length} מתוך ${c.planned || inCat(c.id).length} מתוכננים</span></div>
        <div class="track"><div class="fill" style="width:${Math.round((inCat(c.id).length / (c.planned || inCat(c.id).length)) * 100)}%"></div></div></div>`).join('')}</div>
      ${changed.length ? `<a class="btn block" target="_blank" rel="noopener" href="${esc(adminShareLink(changed))}">שליחת ${changed.length === 1 ? 'שינוי אחד' : changed.length + ' שינויים'} בוואטסאפ</a>
        <p style="text-align:center"><button class="link" data-admin-reset>ביטול כל השינויים</button></p>` : ''}
      <a class="item" href="shoot.html"><div class="grow"><div class="t">דף צילום</div><div class="muted">אילו סרטונים לצלם קודם ואיך לצלם בטלפון</div></div><span class="chev" aria-hidden="true">‹</span></a>
      <h2>סרטונים</h2>
      <input class="search" type="search" id="aq" placeholder="חיפוש סרטון לעריכה" aria-label="חיפוש סרטון לעריכה" value="${esc(demo.q)}">
      <div id="alist">${adminRows(list)}</div>
      <p class="muted" style="text-align:center;margin-top:14px">באפליקציה המלאה יהיו כאן גם העלאת סרטונים, פרסום והסתרה, ניהול קטגוריות וניהול מנויים.</p>`;
  }
  const adminRows = (list) => (list.length ? list.map((v) => `<button class="item arow" data-admin-edit="${esc(v.id)}">
      <div class="ico ${v.video ? 'done' : ''}">${v.video ? icon('check') : icon('play')}</div>
      <div class="grow"><div class="t">${esc(v.title)}</div><div>${metaTags(v)}${state.overrides[v.id] ? '<span class="tag chg">שונה</span>' : ''}</div></div>
      <span class="chev" aria-hidden="true">‹</span></button>`).join('') : '<div class="empty">לא נמצאו סרטונים.</div>');
  function adminShareLink(ids) {
    const lines = ids.map((id) => {
      const o = state.overrides[id];
      const parts = [];
      if (o.title !== undefined) parts.push(`שם: ${o.title}`);
      if (o.level !== undefined) parts.push(`רמה: ${DATA.levels[o.level]}`);
      if (o.video !== undefined) parts.push(`קישור: ${o.video || 'להסיר'}`);
      return `${id} (${BASE[id].title})\n${parts.join('\n')}`;
    });
    return 'https://wa.me/?text=' + encodeURIComponent(`עדכונים לספריית Five Ball:\n\n${lines.join('\n\n')}`);
  }
  // Original values, so an override can be compared and undone.
  const BASE = {};
  function applyOverrides() {
    DATA.videos.forEach((v) => {
      const b = BASE[v.id];
      Object.assign(v, { title: b.title, video: b.video });
      if (b.level !== undefined) v.level = b.level;
      const o = state.overrides[v.id];
      if (!o) return;
      if (typeof o.title === 'string' && o.title) v.title = o.title;
      if (typeof o.video === 'string') v.video = o.video;
      if (b.level !== undefined && DATA.levels[o.level]) v.level = o.level;
    });
  }

  const viewNotFound = () => `<div class="empty">העמוד לא נמצא. <a class="link" href="#/home">חזרה לדף הבית</a></div>`;

  // ---------- router ----------
  function render(keepScroll) {
    let [, name = 'home', arg] = (location.hash || '#/home').split('/');
    arg = decodeURIComponent(arg || '');
    const fresh = !state.profile && !state.skipped;
    const landing = name === 'about' || (fresh && name === 'home');
    const onboarding = fresh && !landing && !['profile', 'signup', 'consent', 'plans', 'admin', 'captain'].includes(name);
    const y = window.scrollY;
    const routes = {
      home: viewHome, search: viewSearch, me: viewMe, profile: viewWelcome, captain: viewCaptain, about: viewLanding,
      signup: viewSignup, consent: viewConsent, plans: viewPlans, admin: viewAdmin,
      cat: () => viewCat(arg), series: () => viewSeries(arg), video: () => viewVideo(arg),
    };
    view.innerHTML = landing ? viewLanding() : onboarding ? viewWelcome() : (routes[name] || viewNotFound)();
    tabs.hidden = onboarding || landing || (fresh && name !== 'home');
    view.classList.toggle('wide', landing);
    const tab = { cat: arg === 'technique' ? 'technique' : 'home', series: 'technique', profile: 'me', captain: 'home', signup: 'me', consent: 'me', plans: 'me', admin: 'me',
      video: videoById[arg] && videoById[arg].cat === 'technique' ? 'technique' : 'home' }[name] || name;
    tabs.querySelectorAll('a').forEach((a) => {
      const on = a.dataset.tab === tab;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    window.scrollTo(0, keepScroll ? y : 0);
    if (!keepScroll) { view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter'); }
    if (name === 'video' && !onboarding && !landing && videoById[arg]) openedVideo(videoById[arg]);
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

  // A short message at the bottom of the screen, instead of a browser dialog.
  let toastTimer = null;
  function toast(text) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = text; el.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 4200);
  }
  // Destructive buttons ask for a second press instead of opening a confirm dialog.
  function armed(btn, text) {
    if (btn.dataset.armed) return true;
    btn.dataset.armed = '1'; btn.dataset.label = btn.textContent; btn.textContent = text; btn.classList.add('armed');
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; btn.classList.remove('armed'); } }, 5000);
    return false;
  }

  // ---------- events ----------
  view.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if ('bannerOff' in d) {
      state.bannerOff = true; save(); render(true);
    } else if (d.mode) {
      demo.mode = d.mode; render(true);
    } else if ('demoNext' in d) {
      afterSignup();
    } else if ('consentBack' in d) {
      demo.sent = false; render();
    } else if (d.plan) {
      demo.plan = d.plan; render(true);
    } else if ('buy' in d) {
      toast(demo.plan === 'free' ? 'הדגמה: באפליקציה ממשיכים מכאן לספרייה החינמית.' : 'הדגמה בלבד: לא בוצע חיוב. באפליקציה ייפתח כאן חלון התשלום של החנות.');
    } else if (d.adminEdit) {
      demo.edit = d.adminEdit; render();
    } else if ('adminClose' in d) {
      demo.edit = null; render();
    } else if (d.adminUndo) {
      delete state.overrides[d.adminUndo]; save(); applyOverrides(); demo.edit = null; render();
    } else if ('adminReset' in d) {
      if (armed(t, 'לחצו שוב כדי לבטל את כל השינויים')) { state.overrides = {}; save(); applyOverrides(); render(true); toast('השינויים בוטלו.'); }
    } else if (d.fav) {
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
      if (armed(t, 'לחצו שוב כדי למחוק את הפרופיל וכל ההתקדמות')) {
        state = blank(); save(); location.hash = '#/home'; render();
      }
    }
  });
  function afterSignup() {
    const p = state.profile;
    demo.sent = false;
    location.hash = demo.mode === 'login' ? '#/home' : (!p || YOUNG.includes(p.age)) ? '#/consent' : '#/plans';
  }
  view.addEventListener('submit', (e) => {
    const id = e.target.id;
    if (id === 'demoSignup') { e.preventDefault(); afterSignup(); return; }
    if (id === 'demoConsent') { e.preventDefault(); demo.sent = true; render(); return; }
    if (id === 'adminForm') {
      e.preventDefault();
      const vid = e.target.dataset.id;
      const b = BASE[vid];
      const o = {};
      const title = document.getElementById('adTitle').value.trim().slice(0, 60);
      const video = document.getElementById('adVideo').value.trim();
      const lvEl = e.target.querySelector('[data-group="alevel"] .chip.on');
      if (title && title !== b.title) o.title = title;
      if (video !== (b.video || '')) o.video = video;
      if (lvEl && Number(lvEl.dataset.val) !== b.level) o.level = Number(lvEl.dataset.val);
      if (Object.keys(o).length) state.overrides[vid] = o; else delete state.overrides[vid];
      save(); applyOverrides(); demo.edit = null; render();
      return;
    }
    if (id !== 'profileForm') return;
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
    if (e.target.id === 'aq') {
      demo.q = e.target.value;
      const q = demo.q.trim();
      document.getElementById('alist').innerHTML = adminRows(DATA.videos.filter((v) => !q || v.title.includes(q) || (v.series && seriesById[v.series].name.includes(q)) || catById[v.cat].name.includes(q)));
      return;
    }
    if (e.target.id !== 'q') return;
    search.q = e.target.value;
    document.getElementById('list').innerHTML = searchResults();
  });
  view.addEventListener('click', (e) => {
    const a = e.target.closest('[data-scroll]');
    if (!a) return;
    const target = document.getElementById(a.dataset.scroll);
    if (target) { e.preventDefault(); target.scrollIntoView({ behavior: CALM ? 'auto' : 'smooth', block: 'start' }); }
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
      DATA.videos.forEach((v) => { videoById[v.id] = v; BASE[v.id] = { title: v.title, video: v.video || '', level: v.level }; });
      DATA.categories.forEach((c) => { catById[c.id] = c; });
      DATA.series.forEach((s) => { seriesById[s.id] = s; });
      state.favorites = state.favorites.filter((id) => videoById[id]);
      if (!state.overrides || typeof state.overrides !== 'object') state.overrides = {};
      applyOverrides();
      render();
    })
    .catch(() => {
      view.innerHTML = '<div class="empty">לא הצלחנו לטעון את הספרייה. בדקו את החיבור ורעננו את העמוד.<br>(בפתיחה מקומית צריך שרת, לא לחיצה כפולה על הקובץ.)</div>';
    });
})();
