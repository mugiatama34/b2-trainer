'use strict';

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
}

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
  const p = getProgress();
  const solved = Object.keys(p).length;
  $app.innerHTML = `
    <div class="card hero">
      <div class="big">${solved} / ${DATA.questions.length}</div>
      <div class="muted">soru en az bir kez çözüldü</div>
    </div>
    <a class="btn primary" href="#/practice">Pratik</a>
    <a class="btn" href="#/cards">Kartlar</a>
    <p class="muted small center">Sınav modu · Tekrar · İlerleme yakında</p>
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
  setHeader(opts.title, true);

  function show() {
    if (i >= queue.length) { opts.onDone(results); return; }
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
}
boot();
