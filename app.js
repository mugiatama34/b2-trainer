'use strict';

// Must match version.json and the cache name in sw.js (see CLAUDE.md).
const APP_VERSION = '1.7.10';

/* ---------- Storage (all keys prefixed with "b2trainer:") ---------- */
const PREFIX = 'b2trainer:';
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (e) { /* quota / private mode */ }
  },
  remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
  }
};

/* ---------- i18n ----------
   UI strings live in i18n/ui.<lang>.json (flat keys). t(key) falls back to Turkish, then to the key.
   Exam content stays German; only explanations/help texts are localized (see tx / nameOf / cardView). */
const LANGS = [
  { id: 'tr', flag: '🇹🇷', name: 'Türkçe', locale: 'tr-TR', llm: 'Turkish' },
  { id: 'en', flag: '🇬🇧', name: 'English', locale: 'en-GB', llm: 'English' },
  { id: 'uk', flag: '🇺🇦', name: 'Українська', locale: 'uk-UA', llm: 'Ukrainian' }
];
let LANG = 'tr';
let UI = {};
let UI_TR = {};
function defaultLang() {
  const l = String(navigator.language || '').toLowerCase();
  if (l.startsWith('uk')) return 'uk';
  if (l.startsWith('tr')) return 'tr';
  return 'en';
}
function isLang(l) { return LANGS.some(x => x.id === l); }
function langInfo() { return LANGS.find(x => x.id === LANG) || LANGS[0]; }
function locale() { return langInfo().locale; }
async function loadStrings(lang) {
  const get = l => fetch(`./i18n/ui.${l}.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
  UI_TR = await get('tr');
  UI = lang === 'tr' ? UI_TR : await get(lang);
  LANG = lang;
  document.documentElement.lang = lang;
}
// t('key', { n: 3 }) → string with {n} replaced.
function t(key, vars) {
  let s = UI[key] != null ? UI[key] : (UI_TR[key] != null ? UI_TR[key] : key);
  if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}
/* Content fields from b2-data.json:
   tx(q, 'explanation') → explanation_<lang>, else explanation_tr; nameOf(section) → name_<lang>, else name;
   cardView(card) → { prompt, blocks } from card.i18n[lang] when present, else the card's own fields. */
function tx(obj, field) {
  if (!obj) return '';
  return obj[field + '_' + LANG] || obj[field + '_tr'] || '';
}
function nameOf(obj) { return (obj && (obj['name_' + LANG] || obj.name)) || ''; }
function cardView(card) {
  const l = card && card.i18n && card.i18n[LANG];
  return {
    prompt: (l && l.prompt) || (card && card.prompt) || '',
    blocks: (l && Array.isArray(l.blocks) && l.blocks) || (card && card.blocks) || []
  };
}

// progress: { [questionId]: { n: attempts, ok: correct attempts, last: timestamp } }
function getProgress() { return store.get('progress', {}); }
function recordAnswer(qid, correct) {
  const p = getProgress();
  const e = p[qid] || { n: 0, ok: 0 };
  e.n += 1;
  if (correct) e.ok += 1;
  e.last = Date.now();
  p[qid] = e;
  store.set('progress', p);
  updateSrs(qid, correct);
}

/* Leitner spaced repetition: srs = { [questionId]: { box: 0..4, due: timestamp } }
   wrong → box 0, due now; correct → box+1 (max 4), due after the box interval. */
const DAY = 24 * 60 * 60 * 1000;
const BOX_DAYS = [0, 1, 2, 4, 7];
function getSrs() { return store.get('srs', {}); }
function updateSrs(qid, correct) {
  const srs = getSrs();
  const e = srs[qid] || { box: 0, due: 0 };
  if (correct) {
    e.box = Math.min(4, e.box + 1);
    e.due = Date.now() + BOX_DAYS[e.box] * DAY;
  } else {
    e.box = 0;
    e.due = Date.now();
  }
  srs[qid] = e;
  store.set('srs', srs);
}
// Due questions that still exist in the data, lowest box first, then oldest due.
function dueQuestions() {
  const srs = getSrs();
  const now = Date.now();
  return DATA.questions
    .filter(q => srs[q.id] && srs[q.id].due <= now)
    .sort((a, b) => (srs[a.id].box - srs[b.id].box) || (srs[a.id].due - srs[b.id].due));
}

function getSettings() { return Object.assign({ examMinutes: 12, monologMinutes: 3, bsMinutes: 20, forumMinutes: 25 }, store.get('settings', {})); }
const MONOLOG_OPTIONS = [2, 3, 4];
function monologSeconds() {
  const m = Number(getSettings().monologMinutes);
  return (MONOLOG_OPTIONS.includes(m) ? m : 3) * 60;
}
function fmtClock(sec) { return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }
function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* not supported */ } }

/* Speaking timer cues: at 2:00 elapsed the examiner may stop the monologue
   (only when the total is longer than 2 min), and a final alert at the end. */
const EXAM_STOP_SEC = 120;
function speakingCues(noteEl, total) {
  let milestone = false;
  return {
    update(elapsed, remaining) {
      if (!milestone && total > EXAM_STOP_SEC && elapsed >= EXAM_STOP_SEC && remaining > 0) {
        milestone = true;
        vibrate(200);
        noteEl.textContent = t('timer.examStop');
        noteEl.className = 'timer-note milestone';
      }
    },
    finish() {
      vibrate([300, 150, 300]);
      noteEl.textContent = t('timer.over');
      noteEl.className = 'timer-note over';
    },
    reset() { milestone = false; noteEl.textContent = ''; noteEl.className = 'timer-note'; }
  };
}
function saveSettings(s) { store.set('settings', s); }

// learned cards: { [cardId]: true }
function getLearned() { return store.get('learned', {}); }
function setLearned(id, on) {
  const l = getLearned();
  if (on) l[id] = true; else delete l[id];
  store.set('learned', l);
}

/* ---------- Helpers ---------- */
const $app = document.getElementById('app');
const $title = document.getElementById('title');
const $back = document.getElementById('backBtn');
const $topRight = document.getElementById('topRight');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function uniq(arr) { return Array.from(new Set(arr)); }
function setHeader(title, showBack) {
  $title.textContent = title;
  $back.classList.toggle('hidden', !showBack);
  $topRight.textContent = '';
  $topRight.className = 'topbar-right';
}
// Cleanup hooks for timers / speech when leaving a screen
let cleanups = [];
function onLeave(fn) { cleanups.push(fn); }
function runCleanups() { cleanups.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } }); cleanups = []; }

/* ---------- Data ---------- */
let DATA = null;
let SECTION_NAME = {};

async function loadData() {
  const res = await fetch('./b2-data.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  DATA = await res.json();
  DATA.sections = DATA.sections || [];
  DATA.questions = (DATA.questions || []).filter(q => q && q.id && Array.isArray(q.options));
  DATA.cards = DATA.cards || [];
  DATA.reading_parts = (DATA.reading_parts || []).filter(p => p && p.id);
  DATA.reading = (DATA.reading || []).filter(s => s && s.id && Array.isArray(s.texts) && Array.isArray(s.questions));
  buildSectionNames();
}
function buildSectionNames() {
  SECTION_NAME = {};
  DATA.sections.forEach(s => { SECTION_NAME[s.id] = nameOf(s); });
}

/* ---------- Router ---------- */
const routes = {
  '': renderHome,
  'practice': renderPracticeSetup,
  'exam': renderExamSetup,
  'review': renderReview,
  'progress': renderProgress,
  'cards': renderCards,
  'card': renderCardDetail,
  'settings': renderSettings,
  'coach': renderCoach,
  'lesen': renderLesen,
  'schreiben': renderSchreiben
};

function renderCoach(args) {
  const mode = args[0];
  if (mode === 'mono') return renderCoachMonolog(args.slice(1));
  if (mode === 't2' || mode === 't3') return renderCoachDialog(mode, args[1]);
  return renderCoachHub();
}

function router() {
  runCleanups();
  screenId += 1;
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const name = parts[0] || '';
  const fn = routes[name] || renderHome;
  window.scrollTo(0, 0);
  fn(parts.slice(1).map(decodeURIComponent));
}

/* ---------- Home ---------- */
function renderHome() {
  setHeader('B2 Prüfungstrainer', false);
  const due = dueQuestions().length;
  const solved = DATA.questions.filter(q => getProgress()[q.id]).length;
  $app.innerHTML = `
    <div class="card hero">
      <div class="big">${due}</div>
      <div class="muted">${esc(t('home.dueLabel'))}</div>
      <div class="muted small">${esc(t('home.solved', { n: solved, total: DATA.questions.length }))}</div>
    </div>
    <a class="btn primary" href="#/practice">${esc(t('home.practice'))}</a>
    <a class="btn" href="#/exam">${esc(t('home.exam'))}</a>
    <a class="btn" href="#/review">${esc(t('home.review'))}${due ? ` (${due})` : ''}</a>
    <a class="btn" href="#/lesen">📖 Lesen</a>
    <a class="btn" href="#/schreiben">✍️ Schreiben</a>
    <a class="btn" href="#/cards">${esc(t('home.cards'))}</a>
    <a class="btn" href="#/coach">🎙 Sprechen-Coach</a>
    <a class="btn" href="#/progress">${esc(t('home.progress'))}</a>
    <a class="btn" href="#/settings">${esc(t('home.settings'))}</a>
  `;
}

/* ---------- Practice setup ---------- */
function renderPracticeSetup() {
  setHeader(t('home.practice'), true);
  const last = store.get('practiceFilter', { section: '', topic: '' });
  const sectionOpts = DATA.sections.map(s =>
    `<option value="${esc(s.id)}">${esc(nameOf(s))}</option>`).join('');
  $app.innerHTML = `
    <div class="card">
      <label class="field"><span>${esc(t('practice.section'))}</span>
        <select id="secSel"><option value="">${esc(t('practice.allSections'))}</option>${sectionOpts}</select>
      </label>
      <label class="field"><span>${esc(t('practice.topic'))}</span>
        <select id="topSel"></select>
      </label>
      <p class="muted small" id="countInfo"></p>
      <button class="btn primary" id="startBtn">${esc(t('practice.start'))}</button>
    </div>
  `;
  const secSel = document.getElementById('secSel');
  const topSel = document.getElementById('topSel');
  const info = document.getElementById('countInfo');
  const startBtn = document.getElementById('startBtn');

  function pool() {
    return DATA.questions.filter(q =>
      (!secSel.value || q.section === secSel.value) &&
      (!topSel.value || q.topic === topSel.value));
  }
  function fillTopics(keep) {
    const qs = DATA.questions.filter(q => !secSel.value || q.section === secSel.value);
    const topics = uniq(qs.map(q => q.topic).filter(Boolean)).sort((a, b) => a.localeCompare(b, 'de'));
    topSel.innerHTML = `<option value="">${esc(t('practice.allTopics'))}</option>` +
      topics.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    topSel.value = topics.includes(keep) ? keep : '';
  }
  function update() {
    const n = pool().length;
    info.textContent = t('practice.available', { n });
    startBtn.disabled = n === 0;
    store.set('practiceFilter', { section: secSel.value, topic: topSel.value });
  }
  secSel.value = DATA.sections.some(s => s.id === last.section) ? last.section : '';
  fillTopics(last.topic);
  update();
  secSel.onchange = () => { fillTopics(''); update(); };
  topSel.onchange = update;
  startBtn.onclick = () => {
    const qs = shuffle(pool()).slice(0, 10);
    runQuiz({ title: t('home.practice'), questions: qs, feedback: true, onDone: showPracticeResult });
  };
}

function showPracticeResult(results) {
  const ok = results.filter(r => r.correct).length;
  $topRight.textContent = '';
  $app.innerHTML = `
    <div class="card hero">
      <div class="big">${ok} / ${results.length}</div>
      <div class="muted">${esc(t('common.correctLower'))}</div>
    </div>
    <button class="btn primary" id="againBtn">${esc(t('practice.again'))}</button>
    <a class="btn" href="#/">${esc(t('common.home'))}</a>
  `;
  document.getElementById('againBtn').onclick = renderPracticeSetup;
}

/* ---------- Quiz engine ----------
   opts: { title, questions, feedback (bool), onAnswer(q, correct), onDone(results), requeueWrong (bool) } */
function renderPrompt(prompt, fill) {
  const parts = String(prompt).split('___');
  if (parts.length === 1) return esc(prompt);
  const blank = `<span class="blank">${fill ? esc(fill) : '&nbsp;'}</span>`;
  return parts.map(esc).join(blank);
}

function runQuiz(opts) {
  const queue = opts.questions.slice();
  const results = [];
  const requeued = new Set();
  let i = 0;
  let done = false;
  setHeader(opts.title, true);
  onLeave(() => { done = true; });

  function show() {
    if (done) return;
    if (i >= queue.length) { done = true; opts.onDone(results); return; }
    const q = queue[i];
    // Shuffle option order on every display; keep track of which one is correct.
    const order = shuffle(q.options.map((text, idx) => ({ text, correct: idx === q.answer })));
    const total = queue.length;
    const meta = [SECTION_NAME[q.section] || q.section, q.topic].filter(Boolean).join(' · ');
    $app.innerHTML = `
      <div class="progress-line"><div style="width:${(i / total) * 100}%"></div></div>
      <div class="q-meta">${i + 1} / ${total} · ${esc(meta)}</div>
      <p class="q-prompt" id="qPrompt">${renderPrompt(q.prompt)}</p>
      <div id="opts">${order.map((o, k) =>
        `<button class="opt" data-k="${k}">${esc(o.text)}</button>`).join('')}</div>
      <div id="after"></div>
    `;
    const buttons = Array.from(document.querySelectorAll('.opt'));
    buttons.forEach(btn => {
      btn.onclick = () => {
        if (done) return;
        const k = Number(btn.dataset.k);
        const chosen = order[k];
        const correct = chosen.correct;
        buttons.forEach(b => { b.disabled = true; });
        results.push({ q, chosen: chosen.text, correct });
        recordAnswer(q.id, correct);
        if (opts.onAnswer) opts.onAnswer(q, correct);
        if (!correct && opts.requeueWrong && !requeued.has(q.id)) {
          requeued.add(q.id);
          queue.push(q);
        }
        const rightText = order.find(o => o.correct).text;
        const after = document.getElementById('after');
        if (opts.feedback) {
          buttons.forEach((b, idx) => {
            if (order[idx].correct) b.classList.add('correct');
            else if (idx === k) b.classList.add('wrong');
          });
          document.getElementById('qPrompt').innerHTML = renderPrompt(q.prompt, rightText);
          after.innerHTML = `
            <div class="card explain ${correct ? 'ok' : 'bad'}">
              <div class="verdict ${correct ? 'ok' : 'bad'}">${correct ? esc(t('quiz.correct')) : esc(t('quiz.wrongAnswer', { answer: rightText }))}</div>
              <div>${esc(tx(q, 'explanation'))}</div>
            </div>
            <button class="btn primary" id="nextBtn">${esc(t('common.next'))}</button>`;
          const next = document.getElementById('nextBtn');
          next.onclick = () => { i++; show(); };
          next.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
          btn.classList.add('chosen');
          setTimeout(() => { i++; show(); }, 250);
        }
      };
    });
  }
  show();
  return { finishNow() { i = queue.length; show(); }, results };
}

/* ---------- Review (Leitner) ---------- */
const REVIEW_LIMIT = 20;

function renderReview() {
  setHeader(t('home.review'), true);
  const due = dueQuestions();
  if (!due.length) {
    const srs = getSrs();
    const next = Object.keys(srs).map(id => srs[id].due).filter(d => d > Date.now()).sort((a, b) => a - b)[0];
    $app.innerHTML = `
      <div class="card hero">
        <div class="big">✓</div>
        <div>${esc(t('review.none'))}</div>
        ${next ? `<div class="muted small">${esc(t('review.next', { date: new Date(next).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }))}</div>` : ''}
      </div>
      <a class="btn primary" href="#/practice">${esc(t('review.practice'))}</a>
      <a class="btn" href="#/">${esc(t('common.home'))}</a>`;
    return;
  }
  const srs = getSrs();
  const counts = [0, 0, 0, 0, 0];
  due.forEach(q => { counts[srs[q.id].box] += 1; });
  $app.innerHTML = `
    <div class="card hero">
      <div class="big">${due.length}</div>
      <div class="muted">${esc(t('home.dueLabel'))}</div>
      <div class="muted small">${esc(t('review.boxes', { list: counts.join(' · ') }))}</div>
    </div>
    <button class="btn primary" id="startBtn">${esc(t('review.start', { n: Math.min(due.length, REVIEW_LIMIT) }))}</button>
    <p class="muted small">${esc(t('review.help'))}</p>
  `;
  document.getElementById('startBtn').onclick = () => {
    runQuiz({
      title: t('home.review'),
      questions: due.slice(0, REVIEW_LIMIT),
      feedback: true,
      requeueWrong: true,
      onDone: results => {
        const ok = results.filter(r => r.correct).length;
        const left = dueQuestions().length;
        $app.innerHTML = `
          <div class="card hero">
            <div class="big">${ok} / ${results.length}</div>
            <div class="muted">${esc(t('common.correctLower'))}</div>
            <div class="muted small">${esc(t('review.left', { n: left }))}</div>
          </div>
          ${left ? `<button class="btn primary" id="moreBtn">${esc(t('review.more'))}</button>` : ''}
          <a class="btn" href="#/">${esc(t('common.home'))}</a>`;
        const more = document.getElementById('moreBtn');
        if (more) more.onclick = renderReview;
      }
    });
  };
}

/* ---------- Exam mode ---------- */
const EXAM_SIZE = 20;

function renderExamSetup() {
  setHeader(t('home.exam'), true);
  const settings = getSettings();
  $app.innerHTML = `
    <div class="card">
      <p>${t('exam.intro', { n: Math.min(EXAM_SIZE, DATA.questions.length) })}</p>
      <label class="field"><span>${esc(t('exam.minutes'))}</span>
        <input type="number" id="minutes" min="1" max="120" inputmode="numeric" value="${settings.examMinutes}">
      </label>
      <button class="btn primary" id="startBtn">${esc(t('exam.start'))}</button>
    </div>`;
  document.getElementById('startBtn').onclick = () => {
    const m = Math.max(1, Math.min(120, parseInt(document.getElementById('minutes').value, 10) || 12));
    settings.examMinutes = m;
    saveSettings(settings);
    startExam(m);
  };
}

function startExam(minutes) {
  const questions = shuffle(DATA.questions).slice(0, EXAM_SIZE);
  const endAt = Date.now() + minutes * 60 * 1000;
  let handle = null;
  let finished = false;

  const quiz = runQuiz({
    title: t('home.exam'),
    questions,
    feedback: false,
    onDone: results => {
      finished = true;
      clearInterval(handle);
      showExamResult(questions, results, Date.now() >= endAt);
    }
  });

  function tick() {
    if (finished) return;
    const left = Math.max(0, endAt - Date.now());
    const s = Math.ceil(left / 1000);
    $topRight.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    $topRight.classList.toggle('warn', s <= 60);
    if (left <= 0) quiz.finishNow();
  }
  handle = setInterval(tick, 500);
  tick();
  onLeave(() => { finished = true; clearInterval(handle); });
}

function showExamResult(questions, results, timeUp) {
  $topRight.textContent = '';
  const byId = {};
  results.forEach(r => { byId[r.q.id] = r; });
  const ok = results.filter(r => r.correct).length;
  const wrong = questions.filter(q => !byId[q.id] || !byId[q.id].correct);
  const pct = Math.round((ok / questions.length) * 100);
  $app.innerHTML = `
    <div class="card hero">
      ${timeUp ? `<div class="verdict bad">${esc(t('common.timeUp'))}</div>` : ''}
      <div class="big">${ok} / ${questions.length}</div>
      <div class="muted">${esc(t('exam.pct', { pct }))} ${esc(pct >= 60 ? t('exam.passed') : t('exam.target'))}</div>
    </div>
    ${wrong.length ? `<h3>${esc(t('exam.wrongList'))}</h3>` : `<p class="center">${esc(t('exam.allRight'))}</p>`}
    ${wrong.map(q => {
      const r = byId[q.id];
      const right = q.options[q.answer];
      return `<div class="card explain bad">
        <div class="q-meta">${esc([SECTION_NAME[q.section], q.topic].filter(Boolean).join(' · '))}</div>
        <div lang="de" style="margin-bottom:6px">${renderPrompt(q.prompt, right)}</div>
        <div class="small">${r ? `${esc(t('exam.yourAnswer'))} <span class="verdict bad">${esc(r.chosen)}</span>` : `<span class="muted">${esc(t('exam.unanswered'))}</span>`}
          · ${esc(t('exam.rightAnswer'))} <strong class="verdict ok">${esc(right)}</strong></div>
        <div class="small" style="margin-top:6px">${esc(tx(q, 'explanation'))}</div>
      </div>`;
    }).join('')}
    <button class="btn primary" id="againBtn">${esc(t('exam.again'))}</button>
    <a class="btn" href="#/">${esc(t('common.home'))}</a>`;
  document.getElementById('againBtn').onclick = renderExamSetup;
}

/* ---------- Progress ---------- */
function pctClass(p) { return p < 50 ? 'low' : (p >= 75 ? 'high' : ''); }
function barRow(label, ok, n) {
  const p = n ? Math.round((ok / n) * 100) : 0;
  return `<div class="bar-row">
    <div class="bar-label"><span>${esc(label)}</span><span class="muted">${n ? '%' + p : '–'} <span class="small">(${ok}/${n})</span></span></div>
    <div class="bar ${n ? pctClass(p) : ''}"><div style="width:${p}%"></div></div>
  </div>`;
}

function renderProgress() {
  setHeader(t('home.progress'), true);
  const prog = getProgress();
  const srs = getSrs();
  const bySection = {};
  const byTopic = {};
  let solved = 0, attempts = 0, correct = 0;
  DATA.questions.forEach(q => {
    const e = prog[q.id];
    if (!e) return;
    solved += 1; attempts += e.n; correct += e.ok;
    const s = bySection[q.section] = bySection[q.section] || { ok: 0, n: 0 };
    s.ok += e.ok; s.n += e.n;
    if (q.topic) {
      const t = byTopic[q.topic] = byTopic[q.topic] || { ok: 0, n: 0 };
      t.ok += e.ok; t.n += e.n;
    }
  });
  const topics = Object.keys(byTopic).map(t => ({ t, ok: byTopic[t].ok, n: byTopic[t].n, p: byTopic[t].ok / byTopic[t].n }));
  const weakest = topics.filter(x => x.p < 1).sort((a, b) => (a.p - b.p) || (b.n - a.n)).slice(0, 3);
  topics.sort((a, b) => a.t.localeCompare(b.t, 'de'));
  const boxes = [0, 0, 0, 0, 0];
  Object.keys(srs).forEach(id => { boxes[srs[id].box] = (boxes[srs[id].box] || 0) + 1; });
  const learned = Object.keys(getLearned()).length;

  $app.innerHTML = `
    <div class="card hero">
      <div class="big">${solved} / ${DATA.questions.length}</div>
      <div class="muted">${esc(t('progress.summary', { attempts, pct: attempts ? Math.round(correct / attempts * 100) : 0 }))}</div>
      <div class="muted small">${esc(t('progress.boxes', { list: boxes.join(' · '), learned, total: DATA.cards.length }))}</div>
    </div>
    ${weakest.length ? `<div class="card"><h3>${esc(t('progress.weakest'))}</h3>
      ${weakest.map(x => barRow(x.t, x.ok, x.n)).join('')}
      <button class="btn" id="weakBtn">${esc(t('progress.weakBtn'))}</button></div>` : ''}
    <div class="card"><h3>${esc(t('progress.sections'))}</h3>
      ${DATA.sections.map(s => barRow(nameOf(s), (bySection[s.id] || {}).ok || 0, (bySection[s.id] || {}).n || 0)).join('')}
    </div>
    ${topics.length ? `<div class="card"><h3>${esc(t('progress.topics'))}</h3>${topics.map(x => barRow(x.t, x.ok, x.n)).join('')}</div>` : ''}
    ${readingProgressHtml()}
    ${coachProgressHtml()}
    ${writingProgressHtml()}
    <button class="btn danger" id="resetBtn">${esc(t('progress.reset'))}</button>
  `;
  const weakBtn = document.getElementById('weakBtn');
  if (weakBtn) weakBtn.onclick = () => {
    store.set('practiceFilter', { section: '', topic: weakest[0].t });
    location.hash = '#/practice';
  };
  document.getElementById('resetBtn').onclick = () => {
    if (!confirm(t('progress.resetConfirm'))) return;
    ['progress', 'srs', 'learned', 'practiceFilter', 'coachHistory', 'reading', 'writingHistory'].forEach(k => store.remove(k));
    renderProgress();
  };
}

// Latest Sprechen-Coach scores per theme.
function coachProgressHtml() {
  const last = lastScoresByTheme();
  const keys = Object.keys(last);
  if (!keys.length) return '';
  const rows = keys.map(k => last[k]).sort((a, b) => b.date - a.date).map(e => `
    <div class="coach-row">
      <span class="t">${esc(e.theme)}<span class="sub">${new Date(e.date).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></span>
      <span class="mini-scores">${scoresInline(e.scores)}</span>
    </div>`).join('');
  return `<div class="card"><h3>${esc(t('progress.coachScores'))}</h3>
    <p class="small muted">Aufgabe · Kohärenz · Wortschatz · Strukturen</p>${rows}</div>`;
}

/* ---------- Lesen ----------
   b2trainer:reading = { [setId]: { best, last, total, wrong: [questionId], ok, n, date } }
   ok/n add up every checked attempt (used for the per-part percentage on the progress screen). */
function getReading() { return store.get('reading', {}); }
function saveReadingResult(set, ok, wrongIds) {
  const all = getReading();
  const total = set.questions.length;
  const e = all[set.id] || { best: 0, ok: 0, n: 0 };
  e.last = ok;
  e.best = Math.max(e.best || 0, ok);
  e.total = total;
  e.wrong = wrongIds;
  e.ok = (e.ok || 0) + ok;
  e.n = (e.n || 0) + total;
  e.date = Date.now();
  all[set.id] = e;
  store.set('reading', all);
}

// Sets grouped by reading_parts order; sets with an unknown part go into a trailing group.
function readingGroups() {
  const groups = DATA.reading_parts.map(p => ({ id: p.id, name: nameOf(p), sets: [] }));
  const byId = {};
  groups.forEach(g => { byId[g.id] = g; });
  DATA.reading.forEach(s => {
    if (!byId[s.part]) groups.push(byId[s.part] = { id: s.part, name: s.part || t('lesen.other'), sets: [] });
    byId[s.part].sets.push(s);
  });
  return groups.filter(g => g.sets.length);
}

function renderLesen(args) {
  if (args[0]) return renderReadingSet(args[0]);
  setHeader('Lesen', true);
  const rec = getReading();
  const groups = readingGroups();
  $app.innerHTML = groups.map(g => `
    <h3>${esc(g.name)}</h3>
    <ul class="list">${g.sets.map(s => {
      const e = rec[s.id];
      const total = s.questions.length;
      return `<li><a href="#/lesen/${encodeURIComponent(s.id)}">
        <span class="t">${esc(s.title)}<span class="sub">${esc(t('lesen.nQuestions', { n: total }))}${e ? ' · ' + esc(t('lesen.lastScore', { n: e.last, total })) : ''}</span></span>
        <span class="best ${e && e.best === total ? 'full' : ''}">${e ? `${e.best}/${total}` : '–'}</span>
      </a></li>`;
    }).join('')}</ul>`).join('') || `<p class="muted center">${esc(t('lesen.none'))}</p>`;
}

function readingParagraphs(body) {
  return String(body || '').split('\n').filter(l => l.trim())
    .map(l => `<p>${l.split(/(\s+)/).map(w => (/^\s*$/.test(w) ? w : `<span class="w">${esc(w)}</span>`)).join('')}</p>`)
    .join('');
}

function renderReadingSet(id) {
  const set = DATA.reading.find(s => s.id === id);
  if (!set) { location.hash = '#/lesen'; return; }
  setHeader(set.title, true);
  $back.setAttribute('href', '#/lesen');
  const matching = set.layout === 'matching';
  const minutes = matching ? 10 : 12;
  const answers = {};
  let checked = false;
  let timer = null;
  let activeKey = set.texts.length ? set.texts[0].key : '';
  let autoRef = null;
  const onScroll = () => requestAnimationFrame(syncTabToQuestions);
  onLeave(() => {
    $back.setAttribute('href', '#/');
    document.body.classList.remove('has-checkbar');
    window.removeEventListener('scroll', onScroll);
    stopTimer();
  });

  const keys = set.texts.map(t => t.key).concat(set.allow_none ? ['x'] : []);
  const textTitle = t => t.title || (String(t.body || '').slice(0, 70).trim() + '…');
  const last = getReading()[set.id];

  function questionHtml(q) {
    let choices;
    if (q.kind === 'match') {
      choices = `<div class="keys">${keys.map(k =>
        `<button class="keybtn" data-v="${esc(k)}" ${k === 'x' ? 'title="kein Tipp"' : ''}>${esc(k)}</button>`).join('')}</div>`;
    } else if (q.kind === 'rf') {
      choices = `<div class="keys">${(q.options || []).map((o, i) =>
        `<button class="keybtn wide" data-v="${i}" lang="de">${esc(o)}</button>`).join('')}</div>`;
    } else {
      choices = (q.options || []).map((o, i) =>
        `<button class="opt ropt" data-v="${i}" lang="de"><b>${'abcdefgh'.charAt(i)})</b> ${esc(o)}</button>`).join('');
    }
    return `<div class="rq" data-q="${esc(q.id)}" data-ref="${esc(q.text_ref || '')}">
      <div class="rq-head"><span class="num">${esc(q.num)}</span><span lang="de">${esc(q.prompt)}</span></div>
      ${choices}
      <div class="rq-after"></div>
    </div>`;
  }

  const textsHtml = matching
    ? set.texts.map(t => `
      <details class="card rtext">
        <summary><span class="keybadge">${esc(t.key)}</span><span lang="de">${esc(textTitle(t))}</span></summary>
        <div class="rbody" lang="de">${t.title ? `<p class="rtitle">${esc(t.title)}</p>` : ''}${readingParagraphs(t.body)}</div>
      </details>`).join('')
    : `<div class="rpane" id="rpane">
        ${set.texts.length > 1 ? `<div class="tabs">${set.texts.map(t =>
          `<button class="tab" data-tab="${esc(t.key)}">${esc(t.key)}</button>`).join('')}</div>` : ''}
        ${set.texts.map(t => `
          <div class="card rscroll rbody" data-text="${esc(t.key)}" lang="de">
            ${t.title ? `<p class="rtitle">${esc(t.title)}</p>` : ''}${readingParagraphs(t.body)}
          </div>`).join('')}
        <button class="rpane-toggle" id="rpaneToggle">${esc(t('lesen.expand'))}</button>
      </div>`;

  $app.innerHTML = `
    <div class="rhead">
      <p class="small muted">${esc(tx(set, 'instructions'))}</p>
      ${set.context_de ? `<p class="context" lang="de">${esc(set.context_de)}</p>` : ''}
      <label class="switch"><input type="checkbox" id="timerChk"> ${esc(t('lesen.timer', { n: minutes }))}</label>
      ${last && last.wrong && last.wrong.length ? `<p class="small muted">${esc(t('lesen.lastTry', { n: last.last, total: last.total, wrong: last.wrong.length }))}</p>` : ''}
    </div>
    ${textsHtml}
    <h3>${esc(t('lesen.questions'))}</h3>
    <div id="rqs">${set.questions.map(questionHtml).join('')}</div>
    <div class="check-bar" id="checkBar">
      <span id="checkInfo" class="small muted"></span>
      <button class="btn primary" id="checkBtn">${esc(t('lesen.check'))}</button>
    </div>`;
  document.body.classList.add('has-checkbar');

  const rqs = document.getElementById('rqs');
  const checkBtn = document.getElementById('checkBtn');
  const checkInfo = document.getElementById('checkInfo');
  const qById = {};
  set.questions.forEach(q => { qById[q.id] = q; });

  function drawInfo() {
    if (checked) return;
    const n = Object.keys(answers).length;
    checkInfo.textContent = t('lesen.answered', { n, total: set.questions.length });
  }

  /* text-questions: tabs + auto-switch to the text of the question being worked on */
  function showText(key) {
    if (!key || matching) return;
    activeKey = key;
    document.querySelectorAll('[data-text]').forEach(el => { el.hidden = el.dataset.text !== key; });
    document.querySelectorAll('[data-tab]').forEach(el => el.classList.toggle('active', el.dataset.tab === key));
  }
  function syncTabToQuestions() {
    const pane = document.getElementById('rpane');
    if (!pane || set.texts.length < 2) return;
    const below = pane.getBoundingClientRect().bottom;
    const first = Array.from(rqs.children).find(el => el.getBoundingClientRect().bottom > below + 20);
    const ref = first && first.dataset.ref;
    if (ref && ref !== autoRef) {
      autoRef = ref;
      if (ref !== activeKey) showText(ref);
    }
  }
  if (!matching) {
    const pane = document.getElementById('rpane');
    pane.style.top = document.querySelector('.topbar').offsetHeight + 'px';
    document.querySelectorAll('[data-tab]').forEach(el => { el.onclick = () => showText(el.dataset.tab); });
    const toggle = document.getElementById('rpaneToggle');
    toggle.onclick = () => {
      const big = pane.classList.toggle('big');
      toggle.textContent = big ? t('lesen.shrink') : t('lesen.expand');
    };
    showText(activeKey);
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  rqs.addEventListener('click', e => {
    const btn = e.target.closest('button[data-v]');
    if (!btn || checked) return;
    const row = btn.closest('.rq');
    const q = qById[row.dataset.q];
    if (answers[q.id] === btn.dataset.v) delete answers[q.id];
    else answers[q.id] = btn.dataset.v;
    row.querySelectorAll('button[data-v]').forEach(b => b.classList.toggle('chosen', b.dataset.v === answers[q.id]));
    if (q.text_ref) { autoRef = q.text_ref; showText(q.text_ref); }
    drawInfo();
  });

  function answerLabel(q, v) {
    if (q.kind === 'match') {
      if (v === 'x') return 'x (kein Tipp)';
      const t = set.texts.find(x => x.key === v);
      return t && t.title ? `${v} – ${t.title}` : v;
    }
    const i = Number(v);
    return (q.kind === 'mc' ? 'abcdefgh'.charAt(i) + ') ' : '') + ((q.options || [])[i] || '');
  }

  function check(timeUp) {
    if (checked) return;
    const empty = set.questions.length - Object.keys(answers).length;
    if (!timeUp && empty && !confirm(t('lesen.emptyConfirm', { n: empty }))) return;
    checked = true;
    stopTimer();
    let ok = 0;
    const wrongIds = [];
    set.questions.forEach(q => {
      const row = rqs.querySelector(`[data-q="${CSS.escape(q.id)}"]`);
      const right = String(q.answer);
      const chosen = answers[q.id];
      const correct = chosen === right;
      if (correct) ok += 1; else wrongIds.push(q.id);
      row.classList.add(correct ? 'ok' : 'bad');
      row.querySelectorAll('button[data-v]').forEach(b => {
        b.disabled = true;
        if (b.dataset.v === right) b.classList.add('correct');
        else if (b.dataset.v === chosen) b.classList.add('wrong');
      });
      row.querySelector('.rq-after').innerHTML = `
        <div class="verdict ${correct ? 'ok' : 'bad'}">${correct ? esc(t('quiz.correct'))
          : `✗ ${esc(chosen === undefined ? t('lesen.empty') : t('lesen.wrong'))} — ${esc(t('lesen.rightIs'))} <span lang="de">${esc(answerLabel(q, right))}</span>`}</div>
        ${tx(q, 'explanation') ? `<div class="small">${esc(tx(q, 'explanation'))}</div>` : ''}`;
    });
    saveReadingResult(set, ok, wrongIds);
    document.getElementById('timerChk').disabled = true;
    checkInfo.className = 'verdict ' + (ok === set.questions.length ? 'ok' : (ok / set.questions.length >= 0.6 ? '' : 'bad'));
    checkInfo.textContent = (timeUp ? t('common.timeUp') + ' · ' : '') + t('lesen.score', { n: ok, total: set.questions.length });
    checkBtn.textContent = t('lesen.retry');
    checkBtn.classList.remove('primary');
    checkBtn.onclick = () => renderReadingSet(set.id);
    const firstBad = rqs.querySelector('.rq.bad');
    if (firstBad) {
      if (firstBad.dataset.ref) showText(firstBad.dataset.ref);
      // Land just below the sticky text pane (or the top bar in matching sets).
      const pane = document.getElementById('rpane');
      const topEdge = pane ? pane.getBoundingClientRect().bottom : document.querySelector('.topbar').offsetHeight;
      window.scrollBy({ top: firstBad.getBoundingClientRect().top - topEdge - 12, behavior: 'smooth' });
    }
  }
  checkBtn.onclick = () => check(false);

  /* Optional timer (off by default) */
  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
    $topRight.textContent = '';
    $topRight.classList.remove('warn');
  }
  document.getElementById('timerChk').onchange = e => {
    if (!e.target.checked) { stopTimer(); return; }
    const endAt = Date.now() + minutes * 60 * 1000;
    const tick = () => {
      const left = Math.max(0, endAt - Date.now());
      const s = Math.ceil(left / 1000);
      $topRight.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      $topRight.classList.toggle('warn', s <= 60);
      if (left <= 0) {
        if (navigator.vibrate) navigator.vibrate(300);
        check(true);
      }
    };
    timer = setInterval(tick, 500);
    tick();
  };

  /* Long press (or double click) on a word toggles a highlight; kept only on this screen. */
  let pressTimer = null;
  const toggleWord = el => { if (el && el.classList.contains('w')) el.classList.toggle('hl'); };
  $app.querySelectorAll('.rbody').forEach(body => {
    body.addEventListener('touchstart', e => {
      const w = e.target.closest('.w');
      clearTimeout(pressTimer);
      if (w) pressTimer = setTimeout(() => { toggleWord(w); if (navigator.vibrate) navigator.vibrate(15); }, 450);
    }, { passive: true });
    ['touchend', 'touchmove', 'touchcancel'].forEach(t => body.addEventListener(t, () => clearTimeout(pressTimer), { passive: true }));
    body.addEventListener('dblclick', e => toggleWord(e.target.closest('.w')));
    body.addEventListener('contextmenu', e => { if (e.target.closest('.w')) e.preventDefault(); });
  });
  onLeave(() => clearTimeout(pressTimer));

  drawInfo();
}

// Per reading part: share of correct answers over all checked attempts.
function readingProgressHtml() {
  if (!DATA.reading.length) return '';
  const rec = getReading();
  const rows = readingGroups().map(g => {
    let ok = 0, n = 0;
    g.sets.forEach(s => { const e = rec[s.id]; if (e) { ok += e.ok || 0; n += e.n || 0; } });
    return barRow(g.name, ok, n);
  }).join('');
  return `<div class="card"><h3>Lesen</h3>${rows}</div>`;
}

/* ---------- Cards ---------- */
const DECKS = [
  { id: 'pruefung', name: 'Prüfung' },
  { id: 'schreiben', name: 'Schreiben' },
  { id: 'sprechen', name: 'Sprechen' },
  { id: 'lesen', name: 'Lesen' }
];

function renderCards(args) {
  setHeader(t('home.cards'), true);
  const known = DECKS.map(d => d.id);
  const extra = uniq(DATA.cards.map(c => c.deck)).filter(d => !known.includes(d))
    .map(d => ({ id: d, name: d }));
  const decks = DECKS.concat(extra, [{ id: MY_PHRASES_DECK, name: t('cards.myPhrases') }]);
  const deck = args[0] || store.get('lastDeck', 'pruefung');
  if (deck === MY_PHRASES_DECK) return renderMyPhrasesDeck(decks);
  const learned = getLearned();
  const cards = DATA.cards.filter(c => c.deck === deck);
  $app.innerHTML = `
    <div class="tabs">${decks.map(d =>
      `<button class="tab ${d.id === deck ? 'active' : ''}" data-deck="${esc(d.id)}">${esc(d.name)}</button>`).join('')}</div>
    <ul class="list">${cards.map(c => `
      <li><a href="#/card/${encodeURIComponent(c.id)}">
        <span class="tick">${learned[c.id] ? '✓' : ''}</span>
        <span class="t">${esc(c.title)}<span class="sub">${esc(cardView(c).prompt)}</span></span>
      </a></li>`).join('') || `<p class="muted center">${esc(t('cards.emptyDeck'))}</p>`}</ul>
  `;
  store.set('lastDeck', deck);
  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => { location.hash = '#/cards/' + encodeURIComponent(t.dataset.deck); };
  });
}

const MY_PHRASES_DECK = 'benim';

function renderMyPhrasesDeck(decks) {
  store.set('lastDeck', MY_PHRASES_DECK);
  const phrases = getMyPhrases();
  $app.innerHTML = `
    <div class="tabs">${decks.map(d =>
      `<button class="tab ${d.id === MY_PHRASES_DECK ? 'active' : ''}" data-deck="${esc(d.id)}">${esc(d.name)}</button>`).join('')}</div>
    ${phrases.length ? `<ul class="phrase-list card">${phrases.map((p, i) => `
      <li><span class="t"><span lang="de">${esc(p.de)}</span>${p.tr ? `<span class="sub">${esc(p.tr)}</span>` : ''}</span>
        <button class="icon-btn" data-say="${i}" aria-label="Vorlesen">🔊</button>
        <button class="icon-btn" data-del="${i}" aria-label="${esc(t('common.delete'))}">🗑</button></li>`).join('')}</ul>`
    : `<p class="muted center">${esc(t('cards.noPhrases'))}</p>`}`;
  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => { location.hash = '#/cards/' + encodeURIComponent(t.dataset.deck); };
  });
  $app.querySelectorAll('[data-say]').forEach(b => { b.onclick = () => speakDe(phrases[Number(b.dataset.say)].de); });
  $app.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = () => { removeMyPhrase(phrases[Number(b.dataset.del)].de); renderMyPhrasesDeck(decks); };
  });
  onLeave(stopSpeech);
}

function renderCardDetail(args) {
  const card = DATA.cards.find(c => c.id === args[0]);
  if (!card) { location.hash = '#/cards'; return; }
  setHeader(card.title, true);
  $back.setAttribute('href', '#/cards/' + encodeURIComponent(card.deck));
  onLeave(() => $back.setAttribute('href', '#/'));

  const isLearned = !!getLearned()[card.id];
  const view = cardView(card);
  const blocks = view.blocks.map(b => `
    <div class="card">
      ${b.heading ? `<h3>${esc(b.heading)}</h3>` : ''}
      <ul>${(b.lines || []).map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    </div>`).join('');
  const timer = card.deck === 'sprechen' ? `
    <div class="card">
      <h3>${esc(t('cards.speakTimer'))}</h3>
      <div class="timer" id="timer">${fmtClock(monologSeconds())}</div>
      <p class="timer-note" id="timerNote" aria-live="polite"></p>
      <div class="row">
        <button class="btn primary" id="tStart">${esc(t('timer.start'))}</button>
        <button class="btn" id="tReset">${esc(t('timer.reset'))}</button>
      </div>
    </div>` : '';
  const sample = card.sample ? `
    <div class="card">
      <details id="sampleBox">
        <summary>${esc(t('cards.showSample'))}</summary>
        <div class="row" style="margin:8px 0">
          <button class="btn" id="speakBtn">🔊 Vorlesen</button>
          <button class="btn" id="stopBtn">${esc(t('common.stop'))}</button>
        </div>
        <div class="sample" lang="de">${esc(card.sample)}</div>
      </details>
    </div>` : '';
  const exq = (card.examiner_questions || []).length ? `
    <div class="card">
      <h3>Prüferfragen</h3>
      <ul>${card.examiner_questions.map(q => `<li lang="de">${esc(q)}</li>`).join('')}</ul>
    </div>` : '';

  const coachHref = coachLinkFor(card);
  $app.innerHTML = `
    <div class="card"><strong>${esc(view.prompt)}</strong></div>
    ${coachHref ? `<a class="btn primary" href="${coachHref}">${esc(t('cards.coach'))}</a>` : ''}
    ${card.deck === 'lesen' && DATA.reading.length ? `<a class="btn primary" href="#/lesen">${esc(t('cards.lesenLink'))}</a>` : ''}
    ${timer}
    ${blocks}
    ${sample}
    ${exq}
    <button class="btn ${isLearned ? '' : 'primary'}" id="learnBtn">
      ${esc(isLearned ? t('cards.learnedUndo') : t('cards.markLearned'))}</button>
  `;

  document.getElementById('learnBtn').onclick = () => {
    setLearned(card.id, !isLearned);
    renderCardDetail(args);
  };

  if (card.deck === 'sprechen') setupSpeakingTimer(monologSeconds());
  if (card.sample) setupSpeech(card.sample);
}

function coachLinkFor(card) {
  if (/^sprechen-t1-/.test(card.id)) return '#/coach/mono/' + encodeURIComponent(card.id);
  if (/^sprechen-t2/.test(card.id)) return '#/coach/t2/' + encodeURIComponent(card.id);
  if (t3Situations().some(c => c.id === card.id)) return '#/coach/t3/' + encodeURIComponent(card.id);
  if (/^sprechen-t3/.test(card.id)) return '#/coach/t3';
  return '';
}

// makeCues(noteEl, total) defaults to the speaking cues (2:00 exam stop + end alert).
function setupSpeakingTimer(seconds, makeCues) {
  const el = document.getElementById('timer');
  const startBtn = document.getElementById('tStart');
  const resetBtn = document.getElementById('tReset');
  const cues = (makeCues || speakingCues)(document.getElementById('timerNote'), seconds);
  let remaining = seconds;
  let handle = null;
  function draw() {
    el.textContent = fmtClock(remaining);
    el.classList.toggle('done', remaining === 0);
  }
  function stop() {
    if (handle) clearInterval(handle);
    handle = null;
    startBtn.textContent = remaining > 0 && remaining < seconds ? t('timer.resume') : t('timer.start');
  }
  startBtn.onclick = () => {
    if (handle) { stop(); return; }
    if (remaining === 0) { remaining = seconds; cues.reset(); }
    const endAt = Date.now() + remaining * 1000;
    startBtn.textContent = t('timer.pause');
    handle = setInterval(() => {
      remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
      draw();
      cues.update(seconds - remaining, remaining);
      if (remaining === 0) {
        stop();
        cues.finish();
      }
    }, 250);
    draw();
  };
  resetBtn.onclick = () => { stop(); remaining = seconds; cues.reset(); draw(); startBtn.textContent = t('timer.start'); };
  onLeave(stop);
  draw();
}

function setupSpeech(text) {
  const speakBtn = document.getElementById('speakBtn');
  const stopBtn = document.getElementById('stopBtn');
  if (!('speechSynthesis' in window)) {
    speakBtn.disabled = true;
    stopBtn.disabled = true;
    return;
  }
  speakBtn.onclick = () => speakDe(text);
  stopBtn.onclick = stopSpeech;
  onLeave(stopSpeech);
}

/* ---------- Sprechen-Coach: settings, API, shared UI ---------- */
const DEFAULT_MODEL = 'claude-sonnet-5';
const API_URL = 'https://api.anthropic.com/v1/messages';
const EVAL_TOKENS = 2000;
const CHAT_TOKENS = 400;

// The key only lives in this device's localStorage (b2trainer:apiKey); never log it.
function getApiKey() { return store.get('apiKey', ''); }
function getModel() { return getSettings().model || DEFAULT_MODEL; }

let promptsModule = null;
function loadPrompts() {
  if (!promptsModule) promptsModule = import('./prompts.js').catch(e => { promptsModule = null; throw e; });
  return promptsModule;
}

class CoachError extends Error {}

function apiErrorText(status, apiMsg) {
  if (status === 401) return t('api.badKey');
  if (status === 429 || status === 529) return t('api.busy');
  if (status === 403) return t('api.forbidden');
  if (status === 404) return t('api.noModel');
  if (status >= 500) return t('api.server');
  return t('api.request', { status }) + (apiMsg ? ': ' + apiMsg : '');
}

/* Single entry point for the Claude API. Returns the joined text blocks.
   opts.maxTokens: 2000 for evaluations, 400 for chat. */
async function callClaude(system, messages, opts) {
  const key = getApiKey();
  if (!key) throw new CoachError(t('api.noKey'));
  const body = {
    model: getModel(),
    max_tokens: (opts && opts.maxTokens) || CHAT_TOKENS,
    system,
    messages,
    thinking: { type: 'disabled' } // short answers; retried without it for models that reject this
  };
  async function post() {
    if (navigator.onLine === false) throw new CoachError(t('api.offline'));
    try {
      return await fetch(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new CoachError(t('api.offline'));
    }
  }
  let res = await post();
  let err = res.ok ? null : await res.json().catch(() => null);
  if (res.status === 400 && err && err.error && /thinking/i.test(err.error.message || '')) {
    delete body.thinking;
    res = await post();
    err = res.ok ? null : await res.json().catch(() => null);
  }
  if (!res.ok) throw new CoachError(apiErrorText(res.status, err && err.error && err.error.message));
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new CoachError(t('api.refusal'));
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (!text) throw new CoachError(t('api.empty'));
  return text;
}

// Strip ``` fences and parse; null if it is not valid JSON.
function parseJsonReply(text) {
  const clean = String(text).replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(clean); } catch (e) { /* try the outermost object */ }
  const a = clean.indexOf('{');
  const b = clean.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(clean.slice(a, b + 1)); } catch (e) { /* fall through */ }
  }
  return null;
}

