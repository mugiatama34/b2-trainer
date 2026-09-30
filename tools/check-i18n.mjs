#!/usr/bin/env node
/* Validates the translations in b2-data.json (Görev 6, Adım 2).

   Usage:  node tools/check-i18n.mjs [original.json] [--partial] [--data file.json] [--patch file.json]
     original.json  backup taken before the translation work (default: `git show HEAD:b2-data.json`)
     --partial      only report missing translations as a count (use between batches)
     --data         file to check (default: b2-data.json)
     --patch        content patch (Görev 7; default: patch-v2.2.json, or its last version in git history). Objects whose id is in
                    replace.{cards,reading,questions} are compared with the patch, not with original.json.

   Checks:
   1. every translatable item has en + uk (explanation_*, instructions_*, name_*, cards[].i18n.{en,uk})
   2. German quotes ('…', „…“ / "…" without Turkish letters) and "→ x" answer markers are kept verbatim;
      no Turkish-only letters (ı ş ğ İ …) left outside those quotes
   3. ids, answers, options and every existing field are unchanged (file minus the new fields == original)
   4. the JSON parses */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['en', 'uk'];
const args = process.argv.slice(2);
const partial = args.includes('--partial');
const dataIdx = args.indexOf('--data');
const dataPath = dataIdx >= 0 ? args[dataIdx + 1] : path.join(ROOT, 'b2-data.json');
const patchIdx = args.indexOf('--patch');
const patchPath = patchIdx >= 0 ? args[patchIdx + 1] : path.join(ROOT, 'patch-v2.2.json');
const EXPECTED_VERSION = '2.3';
const origArg = args.find((a, i) => !a.startsWith('--')
  && !(dataIdx >= 0 && i === dataIdx + 1) && !(patchIdx >= 0 && i === patchIdx + 1));

const errors = [];
const missing = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

// 4. JSON valid
let data, orig;
try {
  data = JSON.parse(readFileSync(dataPath, 'utf8'));
} catch (e) {
  console.error('✗ b2-data.json is not valid JSON: ' + e.message);
  process.exit(1);
}
try {
  const raw = origArg ? readFileSync(origArg, 'utf8')
    : execSync('git show HEAD:b2-data.json', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  orig = JSON.parse(raw);
} catch (e) {
  console.error('✗ cannot read the original file: ' + e.message);
  process.exit(1);
}
// Görev 7: replaced objects are checked against the patch (ids, answers, options, fields), everything else against orig.
// The patch file is deleted from the repo after it is applied; then it is read from git history.
function patchFromGit() {
  const git = cmd => execSync(cmd, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
  try { return git('git show HEAD:patch-v2.2.json'); } catch (e) { /* not in HEAD */ }
  try { return git('git show "$(git rev-list -n 1 HEAD -- patch-v2.2.json)^:patch-v2.2.json"'); } catch (e) { return null; }
}
const patchRaw = patchIdx >= 0 || existsSync(patchPath) ? null : patchFromGit();
if (patchIdx >= 0 || existsSync(patchPath) || patchRaw) {
  let patch;
  try {
    patch = JSON.parse(patchRaw || readFileSync(patchPath, 'utf8'));
  } catch (e) {
    console.error('✗ cannot read the patch file: ' + e.message);
    process.exit(1);
  }
  ['cards', 'reading', 'questions'].forEach(k => {
    ((patch.replace || {})[k] || []).forEach(obj => {
      const i = (orig[k] || []).findIndex(x => x.id === obj.id);
      if (i < 0) { console.error(`✗ patch: ${k}[${obj.id}] not found in the original`); process.exit(1); }
      orig[k][i] = obj;
    });
  });
}

// Görev 7b: small field edits made in place (translations untouched). Applied to orig, so they are not reported as changes.
const EDITS_7B = [
  ['Bei einwandfreier Lieferung können Sie in Zukunft mit weiteren Aufträgen ___.',
    'Wenn die Ware auch künftig pünktlich und fehlerfrei ankommt, dürfen Sie mit weiteren Bestellungen ___.'],
  ['Sie lesen online in einer Wirtschaftszeitung und möchten Ihren Freunden passende Artikel schicken.',
    'Sie stöbern im Karriereteil einer Online-Zeitung und wollen Bekannten passende Beiträge weiterleiten.'],
  ['Ich spreche heute darüber, wie ich mir ein gutes Arbeitsumfeld vorstelle.',
    'Heute erzähle ich, was für mich einen guten Arbeitsplatz ausmacht.'],
  ['Dennoch möchten wir Ihnen entgegenkommen und bieten Ihnen … an.',
    'Trotzdem kommen wir Ihnen gern entgegen und bieten Ihnen … an.'],
  ['S-T-Ä-D-T-L-E-R', 'K-Ö-H-L-E-R'],
];
orig = JSON.parse(EDITS_7B.reduce((s, [a, b]) => s.split(JSON.stringify(a).slice(1, -1)).join(JSON.stringify(b).slice(1, -1)),
  JSON.stringify(orig)));

/* ---- 2. text rules ---- */
// Capitalized words that occur in the German exam content (names like "Aydın").
const NAMES = new Set();
(function collectNames() {
  const add = s => (String(s || '').match(/\p{Lu}[\p{L}]*/gu) || []).forEach(w => NAMES.add(w));
  orig.reading.forEach(r => {
    add(r.context_de);
    (r.texts || []).forEach(x => { add(x.title); add(x.body); });
    (r.questions || []).forEach(q => { add(q.prompt); (q.options || []).forEach(add); });
  });
  orig.questions.forEach(q => { add(q.prompt); q.options.forEach(add); });
})();
const TR_ONLY = /[ıİşŞğĞçÇâÂîÎûÛ]/;
// Quoted spans: '…' (not a Turkish suffix apostrophe like Verbandbuch'a), „…“, "…".
function quotes(s) {
  const out = [];
  const re = /(?<![\p{L}\d])'([^'\n]+?)'(?![\p{L}\d])|„([^“\n]+?)“|"([^"\n]+?)"/gu;
  let m;
  while ((m = re.exec(s))) out.push(m[1] || m[2] || m[3]);
  return out;
}
// A quote is Turkish (translated) when it has Turkish-only letters or a common Turkish word; otherwise German (kept).
const TR_WORDS = new Set(['bir', 've', 'veya', 'yeni', 'kural', 'getiriyor', 'gibi', 'beri', 'ile', 'için', 'ama', 'çok',
  'değil', 'var', 'yok', 'ne', 'mi', 'mı', 'mu', 'bu', 'şu', 'o', 'sonra', 'önce', 'kadar', 'göre', 'olarak', 'olan']);
