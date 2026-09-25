'use strict';

// Must match version.json and the cache name in sw.js (see CLAUDE.md).
const APP_VERSION = '1.1.0';

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
  'card': renderCardDetail
};

function router() {
  runCleanups();
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
    <a class="btn" href="#/progress">İlerleme</a>
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
    <button class="btn danger" id="resetBtn">İlerlemeyi sıfırla</button>
  `;
  const weakBtn = document.getElementById('weakBtn');
  if (weakBtn) weakBtn.onclick = () => {
    store.set('practiceFilter', { section: '', topic: weakest[0].t });
    location.hash = '#/practice';
  };
  document.getElementById('resetBtn').onclick = () => {
    if (!confirm('Tüm ilerleme, tekrar kutuları ve "öğrendim" işaretleri silinsin mi? Bu işlem geri alınamaz.')) return;
    ['progress', 'srs', 'learned', 'practiceFilter'].forEach(k => store.remove(k));
    renderProgress();
  };
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

  $app.innerHTML = `
    <div class="card"><strong lang="de">${esc(card.prompt || '')}</strong></div>
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
  const synth = window.speechSynthesis;
  function pickVoice() {
    const voices = synth.getVoices();
    return voices.find(v => v.lang === 'de-DE') || voices.find(v => /^de/i.test(v.lang)) || null;
  }
  speakBtn.onclick = () => {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/\[|\]/g, ''));
    u.lang = 'de-DE';
    u.rate = 0.9;
    const v = pickVoice();
    if (v) u.voice = v;
    synth.speak(u);
  };
  stopBtn.onclick = () => synth.cancel();
  onLeave(() => synth.cancel());
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