// Lock a button and show a spinner while fn runs.
async function withBusy(btn, fn) {
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> ' + esc(t('common.wait'));
  try { return await fn(); } finally {
    btn.disabled = false;
    btn.innerHTML = label;
  }
}

// Screen token: async results are dropped once the user has navigated away.
let screenId = 0;

/* German TTS */
function germanVoice() {
  const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  return voices.find(v => v.lang === 'de-DE') || voices.find(v => /^de/i.test(v.lang)) || null;
}
function speakDe(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text).replace(/\[|\]/g, ''));
  u.lang = 'de-DE';
  u.rate = 0.9;
  const v = germanVoice();
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}
function stopSpeech() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    ta.remove();
    return ok;
  }
}

/* Fallback mode (no key or API error): copy system + task + text as one prompt
   and paste it into the Claude app. getPrompt() is called at click time. */
function renderFallback(el, getPrompt, reason) {
  el.innerHTML = `
    <div class="card fallback">
      <h3>${esc(t('fallback.title'))}</h3>
      ${reason ? `<p class="small">${esc(reason)}</p>` : ''}
      <button class="btn" data-copy>${esc(t('fallback.copy'))}</button>
      <p class="small muted" data-hint>${esc(t('fallback.hint'))}</p>
    </div>`;
  const btn = el.querySelector('[data-copy]');
  btn.onclick = async () => {
    const ok = await copyText(await getPrompt());
    el.querySelector('[data-hint]').innerHTML = ok
      ? t('fallback.copied')
      : esc(t('fallback.copyFailed'));
  };
}