function isGerman(q) {
  if (TR_ONLY.test(q)) return false;
  return !(String(q).toLowerCase().match(/\p{L}+/gu) || []).some(w => TR_WORDS.has(w));
}
const germanQuotes = s => quotes(s).filter(isGerman);
// "→ a", "→ x.", "→ richtig" …
function arrows(s) {
  return (String(s).match(/→\s*(?:richtig|falsch|[a-hx])(?![\p{L}\d'])/gu) || []).map(a => a.replace(/\s+/g, ' '));
}
function countMap(list) {
  const m = new Map();
  list.forEach(x => m.set(x, (m.get(x) || 0) + 1));
  return m;
}
function checkText(where, tr, tl) {
  if (typeof tl !== 'string' || !tl.trim()) { err(where, 'empty translation'); return; }
  germanQuotes(tr).forEach(q => {
    if (!tl.includes(q)) err(where, `German quote not kept: '${q}'`);
  });
  const a = countMap(arrows(tr));
  const b = countMap(arrows(tl));
  a.forEach((n, k) => { if ((b.get(k) || 0) < n) err(where, `answer marker "${k}" missing`); });
  // Turkish-only letters are allowed only inside spans that also exist in the Turkish original.
  let rest = tl;
  quotes(tr).forEach(q => { rest = rest.split(q).join(''); });
  // Proper names from the German content (e.g. "Herr Aydın") may keep their letters.
  (tr.match(/\p{Lu}[\p{L}]*/gu) || []).filter(w => TR_ONLY.test(w) && NAMES.has(w)).forEach(w => { rest = rest.split(w).join(''); });
  if (TR_ONLY.test(rest) && TR_ONLY.test(tr)) {
    const w = (rest.match(/\S*[ıİşŞğĞçÇâÂîÎûÛ]\S*/) || [''])[0];
    err(where, `Turkish text left: "${w}"`);
  }
}

/* ---- 1. presence ---- */
function field(where, obj, base) {
  if (!obj[base + '_tr'] && !obj[base]) return;
  const src = obj[base + '_tr'] != null ? obj[base + '_tr'] : obj[base];
  LANGS.forEach(l => {
    const k = base + '_' + l;
    if (obj[k] == null) { missing.push(`${where}.${k}`); return; }
    checkText(`${where}.${k}`, src, obj[k]);
  });
}

data.questions.forEach(q => field(`questions[${q.id}]`, q, 'explanation'));
data.reading.forEach(r => {
  field(`reading[${r.id}]`, r, 'instructions');
  (r.questions || []).forEach(q => field(`reading[${r.id}].${q.id}`, q, 'explanation'));
});
data.sections.forEach(s => field(`sections[${s.id}]`, s, 'name'));
data.reading_parts.forEach(p => field(`reading_parts[${p.id}]`, p, 'name'));

data.cards.forEach(c => {
  const where = `cards[${c.id}]`;
  LANGS.forEach(l => {
    const v = c.i18n && c.i18n[l];
    if (!v) { missing.push(`${where}.i18n.${l}`); return; }
    if (c.prompt) checkText(`${where}.i18n.${l}.prompt`, c.prompt, v.prompt);
    const ob = c.blocks || [];
    if (!Array.isArray(v.blocks) || v.blocks.length !== ob.length) {
      err(`${where}.i18n.${l}.blocks`, `expected ${ob.length} blocks`);
      return;
    }
    ob.forEach((b, i) => {
      const tb = v.blocks[i] || {};
      if (b.heading) checkText(`${where}.i18n.${l}.blocks[${i}].heading`, b.heading, tb.heading);
      const lines = b.lines || [];
      if (!Array.isArray(tb.lines) || tb.lines.length !== lines.length) {
        err(`${where}.i18n.${l}.blocks[${i}]`, `expected ${lines.length} lines`);
        return;
      }
      lines.forEach((line, j) => checkText(`${where}.i18n.${l}.blocks[${i}].lines[${j}]`, line, tb.lines[j]));
    });
  });
});

/* ---- 3. nothing but new fields added ---- */
const NEW_KEY = /^(explanation|instructions|name)_(en|uk)$|^i18n$/;
function strip(v, depth) {
  if (Array.isArray(v)) return v.map(x => strip(x, depth + 1));
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach(k => { if (!NEW_KEY.test(k)) o[k] = strip(v[k], depth + 1); });
    return o;
  }
  return v;
}
function diff(a, b, where, out) {
  if (out.length > 20) return;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) { out.push(`${where}: array changed`); return; }
    a.forEach((x, i) => diff(x, b[i], `${where}[${i}]`, out));
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set(Object.keys(a).concat(Object.keys(b)));
    keys.forEach(k => {
      if (!(k in a)) out.push(`${where}.${k}: field removed`);
      else if (!(k in b)) out.push(`${where}.${k}: unexpected new field`);
      else diff(a[k], b[k], `${where}.${k}`, out);
    });
    return;
  }
  if (a !== b) out.push(`${where}: changed (${JSON.stringify(b).slice(0, 60)} → ${JSON.stringify(a).slice(0, 60)})`);
}
const stripped = strip(data, 0);
stripped.meta = Object.assign({}, stripped.meta, { version: orig.meta.version });
const changes = [];
// orig may already carry translations (Görev 7 starts from a translated file) — compare without them.
diff(stripped, strip(orig, 0), 'root', changes);
changes.forEach(c => err('original', c));

/* ---- report ---- */
const total = missing.length;
if (errors.length) {
  console.error(`✗ ${errors.length} error(s):`);
  errors.slice(0, 80).forEach(e => console.error('  ' + e));
  if (errors.length > 80) console.error(`  … ${errors.length - 80} more`);
}
if (total) {
  if (partial) console.log(`… ${total} translation(s) still missing (partial run)`);
  else {
    console.error(`✗ ${total} missing translation(s):`);
    missing.slice(0, 40).forEach(m => console.error('  ' + m));
    if (total > 40) console.error(`  … ${total - 40} more`);
  }
}
if (!partial && data.meta.version !== EXPECTED_VERSION) console.error(`✗ meta.version is ${data.meta.version}, expected ${EXPECTED_VERSION}`);
const failed = errors.length || (!partial && (total || data.meta.version !== EXPECTED_VERSION));
if (!failed) console.log('✓ i18n check passed' + (partial ? ' (partial)' : ''));
process.exit(failed ? 1 : 0);
