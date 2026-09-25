'use strict';

// Must match version.json and the cache name in sw.js (see CLAUDE.md).
const APP_VERSION = '1.3.0';

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

function getSettings() { return Object.assign({ examMinutes: 12 }, store.get('settings', {})); }
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
  SECTION_NAME = {};
  DATA.sections.forEach(s => { SECTION_NAME[s.id] = s.name; });
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
  'coach': renderCoach
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
      <div class="muted">soru tekrar bekliyor</div>
      <div class="muted small">${solved} / ${DATA.questions.length} soru çözüldü</div>
    </div>
    <a class="btn primary" href="#/practice">Pratik</a>
    <a class="btn" href="#/exam">Sınav modu</a>
    <a class="btn" href="#/review">Tekrar${due ? ` (${due})` : ''}</a>
    <a class="btn" href="#/cards">Kartlar</a>
    <a class="btn" href="#/coach">🎙 Sprechen-Coach</a>
    <a class="btn" href="#/progress">İlerleme</a>
    <a class="btn" href="#/settings">Ayarlar</a>
  `;
}

/* ---------- Practice setup ---------- */
function renderPracticeSetup() {
  setHeader('Pratik', true);
  const last = store.get('practiceFilter', { section: '', topic: '' });
  const sectionOpts = DATA.sections.map(s =>
    `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  $app.innerHTML = `
    <div class="card">
      <label class="field"><span>Bölüm</span>
        <select id="secSel"><option value="">Tüm bölümler</option>${sectionOpts}</select>
      </label>
      <label class="field"><span>Konu (opsiyonel)</span>
        <select id="topSel"></select>
      </label>
      <p class="muted small" id="countInfo"></p>
      <button class="btn primary" id="startBtn">10 soruluk turu başlat</button>
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
    topSel.innerHTML = '<option value="">Tüm konular</option>' +
      topics.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    topSel.value = topics.includes(keep) ? keep : '';
  }
  function update() {
    const n = pool().length;
    info.textContent = `${n} soru mevcut`;
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
    runQuiz({ title: 'Pratik', questions: qs, feedback: true, onDone: showPracticeResult });
  };
}

function showPracticeResult(results) {
  const ok = results.filter(r => r.correct).length;
  $topRight.textContent = '';
  $app.innerHTML = `
    <div class="card hero">
      <div class="big">${ok} / ${results.length}</div>
      <div class="muted">doğru</div>
    </div>
    <button class="btn primary" id="againBtn">Yeni tur</button>
    <a class="btn" href="#/">Ana sayfa</a>
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
              <div class="verdict ${correct ? 'ok' : 'bad'}">${correct ? '✓ Doğru' : '✗ Yanlış — doğrusu: ' + esc(rightText)}</div>
              <div>${esc(q.explanation_tr || '')}</div>
            </div>
            <button class="btn primary" id="nextBtn">Devam</button>`;
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
  setHeader('Tekrar', true);
  const due = dueQuestions();
  if (!due.length) {
    const srs = getSrs();
    const next = Object.keys(srs).map(id => srs[id].due).filter(d => d > Date.now()).sort((a, b) => a - b)[0];
    $app.innerHTML = `
      <div class="card hero">
        <div class="big">✓</div>
        <div>Şu an tekrar bekleyen soru yok.</div>
        ${next ? `<div class="muted small">Sıradaki tekrar: ${new Date(next).toLocaleString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>` : ''}
      </div>
      <a class="btn primary" href="#/practice">Pratik yap</a>
      <a class="btn" href="#/">Ana sayfa</a>`;
    return;
  }
  const srs = getSrs();
  const counts = [0, 0, 0, 0, 0];
  due.forEach(q => { counts[srs[q.id].box] += 1; });
  $app.innerHTML = `
    <div class="card hero">
      <div class="big">${due.length}</div>
      <div class="muted">soru tekrar bekliyor</div>
      <div class="muted small">Kutu 0–4: ${counts.join(' · ')}</div>
    </div>
    <button class="btn primary" id="startBtn">Tekrara başla (${Math.min(due.length, REVIEW_LIMIT)} soru)</button>
    <p class="muted small">Yanlış cevaplanan sorular tur sonunda bir kez daha sorulur. Doğru → sonraki kutu (1, 2, 4, 7 gün sonra).</p>
  `;
  document.getElementById('startBtn').onclick = () => {
    runQuiz({
      title: 'Tekrar',
      questions: due.slice(0, REVIEW_LIMIT),
      feedback: true,
      requeueWrong: true,
      onDone: results => {
        const ok = results.filter(r => r.correct).length;
        const left = dueQuestions().length;
        $app.innerHTML = `
          <div class="card hero">
            <div class="big">${ok} / ${results.length}</div>
            <div class="muted">doğru</div>
            <div class="muted small">${left} soru hâlâ tekrar bekliyor</div>
          </div>
          ${left ? '<button class="btn primary" id="moreBtn">Devam et</button>' : ''}
          <a class="btn" href="#/">Ana sayfa</a>`;
        const more = document.getElementById('moreBtn');
        if (more) more.onclick = renderReview;
      }
    });
  };
}

/* ---------- Exam mode ---------- */
const EXAM_SIZE = 20;

function renderExamSetup() {
  setHeader('Sınav modu', true);
  const settings = getSettings();
  $app.innerHTML = `
    <div class="card">
      <p>Tüm bölümlerden karışık <strong>${Math.min(EXAM_SIZE, DATA.questions.length)} soru</strong>. Sınav sırasında açıklama gösterilmez; sonuçlar sonda.</p>
      <label class="field"><span>Süre (dakika)</span>
        <input type="number" id="minutes" min="1" max="120" inputmode="numeric" value="${settings.examMinutes}">
      </label>
      <button class="btn primary" id="startBtn">Sınavı başlat</button>
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
    title: 'Sınav modu',
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
      ${timeUp ? '<div class="verdict bad">Süre doldu</div>' : ''}
      <div class="big">${ok} / ${questions.length}</div>
      <div class="muted">%${pct} doğru ${pct >= 60 ? '· geçme sınırı (%60) üstünde' : '· hedef: %60+'}</div>
    </div>
    ${wrong.length ? '<h3>Yanlışlar</h3>' : '<p class="center">Hepsi doğru! 🎉</p>'}
    ${wrong.map(q => {
      const r = byId[q.id];
      const right = q.options[q.answer];
      return `<div class="card explain bad">
        <div class="q-meta">${esc([SECTION_NAME[q.section], q.topic].filter(Boolean).join(' · '))}</div>
        <div lang="de" style="margin-bottom:6px">${renderPrompt(q.prompt, right)}</div>
        <div class="small">${r ? `Senin cevabın: <span class="verdict bad">${esc(r.chosen)}</span>` : '<span class="muted">Cevaplanmadı</span>'}
          · Doğrusu: <strong class="verdict ok">${esc(right)}</strong></div>
        <div class="small" style="margin-top:6px">${esc(q.explanation_tr || '')}</div>
      </div>`;
    }).join('')}
    <button class="btn primary" id="againBtn">Yeni sınav</button>
    <a class="btn" href="#/">Ana sayfa</a>`;
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
  setHeader('İlerleme', true);
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
      <div class="muted">soru çözüldü · ${attempts} deneme · %${attempts ? Math.round(correct / attempts * 100) : 0} doğru</div>
      <div class="muted small">Leitner kutuları 0–4: ${boxes.join(' · ')} · Öğrenilen kart: ${learned}/${DATA.cards.length}</div>
    </div>
    ${weakest.length ? `<div class="card"><h3>En zayıf 3 konu</h3>
      ${weakest.map(x => barRow(x.t, x.ok, x.n)).join('')}
      <button class="btn" id="weakBtn">En zayıf konuyu çalış</button></div>` : ''}
    <div class="card"><h3>Bölümler</h3>
      ${DATA.sections.map(s => barRow(s.name, (bySection[s.id] || {}).ok || 0, (bySection[s.id] || {}).n || 0)).join('')}
    </div>
    ${topics.length ? `<div class="card"><h3>Konular</h3>${topics.map(x => barRow(x.t, x.ok, x.n)).join('')}</div>` : ''}
    ${coachProgressHtml()}
    <button class="btn danger" id="resetBtn">İlerlemeyi sıfırla</button>
  `;
  const weakBtn = document.getElementById('weakBtn');
  if (weakBtn) weakBtn.onclick = () => {
    store.set('practiceFilter', { section: '', topic: weakest[0].t });
    location.hash = '#/practice';
  };
  document.getElementById('resetBtn').onclick = () => {
    if (!confirm('Tüm ilerleme, tekrar kutuları, "öğrendim" işaretleri ve Coach puanları silinsin mi? Bu işlem geri alınamaz.')) return;
    ['progress', 'srs', 'learned', 'practiceFilter', 'coachHistory'].forEach(k => store.remove(k));
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
      <span class="t">${esc(e.theme)}<span class="sub">${new Date(e.date).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></span>
      <span class="mini-scores">${scoresInline(e.scores)}</span>
    </div>`).join('');
  return `<div class="card"><h3>Sprechen-Coach · son puanlar</h3>
    <p class="small muted">Aufgabe · Kohärenz · Wortschatz · Strukturen</p>${rows}</div>`;
}

/* ---------- Cards ---------- */
const DECKS = [
  { id: 'pruefung', name: 'Prüfung' },
  { id: 'schreiben', name: 'Schreiben' },
  { id: 'sprechen', name: 'Sprechen' }
];

function renderCards(args) {
  setHeader('Kartlar', true);
  const known = DECKS.map(d => d.id);
  const extra = uniq(DATA.cards.map(c => c.deck)).filter(d => !known.includes(d))
    .map(d => ({ id: d, name: d }));
  const decks = DECKS.concat(extra);
  const deck = args[0] || store.get('lastDeck', 'pruefung');
  const learned = getLearned();
  const cards = DATA.cards.filter(c => c.deck === deck);
  $app.innerHTML = `
    <div class="tabs">${decks.map(d =>
      `<button class="tab ${d.id === deck ? 'active' : ''}" data-deck="${esc(d.id)}">${esc(d.name)}</button>`).join('')}</div>
    <ul class="list">${cards.map(c => `
      <li><a href="#/card/${encodeURIComponent(c.id)}">
        <span class="tick">${learned[c.id] ? '✓' : ''}</span>
        <span class="t">${esc(c.title)}<span class="sub">${esc(c.prompt || '')}</span></span>
      </a></li>`).join('') || '<p class="muted center">Bu destede kart yok.</p>'}</ul>
  `;
  store.set('lastDeck', deck);
  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => { location.hash = '#/cards/' + encodeURIComponent(t.dataset.deck); };
  });
}

function renderCardDetail(args) {
  const card = DATA.cards.find(c => c.id === args[0]);
  if (!card) { location.hash = '#/cards'; return; }
  setHeader(card.title, true);
  $back.setAttribute('href', '#/cards/' + encodeURIComponent(card.deck));
  onLeave(() => $back.setAttribute('href', '#/'));

  const isLearned = !!getLearned()[card.id];
  const blocks = (card.blocks || []).map(b => `
    <div class="card">
      ${b.heading ? `<h3>${esc(b.heading)}</h3>` : ''}
      <ul>${(b.lines || []).map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    </div>`).join('');
  const timer = card.deck === 'sprechen' ? `
    <div class="card">
      <h3>Konuşma zamanlayıcısı</h3>
      <div class="timer" id="timer">2:00</div>
      <div class="row">
        <button class="btn primary" id="tStart">Başlat</button>
        <button class="btn" id="tReset">Sıfırla</button>
      </div>
    </div>` : '';
  const sample = card.sample ? `
    <div class="card">
      <details id="sampleBox">
        <summary>Mustertext göster</summary>
        <div class="row" style="margin:8px 0">
          <button class="btn" id="speakBtn">🔊 Vorlesen</button>
          <button class="btn" id="stopBtn">■ Durdur</button>
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
    <div class="card"><strong lang="de">${esc(card.prompt || '')}</strong></div>
    ${coachHref ? `<a class="btn primary" href="${coachHref}">🎙 Coach ile çalış</a>` : ''}
    ${timer}
    ${blocks}
    ${sample}
    ${exq}
    <button class="btn ${isLearned ? '' : 'primary'}" id="learnBtn">
      ${isLearned ? '✓ Öğrendim (geri al)' : 'Öğrendim olarak işaretle'}</button>
  `;

  document.getElementById('learnBtn').onclick = () => {
    setLearned(card.id, !isLearned);
    renderCardDetail(args);
  };

  if (card.deck === 'sprechen') setupSpeakingTimer(120);
  if (card.sample) setupSpeech(card.sample);
}

function coachLinkFor(card) {
  if (/^sprechen-t1-/.test(card.id)) return '#/coach/mono/' + encodeURIComponent(card.id);
  if (/^sprechen-t2/.test(card.id)) return '#/coach/t2/' + encodeURIComponent(card.id);
  if (t3Situations().some(c => c.id === card.id)) return '#/coach/t3/' + encodeURIComponent(card.id);
  if (/^sprechen-t3/.test(card.id)) return '#/coach/t3';
  return '';
}

function setupSpeakingTimer(seconds) {
  const el = document.getElementById('timer');
  const startBtn = document.getElementById('tStart');
  const resetBtn = document.getElementById('tReset');
  let remaining = seconds;
  let handle = null;
  function draw() {
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    el.classList.toggle('done', remaining === 0);
  }
  function stop() {
    if (handle) clearInterval(handle);
    handle = null;
    startBtn.textContent = remaining === 0 ? 'Başlat' : (remaining < seconds ? 'Devam' : 'Başlat');
  }
  startBtn.onclick = () => {
    if (handle) { stop(); return; }
    if (remaining === 0) remaining = seconds;
    const endAt = Date.now() + remaining * 1000;
    startBtn.textContent = 'Durdur';
    handle = setInterval(() => {
      remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
      draw();
      if (remaining === 0) {
        stop();
        if (navigator.vibrate) navigator.vibrate(300);
      }
    }, 250);
    draw();
  };
  resetBtn.onclick = () => { stop(); remaining = seconds; draw(); startBtn.textContent = 'Başlat'; };
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
  if (status === 401) return 'Anahtar hatalı';
  if (status === 429 || status === 529) return 'Yoğunluk var, 10 sn sonra tekrar dene';
  if (status === 403) return 'Bu anahtarın yetkisi yok';
  if (status === 404) return 'Model bulunamadı — Ayarlar\'da model adını kontrol et';
  if (status >= 500) return 'Sunucu hatası, biraz sonra tekrar dene';
  return 'İstek hatası (' + status + ')' + (apiMsg ? ': ' + apiMsg : '');
}

/* Single entry point for the Claude API. Returns the joined text blocks.
   opts.maxTokens: 2000 for evaluations, 400 for chat. */
async function callClaude(system, messages, opts) {
  const key = getApiKey();
  if (!key) throw new CoachError('API anahtarı yok — Ayarlar\'dan ekle');
  const body = {
    model: getModel(),
    max_tokens: (opts && opts.maxTokens) || CHAT_TOKENS,
    system,
    messages,
    thinking: { type: 'disabled' } // short answers; retried without it for models that reject this
  };
  async function post() {
    if (navigator.onLine === false) throw new CoachError('İnternet yok');
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
      throw new CoachError('İnternet yok');
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
  if (data.stop_reason === 'refusal') throw new CoachError('Model bu isteği yanıtlamadı, metni değiştirip tekrar dene');
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (!text) throw new CoachError('Boş cevap geldi, tekrar dene');
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
  btn.innerHTML = '<span class="spinner"></span> Bekle…';
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
      <h3>Yedek mod</h3>
      ${reason ? `<p class="small">${esc(reason)}</p>` : ''}
      <button class="btn" data-copy>📋 Prompt'u kopyala</button>
      <p class="small muted" data-hint>Kopyaladıktan sonra Claude uygulamasını aç, yeni sohbete yapıştır ve gönder.</p>
    </div>`;
  const btn = el.querySelector('[data-copy]');
  btn.onclick = async () => {
    const ok = await copyText(await getPrompt());
    el.querySelector('[data-hint]').innerHTML = ok
      ? '✅ Kopyalandı. Şimdi <strong>Claude uygulamasına yapıştır</strong> ve gönder.'
      : 'Kopyalanamadı — metni elle seçip kopyala.';
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
    el.innerHTML = `<div class="card"><h3>Değerlendirme (ham metin)</h3>
      <div class="sample small">${esc(rawText)}</div></div>`;
    return;
  }
  const scores = result.scores || {};
  el.innerHTML = `
    <div class="card">
      <h3>Puanlar</h3>
      <div class="scores" lang="de">${CRITERIA.map(([k, name]) => `
        <div class="score">${gradeBadge(scores[k])}<span class="small">${name}</span></div>`).join('')}</div>
      <p class="small muted">A = B2 gut · B = B2 · C = B1 · D = unter B1</p>
      ${result.summary_tr ? `<p>${esc(result.summary_tr)}</p>` : ''}
    </div>
    ${Array.isArray(result.corrections) && result.corrections.length ? `
      <div class="card"><h3>Düzeltmeler</h3>${correctionsHtml(result.corrections)}</div>` : ''}
    ${result.improved_de ? `
      <div class="card">
        <h3>Verbesserte Version</h3>
        <div class="row" style="margin:8px 0">
          <button class="btn" data-speak>🔊 Vorlesen</button>
          <button class="btn" data-stop>■ Durdur</button>
        </div>
        <div class="sample" lang="de">${esc(result.improved_de)}</div>
      </div>` : ''}
    ${Array.isArray(result.tips_tr) && result.tips_tr.length ? `
      <div class="card"><h3>İpuçları</h3><ul>${result.tips_tr.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}`;
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
function scoresInline(scores) {
  return CRITERIA.map(([k]) => gradeBadge((scores || {})[k])).join('');
}

/* ---------- Settings ---------- */
function renderSettings() {
  setHeader('Ayarlar', true);
  const settings = getSettings();
  const hasKey = !!getApiKey();
  $app.innerHTML = `
    <div class="card">
      <h3>Sprechen-Coach (Claude API)</h3>
      <label class="field"><span>API anahtarı (sadece bu cihazda saklanır)</span>
        <input type="password" id="keyInput" autocomplete="off" autocapitalize="off" spellcheck="false"
          placeholder="${hasKey ? '•••••••• (kayıtlı)' : 'sk-ant-…'}">
      </label>
      <div class="row">
        <button class="btn primary" id="saveKey">Kaydet</button>
        <button class="btn danger" id="delKey" ${hasKey ? '' : 'disabled'}>Sil</button>
      </div>
      <label class="field"><span>Model</span>
        <input type="text" id="modelInput" autocomplete="off" autocapitalize="off" spellcheck="false"
          value="${esc(settings.model || DEFAULT_MODEL)}">
      </label>
      <button class="btn" id="testBtn">Bağlantıyı test et</button>
      <p id="testOut" class="small"></p>
      <p class="small muted">Anahtar yoksa Coach ekranları yedek modda çalışır: prompt kopyalanır, Claude uygulamasına yapıştırılır.</p>
    </div>`;
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
    if (!v) { out.textContent = 'Anahtar alanı boş.'; return; }
    store.set('apiKey', v);
    renderSettings();
    document.getElementById('testOut').textContent = 'Kaydedildi.';
  };
  document.getElementById('delKey').onclick = () => {
    if (!confirm('API anahtarı bu cihazdan silinsin mi?')) return;
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
      out.textContent = '✅ Bağlantı çalışıyor (' + getModel() + ')';
    } catch (e) {
      out.textContent = '❌ ' + (e instanceof CoachError ? e.message : 'Beklenmeyen hata');
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
    ${getApiKey() ? '' : `<div class="card small">API anahtarı yok → <strong>yedek mod</strong> (prompt kopyala → Claude uygulaması).
      <a href="#/settings">Ayarlar'dan anahtar ekle</a></div>`}
    <h3>Teil 1 · Monolog</h3>
    <ul class="list">${t1Cards().map(c => item('#/coach/mono/' + encodeURIComponent(c.id), c.title, c.prompt, last[c.id])).join('')}</ul>
    <h3>Teil 2 · Smalltalk (Partner)</h3>
    <ul class="list">${item('#/coach/t2/' + encodeURIComponent((t2Cards()[0] || {}).id || ''), 'Smalltalk mit Kollegen', '5 tur · du-Form · sesli', last['coach-t2'])}</ul>
    <h3>Teil 3 · Lösungswege (Partner)</h3>
    <a class="btn primary" href="#/coach/t3/new">✨ Neue Situation</a>
    <ul class="list">${t3Situations().map(c => item('#/coach/t3/' + encodeURIComponent(c.id), c.title, c.prompt, last[c.id])).join('')}</ul>
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

  $app.innerHTML = `
    <div class="card"><strong lang="de">${esc(card.prompt || '')}</strong>
      ${(card.blocks || []).length ? `<details><summary>Stichpunkte</summary>${card.blocks.map(b => `
        ${b.heading ? `<h3>${esc(b.heading)}</h3>` : ''}
        <ul>${(b.lines || []).map(l => `<li lang="de">${esc(l)}</li>`).join('')}</ul>`).join('')}</details>` : ''}
    </div>
    <div class="card">
      <h3>1 · Kayıt (2 dk)</h3>
      <div class="timer" id="recTimer">2:00</div>
      <div class="row">
        <button class="btn primary" id="recBtn">🎙 Kaydı başlat</button>
        <button class="btn" id="playBtn" disabled>▶ Dinle</button>
      </div>
      <p class="small muted" id="recInfo">Kayıt sadece bu oturumda, telefonda kalır; hiçbir yere gönderilmez.</p>
    </div>
    <div class="card">
      <h3>2 · Metin</h3>
      <p class="small muted">Klavyedeki 🎤 simgesine bas ve tekrar konuş.</p>
      <textarea id="mText" rows="8" lang="de" placeholder="Ich möchte über … sprechen."></textarea>
      <p class="small muted" id="wordCount"></p>
      ${hasKey ? '<button class="btn primary" id="evalBtn">Bewerten</button>' : ''}
      <p class="small error" id="evalErr"></p>
      <div id="fallback"></div>
    </div>
    <div id="result"></div>
    <div id="followups"></div>`;

  setupRecorder(120);

  const ta = document.getElementById('mText');
  const wc = document.getElementById('wordCount');
  function countWords() {
    const n = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0;
    wc.textContent = n + ' kelime' + (n ? ' (2 dk ≈ 200–250 kelime)' : '');
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
    renderFallback(fallbackEl, fallbackPrompt, 'API anahtarı yok. Metni yazdıktan sonra prompt\'u kopyalayıp Claude uygulamasına yapıştır.');
    return;
  }

  const evalBtn = document.getElementById('evalBtn');
  const errEl = document.getElementById('evalErr');
  evalBtn.onclick = () => {
    if (!ta.value.trim()) { errEl.textContent = 'Önce metni yaz (dikte).'; return; }
    errEl.textContent = '';
    fallbackEl.innerHTML = '';
    withBusy(evalBtn, async () => {
      let text;
      try {
        const P = await loadPrompts();
        text = await callClaude(P.PROMPT_MONOLOG, [{ role: 'user', content: userMessage() }], { maxTokens: EVAL_TOKENS });
      } catch (e) {
        if (my !== screenId) return;
        errEl.textContent = '❌ ' + (e instanceof CoachError ? e.message : 'Beklenmeyen hata');
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
      <textarea rows="4" lang="de" placeholder="Klavyedeki 🎤 ile cevapla…"></textarea>
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
      if (!ta.value.trim()) { err.textContent = 'Önce cevabını yaz (dikte).'; return; }
      err.textContent = '';
      withBusy(send, async () => {
        const msg = `Talk topic: ${card.prompt}\n\nExaminer question: ${q}\n\nCandidate answer (dictation):\n${ta.value.trim()}`;
        let text;
        try {
          const P = await loadPrompts();
          text = await callClaude(P.PROMPT_FOLLOWUP, [{ role: 'user', content: msg }], { maxTokens: EVAL_TOKENS });
        } catch (e) {
          if (my !== screenId) return;
          err.textContent = '❌ ' + (e instanceof CoachError ? e.message : 'Beklenmeyen hata');
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

/* 2-minute voice recording (MediaRecorder). The recording stays in memory only. */
function setupRecorder(seconds) {
  const recBtn = document.getElementById('recBtn');
  const playBtn = document.getElementById('playBtn');
  const timerEl = document.getElementById('recTimer');
  const info = document.getElementById('recInfo');
  let recorder = null, stream = null, chunks = [], handle = null, url = null, audio = null;

  function draw(left) {
    const s = Math.max(0, Math.ceil(left));
    timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
    info.textContent = 'Bu cihaz/tarayıcı ses kaydını desteklemiyor. Zamanlayıcı yerine doğrudan dikte kullan.';
    return;
  }
  recBtn.onclick = async () => {
    if (recorder && recorder.state === 'recording') { stop(); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      info.textContent = 'Mikrofon izni verilmedi.';
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
      audio.onended = () => { playBtn.textContent = '▶ Dinle'; };
      playBtn.disabled = false;
      playBtn.textContent = '▶ Dinle';
      recBtn.textContent = '🎙 Yeniden kaydet';
    };
    recorder.start(1000);
    const endAt = Date.now() + seconds * 1000;
    recBtn.textContent = '■ Durdur';
    playBtn.disabled = true;
    if (audio) audio.pause();
    handle = setInterval(() => {
      const left = (endAt - Date.now()) / 1000;
      draw(left);
      if (left <= 0) {
        stop();
        if (navigator.vibrate) navigator.vibrate(300);
      }
    }, 250);
    draw(seconds);
  };
  playBtn.onclick = () => {
    if (!audio) return;
    if (audio.paused) { audio.currentTime = audio.ended ? 0 : audio.currentTime; audio.play(); playBtn.textContent = '❚❚ Durdur'; }
    else { audio.pause(); playBtn.textContent = '▶ Dinle'; }
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
    <p class="muted small">Bir durum seç ya da Claude yeni bir iş yeri sorunu üretsin.</p>
    <a class="btn primary" href="#/coach/t3/new">✨ Neue Situation</a>
    <ul class="list">${t3Situations().map(c => `
      <li><a href="#/coach/t3/${encodeURIComponent(c.id)}"><span class="t">${esc(c.title)}<span class="sub" lang="de">${esc(c.prompt)}</span></span></a></li>`).join('')}</ul>`;
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
        <p class="small muted">Claude bir iş arkadaşı, sana "du" diye hitap eder. ${K.turns} tur. Cevap ver → gerekçe → örnek → karşı soru (Und du?).</p>`;
    } else {
      sitBox.innerHTML = `
        <strong>Situation</strong>
        <p lang="de" id="sitText">${situation ? esc(situation) : '<span class="muted">Henüz durum yok.</span>'}</p>
        <p class="small muted">Claude iş arkadaşın; birlikte çözüm bulun, görev paylaşın, uzun vadeli önlem konuşun. ${K.turns} tur.</p>
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
      if (el) el.textContent = '❌ ' + (e instanceof CoachError ? e.message : 'Beklenmeyen hata');
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
        <span class="small muted">${started ? `Tur ${Math.min(turns, K.maxTurns)} / ${K.turns}` : ''}</span>
        <button class="btn inline" id="muteBtn">${muted ? '🔇 Ses kapalı' : '🔊 Ses açık'}</button>
      </div>
      <div class="chat" id="chatLog">${history.slice(1).map(m => `
        <div class="msg ${m.role === 'user' ? 'me' : 'them'}" lang="de">${esc(m.content)}${m.role === 'assistant'
          ? '<button class="say" aria-label="Vorlesen">🔊</button>' : ''}</div>`).join('')}
        ${busy ? '<div class="msg them typing"><span class="spinner"></span></div>' : ''}
      </div>
      ${started ? `
        <p class="small muted">Klavyedeki 🎤 simgesine bas ve konuş, sonra gönder.</p>
        <textarea id="chatInput" rows="3" lang="de" placeholder="Deine Antwort…"></textarea>
        <button class="btn primary" id="sendBtn" ${busy ? 'disabled' : ''}>Gönder</button>
        ${turns >= K.maxTurns ? '<p class="small">Tur sayısı doldu — şimdi değerlendirebilirsin.</p>' : ''}
        <button class="btn" id="endBtn" ${busy || !turns ? 'disabled' : ''}>Beenden &amp; bewerten</button>`
      : `<button class="btn primary" id="startBtn" ${busy ? 'disabled' : ''}>Gespräch starten</button>`}
      <p class="small error" id="chatErr"></p>`;
    document.getElementById('muteBtn').onclick = () => {
      muted = !muted;
      store.set('coachMute', muted);
      if (muted) stopSpeech();
      document.getElementById('muteBtn').textContent = muted ? '🔇 Ses kapalı' : '🔊 Ses açık';
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
      document.getElementById('chatErr').textContent = '❌ ' + (e instanceof CoachError ? e.message : 'Beklenmeyen hata');
      renderFallback(fallbackEl, rolePlayPrompt, 'Konuşmayı Claude uygulamasında sürdürebilirsin.');
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
      errEl.textContent = '❌ ' + (e instanceof CoachError ? e.message : 'Beklenmeyen hata');
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
    renderFallback(fallbackEl, rolePlayPrompt,
      'API anahtarı yok. Rol oyunu prompt\'unu kopyala; Claude uygulamasında (sesli modda da olur) konuşmayı yap.');
  }

  drawSituation();
  drawChat();
  if (kind === 't3' && !situation && hasKey) {
    const nb = document.getElementById('newSitBtn');
    if (nb) withBusy(nb, newSituation);
  } else if (kind === 't3' && !situation) {
    sitBox.insertAdjacentHTML('beforeend', '<p class="small">Yeni durum üretmek için API anahtarı gerekir — listeden bir durum seç.</p>');
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
  bar.innerHTML = '<span>Yeni sürüm var 🎉</span><button class="btn primary inline" id="updateBtn">Yenile</button>';
  document.body.appendChild(bar);
  document.body.classList.add('has-banner');
  document.getElementById('updateBtn').onclick = e => {
    e.target.disabled = true;
    e.target.textContent = 'Yükleniyor…';
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

async function boot() {
  try {
    await loadData();
  } catch (e) {
    $app.innerHTML = `<div class="card"><p>İçerik yüklenemedi (b2-data.json).</p>
      <p class="muted small">${esc(e.message)}</p>
      <button class="btn primary" onclick="location.reload()">Tekrar dene</button></div>`;
    return;
  }
  window.addEventListener('hashchange', router);
  router();
  checkForUpdate();
}
boot();