/* Evaluation result (monologue + dialog share the schema) */
const CRITERIA = [
  ['aufgabe', 'Aufgabenerfüllung'],
  ['kohaerenz', 'Kohärenz'],
  ['wortschatz', 'Wortschatz'],
  ['strukturen', 'Strukturen']
];
const GRADE_TEXT = { A: 'B2 gut', B: 'B2', C: 'B1', D: 'unter B1' };
function gradeBadge(g) {
  const k = String(g || '?').trim().charAt(0).toUpperCase();
  return `<span class="grade grade-${/[ABCD]/.test(k) ? k : 'x'}" title="${esc(GRADE_TEXT[k] || '')}">${esc(k)}</span>`;
}
function correctionsHtml(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return `<ul class="corrections">${list.map(c => `
    <li>
      <div lang="de"><span class="wrong-text">${esc(c.original)}</span> → <span class="right-text">${esc(c.corrected)}</span></div>
      ${c.explanation_tr ? `<div class="small muted">${esc(c.explanation_tr)}</div>` : ''}
    </li>`).join('')}</ul>`;
}
function renderEvalResult(el, result, rawText) {
  if (!result) {
    el.innerHTML = `<div class="card"><h3>${esc(t('eval.raw'))}</h3>
      <div class="sample small">${esc(rawText)}</div></div>`;
    return;
  }
  const scores = result.scores || {};
  el.innerHTML = `
    <div class="card">
      <h3>${esc(t('eval.scores'))}</h3>
      <div class="scores" lang="de">${CRITERIA.map(([k, name]) => `
        <div class="score">${gradeBadge(scores[k])}<span class="small">${name}</span></div>`).join('')}</div>
      <p class="small muted">A = B2 gut · B = B2 · C = B1 · D = unter B1</p>
      ${result.summary_tr ? `<p>${esc(result.summary_tr)}</p>` : ''}
    </div>
    ${Array.isArray(result.corrections) && result.corrections.length ? `
      <div class="card"><h3>${esc(t('eval.corrections'))}</h3>${correctionsHtml(result.corrections)}</div>` : ''}
    ${result.improved_de ? `
      <div class="card">
        <h3>Verbesserte Version</h3>
        <div class="row" style="margin:8px 0">
          <button class="btn" data-speak>🔊 Vorlesen</button>
          <button class="btn" data-stop>${esc(t('common.stop'))}</button>
        </div>
        <div class="sample" lang="de">${esc(result.improved_de)}</div>
      </div>` : ''}
    ${Array.isArray(result.tips_tr) && result.tips_tr.length ? `
      <div class="card"><h3>${esc(t('eval.tips'))}</h3><ul>${result.tips_tr.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}`;
  const sp = el.querySelector('[data-speak]');
  if (sp) {
    sp.onclick = () => speakDe(result.improved_de);
    el.querySelector('[data-stop]').onclick = stopSpeech;
  }
}

/* History: b2trainer:coachHistory = [{ date, cardId, theme, mode, scores }] */
function getCoachHistory() { return store.get('coachHistory', []); }
function addCoachHistory(entry) {
  const h = getCoachHistory();
  h.push(entry);
  store.set('coachHistory', h.slice(-300));
}
function lastScoresByTheme() {
  const last = {};
  getCoachHistory().forEach(e => { last[e.cardId || e.theme] = e; });
  return last;
}
function scoresInline(scores, criteria) {
  return (criteria || CRITERIA).map(([k]) => gradeBadge((scores || {})[k])).join('');
}

/* ---------- Settings ---------- */
function renderSettings() {
  setHeader(t('home.settings'), true);
  const settings = getSettings();
  const hasKey = !!getApiKey();
  $app.innerHTML = `
    <div class="card">
      <h3>${esc(t('settings.language'))}</h3>
      <div class="lang-row">${langButtonsHtml(LANG)}</div>
    </div>
    <div class="card">
      <h3>Sprechen-Coach (Claude API)</h3>
      <label class="field"><span>${esc(t('settings.apiKey'))}</span>
        <input type="password" id="keyInput" autocomplete="off" autocapitalize="off" spellcheck="false"
          placeholder="${hasKey ? esc(t('settings.keySaved')) : 'sk-ant-…'}">
      </label>
      <div class="row">
        <button class="btn primary" id="saveKey">${esc(t('common.save'))}</button>
        <button class="btn danger" id="delKey" ${hasKey ? '' : 'disabled'}>${esc(t('common.delete'))}</button>
      </div>
      <label class="field"><span>Model</span>
        <input type="text" id="modelInput" autocomplete="off" autocapitalize="off" spellcheck="false"
          value="${esc(settings.model || DEFAULT_MODEL)}">
      </label>
      <button class="btn" id="testBtn">${esc(t('settings.test'))}</button>
      <p id="testOut" class="small"></p>
      <p class="small muted">${esc(t('settings.noKeyHelp'))}</p>
    </div>
    <div class="card">
      <h3>Sprechen</h3>
      <label class="field"><span>${esc(t('settings.monolog'))}</span>
        <select id="monoSelect">${MONOLOG_OPTIONS.map(m =>
          `<option value="${m}" ${monologSeconds() === m * 60 ? 'selected' : ''}>${esc(t('common.minutes', { n: m }))}</option>`).join('')}</select>
      </label>
      <p class="small muted">${esc(t('settings.monologHelp'))}</p>
    </div>
    <div class="card">
      <h3>Schreiben</h3>
      ${Object.keys(WRITING_KINDS).map(k => `
        <label class="field"><span>${esc(t('settings.writingMinutes', { name: WRITING_KINDS[k].name }))}</span>
          <input type="number" data-wmin="${k}" min="5" max="60" inputmode="numeric" value="${writingMinutes(k)}">
        </label>`).join('')}
    </div>`;
  $app.querySelectorAll('[data-lang]').forEach(b => {
    b.onclick = async () => {
      if (b.dataset.lang === LANG) return;
      await setLang(b.dataset.lang);
      renderSettings();
    };
  });
  document.querySelectorAll('[data-wmin]').forEach(inp => {
    inp.onchange = () => {
      const K = WRITING_KINDS[inp.dataset.wmin];
      const s = getSettings();
      s[K.minutesKey] = Math.max(5, Math.min(60, parseInt(inp.value, 10) || K.defaultMinutes));
      saveSettings(s);
      inp.value = s[K.minutesKey];
    };
  });
  document.getElementById('monoSelect').onchange = e => {
    const s = getSettings();
    s.monologMinutes = parseInt(e.target.value, 10) || 3;
    saveSettings(s);
  };
  const keyInput = document.getElementById('keyInput');
  const modelInput = document.getElementById('modelInput');
  const out = document.getElementById('testOut');
  function saveModel() {
    const s = getSettings();
    s.model = modelInput.value.trim() || DEFAULT_MODEL;
    saveSettings(s);
  }
  modelInput.onchange = saveModel;
  document.getElementById('saveKey').onclick = () => {
    const v = keyInput.value.trim();
    if (!v) { out.textContent = t('settings.keyEmpty'); return; }
    store.set('apiKey', v);
    renderSettings();
    document.getElementById('testOut').textContent = t('settings.saved');
  };
  document.getElementById('delKey').onclick = () => {
    if (!confirm(t('settings.delKeyConfirm'))) return;
    store.remove('apiKey');
    renderSettings();
  };
  const testBtn = document.getElementById('testBtn');
  testBtn.onclick = () => withBusy(testBtn, async () => {
    saveModel();
    if (keyInput.value.trim()) store.set('apiKey', keyInput.value.trim());
    out.textContent = '';
    try {
      await callClaude('Reply with the single word: OK', [{ role: 'user', content: 'Test' }], { maxTokens: 16 });
      out.textContent = t('settings.testOk', { model: getModel() });
    } catch (e) {
      out.textContent = '❌ ' + (e instanceof CoachError ? e.message : t('api.unexpected'));
    }
  });
}

/* ---------- Coach hub ---------- */
function t1Cards() { return DATA.cards.filter(c => /^sprechen-t1-/.test(c.id)); }

function renderCoachHub() {
  setHeader('Sprechen-Coach', true);
  const last = lastScoresByTheme();
  const item = (href, title, sub, entry) => `
    <li><a href="${href}">
      <span class="t">${esc(title)}<span class="sub">${esc(sub || '')}</span></span>
      ${entry ? `<span class="mini-scores">${scoresInline(entry.scores)}</span>` : ''}
    </a></li>`;
  $app.innerHTML = `
    ${getApiKey() ? '' : `<div class="card small">${t('coach.noKey')}
      <a href="#/settings">${esc(t('coach.addKey'))}</a></div>`}
    <h3>Teil 1 · Monolog</h3>
    <ul class="list">${t1Cards().map(c => item('#/coach/mono/' + encodeURIComponent(c.id), c.title, cardView(c).prompt, last[c.id])).join('')}</ul>
    <h3>Teil 2 · Smalltalk (Partner)</h3>
    <ul class="list">${item('#/coach/t2/' + encodeURIComponent((t2Cards()[0] || {}).id || ''), 'Smalltalk mit Kollegen', t('coach.t2Sub'), last['coach-t2'])}</ul>
    <h3>Teil 3 · Lösungswege (Partner)</h3>
    <a class="btn primary" href="#/coach/t3/new">✨ Neue Situation</a>
    <ul class="list">${t3Situations().map(c => item('#/coach/t3/' + encodeURIComponent(c.id), c.title, cardView(c).prompt, last[c.id])).join('')}</ul>
  `;
}

/* ---------- Mode 1: Monolog (Teil 1A + 1B) ---------- */
function renderCoachMonolog(args) {
  const card = DATA.cards.find(c => c.id === args[0]);
  if (!card) { location.hash = '#/coach'; return; }
  const my = screenId;
  setHeader('Coach · ' + card.title, true);
  $back.setAttribute('href', '#/coach');
  onLeave(() => { $back.setAttribute('href', '#/'); stopSpeech(); });
  const draftKey = 'coachDraft:' + card.id;
  const hasKey = !!getApiKey();
  const monoSec = monologSeconds();
  const monoMin = monoSec / 60;

  $app.innerHTML = `
    <div class="card"><strong>${esc(cardView(card).prompt)}</strong>
      ${cardView(card).blocks.length ? `<details><summary>Stichpunkte</summary>${cardView(card).blocks.map(b => `
        ${b.heading ? `<h3>${esc(b.heading)}</h3>` : ''}
        <ul>${(b.lines || []).map(l => `<li>${esc(l)}</li>`).join('')}</ul>`).join('')}</details>` : ''}
    </div>
    <div class="card">
      <h3>${esc(t('mono.record', { n: monoMin }))}</h3>
      <div class="timer" id="recTimer">${fmtClock(monoSec)}</div>
      <p class="timer-note" id="recNote" aria-live="polite"></p>
      <div class="row">
        <button class="btn primary" id="recBtn">${esc(t('rec.start'))}</button>
        <button class="btn" id="playBtn" disabled>${esc(t('rec.play'))}</button>
      </div>
      <p class="small muted" id="recInfo">${esc(t('rec.info'))}</p>
    </div>
    <div class="card">
      <h3>${esc(t('mono.text'))}</h3>
      <p class="small muted">${esc(t('mono.dictate'))}</p>
      <textarea id="mText" rows="8" lang="de" placeholder="Ich möchte über … sprechen."></textarea>
      <p class="small muted" id="wordCount"></p>
      ${hasKey ? '<button class="btn primary" id="evalBtn">Bewerten</button>' : ''}
      <p class="small error" id="evalErr"></p>
      <div id="fallback"></div>
    </div>
    <div id="result"></div>
    <div id="followups"></div>`;

  setupRecorder(monoSec);

  const ta = document.getElementById('mText');
  const wc = document.getElementById('wordCount');
  function countWords() {
    const n = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0;
    wc.textContent = t('common.words', { n }) + (n ? ' ' + t('mono.wordTarget', { min: monoMin, a: monoMin * 100, b: monoMin * 125 }) : '');
  }
  ta.value = store.get(draftKey, '');
  countWords();
  ta.oninput = () => { store.set(draftKey, ta.value); countWords(); };

  function taskText() {
    const points = (card.blocks || []).map(b => (b.heading ? b.heading + ': ' : '') + (b.lines || []).join('; ')).join('\n');
    return `Task (DTB B2 Sprechen Teil 1A, about 2 minutes):\n${card.prompt}\n\nNotes on the card:\n${points}`;
  }
  function userMessage() {
    return `${taskText()}\n\nCandidate transcript:\n${ta.value.trim()}`;
  }
  const fallbackEl = document.getElementById('fallback');
  const fallbackPrompt = async () => (await loadPrompts()).PROMPT_MONOLOG + '\n\n' + userMessage();
  if (!hasKey) {
    renderFallback(fallbackEl, fallbackPrompt, t('mono.noKey'));
    return;
  }

  const evalBtn = document.getElementById('evalBtn');
  const errEl = document.getElementById('evalErr');
  evalBtn.onclick = () => {
    if (!ta.value.trim()) { errEl.textContent = t('mono.writeFirst'); return; }
    errEl.textContent = '';
    fallbackEl.innerHTML = '';
    withBusy(evalBtn, async () => {
      let text;
      try {
        const P = await loadPrompts();
        text = await callClaude(P.PROMPT_MONOLOG, [{ role: 'user', content: userMessage() }], { maxTokens: EVAL_TOKENS });
      } catch (e) {
        if (my !== screenId) return;
        errEl.textContent = '❌ ' + (e instanceof CoachError ? e.message : t('api.unexpected'));
        renderFallback(fallbackEl, fallbackPrompt);
        return;
      }
      if (my !== screenId) return;
      const result = parseJsonReply(text);
      const resultEl = document.getElementById('result');
      renderEvalResult(resultEl, result, text);
      if (result && result.scores) {
        addCoachHistory({ date: Date.now(), cardId: card.id, theme: card.title, mode: 'mono', scores: result.scores });
      }
      renderFollowups(document.getElementById('followups'), result && result.followup_questions_de, card, my);
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
}

/* Teil 1B: examiner follow-up questions, read aloud, answered by dictation */
function renderFollowups(el, questions, card, my) {
  if (!Array.isArray(questions) || !questions.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<h3>Prüferfragen (Teil 1B)</h3>` + questions.map((q, i) => `
    <div class="card" data-i="${i}">
      <p lang="de"><strong>${esc(q)}</strong></p>
      <button class="btn inline" data-say>🔊 Frage vorlesen</button>
      <textarea rows="4" lang="de" placeholder="${esc(t('followup.placeholder'))}"></textarea>
      <button class="btn primary" data-send>Antwort prüfen</button>
      <p class="small error" data-err></p>
      <div data-out></div>
    </div>`).join('');
  el.querySelectorAll('[data-i]').forEach(box => {
    const q = questions[Number(box.dataset.i)];
    const ta = box.querySelector('textarea');
    const out = box.querySelector('[data-out]');
    const err = box.querySelector('[data-err]');
    box.querySelector('[data-say]').onclick = () => speakDe(q);
    const send = box.querySelector('[data-send]');
    send.onclick = () => {
      if (!ta.value.trim()) { err.textContent = t('followup.writeFirst'); return; }
      err.textContent = '';
      withBusy(send, async () => {
        const msg = `Talk topic: ${card.prompt}\n\nExaminer question: ${q}\n\nCandidate answer (dictation):\n${ta.value.trim()}`;
        let text;
        try {
          const P = await loadPrompts();
          text = await callClaude(P.PROMPT_FOLLOWUP, [{ role: 'user', content: msg }], { maxTokens: EVAL_TOKENS });
        } catch (e) {
          if (my !== screenId) return;
          err.textContent = '❌ ' + (e instanceof CoachError ? e.message : t('api.unexpected'));
          renderFallback(out, async () => (await loadPrompts()).PROMPT_FOLLOWUP + '\n\n' + msg);
          return;
        }
        if (my !== screenId) return;
        const r = parseJsonReply(text);
        if (!r) { out.innerHTML = `<div class="sample small">${esc(text)}</div>`; return; }
        out.innerHTML = `
          ${r.ok_tr ? `<p class="verdict ok">✓ ${esc(r.ok_tr)}</p>` : ''}
          ${correctionsHtml(r.corrections)}
          ${r.better_answer_de ? `<h3>Musterantwort</h3>
            <button class="btn inline" data-say2>🔊 Vorlesen</button>
            <div class="sample" lang="de">${esc(r.better_answer_de)}</div>` : ''}`;
        const s2 = out.querySelector('[data-say2]');
        if (s2) s2.onclick = () => speakDe(r.better_answer_de);
      });
    };
  });
  // Read the first question aloud, like an examiner would.
  speakDe(questions[0]);
}

