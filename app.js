/* ===== «Престол эпох» — движок симулятора правителя ===== */
'use strict';

const STORE_KEY = 'prestolEpochsV1';
let store = loadStore();
let safeModalQueue = [];

/* ---------- утилиты ---------- */
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function today(off) { const d = new Date(); if (off) d.setDate(d.getDate() + off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* повреждённые данные — заново */ }
  return { profiles: {}, currentId: null, admin: { pin: null, prizes: {} }, ui: { theme: 'royal' } };
}
function saveStore() { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
function P() { return store.profiles[store.currentId] || null; }
function titleFor(points) {
  let t = DATA.titles[0].name;
  for (const x of DATA.titles) if (points >= x.min) t = x.name;
  return t;
}

/* ---------- телеметрия (статистика для родителей) ---------- */
const TL = {
  endpoint: 'https://game-metrics.kirillovd.workers.dev/track',
  q: [], timer: null, logged: false, curReign: null,
  send: function (t, d) {
    try {
      const p = P();
      this.q.push({ t: t, g: 'prestol', p: p ? p.name : '—', d: String(d || '').slice(0, 150), ts: Date.now() });
      if (this.q.length >= 10) this.flush();
      else if (!this.timer) this.timer = setTimeout(() => this.flush(), 7000);
    } catch (e) { /* тише едешь — статистика целее */ }
  },
  flush: function () {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.q.length) return;
    const body = JSON.stringify({ events: this.q.splice(0, 60) });
    try {
      fetch(this.endpoint, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' }, body: body })
        .catch(() => { try { navigator.sendBeacon(this.endpoint, body); } catch (e2) {} });
    } catch (e) {
      try { navigator.sendBeacon(this.endpoint, body); } catch (e2) {}
    }
  }
};
window.addEventListener('pagehide', () => TL.flush());

/* ---------- похвала, история, письма Летописца ---------- */
const PRAISE = ['Мудрейшее решение! 👑', 'Летописец аплодирует!', 'Так правят великие!', 'Блестящий ход, государь!', 'Такие решения вносят в хроники!', 'Народ бы одобрил!'];
function praiseToast() { toast(PRAISE[Math.floor(Math.random() * PRAISE.length)]); }
function hist(k, x) {
  const p = P();
  p.history = p.history || [];
  p.history.push({ d: today(), k: k, x: String(x || '').slice(0, 90) });
  if (p.history.length > 400) p.history.splice(0, p.history.length - 400);
  saveStore();
}
function buildChronLetter(id) {
  const r = DATA.reigns.find(x => x.id === id);
  const st = getReignState(id);
  const m = st.session.metrics;
  const best = METRICS.reduce((a, b) => m[a.key] >= m[b.key] ? a : b);
  const worst = METRICS.reduce((a, b) => m[a.key] <= m[b.key] ? a : b);
  const praiseMap = {
    army: 'Держава твоя крепка: под твоим стягом дружины идут охотно, а враги считают дважды.',
    people: 'Народ тебя любит — а это дороже золота и мечей вместе взятых.',
    gold: 'Казна полна: замыслы твои обеспечены, а слово «не на что» тебе не знакомо.',
    chron: 'Летописцы спорят, кому приписать тебя в хрониках, — и переписывают твоё имя каллиграфически.'
  };
  const adviceMap = {
    army: 'Но держи в уме: Держава твоя пошатнулась — береги дружину и не лезь в бой без нужды.',
    people: 'Но помни: Народ ропщет. Голодный или обиженный народ прощает всё, кроме равнодушия князя.',
    gold: 'Но помни: Казна пуста. Богатая земля — спокойная земля; умей копить.',
    chron: 'Но помни: Летописец хмур. История смотрит не только на победы, но и на справедливость.'
  };
  return '<p>Правитель <b>' + esc(P().name) + '</b>! Правление «' + esc(r.title) + '» (' + esc(r.years) + ') завершено. Летопись пишется — и в ней о тебе скажут так:</p>' +
    '<p>' + praiseMap[best.key] + '</p><p>' + adviceMap[worst.key] + '</p>' +
    '<div style="text-align:right;font-style:italic;margin-top:8px">Записано и сохранено.<br>Твой Летописец 📜</div>';
}
const METRICS = DATA.metrics;

/* ---------- темы ---------- */
function applyTheme() {
  store.ui = store.ui || {};
  if (!['royal', 'day', 'neon'].includes(store.ui.theme)) store.ui.theme = 'royal';
  document.body.dataset.theme = store.ui.theme;
}
const THEMES = [
  { id: 'royal', name: 'Царская', desc: 'тёмная с золотом', colors: ['#10131a', '#1c222e', '#d4af5e'] },
  { id: 'day', name: 'Светлая', desc: 'пергамент днём', colors: ['#f0ece1', '#ffffff', '#9a7a2e'] },
  { id: 'neon', name: 'Неон', desc: 'индиго-фиолетовая', colors: ['#0d1017', '#1b2231', '#8b9dff'] }
];

/* ---------- монеты и сейфы ---------- */
function addPoints(n, silent) {
  const p = P();
  p.points += n;
  saveStore();
  if (!silent) toast('+' + n + ' 🪙 в казну');
  checkSafes();
}
function checkSafes() {
  const p = P();
  DATA.safes.forEach((thr, i) => {
    if (p.points >= thr && p.safesOpened.indexOf(i) < 0) {
      p.safesOpened.push(i);
      safeModalQueue.push(i);
    }
  });
  saveStore();
  if (safeModalQueue.length) showNextSafe();
}
function safePrize(i) {
  const custom = store.admin.prizes[i];
  return custom && custom.text ? custom : { text: 'Приз №' + (i + 1) + ' — получи у родителей!', img: '' };
}
function showNextSafe() {
  if ($('modal-root').classList.contains('show')) return;
  const i = safeModalQueue.shift();
  if (i === undefined) return;
  const prize = safePrize(i);
  confetti();
  showModal(`
    <h2>Сундук открыт!</h2>
    <div class="big">🪙✨</div>
    <p>Твоя казна доросла до ${DATA.safes[i]} 🪙 — сундук №${i + 1} поддался!</p>
    <div style="background:var(--panel-soft);border:2px dashed var(--gold);border-radius:8px;padding:14px;margin:10px 0;">
      <div style="font-size:2em">🎁</div>
      <p style="font-size:1.15em"><b>${esc(prize.text)}</b></p>
      ${prize.img ? `<img src="${esc(prize.img)}" style="max-width:100%;border-radius:8px;">` : ''}
      <p class="small" style="color:var(--ink-soft)">Получи приз у родителей — и возвращайся на престол!</p>
    </div>
    <button class="gold" onclick="closeModal()">Продолжить правление</button>`);
}

/* ---------- достижения ---------- */
function unlockAch(id) {
  const p = P();
  if (!p || p.achievements.indexOf(id) >= 0) return;
  const a = DATA.achievements.find(x => x.id === id);
  if (!a) return;
  p.achievements.push(id);
  saveStore();
  toast(`${a.emoji} Награда: «${a.title}»`, 'ach');
}
function touchActivity() {
  const p = P();
  if (!p) return;
  if (p.activity.indexOf(today()) < 0) { p.activity.push(today()); saveStore(); }
}

/* ---------- сессия правления ---------- */
function getReignState(id) {
  const p = P();
  if (!p.reigns[id]) {
    p.reigns[id] = {
      session: { idx: 0, metrics: Object.assign({}, DATA.reigns.find(r => r.id === id).start), pending: null, minMetrics: Math.min(...Object.values(DATA.reigns.find(r => r.id === id).start)) },
      status: null, earned: {}, log: []
    };
    saveStore();
  }
  return p.reigns[id];
}
/* ---------- вопрос дня и календарь огня ---------- */
function dateStr(offset) {
  const d = new Date();
  d.setDate(d.getDate() + (offset || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dayQFor(dstr) {
  const n = Math.floor(Date.parse(dstr) / 86400000);
  return DATA.dayQuestions[n % DATA.dayQuestions.length];
}
function flameOf() {
  const p = P();
  if (!p.flame) p.flame = { last: null, streak: 0, best: 0, days: {} };
  return p.flame;
}
function flameOnSolve() {
  const f = flameOf();
  const d = today();
  if (f.last === d) return;
  f.streak = (f.last === dateStr(-1)) ? f.streak + 1 : 1;
  f.last = d;
  f.best = Math.max(f.best, f.streak);
  f.days[d] = true;
  const keys = Object.keys(f.days).sort();
  while (keys.length > 30) delete f.days[keys.shift()];
  saveStore();
  if (f.streak >= 3) unlockAch('a_flame');
}
function daySolvedToday() {
  const p = P();
  return !!(p.flame && p.flame.days && p.flame.days[today()]);
}
function flameStripHtml() {
  const p = P();
  const f = p.flame || { streak: 0, best: 0, days: {} };
  const names = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
  let cells = '';
  for (let i = 6; i >= 0; i--) {
    const d = dateStr(-i);
    const lit = !!(f.days && f.days[d]);
    const wd = names[(new Date(d).getDay() + 6) % 7];
    cells += `<div class="flame-cell ${lit ? 'lit' : ''} ${i === 0 ? 'today' : ''}"><span class="f-ico">${lit ? '🔥' : '·'}</span><span class="f-day">${wd}</span></div>`;
  }
  return `<div class="flame-strip">${cells}</div>`;
}
function dayCardHtml() {
  const f = P().flame || { streak: 0, best: 0 };
  const solved = daySolvedToday();
  return `
  <div class="paper day-card">
    <h4>🔥 Вопрос дня</h4>
    <div class="day-row">
      <div class="flame-info">серия: <b>${f.streak || 0}</b> 🔥 · рекорд: <b>${f.best || 0}</b></div>
      ${flameStripHtml()}
      ${solved
        ? '<span class="result-ok">✔ отвечено сегодня — до завтра!</span>'
        : '<button class="gold" data-act="dayOpen">Ответить на вопрос дня 🔥</button>'}
    </div>
  </div>`;
}
function dayOpen() {
  const t = dayQFor(today());
  showModal(`
    <h2>🔥 Вопрос дня</h2>
    <p>${t.q}</p>
    ${t.options.map((o, i) => `<button class="report-opt" data-act="dayOpt" data-arg="${i}">${esc(o)}</button>`).join('')}
    <div id="day-res"></div>
    <p class="small" style="color:var(--ink-soft);margin-top:6px">Верный ответ с первой попытки: 10 🪙. Неверные варианты просто отметятся — пробуй дальше.</p>`);
}
function dayOpt(i) {
  const t = dayQFor(today());
  if (daySolvedToday()) return;
  if (i === t.correct) {
    flameOnSolve();
    addPoints(10);
    TL.send('daytask', '✔ +10 🪙 серия=' + P().flame.streak);
    confetti();
    showModal(`
      <h2>🔥 Верно!</h2>
      <div class="big">🔥</div>
      <p>+10 🪙 в казну${P().flame.streak > 1 ? ' · серия: ' + P().flame.streak + ' дней 🔥' : ''}</p>
      <div class="hist-note" style="text-align:left">${t.explain}</div>
      <button class="gold" data-act="dayDone">Отлично!</button>`);
  } else {
    TL.send('daytask', '✘');
    const res = $('day-res');
    if (res) res.innerHTML = '<span class="result-bad">Не то — отметим и подумаем ещё!</span>';
    const btn = document.querySelector(`[data-act="dayOpt"][data-arg="${i}"]`);
    if (btn) { btn.disabled = true; btn.style.opacity = .4; }
  }
}
/* ---------- ИИ-наставник «Спросить Летописца» ---------- */
let askState = { ctx: '', history: [], busy: false };
function askOpen(ctx) {
  askState = { ctx: ctx, history: [], busy: false };
  showModal(`
    <h2>🤖 Спросить Летописца</h2>
    <p class="small" style="color:var(--ink-soft)">Летописец не выберет за тебя — он напомнит историю и подскажет, о чём подумать.</p>
    <div id="ask-log" style="text-align:left;max-height:40vh;overflow:auto;margin:10px 0"></div>
    <div class="answer-row" style="justify-content:center">
      <input type="text" id="ask-input" placeholder="Спроси Летописца…" autocomplete="off" style="flex:1;min-width:180px">
      <button class="gold" data-act="askSend">Спросить</button>
    </div>
    <div style="margin-top:8px"><button class="small-btn ghost" data-act="closeModal">Закрыть</button></div>
  `);
  renderAskLog();
  setTimeout(() => { const i = $('ask-input'); if (i) i.focus(); }, 50);
}
function renderAskLog() {
  const box = $('ask-log');
  if (!box) return;
  box.innerHTML = askState.history.map(m => m.role === 'user'
    ? `<div style="background:var(--note-bg);border-radius:10px;padding:8px 12px;margin:6px 0;color:var(--note-ink)"><b>Ты:</b> ${esc(m.text)}</div>`
    : `<div style="background:var(--hint-bg);border-radius:10px;padding:8px 12px;margin:6px 0"><b>Летописец:</b> ${esc(m.text)}</div>`).join('')
    + (askState.busy ? '<div class="small muted">Летописец листает хроники…</div>' : '');
  box.scrollTop = box.scrollHeight;
}
async function askSend() {
  const inp = $('ask-input');
  if (!inp || askState.busy) return;
  const q = inp.value.trim();
  if (!q) return;
  inp.value = '';
  askState.history.push({ role: 'user', text: q });
  askState.busy = true;
  renderAskLog();
  const p = P();
  try {
    const r = await fetch('https://game-metrics.kirillovd.workers.dev/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: q, ctx: askState.ctx, g: 'prestol', p: p ? p.name : '' })
    });
    const d = await r.json();
    askState.history.push({ role: 'bot', text: d.answer || 'Хм. Вспомни, что было раньше в этой истории — и скажи мне, какие силы сталкиваются.' });
  } catch (e) {
    askState.history.push({ role: 'bot', text: 'Связь с Летописцем пропала — попробуй ещё раз.' });
  }
  askState.busy = false;
  renderAskLog();
}
function reignUnlocked(idx) {
  if (idx === 0) return true;
  const prev = DATA.reigns[idx - 1];
  const st = P().reigns[prev.id];
  return !!(st && st.status) || !!(P().earlyUnlock && P().earlyUnlock[DATA.reigns[idx].id]);
}
function reignStats(id) {
  const r = DATA.reigns.find(x => x.id === id);
  const st = P().reigns[id];
  return {
    done: !!(st && st.status),
    status: st ? st.status : null,
    inProgress: !!(st && !st.status && st.session.idx > 0)
  };
}

/* ---------- маршрутизация ---------- */
function route() {
  const h = location.hash.replace(/^#/, '');
  const p = P();
  if (!p) { renderProfiles(); return; }
  touchActivity();
  if (!h.startsWith('reign/')) TL.curReign = null;
  if (!TL.logged) { TL.logged = true; TL.send('login', 'монет: ' + p.points); }
  if (!p.briefed && h !== 'intro' && h !== 'admin') { renderIntro(); return; }
  if (h === '' || h === 'map') renderMap();
  else if (h.startsWith('reign/')) renderReign(h.split('/')[1]);
  else if (h === 'tournament') renderTournament();
  else if (h === 'ach') renderAch();
  else if (h === 'profile') renderProfilePage();
  else if (h === 'admin') renderAdmin();
  else renderMap();
}
window.addEventListener('hashchange', route);

/* ---------- шапка ---------- */
function headerHtml(active) {
  const p = P();
  const nextSafeIdx = DATA.safes.findIndex((thr, i) => p.safesOpened.indexOf(i) < 0);
  let safeBar = '';
  if (nextSafeIdx >= 0) {
    const prev = nextSafeIdx === 0 ? 0 : DATA.safes[nextSafeIdx - 1];
    const thr = DATA.safes[nextSafeIdx];
    const pct = Math.min(100, Math.round((p.points - prev) / (thr - prev) * 100));
    safeBar = `
      <div class="safe-progress">
        <span>🪙 Сундук №${nextSafeIdx + 1}</span>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <span>${p.points} / ${thr}</span>
      </div>`;
  } else {
    safeBar = `<div class="safe-progress"><span>🪙 Все сундуки вскрыты — ты легенда казны!</span></div>`;
  }
  const links = [['map', '🗺️ Престолы'], ['tournament', '🏆 Турнир'], ['ach', '🏅 Награды']];
  const nav = links.map(([id, label]) => `<a href="#${id}" ${active === id ? 'style="font-weight:bold"' : ''}>${label}</a>`).join(' · ');
  return `
    <div class="topbar">
      <span class="brand">👑 Престол эпох</span>
      <span class="agent-chip">${p.emoji} <b>${esc(p.name)}</b> · ${titleFor(p.points)}</span>
      <span class="spacer"></span>
      <span class="points-chip">🪙 ${p.points}</span>
    </div>
    <div style="margin-bottom:8px;" class="small">${nav} · <a href="#profile">👤 Профиль</a> · <a href="#admin">🔑 Родителям</a></div>
    ${safeBar}`;
}
function footerHtml() {
  return `<footer class="site-foot">${DATA.credits}<br>Прогресс хранится в этом браузере; кнопка сохранения в файл — на странице профиля.</footer>`;
}

/* ---------- профили ---------- */
function renderProfiles() {
  const list = Object.keys(store.profiles).map(id => {
    const p = store.profiles[id];
    return `<div class="profile-card" data-act="pickProfile" data-arg="${id}">
      <div class="avatar">${p.emoji}</div>
      <b>${esc(p.name)}</b><br><small>${titleFor(p.points)} · 🪙 ${p.points}</small>
    </div>`;
  }).join('');
  $('app').innerHTML = `
    <div class="topbar"><span class="brand">👑 Престол эпох</span></div>
    <p class="board-intro">Симулятор правителя: садись на престолы русских князей и принимай решения, изменившие историю. Выбери правителя — или начни новый.</p>
    <div class="profile-grid">${list || '<span class="muted">Пока никто не занимал престол.</span>'}</div>
    <div class="paper" style="max-width:460px">
      <h4>Новый правитель</h4>
      <p class="small">Как записать тебя в летопись?</p>
      <input type="text" id="np-name" maxlength="20" placeholder="Имя правителя" style="width:100%">
      <div class="emoji-pick" id="np-emoji"></div>
      <button class="gold" data-act="createProfile">Занести в летопись ✒️</button>
    </div>
    ${footerHtml()}`;
  const avatars = ['👑', '🤴', '👸', '⚔️', '🛡️', '🐎', '🕊️', '📜', '🦅', '🐺'];
  const box = $('np-emoji');
  box.innerHTML = avatars.map((a, i) => `<button data-act="pickEmoji" data-arg="${i}" class="${i === 0 ? 'sel' : ''}">${a}</button>`).join('');
  box.dataset.sel = '0';
}

/* ---------- вступление (слово летописца) ---------- */
function renderIntro() {
  const p = P();
  $('app').innerHTML = `
  <div class="topbar">
    <span class="brand">👑 Престол эпох</span>
    <span class="spacer"></span>
    <span class="agent-chip">${p.emoji} <b>${esc(p.name)}</b></span>
  </div>
  <div class="paper" style="max-width:640px;margin:10px auto 0">
    <div style="text-align:right;color:var(--ink-soft);font-size:.85em">СЛОВО ЛЕТОПИСЦА · ПЕРЕД НАЧАЛОМ</div>
    <p>Слушай, правитель. Меня зовут Летописец. Я записываю всё, что делают князья земли Русской, — и скоро моё перо коснётся тебя.</p>
    <p>Ты пройдёшь <b>три правления</b>: князя Владимира, что выбирал веру для всей Руси; князя Александра, что бился на льду Чудского озера; и князя Дмитрия, что вывел Русь на поле Куликово. В каждом ты будешь принимать решения за настоящего правителя — и сравнивать свой путь с тем, что случилось на самом деле.</p>
    <p>Над каждым твоим решением будут висеть четыре шкалы: <b>⚔️ Держава</b>, <b>🌾 Народ</b>, <b>💰 Казна</b> и <b>📜 Летописец</b> (моё мнение о тебе — не последнее дело!). Шкала дошла до пустоты — правление оборвётся раньше срока.</p>
    <p>За советом ко мне будет приходить <b>гонец с донесениями</b>: в них правда мешается с ложью, и отличить одно от другого — половина ума правителя.</p>
    <p>Мудрые решения и верные донесения приносят <b>монеты 🪙</b>. Монеты открывают <b>сундуки</b>, а в сундуках — настоящие призы: за ними идти к родителям. Проходя правления, заработаешь титул — от старейшины до Легенды летописей.</p>
    <p>И последнее. Там, где твой выбор разойдётся с историей, я честно напишу: <b>«а было так…»</b>. Историю не переписать — но понять её можно только примерив на себя.</p>
    <div style="text-align:right;font-style:italic;color:var(--ink-soft)">— Летописец 📜</div>
  </div>
  <div style="text-align:center;margin:18px 0 30px">
    <button class="gold" style="font-size:1.15em;padding:12px 26px" data-act="introGo">Сесть на престол 👑</button>
  </div>
  ${footerHtml()}`;
}

/* ---------- карта престолов ---------- */
function renderMap() {
  const p = P();
  let cards = '';
  DATA.reigns.forEach((r, idx) => {
    if (!reignUnlocked(idx)) {
      cards += `
      <div class="reign-card">
        <div class="pin">🔒</div>
        <div class="reign-paper" style="opacity:.75">
          <h3>Правление №${r.num}. ${esc(r.title)}</h3>
          <div class="sub">${esc(r.years)}</div>
          <p class="small">Летописец советует пройти предыдущее правление. Но смелых он не держит.</p>
          <button class="ghost" data-act="earlyUnlock" data-arg="${r.id}">Открыть досрочно 🔓</button>
        </div>
      </div>`;
      return;
    }
    const st = reignStats(r.id);
    const pinCls = st.status === 'triumph' ? 'done' : (st.status === 'crisis' ? 'risk' : '');
    const pinIco = st.status === 'triumph' ? '✅' : (st.status === 'crisis' ? '⚠️' : r.emoji);
    const stamp = st.status === 'triumph' ? '<div class="stamp ok">В летописи</div>' : (st.status === 'crisis' ? '<div class="stamp bad">Кризис</div>' : '');
    const btnLabel = st.status ? 'Переиграть' : (st.inProgress ? 'Продолжить' : 'Начать правление');
    cards += `
      <div class="reign-card">
        <div class="pin ${pinCls}">${pinIco}</div>
        <div class="reign-paper">
          ${stamp}
          <h3>Правление №${r.num}. ${esc(r.title)}</h3>
          <div class="sub">${esc(r.years)}</div>
          <p class="small">${esc(r.hero)}</p>
          <div class="reign-meta">
            <button class="gold" data-act="goto" data-arg="#reign/${r.id}">${btnLabel}</button>
            ${st.inProgress ? '<span class="small muted">правление начато</span>' : ''}
          </div>
        </div>
      </div>`;
  });
  const safesRow = DATA.safes.map((thr, i) => {
    const opened = p.safesOpened.indexOf(i) >= 0;
    return `<div class="safe-box ${opened ? 'open' : ''}" title="${thr} 🪙" ${opened ? `data-act="showSafe" data-arg="${i}"` : ''}>${opened ? '🎁' : '🔒'}</div>`;
  }).join('');
  $('app').innerHTML = headerHtml('map') + `
    ${dayCardHtml()}
    <p class="board-intro">Нить времён. Иди по порядку: от крещения Руси — к полю Куликову. Сундуки открываются сами, когда казна дорастает 🪙.</p>
    <div class="safe-row">${safesRow}</div>
    <div class="path">${cards}</div>
    <div class="paper">
      <h4>🏆 Турнир знатоков</h4>
      <p>12 вопросов по трём правлениям — проверка памяти правителя. <a href="#tournament">В турнирный шатёр</a>.</p>
    </div>
    ${footerHtml()}`;
}

/* ---------- правление ---------- */
function metricBarHtml(m) {
  return METRICS.map(mt => {
    const v = m[mt.key];
    const low = v <= 2;
    return `<div class="metric" title="${esc(mt.hint)}">
      <span class="m-ico">${mt.emoji}</span>
      <div class="m-bar"><i class="${low ? 'low' : 'ok'}" style="width:${v * 10}%"></i></div>
      <span class="m-name">${mt.name}</span>
    </div>`;
  }).join('');
}
function renderReign(id) {
  const r = DATA.reigns.find(x => x.id === id);
  if (!r) { location.hash = 'map'; return; }
  const idxOfR = DATA.reigns.indexOf(r);
  if (!reignUnlocked(idxOfR)) { location.hash = 'map'; return; }
  const p = P();
  const st = getReignState(id);
  if (!st.session.ended && TL.curReign !== id) { TL.curReign = id; TL.send('reign_open', id); }

  // Финальный экран
  if (st.session.ended) { renderReignFinale(r, st); return; }

  const card = r.cards[st.session.idx];
  let cardHtml = '';
  if (card.type === 'scene') {
    if (st.session.pending && st.session.pending.cardId === card.id) {
      const ch = card.choices[st.session.pending.choice];
      const eff = Object.entries(ch.effects || {}).map(([k, v]) => {
        const mt = METRICS.find(m => m.key === k);
        return `${mt.emoji} ${v > 0 ? '+' : ''}${v}`;
      }).join(' · ');
      cardHtml = `
        <div class="paper scene-card">
          <span class="scene-tag">СЦЕНА ${st.session.idx + 1} ИЗ ${r.cards.length}</span>
          <p>${card.text}</p>
          <div class="consequence"><b>${esc(ch.label)}</b><br>${ch.outcome}<br><span class="small muted">${eff}</span></div>
          ${ch.hist ? `<div class="hist-note"><b>📜 Летопись говорит:</b> ${ch.hist}</div>` : ''}
          <button class="gold" data-act="reignNext" data-arg="${id}">Дальше 👉</button>
        </div>`;
    } else {
      cardHtml = `
        <div class="paper scene-card">
          <span class="scene-tag">СЦЕНА ${st.session.idx + 1} ИЗ ${r.cards.length}</span>
          <p>${card.text}</p>
          ${card.choices.map((ch, i) => `<button class="choice-btn" data-act="reignChoose" data-arg="${id}|${card.id}|${i}">${esc(ch.label)}</button>`).join('')}
          <div style="margin-top:8px"><button class="small-btn ghost" data-act="askScene" data-arg="${id}|${card.id}">🤖 Спросить Летописца</button></div>
        </div>`;
    }
  } else if (card.type === 'report') {
    if (st.session.pending && st.session.pending.cardId === card.id) {
      const picked = st.session.pending.choice;
      const ok = picked === card.correct;
      cardHtml = `
        <div class="paper scene-card">
          <span class="scene-tag report">ДОНЕСЕНИЕ ГОНЦА</span>
          <p>${card.q}</p>
          <p class="${ok ? 'result-ok' : 'result-bad'}">${ok ? '✔ Правда распознана! +20 🪙' : '✘ Неверный ответ'}</p>
          <div class="hist-note">${card.explain}</div>
          <button class="gold" data-act="reignNext" data-arg="${id}">Дальше 👉</button>
        </div>`;
    } else {
      cardHtml = `
        <div class="paper scene-card">
          <span class="scene-tag report">ДОНЕСЕНИЕ ГОНЦА</span>
          <p>${card.q}</p>
          ${card.options.map((o, i) => `<button class="report-opt" data-act="reignReport" data-arg="${id}|${card.id}|${i}">${esc(o)}</button>`).join('')}
        </div>`;
    }
  }

  $('app').innerHTML = headerHtml() + `
    <div class="case-head">
      <h2>Правление №${r.num}. ${esc(r.title)}</h2>
      <span class="small muted">${esc(r.years)}</span>
      <span class="small"><a href="#map" class="linklike">← к престолам</a></span>
    </div>
    <div class="paper">
      <h4>Правитель</h4>
      <p class="small">${esc(r.intro)}</p>
    </div>
    <div class="metrics">${metricBarHtml(st.session.metrics)}</div>
    ${cardHtml}
    ${footerHtml()}`;
}
function reignChoose(id, cardId, choiceIdx) {
  const r = DATA.reigns.find(x => x.id === id);
  const st = getReignState(id);
  const card = r.cards[st.session.idx];
  if (!card || card.id !== cardId) return;
  const p = P();
  const ch = card.choices[choiceIdx];
  // эффекты
  const m = st.session.metrics;
  for (const [k, v] of Object.entries(ch.effects || {})) {
    m[k] = Math.max(0, Math.min(10, m[k] + v));
  }
  st.session.minMetrics = Math.min(st.session.minMetrics, ...Object.values(m));
  // лог для родителей
  st.log.push({ card: cardId, choice: choiceIdx, label: ch.label, day: today() });
  TL.send('choice', id + '/' + cardId + ' ' + (ch.wise ? '(мудрое) ' : '') + ch.label.slice(0, 90));
  if (ch.wise) praiseToast();
  hist('choice', r.title + ': ' + ch.label.slice(0, 60));
  st.session.pending = { cardId, choice: choiceIdx };
  // монеты за мудрость (первый раз)
  if (ch.wise && !st.earned['w_' + cardId]) {
    st.earned['w_' + cardId] = true;
    p.wiseCount = (p.wiseCount || 0) + 1;
    addPoints(10, true);
  }
  unlockAch('a_first');
  if ((p.wiseCount || 0) >= 10) unlockAch('a_wise');
  // предупреждение о низкой шкале и смерть шкалы?
  st.session.warned = st.session.warned || {};
  for (const mt of METRICS) {
    if (m[mt.key] <= 2 && m[mt.key] > 0 && !st.session.warned[mt.key]) {
      st.session.warned[mt.key] = true;
      toast('⚠️ ' + mt.name + ' на исходе («' + mt.hint + '») — следующий выбор может всё решить.');
    }
  }
  if (Object.values(m).some(v => v <= 0)) {
    st.session.ended = 'crisis';
    hist('crisis', 'Кризис правления: ' + r.title);
    TL.send('reign_end', id + ' КРИЗИС');
  }
  saveStore();
  renderReign(id);
}
function reignReport(id, cardId, choiceIdx) {
  const r = DATA.reigns.find(x => x.id === id);
  const st = getReignState(id);
  const card = r.cards[st.session.idx];
  if (!card || card.id !== cardId) return;
  const p = P();
  st.log.push({ card: cardId, choice: choiceIdx, label: card.options[choiceIdx], day: today() });
  TL.send('report', id + '/' + cardId + (choiceIdx === card.correct ? ' ✔' : ' ✘'));
  st.session.pending = { cardId, choice: choiceIdx };
  if (choiceIdx === card.correct && !st.earned['r_' + cardId]) {
    st.earned['r_' + cardId] = true;
    p.reportCount = (p.reportCount || 0) + 1;
    addPoints(20, true);
  } else if (choiceIdx === card.correct) {
    p.reportCount = (p.reportCount || 0) + 1;
  }
  if ((p.reportCount || 0) >= 8) unlockAch('a_gonets');
  saveStore();
  renderReign(id);
}
function reignNext(id) {
  const r = DATA.reigns.find(x => x.id === id);
  const st = getReignState(id);
  if (st.session.ended) { renderReign(id); return; }
  st.session.pending = null;
  st.session.idx++;
  if (st.session.idx >= r.cards.length) finishReign(id);
  saveStore();
  if (!st.session.ended) renderReign(id);
}
function finishReign(id) {
  const r = DATA.reigns.find(x => x.id === id);
  const st = getReignState(id);
  const p = P();
  st.session.ended = 'triumph';
  st.status = 'triumph';
  TL.send('reign_end', id + ' триумф, летописец: ' + st.session.metrics.chron);
  hist('reign_end', 'Правление завершено: ' + r.title);
  const p2 = P();
  p2.chronLetters = p2.chronLetters || {};
  p2.chronLetters[id] = buildChronLetter(id);
  saveStore();
  if (!st.earned['finale']) {
    st.earned['finale'] = true;
    addPoints(50, true);
  }
  if (st.session.minMetrics >= 3 && !st.earned['perfect']) {
    st.earned['perfect'] = true;
    addPoints(30, true);
    unlockAch('a_perfect');
  }
  if (id === 'vladimir') unlockAch('a_vladimir');
  if (id === 'alexander') unlockAch('a_alexander');
  if (id === 'dmitry') unlockAch('a_dmitry');
  confetti();
  saveStore();
}
function renderReignFinale(r, st) {
  const chron = st.session.metrics.chron;
  let finTitle = DATA.reigns.find(x => x.id === r.id).finaleTitles[DATA.reigns.find(x => x.id === r.id).finaleTitles.length - 1][1];
  for (const [min, t] of r.finaleTitles) { if (chron >= min) { finTitle = t; break; } }
  const isCrisis = st.session.ended === 'crisis';
  // ключевые решения игрока
  const myChoices = r.cards.filter(c => c.type === 'scene').map((c, i) => {
    const logItem = st.log.find(l => l.card === c.id);
    return logItem ? `<div class="chron-row"><div class="c-moment">Решение ${i + 1}</div><div class="c-body">${esc(logItem.label)}</div></div>` : '';
  }).join('');
  const chronicle = r.chronicle.map(c => `
    <div class="chron-row"><div class="c-moment">${esc(c.moment)}</div><div class="c-body">${esc(c.history)}</div></div>`).join('');
  $('app').innerHTML = headerHtml() + `
    <div class="case-head"><h2>Правление №${r.num}. ${esc(r.title)} — итог</h2></div>
    ${isCrisis ? `
      <div class="paper" style="border:2px solid var(--red)">
        <h4 style="color:var(--red)">⚠️ ПРАВЛЕНИЕ ОБОРВАЛОСЬ</h4>
        <p>Одна из шкал опустела — и земля не удержала правителя. Так тоже бывает: история знает князей, проигравших всё за один год.</p>
        <p class="small muted">Переиграй правление — летописец даёт вторые шары… то есть шансы.</p>
      </div>` : `
      <div class="paper" style="border:2px solid var(--gold);text-align:center">
        <h4>📜 ПРАВЛЕНИЕ ЗАВЕРШЕНО</h4>
        <p style="font-size:1.25em"><b>${esc(finTitle)}</b></p>
        <p class="small muted">+50 🪙 за завершение${st.session.minMetrics >= 3 ? ' · +30 🪙 за мудрое правление' : ''}</p>
      </div>`}
    ${!isCrisis && P().chronLetters && P().chronLetters[r.id] ? `<div class="paper" style="border:2px solid var(--gold)"><h4>📩 Письмо от Летописца</h4>${P().chronLetters[r.id]}</div>` : ''}
    <div class="metrics">${metricBarHtml(st.session.metrics)}</div>
    <div class="paper">
      <h4>Твои решения</h4>
      ${myChoices || '<p class="small muted">—</p>'}
    </div>
    <div class="paper">
      <h4>📜 А было так (летопись)</h4>
      ${chronicle}
    </div>
    <div style="display:flex;gap:10px;justify-content:center;margin:18px 0">
      <button class="gold" data-act="goto" data-arg="#map">К престолам 🗺️</button>
      <button class="ghost" data-act="reignRestart" data-arg="${r.id}">Переиграть правление 🔄</button>
    </div>
    ${footerHtml()}`;
}
function reignRestart(id) {
  const st = getReignState(id);
  const r = DATA.reigns.find(x => x.id === id);
  st.session = { idx: 0, metrics: Object.assign({}, r.start), pending: null, minMetrics: Math.min(...Object.values(r.start)), ended: null };
  st.log = [];
  saveStore();
  renderReign(id);
}

/* ---------- турнир ---------- */
function renderTournament() {
  const p = P();
  const T = DATA.tournament;
  p.tournament = p.tournament || { answers: {}, earned: {}, best: null, idx: 0 };
  const t = p.tournament;
  if (t.idx >= T.questions.length) {
    const score = T.questions.filter(q => t.answers[q.id] === q.correct).length;
    if (t.best === null || score > t.best) t.best = score;
    saveStore();
    const rows = T.questions.map((q, i) => {
      const ok = t.answers[q.id] === q.correct;
      return `<div class="paper ${ok ? '' : ''}" style="padding:12px 16px">
        <b>Вопрос ${i + 1}</b> ${ok ? '<span class="result-ok">✔</span>' : '<span class="result-bad">✘</span>'}
        <p class="small" style="margin:6px 0">${q.q}</p>
        <div class="hist-note small">${q.explain}</div>
      </div>`;
    }).join('');
    $('app').innerHTML = headerHtml('tournament') + `
      <div class="paper" style="text-align:center">
        <h4>Протокол турнира</h4>
        <p style="font-size:1.3em">Верно <b>${score} из ${T.questions.length}</b></p>
        <p>${score >= 9 ? 'Летописец снял шапку: знаток эпох!' : score >= 6 ? 'Достойно, правитель! Разбери промахи ниже.' : 'Летопись ждёт реванша — повторение мать учения.'}</p>
        <button class="gold" data-act="tourRestart">Пройти снова 🔄</button>
      </div>
      ${rows}
      ${footerHtml()}`;
    return;
  }
  const q = T.questions[t.idx];
  const prev = t.idx > 0 ? T.questions[t.idx - 1] : null;
  const prevHtml = prev ? `<div class="paper" style="padding:12px 16px"><span class="${t.answers[prev.id] === prev.correct ? 'result-ok' : 'result-bad'}">${t.answers[prev.id] === prev.correct ? '✔' : '✘'}</span> ${prev.explain}</div>` : '';
  $('app').innerHTML = headerHtml('tournament') + `
    <div class="case-head"><h2>🏆 ${T.title}</h2><span class="small"><a href="#map" class="linklike">← к престолам</a></span></div>
    <p class="board-intro">${T.intro}</p>
    ${prevHtml}
    <div class="paper">
      <span class="scene-tag">ВОПРОС ${t.idx + 1} / ${T.questions.length}</span>
      <p>${q.q}</p>
      ${q.options.map((o, i) => `<button class="report-opt" data-act="tourAnswer" data-arg="${q.id}|${i}">${esc(o)}</button>`).join('')}
    </div>
    ${footerHtml()}`;
}
function tourAnswer(qid, i) {
  const p = P();
  const t = p.tournament;
  const q = DATA.tournament.questions.find(x => x.id === qid);
  t.answers[qid] = i;
  TL.send('tour', qid + (i === q.correct ? ' ✔' : ' ✘'));
  if (i === q.correct && !t.earned[qid]) {
    t.earned[qid] = true;
    addPoints(10, true);
  }
  t.idx++;
  if (t.idx >= DATA.tournament.questions.length) {
    const score = DATA.tournament.questions.filter(x => t.answers[x.id] === x.correct).length;
    if (score >= 9) unlockAch('a_tour');
  }
  saveStore();
  renderTournament();
}

/* ---------- награды ---------- */
function renderAch() {
  const p = P();
  const cards = DATA.achievements.map(a => {
    const has = p.achievements.indexOf(a.id) >= 0;
    return `<div class="ach-card ${has ? '' : 'locked'}"><div class="em">${a.emoji}</div><div><b>${a.title}</b><span class="small">${a.desc}</span></div></div>`;
  }).join('');
  $('app').innerHTML = headerHtml('ach') + `
    <div class="case-head"><h2>🏅 Награды правителя</h2></div>
    <div class="paper"><h4>Титул</h4><p>Сейчас: <b>${titleFor(p.points)}</b> (${p.points} 🪙).</p>
    <p class="small muted">${DATA.titles.map(x => x.name + ' (' + x.min + '🪙)').join(' → ')}</p></div>
    <div class="ach-grid">${cards}</div>
    ${footerHtml()}`;
}

/* ---------- профиль ---------- */
function renderProfilePage() {
  const p = P();
  const others = Object.keys(store.profiles).filter(id => id !== store.currentId)
    .map(id => `<button data-act="pickProfile" data-arg="${id}">${store.profiles[id].emoji} ${esc(store.profiles[id].name)}</button>`).join(' ');
  $('app').innerHTML = headerHtml('profile') + `
    <div class="case-head"><h2>👤 Профиль</h2></div>
    <div class="paper">
      <h4>Правитель ${esc(p.name)} ${p.emoji}</h4>
      <p>Титул: <b>${titleFor(p.points)}</b> · Казна: <b>${p.points} 🪙</b> · Наград: ${p.achievements.length}/${DATA.achievements.length} · Сундуков: ${p.safesOpened.length}/${DATA.safes.length}</p>
      <p class="small muted">В летописи с ${p.created}.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button data-act="goto" data-arg="#map">К престолам</button>
        ${others ? `<span class="small muted">Сменить:</span> ${others}` : ''}
        <button class="ghost" data-act="saveProgress">💾 Сохранить в файл</button>
        <button class="ghost" data-act="resetProgress">🗑 Начать заново</button>
      </div>
    </div>
    <div class="paper">
      <h4>Оформление</h4>
      <div class="theme-grid">
        ${THEMES.map(t => `
        <button class="theme-card ${store.ui.theme === t.id ? 'sel' : ''}" data-act="setTheme" data-arg="${t.id}">
          <div class="swatch">${t.colors.map(c => `<i style="background:${c}"></i>`).join('')}</div>
          <div class="t-label"><b>${t.name}</b><br><span class="small muted">${t.desc}</span></div>
        </button>`).join('')}
      </div>
    </div>
    <div class="paper"><h4>Перенос прогресса</h4>
      <p class="small">Прогресс живёт в этом браузере. Перенос на другое устройство: сохрани в файл здесь, загрузи на странице «Родителям» там.</p>
    </div>
    ${footerHtml()}`;
}
function saveProgress() {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'prestol-epoh-' + (P() ? P().name : 'save') + '-' + today() + '.json';
  a.click();
  toast('Файл сохранён — смотри в загрузки 💾');
}

/* ---------- родителям ---------- */
function weekReportHtml() {
  const p = P();
  const H = p.history || [];
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(today(-i));
  const names = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const rows = days.map(d => {
    const evs = H.filter(h => h.d === d);
    const wd = names[new Date(d).getDay()];
    if (!evs.length) return '<div class="prize-row"><span class="small muted">' + wd + ' ' + d.slice(5) + ' — тишина</span></div>';
    const parts = evs.map(h => esc(h.x));
    return '<div class="prize-row"><div style="flex:1;min-width:0"><b>' + wd + ' ' + d.slice(5) + '</b><div class="small muted">' + parts.slice(0, 8).join(' · ') + (parts.length > 8 ? ' …' : '') + '</div></div></div>';
  });
  const active = days.filter(d => H.some(h => h.d === d)).length;
  return rows.join('') + '<p class="small muted">Дней с занятиями за неделю: ' + active + ' из 7. Серия вопроса дня: ' + ((p.flame && p.flame.streak) || 0) + ' 🔥 (рекорд ' + ((p.flame && p.flame.best) || 0) + ').</p>';
}
function adminChronicleHtml() {
  const p = P();
  if (!p) return '';
  const rows = [];
  DATA.reigns.forEach(r => {
    const st = p.reigns[r.id];
    if (!st || !st.log.length) return;
    const status = st.status === 'triumph' ? '✔ завершено' : (st.status === 'crisis' ? '⚠️ кризис' : '— в процессе');
    const items = st.log.map(l => `<li class="small">${esc(l.label)} <span class="muted">(${l.day})</span></li>`).join('');
    rows.push(`<div class="prize-row" style="align-items:flex-start"><div style="flex:1;min-width:0">
      <b>Правление №${r.num}. ${esc(r.title)}</b> <span class="small" style="color:var(--muted)">(${status})</span>
      <ul style="margin:6px 0 0;padding-left:18px">${items}</ul>
    </div></div>`);
  });
  return rows.length ? rows.join('') : '<p class="small">Правитель ещё не принимал решений.</p>';
}
function renderAdmin() {
  const pin = store.admin.pin;
  if (pin === null) {
    $('app').innerHTML = `
      <div class="topbar"><span class="brand">🔑 Родителям</span><span class="spacer"></span><a href="#map" class="small">← назад</a></div>
      <div class="admin-box"><h3>Установка PIN</h3>
      <p class="small">Придумайте 4-значный PIN — он закроет эту страницу от юных правителей.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><input type="password" id="pin1" maxlength="4" placeholder="PIN"> <input type="password" id="pin2" maxlength="4" placeholder="ещё раз"> <button class="gold" data-act="pinSet">Сохранить</button></div>
      <div id="pin-res"></div></div>`;
    return;
  }
  if (!store.adminAuthed) {
    $('app').innerHTML = `
      <div class="topbar"><span class="brand">🔑 Родителям</span><span class="spacer"></span><a href="#map" class="small">← назад</a></div>
      <div class="admin-box"><h3>Введите PIN</h3>
      <div style="display:flex;gap:8px"><input type="password" id="pin" maxlength="4" placeholder="PIN"> <button class="gold" data-act="pinCheck">Войти</button></div><div id="pin-res"></div></div>`;
    return;
  }
  const prizeRows = DATA.safes.map((thr, i) => {
    const pr = store.admin.prizes[i] || {};
    return `<div class="prize-row">
      <span class="thr">Сундук №${i + 1}<br><small>${thr} 🪙</small></span>
      <input type="text" data-prize="${i}" value="${esc(pr.text || '')}" placeholder="Например: поход в кино / сладость / 300 ₽">
      <input type="text" data-prizeimg="${i}" value="${esc(pr.img || '')}" placeholder="ссылка на картинку (необязательно)">
    </div>`;
  }).join('');
  $('app').innerHTML = `
    <div class="topbar"><span class="brand">🔑 Родителям</span><span class="spacer"></span><a href="#map" class="small">← назад</a></div>
    <div class="admin-box"><h3>Призы в сундуках</h3>
      <p class="small">Сундук открывается сам при накоплении монет: ${DATA.safes.join(', ')}. Тексты хранятся только в этом браузере. Пустое поле = нейтральная надпись.</p>
      ${prizeRows}
      <div style="display:flex;gap:8px;align-items:center"><button class="gold" data-act="prizesSave">Сохранить призы</button><span id="prizes-res"></span></div>
    </div>
    <div class="admin-box"><h3>Летопись решений</h3>
      <p class="small">Все выборы правителя — чтобы видеть, как ребёнок рассуждает.</p>
      ${adminChronicleHtml()}
    </div>
    <div class="admin-box"><h3>Отчёт за неделю</h3>${weekReportHtml()}</div>
    <div class="admin-box"><h3>Полезно знать</h3>
      <ul class="small">
        <li>Мудрые решения (+10🪙) и верные донесения (+20🪙) начисляются один раз — переигрывание не фармит казну.</li>
        <li>Если шкала правителя опустела — правление обрывается кризисом; это нормально, переиграть можно всегда.</li>
        <li>Титулы: ${DATA.titles.map(t => t.name + ' (' + t.min + '🪙)').join(' → ')}.</li>
      </ul>
    </div>
    <div class="admin-box"><h3>Обслуживание</h3>
      <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start">
        <button data-act="saveProgress">💾 Сохранить всё в файл</button>
        <label class="small">📥 Загрузить сохранение: <input type="file" id="restore-file" accept=".json"></label>
        <button class="ghost" data-act="pinReset">Сбросить PIN</button>
      </div>
      <div id="admin-res"></div>
    </div>
    <footer class="site-foot">${DATA.credits}</footer>`;
}

/* ---------- модалки, тосты, конфетти ---------- */
function showModal(html) {
  $('modal-root').innerHTML = `<div class="modal">${html}</div>`;
  $('modal-root').classList.add('show');
}
function closeModal() {
  $('modal-root').classList.remove('show');
  $('modal-root').innerHTML = '';
  if (safeModalQueue.length) showNextSafe();
}
function toast(text, cls) {
  const t = document.createElement('div');
  t.className = 'toast ' + (cls || '');
  t.textContent = text;
  $('toast-wrap').appendChild(t);
  setTimeout(() => t.remove(), 4200);
}
function confetti() {
  const box = document.createElement('div');
  box.className = 'confetti';
  const parts = ['👑', '🪙', '✨', '⚔️', '📜', '🏰'];
  for (let i = 0; i < 36; i++) {
    const s = document.createElement('span');
    s.textContent = parts[Math.floor(Math.random() * parts.length)];
    s.style.left = Math.random() * 100 + 'vw';
    s.style.animationDuration = (1.8 + Math.random() * 1.6) + 's';
    s.style.animationDelay = (Math.random() * 0.6) + 's';
    s.style.fontSize = (14 + Math.random() * 14) + 'px';
    box.appendChild(s);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 4200);
}

/* ---------- клики ---------- */
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, arg = el.dataset.arg;
  switch (act) {
    case 'goto': location.hash = arg.slice(1); break;
    case 'pickProfile': store.currentId = arg; store.adminAuthed = false; saveStore(); location.hash = ''; route(); break;
    case 'pickEmoji': {
      const box = $('np-emoji');
      box.querySelectorAll('button').forEach(b => b.classList.remove('sel'));
      el.classList.add('sel');
      box.dataset.sel = el.dataset.arg;
      break;
    }
    case 'createProfile': {
      const name = $('np-name').value.trim();
      if (!name) { $('np-name').focus(); return; }
      const av = ['👑', '🤴', '👸', '⚔️', '🛡️', '🐎', '🕊️', '📜', '🦅', '🐺'][$('np-emoji').dataset.sel || 0];
      const id = 'p' + Date.now();
      store.profiles[id] = {
        name, emoji: av, created: today(), briefed: false, points: 0,
        reigns: {}, tournament: { answers: {}, earned: {}, best: null, idx: 0 },
        achievements: [], activity: [], safesOpened: [], earlyUnlock: {},
        wiseCount: 0, reportCount: 0
      };
      store.currentId = id;
      saveStore();
      location.hash = '';
      route();
      toast('Летопись открыта, правитель ' + name + '!');
      break;
    }
    case 'introGo': P().briefed = true; saveStore(); location.hash = ''; route(); toast('Престол ждёт!'); break;
    case 'earlyUnlock': {
      showModal(`<h2>Начать правление досрочно?</h2><p>Летописец советует порядок, но не запрещает смелость. Открыть?</p>
        <button class="gold" data-act="confirmEarly" data-arg="${arg}">Открываю!</button>
        <button data-act="closeModal">Лучше по порядку</button>`);
      break;
    }
    case 'confirmEarly': { const p = P(); p.earlyUnlock = p.earlyUnlock || {}; p.earlyUnlock[arg] = true; saveStore(); closeModal(); route(); break; }
    case 'askScene': {
      const [rid, cardId] = arg.split('|');
      const r = DATA.reigns.find(x => x.id === rid);
      const card = r && r.cards.find(c => c.id === cardId);
      if (card) askOpen(card.text);
      break;
    }
    case 'askSend': askSend(); break;
    case 'reignChoose': { const [rid, cardId, i] = arg.split('|'); reignChoose(rid, cardId, +i); break; }
    case 'reignReport': { const [rid, cardId, i] = arg.split('|'); reignReport(rid, cardId, +i); break; }
    case 'reignNext': reignNext(arg); break;
    case 'reignRestart': reignRestart(arg); break;
    case 'tourAnswer': { const [qid, i] = arg.split('|'); tourAnswer(qid, +i); break; }
    case 'tourRestart': { const p = P(); p.tournament = { answers: {}, earned: p.tournament.earned, best: p.tournament.best, idx: 0 }; saveStore(); renderTournament(); break; }
    case 'saveProgress': saveProgress(); break;
    case 'showSafe': { const pr = safePrize(+arg); showModal(`<h2>Сундук №${+arg + 1}</h2><div class="big">🪙</div><p><b>${esc(pr.text)}</b></p>${pr.img ? `<img src="${esc(pr.img)}" style="max-width:100%;border-radius:8px;">` : ''}<button class="gold" onclick="closeModal()">Закрыть</button>`); break; }
    case 'resetProgress':
      showModal(`<h2>Начать заново?</h2><p>Казна, титул, правления и награды обнулятся. Имя останется. Отменить нельзя.</p>
        <button class="primary" data-act="confirmReset">Да, обнулить</button> <button data-act="closeModal">Отмена</button>`);
      break;
    case 'confirmReset': {
      const old = P();
      store.profiles[store.currentId] = {
        name: old.name, emoji: old.emoji, created: today(), briefed: true, points: 0,
        reigns: {}, tournament: { answers: {}, earned: {}, best: null, idx: 0 },
        achievements: [], activity: [], safesOpened: [], earlyUnlock: {},
        wiseCount: 0, reportCount: 0
      };
      saveStore();
      closeModal();
      location.hash = '';
      route();
      toast('Летопись переписана заново!');
      break;
    }
    case 'setTheme': {
      store.ui.theme = arg;
      saveStore();
      applyTheme();
      route();
      toast('Оформление: ' + (THEMES.find(t => t.id === arg) || {}).name);
      break;
    }
    case 'dayOpen': dayOpen(); break;
    case 'dayOpt': dayOpt(+arg); break;
    case 'dayDone': closeModal(); route(); break;
    case 'closeModal': closeModal(); break;
    case 'pinSet': {
      const a = $('pin1').value, b = $('pin2').value;
      if (!/^\d{4}$/.test(a) || a !== b) { $('pin-res').innerHTML = '<span class="result-bad">PIN — 4 одинаковые цифры в обоих полях.</span>'; return; }
      store.admin.pin = btoa(a); store.adminAuthed = true; saveStore(); renderAdmin();
      break;
    }
    case 'pinCheck': {
      if (btoa($('pin').value) === store.admin.pin) { store.adminAuthed = true; saveStore(); renderAdmin(); }
      else $('pin-res').innerHTML = '<span class="result-bad">Неверный PIN.</span>';
      break;
    }
    case 'pinReset': store.admin.pin = null; store.adminAuthed = false; saveStore(); renderAdmin(); break;
    case 'prizesSave': {
      document.querySelectorAll('[data-prize]').forEach(inp => {
        const i = inp.dataset.prize;
        store.admin.prizes[i] = store.admin.prizes[i] || {};
        store.admin.prizes[i].text = inp.value.trim();
      });
      document.querySelectorAll('[data-prizeimg]').forEach(inp => {
        const i = inp.dataset.prizeimg;
        store.admin.prizes[i] = store.admin.prizes[i] || {};
        store.admin.prizes[i].img = inp.value.trim();
      });
      saveStore();
      $('prizes-res').innerHTML = '<span class="result-ok">Сохранено ✓</span>';
      break;
    }
  }
});
document.addEventListener('change', (ev) => {
  if (ev.target && ev.target.id === 'restore-file') {
    const f = ev.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const obj = JSON.parse(r.result);
        if (!obj.profiles) throw new Error('bad');
        store = obj;
        saveStore();
        $('admin-res').innerHTML = '<span class="result-ok">Сохранение загружено ✓</span>';
        toast('Прогресс восстановлен');
        route();
      } catch (e) { $('admin-res').innerHTML = '<span class="result-bad">Файл не похож на сохранение «Престола эпох».</span>'; }
    };
    r.readAsText(f);
  }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target && ev.target.id === 'ask-input') { askSend(); return; }
  if (ev.key === 'Escape') closeModal();
});

/* ---------- старт ---------- */
applyTheme();
route();