/* Monologue voice recording (MediaRecorder, length from settings). The recording stays in memory only. */
function setupRecorder(seconds) {
  const recBtn = document.getElementById('recBtn');
  const playBtn = document.getElementById('playBtn');
  const timerEl = document.getElementById('recTimer');
  const info = document.getElementById('recInfo');
  const cues = speakingCues(document.getElementById('recNote'), seconds);
  let recorder = null, stream = null, chunks = [], handle = null, url = null, audio = null;

  function draw(left) {
    const s = Math.max(0, Math.ceil(left));
    timerEl.textContent = fmtClock(s);
    timerEl.classList.toggle('done', s === 0);
  }
  function release() {
    if (handle) clearInterval(handle);
    handle = null;
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  function stop() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    release();
  }
  if (!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    recBtn.disabled = true;
    info.textContent = t('rec.unsupported');
    return;
  }
  recBtn.onclick = async () => {
    if (recorder && recorder.state === 'recording') { stop(); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      info.textContent = t('rec.denied');
      return;
    }
    const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks = [];
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || type || 'audio/mp4' }));
      audio = new Audio(url);
      audio.onended = () => { playBtn.textContent = t('rec.play'); };
      playBtn.disabled = false;
      playBtn.textContent = t('rec.play');
      recBtn.textContent = t('rec.again');
    };
    recorder.start(1000);
    cues.reset();
    const endAt = Date.now() + seconds * 1000;
    recBtn.textContent = t('common.stop');
    playBtn.disabled = true;
    if (audio) audio.pause();
    handle = setInterval(() => {
      const left = (endAt - Date.now()) / 1000;
      draw(left);
      cues.update(seconds - left, left);
      if (left <= 0) {
        stop();
        cues.finish();
      }
    }, 250);
    draw(seconds);
  };
  playBtn.onclick = () => {
    if (!audio) return;
    if (audio.paused) { audio.currentTime = audio.ended ? 0 : audio.currentTime; audio.play(); playBtn.textContent = t('rec.pause'); }
    else { audio.pause(); playBtn.textContent = t('rec.play'); }
  };
  onLeave(() => {
    stop();
    if (audio) audio.pause();
    if (url) URL.revokeObjectURL(url);
  });
  draw(seconds);
}

/* ---------- Modes 2 + 3: partner dialogues (Teil 2 Smalltalk, Teil 3 Lösungswege) ---------- */
const PROMPT_NEW_SITUATION = `You write practice situations for the German exam "Deutsch-Test für den Beruf B2", Sprechen Teil 3 (Lösungswege diskutieren).
Invent ONE new, realistic workplace problem that two colleagues must solve together (vary the setting: office, clinic, care, counselling centre, logistics, customer service). 1-2 German sentences at B2 level. Output only the situation, no introduction, no quotes.`;

const DIALOG_KINDS = {
  t2: { title: 'Teil 2 · Smalltalk', task: 'Teil 2 Smalltalk mit Kollegen (du-Form)', turns: '5', maxTurns: 5 },
  t3: { title: 'Teil 3 · Lösungswege', task: 'Teil 3 Lösungswege diskutieren', turns: '6–8', maxTurns: 8 }
};

function t2Cards() { return DATA.cards.filter(c => /^sprechen-t2/.test(c.id)); }
function t3Situations() {
  const all = DATA.cards.filter(c => /^sprechen-t3/.test(c.id));
  const fall = all.filter(c => (c.tags || []).includes('fall'));
  return fall.length ? fall : all.filter(c => c.id !== 'sprechen-t3');
}
// Small-talk questions from the Teil 2 cards (lines ending with "?").
function smalltalkQuestions() {
  const qs = [];
  t2Cards().forEach(c => (c.blocks || []).forEach(b => (b.lines || []).forEach(l => {
    // Skip generic counter-questions ("Und wie ist das bei dir?", "Hast du auch schon mal …?").
    if (/\?\s*$/.test(l) && !/…|^Und /.test(l)) qs.push(l.trim());
  })));
  return uniq(qs);
}

function monologSchema(P) {
  const s = P.PROMPT_MONOLOG;
  const i = s.indexOf('{"scores"');
  return i >= 0 ? s.slice(i) : '';
}

function renderCoachT3Picker() {
  setHeader('Coach · Teil 3', true);
  $back.setAttribute('href', '#/coach');
  onLeave(() => $back.setAttribute('href', '#/'));
  $app.innerHTML = `
    <p class="muted small">${esc(t('t3.pick'))}</p>
    <a class="btn primary" href="#/coach/t3/new">✨ Neue Situation</a>
    <ul class="list">${t3Situations().map(c => `
      <li><a href="#/coach/t3/${encodeURIComponent(c.id)}"><span class="t">${esc(c.title)}<span class="sub">${esc(cardView(c).prompt)}</span></span></a></li>`).join('')}</ul>`;
}

function renderCoachDialog(kind, arg) {
  const K = DIALOG_KINDS[kind];
  let card = null;
  if (kind === 't2') card = DATA.cards.find(c => c.id === arg) || t2Cards()[0] || null;
  if (kind === 't3') {
    if (!arg) { renderCoachT3Picker(); return; }
    card = arg === 'new' ? null : DATA.cards.find(c => c.id === arg);
    if (arg !== 'new' && !card) { location.hash = '#/coach/t3'; return; }
  }
  const my = screenId;
  const hasKey = !!getApiKey();
  setHeader('Coach · ' + K.title, true);
  $back.setAttribute('href', kind === 't3' ? '#/coach/t3' : '#/coach');
  onLeave(() => { $back.setAttribute('href', '#/'); stopSpeech(); });

  let situation = kind === 't3' && card ? card.prompt : '';
  let history = [];   // API messages; history[0] is the hidden kick-off instruction
  let busy = false;
  let muted = !!store.get('coachMute', false);

  $app.innerHTML = `
    <div class="card" id="sitBox"></div>
    <div id="chatArea"></div>
    <div id="dlgFallback"></div>
    <div id="dlgResult"></div>`;
  const sitBox = document.getElementById('sitBox');
  const chatArea = document.getElementById('chatArea');
  const fallbackEl = document.getElementById('dlgFallback');
  const resultEl = document.getElementById('dlgResult');

  function drawSituation() {
    if (kind === 't2') {
      sitBox.innerHTML = `<strong>Smalltalk mit einer Kollegin / einem Kollegen</strong>
        <p class="small muted">${esc(t('t2.help', { n: K.turns }))}</p>`;
    } else {
      sitBox.innerHTML = `
        <strong>Situation</strong>
        <p lang="de" id="sitText">${situation ? esc(situation) : `<span class="muted">${esc(t('t3.noSituation'))}</span>`}</p>
        <p class="small muted">${esc(t('t3.help', { n: K.turns }))}</p>
        ${hasKey ? '<button class="btn" id="newSitBtn">✨ Neue Situation</button><p class="small error" id="sitErr"></p>' : ''}`;
      const nb = document.getElementById('newSitBtn');
      if (nb) nb.onclick = () => withBusy(nb, newSituation);
    }
  }

  async function newSituation() {
    const errEl = document.getElementById('sitErr');
    errEl.textContent = '';
    try {
      const text = await callClaude(PROMPT_NEW_SITUATION,
        [{ role: 'user', content: 'Neue Situation, bitte. (' + Math.floor(Math.random() * 1e6) + ')' }], { maxTokens: CHAT_TOKENS });
      if (my !== screenId) return;
      situation = text.replace(/^["„]|["“]$/g, '').trim();
      history = [];
      resultEl.innerHTML = '';
      drawSituation();
      drawChat();
    } catch (e) {
      if (my !== screenId) return;
      const el = document.getElementById('sitErr');
      if (el) el.textContent = '❌ ' + (e instanceof CoachError ? e.message : t('api.unexpected'));
    }
  }

  async function systemPrompt() {
    const P = await loadPrompts();
    return kind === 't2' ? P.PROMPT_T2 : P.PROMPT_T3.replace('{{SITUATION}}', situation);
  }
  function kickoff() {
    if (kind === 't2') {
      const qs = smalltalkQuestions();
      if (qs.length && Math.random() < 0.7) {
        const q = qs[Math.floor(Math.random() * qs.length)];
        return `Start the small talk now. Greet me briefly and ask this question (you may phrase it naturally): "${q}"`;
      }
      return 'Start the small talk now. Greet me briefly and ask me a typical workplace small-talk question of your choice.';
    }
    return 'Start the discussion now: briefly describe the problem from your point of view and make a first suggestion or ask what we should do first.';
  }
  function candidateTurns() { return history.filter((m, i) => i > 0 && m.role === 'user').length; }
  function transcript() {
    return history.slice(1).map(m => (m.role === 'user' ? 'Kandidatin: ' : 'Partner: ') + m.content).join('\n');
  }

  function drawChat() {
    if (kind === 't3' && !situation) { chatArea.innerHTML = ''; return; }
    if (!hasKey) { chatArea.innerHTML = ''; drawNoKeyFallback(); return; }
    const started = history.length > 0;
    const turns = candidateTurns();
    chatArea.innerHTML = `
      <div class="chat-bar">
        <span class="small muted">${started ? esc(t('chat.turn', { n: Math.min(turns, K.maxTurns), total: K.turns })) : ''}</span>
        <button class="btn inline" id="muteBtn">${esc(muted ? t('chat.muted') : t('chat.unmuted'))}</button>
      </div>
      <div class="chat" id="chatLog">${history.slice(1).map(m => `
        <div class="msg ${m.role === 'user' ? 'me' : 'them'}" lang="de">${esc(m.content)}${m.role === 'assistant'
          ? '<button class="say" aria-label="Vorlesen">🔊</button>' : ''}</div>`).join('')}
        ${busy ? '<div class="msg them typing"><span class="spinner"></span></div>' : ''}
      </div>
      ${started ? `
        <p class="small muted">${esc(t('chat.dictate'))}</p>
        <textarea id="chatInput" rows="3" lang="de" placeholder="Deine Antwort…"></textarea>
        <button class="btn primary" id="sendBtn" ${busy ? 'disabled' : ''}>${esc(t('common.send'))}</button>
        ${turns >= K.maxTurns ? `<p class="small">${esc(t('chat.turnsDone'))}</p>` : ''}
        <button class="btn" id="endBtn" ${busy || !turns ? 'disabled' : ''}>Beenden &amp; bewerten</button>`
      : `<button class="btn primary" id="startBtn" ${busy ? 'disabled' : ''}>Gespräch starten</button>`}
      <p class="small error" id="chatErr"></p>`;
    document.getElementById('muteBtn').onclick = () => {
      muted = !muted;
      store.set('coachMute', muted);
      if (muted) stopSpeech();
      document.getElementById('muteBtn').textContent = muted ? t('chat.muted') : t('chat.unmuted');
    };
    chatArea.querySelectorAll('.msg.them .say').forEach(btn => {
      btn.onclick = () => speakDe(btn.parentNode.firstChild.textContent);
    });
    const log = document.getElementById('chatLog');
    if (log.lastElementChild) log.lastElementChild.scrollIntoView({ block: 'nearest' });
    const startBtn = document.getElementById('startBtn');
    if (startBtn) startBtn.onclick = () => {
      unlockSpeech();
      history = [{ role: 'user', content: kickoff() }];
      partnerTurn();
    };
    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) sendBtn.onclick = () => {
      const input = document.getElementById('chatInput');
      const text = input.value.trim();
      if (!text) return;
      unlockSpeech();
      history.push({ role: 'user', content: text });
      partnerTurn();
    };
    const endBtn = document.getElementById('endBtn');
    if (endBtn) endBtn.onclick = () => withBusy(endBtn, evaluate);
  }

  // iOS only lets speechSynthesis talk after a user gesture; speak an empty utterance in the tap.
  function unlockSpeech() {
    if (muted || !('speechSynthesis' in window)) return;
    try { speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch (e) { /* ignore */ }
  }

  async function partnerTurn() {
    busy = true;
    fallbackEl.innerHTML = '';
    drawChat();
    try {
      const reply = await callClaude(await systemPrompt(), history, { maxTokens: CHAT_TOKENS });
      if (my !== screenId) return;
      history.push({ role: 'assistant', content: reply });
      busy = false;
      drawChat();
      if (!muted) speakDe(reply);
    } catch (e) {
      if (my !== screenId) return;
      // Drop the unanswered message so the conversation stays user/assistant alternating.
      const last = history.pop();
      busy = false;
      drawChat();
      if (history.length && last) { const inp = document.getElementById('chatInput'); if (inp) inp.value = last.content; }
      document.getElementById('chatErr').textContent = '❌ ' + (e instanceof CoachError ? e.message : t('api.unexpected'));
      renderFallback(fallbackEl, rolePlayPrompt, t('chat.continueInApp'));
    }
  }

  async function evaluationPrompt() {
    const P = await loadPrompts();
    const system = P.PROMPT_DIALOG_EVAL.replace('{{TASK}}', K.task);
    const user = `Task type: ${K.task}\n${situation ? 'Situation: ' + situation + '\n' : ''}\n` +
      `JSON schema of the monologue evaluation:\n${monologSchema(P)}\n\nDialogue:\n${transcript()}`;
    return { system, user };
  }

  async function evaluate() {
    const errEl = document.getElementById('chatErr');
    errEl.textContent = '';
    fallbackEl.innerHTML = '';
    stopSpeech();
    const { system, user } = await evaluationPrompt();
    let text;
    try {
      text = await callClaude(system, [{ role: 'user', content: user }], { maxTokens: EVAL_TOKENS });
    } catch (e) {
      if (my !== screenId) return;
      errEl.textContent = '❌ ' + (e instanceof CoachError ? e.message : t('api.unexpected'));
      renderFallback(fallbackEl, async () => { const p = await evaluationPrompt(); return p.system + '\n\n' + p.user; });
      return;
    }
    if (my !== screenId) return;
    const result = parseJsonReply(text);
    renderEvalResult(resultEl, result, text);
    if (result && result.scores) {
      // All Teil 2 chats share one entry; Teil 3 is tracked per situation.
      const id = kind === 't2' ? 'coach-t2' : (card ? card.id : 'coach-t3-new');
      const theme = kind === 't2' ? 'Teil 2 · Smalltalk' : (card ? card.title : 'Teil 3 · Neue Situation');
      addCoachHistory({ date: Date.now(), cardId: id, theme, mode: kind, scores: result.scores });
    }
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Fallback: the role-play as one prompt for the Claude app (plus the dialogue so far).
  async function rolePlayPrompt() {
    const sys = await systemPrompt();
    const done = history.length > 1 ? '\n\nConversation so far:\n' + transcript() + '\n\nContinue the role-play from here.' : '\n\n' + kickoff();
    return sys + done + '\n\nAt the end, when I write "Bewerten", evaluate only my turns as a DTB B2 examiner (A/B/C/D for Aufgabe, Kohärenz, Wortschatz, Strukturen; corrections with Turkish explanations).';
  }
  function drawNoKeyFallback() {
    renderFallback(fallbackEl, rolePlayPrompt, t('chat.noKey'));
  }

  drawSituation();
  drawChat();
  if (kind === 't3' && !situation && hasKey) {
    const nb = document.getElementById('newSitBtn');
    if (nb) withBusy(nb, newSituation);
  } else if (kind === 't3' && !situation) {
    sitBox.insertAdjacentHTML('beforeend', `<p class="small">${esc(t('t3.needKey'))}</p>`);
  }
}

/* ---------- Schreiben-Coach ----------
   Tasks come from the cards: Beschwerde = "bs-*" cards, Forumsbeitrag = one line of a "forum-themen-*" card
   ("Thema — Pro: … | Contra: …"). Photos are only kept in memory: shrunk, sent to the API, then dropped. */
const WRITING_KINDS = {
  bs: { name: 'Beschwerde', minutesKey: 'bsMinutes', defaultMinutes: 20, words: '120–170' },
  forum: { name: 'Forumsbeitrag', minutesKey: 'forumMinutes', defaultMinutes: 25, words: '150–200' }
};
const MAX_PAGES = 3;
const IMAGE_MAX_SIDE = 1600;
const IMAGE_QUALITY = 0.8;
const MIN_TRANSCRIPT_WORDS = 30;
const TRANSCRIBE_TOKENS = 2000;
const WRITING_EVAL_TOKENS = 3000;
const WRITING_CRITERIA = [
  ['aufgabe', 'Aufgabe'],
  ['register', 'Register'],
  ['kohaerenz', 'Kohärenz'],
  ['sprache', 'Sprache']
];

function writingMinutes(kind) {
  const K = WRITING_KINDS[kind];
  const m = parseInt(getSettings()[K.minutesKey], 10);
  return m >= 5 && m <= 60 ? m : K.defaultMinutes;
}
function countWords(text) {
  const t = String(text || '').replace(/\[\?\]/g, '').trim();
  return t ? t.split(/\s+/).length : 0;
}
function blockLines(card, headingStart) {
  const b = (card.blocks || []).find(x => String(x.heading || '').startsWith(headingStart));
  return b ? (b.lines || []) : [];
}
function beschwerdeCards() { return DATA.cards.filter(c => /^bs-/.test(c.id)); }
function forumCards() { return DATA.cards.filter(c => /^forum-themen-/.test(c.id)); }
function forumLines(card) { return (card.blocks || []).reduce((a, b) => a.concat(b.lines || []), []); }
function parseTopic(line) {
  const s = String(line);
  const i = s.indexOf('—');
  const rest = i >= 0 ? s.slice(i + 1) : '';
  return {
    title: (i >= 0 ? s.slice(0, i) : s).trim(),
    pro: ((rest.match(/Pro:\s*([^|]*)/) || [])[1] || '').trim(),
    contra: ((rest.match(/Contra:\s*(.*)$/) || [])[1] || '').trim()
  };
}
function topicHintHtml(t) {
  return `<span lang="de"><strong>Pro:</strong> ${esc(t.pro || '–')}<br><strong>Contra:</strong> ${esc(t.contra || '–')}</span>`;
}

// { kind, id, href, title, task, card, chef, kunde } for Beschwerde; { …, topic } for Forumsbeitrag.
function writingTask(kind, cardId, idx) {
  const card = DATA.cards.find(c => c.id === cardId);
  if (!card) return null;
  if (kind === 'bs') {
    if (!/^bs-/.test(card.id)) return null;
    return {
      kind, card, id: card.id,
      href: '#/schreiben/bs/' + encodeURIComponent(card.id),
      title: card.title.replace(/^Beschwerde-Übung\s*·\s*/, ''),
      task: card.prompt || '',
      chef: blockLines(card, 'Chef'),
      kunde: blockLines(card, 'Kunden')
    };
  }
  if (kind !== 'forum' || !/^forum-themen-/.test(card.id)) return null;
  const line = forumLines(card)[Number(idx)];
  if (!line) return null;
  const topic = parseTopic(line);
  return {
    kind, card, topic, id: card.id + ':' + idx,
    href: '#/schreiben/forum/' + encodeURIComponent(card.id) + '/' + idx,
    title: topic.title,
    task: `Ihre Firma plant eine neue Regel: „${topic.title}“. Schreiben Sie einen Beitrag im Firmenforum (ca. 150 Wörter): Äußern Sie Ihre Meinung, begründen Sie sie und nennen Sie Beispiele.`
  };
}

function fillPrompt(template, values) {
  // Placeholders are replaced in order; {{TEXT}} comes last so the candidate's text is never re-scanned.
  return Object.keys(values).reduce((acc, k) => acc.split('{{' + k + '}}').join(values[k]), template);
}
function writingEvalPrompt(P, task, text) {
  if (task.kind === 'bs') {
    return fillPrompt(P.PROMPT_EVAL_BESCHWERDE, {
      CHEF: task.chef.join('\n'), KUNDE: task.kunde.join(' '), TASK: task.task, TEXT: text
    });
  }
  // The forum prompt refers to "the same schema as the complaint evaluation": append that schema.
  const b = P.PROMPT_EVAL_BESCHWERDE;
  const schema = b.slice(b.indexOf('{"word_count"'));
  return fillPrompt(P.PROMPT_EVAL_FORUM, { TOPIC: task.topic.title, TEXT: text }) +
    '\n\nJSON schema of the complaint evaluation:\n' + schema;
}
function isCovered(item) { return item && (item.covered === true || item.covered === 'true'); }

/* My phrases: b2trainer:myPhrases = [{ de, tr, date }] (shown in Kartlar → "Benim kalıplarım") */
function getMyPhrases() { return store.get('myPhrases', []); }
function phraseKey(de) { return String(de || '').trim().toLowerCase(); }
function hasMyPhrase(de) { return getMyPhrases().some(p => phraseKey(p.de) === phraseKey(de)); }
function addMyPhrase(p) {
  const list = getMyPhrases();
  if (!p || !p.de || list.some(x => phraseKey(x.de) === phraseKey(p.de))) return;
  list.push({ de: String(p.de).trim(), tr: String(p.tr || '').trim(), date: Date.now() });
  store.set('myPhrases', list);
}
function removeMyPhrase(de) {
  store.set('myPhrases', getMyPhrases().filter(p => phraseKey(p.de) !== phraseKey(de)));
}

/* History: b2trainer:writingHistory = [{ date, kind, taskId, title, scores, words, checklist: { ok, n }, text }] (no images) */
function getWritingHistory() { return store.get('writingHistory', []); }
function addWritingHistory(entry) {
  const h = getWritingHistory();
  h.push(entry);
  store.set('writingHistory', h.slice(-100));
}
function lastWritingByTask() {
  const last = {};
  getWritingHistory().forEach(e => { last[e.taskId] = e; });
  return last;
}

function renderWritingResult(el, result, rawText, task, text) {
  if (!result) {
    el.innerHTML = `<div class="card"><h3>${esc(t('eval.raw'))}</h3><div class="sample small">${esc(rawText)}</div></div>`;
    return;
  }
  const K = WRITING_KINDS[task.kind];
  const scores = result.scores || {};
  const checklist = Array.isArray(result.checklist) ? result.checklist : [];
  const okN = checklist.filter(isCovered).length;
  const phrases = (Array.isArray(result.useful_phrases) ? result.useful_phrases : []).filter(p => p && p.de);
  const tips = Array.isArray(result.tips_tr) ? result.tips_tr : [];
  el.innerHTML = `
    ${checklist.length ? `
      <div class="card">
        <h3>${esc(t('write.checklist', { n: okN, total: checklist.length }))}</h3>
        <p class="small muted">${esc(t('write.checklistHelp'))}</p>
        <ul class="checklist">${checklist.map(c => `
          <li class="${isCovered(c) ? 'ok' : 'bad'}"><span class="mark">${isCovered(c) ? '✅' : '❌'}</span>
            <span><span lang="de">${esc(c.point)}</span>${c.comment_tr ? `<span class="sub">${esc(c.comment_tr)}</span>` : ''}</span></li>`).join('')}
        </ul>
      </div>` : ''}
    <div class="card">
      <h3>${esc(t('eval.scores'))}</h3>
      <div class="scores" lang="de">${WRITING_CRITERIA.map(([k, name]) => `
        <div class="score">${gradeBadge(scores[k])}<span class="small">${name}</span></div>`).join('')}</div>
      <p class="small muted">A = B2 gut · B = B2 · C = B1 · D = unter B1 · <strong>${esc(t('common.words', { n: countWords(text) }))}</strong> (${esc(t('write.target', { words: K.words }))})</p>
      ${result.summary_tr ? `<p>${esc(result.summary_tr)}</p>` : ''}
    </div>
    ${Array.isArray(result.corrections) && result.corrections.length ? `
      <div class="card"><h3>${esc(t('eval.corrections'))}</h3>${correctionsHtml(result.corrections)}</div>` : ''}
    ${phrases.length ? `
      <div class="card"><h3>${esc(t('write.phrases'))}</h3>
        <ul class="phrase-list">${phrases.map((p, i) => `
          <li><span class="t"><span lang="de">${esc(p.de)}</span>${p.tr ? `<span class="sub">${esc(p.tr)}</span>` : ''}</span>
            <button class="btn inline" data-add="${i}" ${hasMyPhrase(p.de) ? 'disabled' : ''}>${esc(hasMyPhrase(p.de) ? t('write.added') : t('write.addToCards'))}</button></li>`).join('')}
        </ul>
      </div>` : ''}
    ${result.improved_de ? `
      <div class="card">
        <details>
          <summary>Mustertext</summary>
          <div class="row" style="margin:8px 0">
            <button class="btn" data-speak>🔊 Vorlesen</button>
            <button class="btn" data-stop>${esc(t('common.stop'))}</button>
          </div>
          <div class="sample" lang="de">${esc(result.improved_de)}</div>
        </details>
      </div>` : ''}
    ${tips.length ? `<div class="card"><h3>${esc(t('eval.tips'))}</h3><ul>${tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}`;
  el.querySelectorAll('[data-add]').forEach(b => {
    b.onclick = () => {
      addMyPhrase(phrases[Number(b.dataset.add)]);
      b.disabled = true;
      b.textContent = t('write.added');
    };
  });
  const sp = el.querySelector('[data-speak]');
  if (sp) {
    sp.onclick = () => speakDe(result.improved_de);
    el.querySelector('[data-stop]').onclick = stopSpeech;
  }
}

// Latest Schreiben scores per task (progress screen).
function writingProgressHtml() {
  const last = lastWritingByTask();
  const rows = Object.keys(last).map(k => last[k]).sort((a, b) => b.date - a.date).map(e => `
    <div class="coach-row">
      <span class="t">${esc((WRITING_KINDS[e.kind] || {}).name || '')} · ${esc(e.title)}<span class="sub">${new Date(e.date).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        · ${esc(t('common.words', { n: e.words || 0 }))}${e.checklist && e.checklist.n ? ` · ✅ ${e.checklist.ok}/${e.checklist.n}` : ''}</span></span>
      <span class="mini-scores">${scoresInline(e.scores, WRITING_CRITERIA)}</span>
    </div>`).join('');
  if (!rows) return '';
  return `<div class="card"><h3>${esc(t('progress.writingScores'))}</h3>
    <p class="small muted">Aufgabe · Register · Kohärenz · Sprache</p>${rows}</div>`;
}

/* Writing support: task points to tick while writing on paper, offline cards, outline (API), my phrases. */
const FORUM_POINTS = ['opinion', 'arguments', 'example', 'otherSide', 'compromise', 'conclusion', 'register'];
// Boss instructions split into single points ("Siehe …: a, b, c" lists are split at commas).
function chefPoints(lines) {
  const out = [];
  lines.forEach(line => {
    const s = String(line).replace(/^\s*Chef(in)?\s*:\s*/i, '').replace(/^[„"“]\s*/, '').replace(/\s*[“"”]\s*$/, '').trim();
    const siehe = s.match(/^Siehe [^:]+:\s*(.*)$/);
    if (siehe) { siehe[1].split(/,\s*/).forEach(x => out.push(x.replace(/\.$/, '').trim())); return; }
    (s.match(/[^.!?]+[.!?]*/g) || []).forEach(x => out.push(x.trim()));
  });
  return out.filter(Boolean);
}
function writingPoints(task) {
  if (task.kind === 'forum') return FORUM_POINTS.map(k => t('forumPoint.' + k));
  return chefPoints(task.chef).concat([t('write.pointCustomer'), t('write.pointFormal')]);
}
// Refusal wording in the boss instructions ("kein Austauschgerät", "nicht verantwortlich", …).
const REFUSAL_RE = /\bkein(e|en|em|er|es)?\b|nicht verantwortlich|nicht (am|an|bei|in) |nicht unsere|bleiben bestehen|ablehnen/i;
function supportCardIds(task) {
  if (task.kind === 'forum') return ['schreiben-forum', 'schreiben-fehler', 'schreiben-konnektoren'];
  const ids = ['schreiben-beschwerde', 'schreiben-ablehnen', 'schreiben-fehler', 'schreiben-konnektoren'];
  return REFUSAL_RE.test(task.chef.join(' ')) ? ['schreiben-ablehnen'].concat(ids.filter(id => id !== 'schreiben-ablehnen')) : ids;
}
function outlineTaskInfo(task) {
  if (task.kind === 'bs') {
    return `Task: formal reply e-mail to a customer complaint (DTB B2, Lesen & Schreiben Teil 2).\nBoss instructions (all must appear):\n${task.chef.join('\n')}\nCustomer complaint (summary): ${task.kunde.join(' ')}\nWriting task: ${task.task}`;
  }
  return `Task: Forumsbeitrag (DTB B2), about 150 words: colleagues discuss a new company rule in the internal forum, she gives her opinion with reasons and examples.\nTopic: ${task.topic.title}`;
}

function renderWritingSupport(el, task, hasKey, my) {
  const cards = supportCardIds(task).map(id => DATA.cards.find(c => c.id === id)).filter(Boolean);
  const points = writingPoints(task);
  const phrases = getMyPhrases();
  el.innerHTML = `
    <div class="card">
      <h3>${esc(t('write.points'))}</h3>
      <p class="small muted">${esc(t('write.pointsHelp'))}</p>
      <ul class="ticklist">${points.map((pt, i) => `
        <li><label><input type="checkbox" data-tick="${i}"><span ${task.kind === 'bs' && i < points.length - 2 ? 'lang="de"' : ''}>${esc(pt)}</span></label></li>`).join('')}</ul>
      <p class="small muted" id="tickInfo"></p>
    </div>
    <details class="card support">
      <summary>${esc(t('write.support'))}</summary>
      <h3>${esc(t('home.cards'))}</h3>
      ${cards.map(c => `
        <details class="sub-card">
          <summary>${esc(c.title)}</summary>
          ${cardView(c).blocks.map(b => `${b.heading ? `<h4>${esc(b.heading)}</h4>` : ''}
            <ul>${(b.lines || []).map(l => `<li>${esc(l)}</li>`).join('')}</ul>`).join('')}
          ${c.sample ? `<h4>Mustertext</h4>
            <button class="btn inline" data-say-card="${esc(c.id)}">🔊 Vorlesen</button>
            <div class="sample small" lang="de">${esc(c.sample)}</div>` : ''}
        </details>`).join('')}
      <h3>${esc(t('write.outline'))}</h3>
      ${hasKey ? `<button class="btn" id="outlineBtn">${esc(t('write.outlineBtn'))}</button>` : ''}
      <p class="small muted">${esc(t('write.outlineHelp'))}</p>
      <p class="small error" id="outlineErr"></p>
      <div id="outline"></div>
      <h3>${esc(t('cards.myPhrases'))}</h3>
      ${phrases.length ? `<ul class="phrase-list">${phrases.map(p => `
        <li><span class="t"><span lang="de">${esc(p.de)}</span>${p.tr ? `<span class="sub">${esc(p.tr)}</span>` : ''}</span></li>`).join('')}</ul>`
        : `<p class="small muted">${esc(t('write.noPhrases'))}</p>`}
    </details>`;

  const ticks = Array.from(el.querySelectorAll('[data-tick]'));
  const tickInfo = el.querySelector('#tickInfo');
  const drawTicks = () => { tickInfo.textContent = t('write.ticked', { n: ticks.filter(x => x.checked).length, total: ticks.length }); };
  ticks.forEach(x => { x.onchange = drawTicks; });
  drawTicks();

  el.querySelectorAll('[data-say-card]').forEach(b => {
    b.onclick = () => { const c = cards.find(x => x.id === b.dataset.sayCard); if (c) speakDe(c.sample); };
  });

  const outlineEl = el.querySelector('#outline');
  const errEl = el.querySelector('#outlineErr');
  const outlinePrompt = async () => fillPrompt((await loadPrompts()).PROMPT_OUTLINE, { TASKINFO: outlineTaskInfo(task) });
  const btn = el.querySelector('#outlineBtn');
  if (!btn) {
    renderFallback(outlineEl, outlinePrompt, t('write.outlineNoKey'));
    return;
  }
  btn.onclick = () => withBusy(btn, async () => {
    errEl.textContent = '';
    outlineEl.innerHTML = '';
    let raw;
    try {
      raw = await callClaude(undefined, [{ role: 'user', content: await outlinePrompt() }], { maxTokens: 1200 });
    } catch (e) {
      if (my !== screenId) return;
      errEl.textContent = '❌ ' + (e instanceof CoachError ? e.message : t('api.unexpected'));
      renderFallback(outlineEl, outlinePrompt);
      return;
    }
    if (my !== screenId) return;
    const r = parseJsonReply(raw);
    const paras = r && Array.isArray(r.paragraphs) ? r.paragraphs : null;
    outlineEl.innerHTML = paras ? `<ol class="outline">${paras.map(p => `
      <li><div>${esc(p.goal_tr || '')}</div>
        <ul>${(Array.isArray(p.starters_de) ? p.starters_de : []).map(x => `<li lang="de">${esc(x)}</li>`).join('')}</ul></li>`).join('')}</ol>`
      : `<div class="sample small">${esc(raw)}</div>`;
  });
}

function renderSchreiben(args) {
  const a = args[0] || '';
  if (a === 'bs' || a === 'forum') {
    const task = writingTask(a, args[1], args[2]);
    if (!task) { location.hash = '#/schreiben'; return; }
    return renderWritingTask(task);
  }
  if (a === 'sim') return renderForumSim();
  return renderSchreibenList(a === 'tab' ? args[1] : store.get('schreibenTab', 'bs'));
}

function renderSchreibenList(tab) {
  if (!WRITING_KINDS[tab]) tab = 'bs';
  store.set('schreibenTab', tab);
  setHeader('Schreiben', true);
  const last = lastWritingByTask();
  const tabs = `<div class="tabs">${Object.keys(WRITING_KINDS).map(k =>
    `<button class="tab ${k === tab ? 'active' : ''}" data-tab="${k}">${WRITING_KINDS[k].name}</button>`).join('')}</div>`;
  const intro = getApiKey() ? '' : `<div class="card small">${t('write.noKeyIntro')}
    <a href="#/settings">${esc(t('coach.addKey'))}</a></div>`;
  let body;
  if (tab === 'bs') {
    body = `<p class="small muted">${esc(t('write.bsIntro', { n: writingMinutes('bs') }))}</p>
      <ul class="list">${beschwerdeCards().map(c => {
        const tk = writingTask('bs', c.id);
        return `<li><a href="${tk.href}">
          <span class="t">${esc(tk.title)}<span class="sub" lang="de">${esc(tk.kunde.join(' '))}</span></span>
          ${last[tk.id] ? `<span class="mini-scores">${scoresInline(last[tk.id].scores, WRITING_CRITERIA)}</span>` : ''}
        </a></li>`;
      }).join('') || `<p class="muted center">${esc(t('write.noBs'))}</p>`}</ul>`;
  } else {
    body = `<p class="small muted">${esc(t('write.forumIntro', { n: writingMinutes('forum') }))}</p>
      <a class="btn primary" href="#/schreiben/sim">🎲 ${esc(t('write.sim'))}</a>
      ${forumCards().map(c => `
        <h3>${esc(c.title.replace(/^Forum-Themen\s*·\s*/, ''))}</h3>
        <ul class="list">${forumLines(c).map((line, i) => {
          const tk = writingTask('forum', c.id, i);
          return `<li class="topic"><a href="${tk.href}"><span class="t" lang="de">${esc(tk.title)}</span>
            ${last[tk.id] ? `<span class="mini-scores">${scoresInline(last[tk.id].scores, WRITING_CRITERIA)}</span>` : ''}</a>
            <button class="hint-btn" data-hint aria-label="${esc(t('write.hint'))}" aria-expanded="false">💡</button>
            <div class="hint small" hidden>${topicHintHtml(tk.topic)}</div></li>`;
        }).join('')}</ul>`).join('')}`;
  }
  $app.innerHTML = intro + tabs + body;
  $app.querySelectorAll('[data-tab]').forEach(b => {
    b.onclick = () => { location.hash = '#/schreiben/tab/' + b.dataset.tab; };
  });
  $app.querySelectorAll('[data-hint]').forEach(b => {
    b.onclick = () => {
      const hint = b.nextElementSibling;
      hint.hidden = !hint.hidden;
      b.setAttribute('aria-expanded', String(!hint.hidden));
    };
  });
}

// Exam simulation: two random topics, pick one (as in the exam).
function renderForumSim() {
  setHeader(t('write.sim'), true);
  $back.setAttribute('href', '#/schreiben/tab/forum');
  onLeave(() => $back.setAttribute('href', '#/'));
  const all = [];
  forumCards().forEach(c => forumLines(c).forEach((l, i) => all.push(writingTask('forum', c.id, i))));
  const pick = shuffle(all.filter(Boolean)).slice(0, 2);
  $app.innerHTML = `
    <p class="small muted">${esc(t('write.simIntro', { n: writingMinutes('forum') }))}</p>
    ${pick.map((tk, k) => `
      <div class="card">
        <h3>Thema ${'AB'.charAt(k)}</h3>
        <p lang="de"><strong>${esc(tk.title)}</strong></p>
        <details><summary>💡 ${esc(t('write.hint'))}</summary><p class="small">${topicHintHtml(tk.topic)}</p></details>
        <a class="btn primary" href="${tk.href}">${esc(t('write.pickTopic'))}</a>
      </div>`).join('')}
    <button class="btn" id="againBtn">${esc(t('write.otherTopics'))}</button>`;
  document.getElementById('againBtn').onclick = renderForumSim;
}

/* Shrink a photo with a canvas (long side ≤ 1600 px, JPEG 0.8) → data URL. */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const w0 = img.naturalWidth, h0 = img.naturalHeight;
        const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(w0, h0));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w0 * scale));
        canvas.height = Math.max(1, Math.round(h0 * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
        canvas.width = canvas.height = 0; // release the bitmap early (iOS memory)
        resolve(data);
      } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

function writingTaskCardHtml(task) {
  if (task.kind === 'bs') {
    return `<div class="card">
      <p><strong lang="de">${esc(task.task)}</strong></p>
      <h3>Chef/Chefin schreibt</h3>
      ${task.chef.map(l => `<p lang="de" class="quote">${esc(l)}</p>`).join('')}
      <h3>Kunden-E-Mail (kurz)</h3>
      ${task.kunde.map(l => `<p lang="de">${esc(l)}</p>`).join('')}
    </div>`;
  }
  return `<div class="card">
    <h3>Forumsbeitrag</h3>
    <p lang="de"><strong>${esc(task.title)}</strong></p>
    <p lang="de" class="small">${esc(task.task)}</p>
    <details><summary>💡 ${esc(t('write.hint'))}</summary><p class="small">${topicHintHtml(task.topic)}</p></details>
  </div>`;
}

// Writing timer: note + vibration 5 min before the end, remaining time mirrored in the top bar.
function writingCues(noteEl, total) {
  let warned = false;
  const base = speakingCues(noteEl, 0);
  return {
    update(elapsed, remaining) {
      $topRight.textContent = '⏱ ' + fmtClock(Math.max(0, Math.round(remaining)));
      $topRight.classList.toggle('warn', remaining <= 60);
      if (!warned && total > 300 && remaining <= 300 && remaining > 0) {
        warned = true;
        vibrate(200);
        noteEl.textContent = t('write.last5');
        noteEl.className = 'timer-note milestone';
      }
    },
    finish() { base.finish(); },
    reset() { warned = false; base.reset(); $topRight.textContent = ''; $topRight.classList.remove('warn'); }
  };
}

function renderWritingTask(task) {
  const K = WRITING_KINDS[task.kind];
  const my = screenId;
  const hasKey = !!getApiKey();
  const seconds = writingMinutes(task.kind) * 60;
  const draftKey = 'writingDraft:' + task.id;
  let pages = []; // data URLs, memory only
  setHeader(K.name + ' · ' + task.title, true);
  $back.setAttribute('href', '#/schreiben/tab/' + task.kind);
  onLeave(() => {
    pages = [];
    $back.setAttribute('href', '#/');
    $topRight.classList.remove('warn');
    stopSpeech();
  });

  $app.innerHTML = `
    ${writingTaskCardHtml(task)}
    <div class="card">
      <h3>${esc(t('lesen.timer', { n: seconds / 60 }))}</h3>
      <div class="timer" id="timer">${fmtClock(seconds)}</div>
      <p class="timer-note" id="timerNote" aria-live="polite"></p>
      <div class="row">
        <button class="btn primary" id="tStart">${esc(t('timer.start'))}</button>
        <button class="btn" id="tReset">${esc(t('timer.reset'))}</button>
      </div>
    </div>
    <div id="support"></div>
    <div class="card">
      <h3>${esc(t('write.upload'))}</h3>
      ${hasKey ? `
        <label class="btn primary file-btn" id="camLabel">${esc(t('write.camera'))}
          <input type="file" class="file-input" id="camInput" accept="image/*" capture="environment" multiple></label>
        <label class="btn file-btn" id="galLabel">${esc(t('write.gallery'))}
          <input type="file" class="file-input" id="galInput" accept="image/*" multiple></label>
        <div class="thumbs" id="thumbs"></div>
        <p class="small muted" id="pageInfo"></p>
        <button class="btn primary" id="readBtn" hidden>${esc(t('write.read'))}</button>
        <p class="small error" id="upErr"></p>
        <button class="btn" id="typeBtn">${esc(t('write.type'))}</button>`
      : `<p class="small">${t('write.noKeyPhoto')}</p>`}
    </div>
    <div class="card" id="textCard" hidden>
      <h3>${esc(t('write.text'))}</h3>
      <p class="warn-note" id="trWarn" hidden>${esc(t('write.trWarn'))}</p>
      <p class="small error" id="trErr"></p>
      <textarea id="sText" rows="12" lang="de" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
        placeholder="Sehr geehrte… / Hallo zusammen, …"></textarea>
      <div id="unclear"></div>
      <p class="small muted" id="sCount"></p>
      <div id="evalArea"></div>
    </div>
    <div id="wResult"></div>`;

  setupSpeakingTimer(seconds, writingCues);
  renderWritingSupport(document.getElementById('support'), task, hasKey, my);

  /* Text box (transcription result or typed text) */
  const textCard = document.getElementById('textCard');
  const ta = document.getElementById('sText');
  const trWarn = document.getElementById('trWarn');
  const trErr = document.getElementById('trErr');
  const unclear = document.getElementById('unclear');
  const sCount = document.getElementById('sCount');
  function drawText() {
    const n = (ta.value.match(/\[\?\]/g) || []).length;
    unclear.innerHTML = n ? `
      <p class="small">${t('write.unclear', { n })}</p>
      <div class="sample unclear-preview" lang="de">${esc(ta.value).replace(/(\S*\s?)\[\?\]/g, '<mark>$1[?]</mark>')}</div>` : '';
    const w = countWords(ta.value);
    sCount.textContent = t('common.words', { n: w }) + ' · ' + t('write.target', { words: K.words });
  }
  function showText(text, fromPhoto) {
    textCard.hidden = false;
    if (text != null) { ta.value = text; store.set(draftKey, text); }
    trWarn.hidden = !fromPhoto;
    drawText();
  }
  ta.oninput = () => { store.set(draftKey, ta.value); drawText(); };
  const draft = store.get(draftKey, '');
  if (draft || !hasKey) showText(draft, false);

  if (hasKey) setupPhotoUpload();
  setupEvaluation();

  /* Step B: evaluation of the confirmed text */
  function setupEvaluation() {
    const area = document.getElementById('evalArea');
    area.innerHTML = `
      ${hasKey ? `<button class="btn primary" id="evalBtn">${esc(t('write.evaluate'))}</button>` : ''}
      <p class="small error" id="evalErr"></p>
      <div id="wFallback"></div>`;
    const errEl = document.getElementById('evalErr');
    const fallbackEl = document.getElementById('wFallback');
    const resultEl = document.getElementById('wResult');
    const cleanText = () => ta.value.replace(/[ \t]*\[\?\]/g, '').trim();
    const fallbackPrompt = async () => writingEvalPrompt(await loadPrompts(), task, cleanText());
    if (!hasKey) {
      renderFallback(fallbackEl, fallbackPrompt, t('write.evalNoKey'));
      return;
    }
    const evalBtn = document.getElementById('evalBtn');
    evalBtn.onclick = () => {
      const text = cleanText();
      if (!text) { errEl.textContent = t('write.textFirst'); return; }
      errEl.textContent = '';
      fallbackEl.innerHTML = '';
      withBusy(evalBtn, async () => {
        let raw;
        try {
          const P = await loadPrompts();
          raw = await callClaude(undefined, [{ role: 'user', content: writingEvalPrompt(P, task, text) }], { maxTokens: WRITING_EVAL_TOKENS });
        } catch (e) {
          if (my !== screenId) return;
          errEl.textContent = '❌ ' + (e instanceof CoachError ? e.message : t('api.unexpected'));
          renderFallback(fallbackEl, fallbackPrompt);
          return;
        }
        if (my !== screenId) return;
        const result = parseJsonReply(raw);
        renderWritingResult(resultEl, result, raw, task, text);
        if (result && result.scores) {
          const list = Array.isArray(result.checklist) ? result.checklist : [];
          addWritingHistory({
            date: Date.now(), kind: task.kind, taskId: task.id, title: task.title,
            scores: result.scores, words: countWords(text),
            checklist: { ok: list.filter(isCovered).length, n: list.length },
            text
          });
        }
        resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    };
  }

  function setupPhotoUpload() {
    const thumbs = document.getElementById('thumbs');
    const pageInfo = document.getElementById('pageInfo');
    const readBtn = document.getElementById('readBtn');
    const upErr = document.getElementById('upErr');
    const inputs = [document.getElementById('camInput'), document.getElementById('galInput')];
    let preparing = 0;

    function drawPages() {
      thumbs.innerHTML = pages.map((data, i) => `
        <div class="thumb"><img src="${data}" alt="${esc(t('write.page', { n: i + 1 }))}"><span>${i + 1}</span>
          <button data-del="${i}" aria-label="${esc(t('write.delPage', { n: i + 1 }))}">×</button></div>`).join('');
      thumbs.querySelectorAll('[data-del]').forEach(b => {
        b.onclick = () => { pages.splice(Number(b.dataset.del), 1); drawPages(); };
      });
      const full = pages.length >= MAX_PAGES;
      inputs.forEach(inp => { inp.disabled = full; inp.parentNode.classList.toggle('disabled', full); });
      readBtn.hidden = !pages.length;
      readBtn.textContent = t('write.readN', { n: pages.length });
      pageInfo.textContent = preparing ? t('write.preparing')
        : pages.length ? t('write.pagesInfo', { n: pages.length, max: MAX_PAGES })
          : t('write.photoHelp', { max: MAX_PAGES });
    }
    async function addFiles(input) {
      const files = Array.from(input.files || []);
      input.value = '';
      upErr.textContent = '';
      const room = MAX_PAGES - pages.length - preparing;
      if (files.length > room) upErr.textContent = t('write.tooMany', { max: MAX_PAGES, n: files.length - Math.max(0, room) });
      for (const f of files.slice(0, Math.max(0, room))) {
        preparing += 1;
        drawPages();
        try {
          const data = await shrinkImage(f);
          if (my !== screenId) return;
          pages.push(data);
        } catch (e) {
          if (my !== screenId) return;
          upErr.textContent = t('write.photoFailed');
        } finally { preparing -= 1; }
        drawPages();
      }
    }
    inputs.forEach(inp => { inp.onchange = () => addFiles(inp); });
    drawPages();

    readBtn.onclick = () => withBusy(readBtn, async () => {
      upErr.textContent = '';
      trErr.textContent = '';
      let text;
      try {
        const P = await loadPrompts();
        const content = pages.map(data => ({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: data.slice(data.indexOf(',') + 1) }
        }));
        content.push({ type: 'text', text: P.PROMPT_TRANSCRIBE });
        text = await callClaude(undefined, [{ role: 'user', content }], { maxTokens: TRANSCRIBE_TOKENS });
      } catch (e) {
        if (my !== screenId) return;
        upErr.textContent = '❌ ' + (e instanceof CoachError ? e.message : t('api.unexpected')) + ' — ' + t('write.readFailed');
        return;
      }
      if (my !== screenId) return;
      pages = []; // the photos leave memory once the text is back
      drawPages();
      showText(text.trim(), true);
      if (countWords(text) < MIN_TRANSCRIPT_WORDS) trErr.textContent = t('write.blurry');
      textCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    document.getElementById('typeBtn').onclick = () => {
      showText(null, false);
      ta.focus();
      textCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }
}

/* ---------- Boot ---------- */
let swReg = null;
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
      .then(reg => { swReg = reg; })
      .catch(() => { /* offline support unavailable */ });
  });
}

/* ---------- Update notice ----------
   version.json is never cached (SW skips it, fetch uses no-store). If the server
   version differs from APP_VERSION, show a banner; tapping it activates the new SW. */
async function checkForUpdate() {
  let server;
  try {
    const res = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    server = String((await res.json()).version || '');
  } catch (e) { return; /* offline */ }
  if (server && server !== APP_VERSION) showUpdateBanner(server);
}

function showUpdateBanner(version) {
  if (document.getElementById('updateBanner')) return;
  const bar = document.createElement('div');
  bar.id = 'updateBanner';
  bar.className = 'update-banner';
  bar.innerHTML = `<span>${esc(t('update.available'))}</span><button class="btn primary inline" id="updateBtn">${esc(t('update.reload'))}</button>`;
  document.body.appendChild(bar);
  document.body.classList.add('has-banner');
  document.getElementById('updateBtn').onclick = e => {
    e.target.disabled = true;
    e.target.textContent = t('common.loading');
    applyUpdate(version);
  };
}

function waitFor(promiseFn, ms) {
  return Promise.race([promiseFn(), new Promise(r => setTimeout(r, ms))]);
}

async function applyUpdate(version) {
  try {
    const reg = swReg || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
    if (reg) {
      await waitFor(() => reg.update(), 8000).catch(() => {});
      // Wait for a freshly found worker to finish installing.
      const sw = reg.installing;
      if (sw) {
        await waitFor(() => new Promise(r => sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' || sw.state === 'redundant') r();
        })), 15000);
      }
      if (reg.waiting) {
        const changed = new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        await waitFor(() => changed, 5000);
      }
    }
    if (window.caches) {
      const keep = 'b2trainer-v' + version;
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith('b2trainer-') && k !== keep).map(k => caches.delete(k)));
    }
  } catch (e) { /* reload anyway */ }
  location.reload();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForUpdate();
});

/* ---------- Language ----------
   First launch (no b2trainer:lang yet): full-screen picker, the navigator.language default is highlighted. */
function langButtonsHtml(current) {
  return LANGS.map(l => `
    <button class="btn lang-btn ${l.id === current ? 'primary' : ''}" data-lang="${l.id}" lang="${l.id}">
      <span class="flag">${l.flag}</span> ${esc(l.name)}</button>`).join('');
}
async function setLang(lang) {
  store.set('lang', lang);
  await loadStrings(lang);
  if (DATA) buildSectionNames();
  applyStaticStrings();
}
function applyStaticStrings() {
  $back.setAttribute('aria-label', t('common.home'));
}
function showLangPicker() {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.className = 'lang-screen';
    box.innerHTML = `
      <div class="lang-inner">
        <h1>B2 Prüfungstrainer</h1>
        <p class="muted">Dil seç · Choose your language · Оберіть мову</p>
        ${langButtonsHtml(defaultLang())}
      </div>`;
    document.body.appendChild(box);
    box.querySelectorAll('[data-lang]').forEach(b => {
      b.onclick = async () => {
        await setLang(b.dataset.lang);
        box.remove();
        resolve();
      };
    });
  });
}

async function boot() {
  const saved = store.get('lang', '');
  await loadStrings(isLang(saved) ? saved : defaultLang());
  applyStaticStrings();
  $app.innerHTML = `<p class="muted center">${esc(t('common.loading'))}</p>`;
  try {
    await loadData();
  } catch (e) {
    $app.innerHTML = `<div class="card"><p>${esc(t('boot.loadFailed'))}</p>
      <p class="muted small">${esc(e.message)}</p>
      <button class="btn primary" onclick="location.reload()">${esc(t('boot.retry'))}</button></div>`;
    return;
  }
  if (!isLang(saved)) await showLangPicker();
  window.addEventListener('hashchange', router);
  router();
  checkForUpdate();
}
boot();
