#!/usr/bin/env node
/**
 * TITLE CASE SCANNER FOR CLUB COMMANDER UI TEXT (2026-11-28)
 *
 * Dan's house style: every word of a UI label is capitalised ("Back To
 * Dashboard", "Connection Error. Please Try Again."), acronyms stay as they
 * are (RSVP, QR, PIN, W-2G), and every part of a hyphenated word is
 * capitalised ("Check-In"). This scanner finds user-facing text that breaks
 * it, and with --fix rewrites it in place.
 *
 * It parses each file with espree (JSX on), so it knows WHERE a string sits:
 *
 *   UI       JSX text, UI attributes (aria-label, placeholder, title, alt,
 *            label, ...), UI object properties (label, title, message,
 *            error, ...), and arguments of the calls that show text
 *            (toast, alert, confirm, setError, ...).
 *   log      console / logger arguments, and errors thrown inside API routes.
 *   machine  anything compared (===, case, .includes), object keys, imports,
 *            console/logging, storage keys, query builder arguments, and
 *            attributes that carry data (value, className, href, key, ...).
 *   other    everything else (plain variables, array members, returns):
 *            also reported, because a label is often built that way.
 *
 * A string whose exact text is ALSO used in a machine position anywhere in
 * the scanned files is never rewritten: renaming one side of a comparison
 * is how a toast fix becomes a broken filter.
 *
 * Scope limit, on purpose: a text of more than MAX_WORDS words is prose
 * (help paragraphs in pages/commander/docs/*), not a label, and is left as
 * sentences. Headings, steps, list labels and callout titles in those pages
 * are short and are covered.
 *
 * pages/api/** is scanned only for the `error` / `message` values a route
 * returns, which the staff UI shows verbatim in toasts and banners. SMS and
 * email bodies, log lines and machine codes there are not UI.
 *
 * Usage:
 *   node scripts/title-case-scan.mjs [--fix] [--json] [paths...]
 * Default paths: pages src vendor/commander-shared/src
 * Exit 1 (without --fix) when a finding is not in the allowlist
 * scripts/ci/title-case-allowlist.json.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');
export const MAX_WORDS = 12;
export const DEFAULT_PATHS = ['pages', 'src', 'vendor/commander-shared/src'];
/**
 * Files that hold no UI text at all, so they are not scanned:
 *  - supabaseKeys.js: console warnings about deployment keys.
 *  - lib/probe/*: login-bridge probe step names, written to
 *    cron_execution_log and read by the hub watchdogs, never shown in the app.
 *  - agentExecution.mjs: agent tooling preview reasons (CI, not UI).
 *  - lib/commander/{twilio,notifications,pushNotifications}.js: SMS and push
 *    message bodies composed for a player's phone. They are messages, not
 *    app labels, and stay written as sentences.
 *  - desktopReleaseSource.js: GitHub release-lookup diagnostics; the
 *    Downloads page never shows them (it links the releases page instead).
 */
export const NOT_UI_FILES = [
  /^src\/lib\/supabaseKeys\.js$/,
  /^src\/lib\/probe\//,
  /^vendor\/commander-shared\/src\/lib\/agentExecution\.mjs$/,
  /^src\/lib\/commander\/desktopReleaseSource\.js$/,
  /^vendor\/commander-shared\/src\/lib\/commander\/(twilio|notifications|pushNotifications)\.js$/,
];
const EXTS = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);

/* ---------------------------------------------------------------- context */

const UI_ATTRS = new Set([
  'aria-label', 'aria-description', 'aria-placeholder', 'aria-valuetext', 'aria-roledescription',
  'placeholder', 'title', 'alt', 'label', 'subtitle', 'heading', 'message', 'description',
  'emptyText', 'emptyMessage', 'emptyTitle', 'confirmText', 'confirmLabel', 'cancelText',
  'cancelLabel', 'text', 'hint', 'helperText', 'helper', 'tooltip', 'buttonText', 'buttonLabel',
  'cta', 'ctaLabel', 'ctaText', 'caption', 'loadingText', 'errorText', 'summary', 'actionLabel',
  'primaryLabel', 'secondaryLabel', 'submitLabel', 'badge', 'status', 'statusLabel', 'unit',
  'sublabel', 'subLabel', 'header', 'headerTitle', 'sectionTitle', 'note', 'prefix', 'suffix',
]);
const UI_KEYS = new Set([
  ...UI_ATTRS, 'error', 'msg', 'name', 'desc', 'body', 'detail', 'details', 'tip', 'help',
  'question', 'answer', 'step', 'steps', 'warning', 'info', 'success', 'hintText', 'short',
  'long', 'display', 'displayName', 'heading', 'headline', 'tagline', 'empty', 'notice',
]);
const MACHINE_KEYS = new Set([
  'id', 'key', 'value', 'type', 'action', 'code', 'reason', 'notes', 'note_type', 'category',
  'method', 'mode', 'role', 'variant', 'color', 'icon', 'href', 'path', 'url', 'route', 'src',
  'event', 'channel', 'table', 'column', 'field', 'kind', 'slug', 'source', 'provider', 'tier',
  'plan', 'format', 'locale', 'timezone', 'timeZone', 'currency', 'sort', 'order', 'className',
  'style', 'fontFamily', 'font', 'background', 'border', 'transition', 'animation', 'gridTemplateColumns',
  'boxShadow', 'transform', 'filter', 'content', 'game_type', 'gameType', 'reason_code',
  'adjustment_type', 'transaction_type', 'entry_type', 'payment_method', 'game', 'game_name',
  'stakes', 'level', 'priority', 'severity', 'subject', 'to', 'from', 'sms', 'html', 'textBody',
]);
const MACHINE_ATTRS = new Set([
  'className', 'class', 'style', 'href', 'src', 'id', 'key', 'name', 'type', 'value',
  'defaultValue', 'htmlFor', 'role', 'rel', 'target', 'method', 'action', 'autoComplete',
  'inputMode', 'pattern', 'accept', 'd', 'viewBox', 'fill', 'stroke', 'xmlns', 'encType',
  'lang', 'dir', 'as', 'variant', 'size', 'color', 'icon', 'mode', 'format', 'locale',
  'timeZone', 'form', 'media', 'sizes', 'srcSet', 'content', 'property', 'charSet', 'download',
  'tab', 'activeTab', 'section', 'storageKey', 'route', 'path', 'event', 'gameType', 'kind',
  'fontFamily', 'transform', 'points', 'gradientTransform', 'strokeLinecap', 'textAnchor',
]);
const UI_CALLS = new Set([
  'alert', 'confirm', 'prompt', 'toast', 'showToast', 'addToast', 'notify', 'setError',
  'setMessage', 'setStatus', 'setStatusMessage', 'setSuccess', 'setNotice', 'setInfo',
  'setWarning', 'setToast', 'setFeedback', 'setResult', 'setErr', 'setMsg', 'setFormError',
  'setErrorMessage', 'setSuccessMessage', 'setPinError', 'setLoginError', 'setScanError',
  'setSaveError', 'setLoadError', 'setFlash', 'setBanner', 'setHint', 'setLabel', 'setTitle',
  'success', 'error', 'warning', 'info', 'Error', 'showError', 'showSuccess', 'flash',
]);
const MACHINE_CALLS = new Set([
  'includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'match', 'matchAll', 'replace',
  'replaceAll', 'split', 'test', 'eq', 'neq', 'ilike', 'like', 'in', 'contains', 'is', 'not',
  'getItem', 'setItem', 'removeItem', 'addEventListener', 'removeEventListener', 'select',
  'order', 'from', 'rpc', 'channel', 'on', 'emit', 'dispatchEvent', 'require', 'get', 'has',
  'set', 'delete', 'append', 'createElement', 'querySelector', 'querySelectorAll', 'closest',
  'getElementById', 'setAttribute', 'getAttribute', 'fetch', 'commanderFetch', 'push',
  'replaceState', 'pushState', 'localeCompare', 'toLocaleString', 'toLocaleDateString',
  'toLocaleTimeString', 'DateTimeFormat', 'NumberFormat', 'RegExp', 'Date', 'insert', 'update',
  'upsert', 'filter', 'or', 'textSearch', 'track', 'logEvent', 'captureMessage', 'postMessage',
]);
// pages/api: only the values a route hands back for the UI to show.
const API_UI_KEYS = new Set(['error', 'message', 'msg', 'hint', 'userMessage', 'displayMessage']);
const LOGGERS = new Set(['console', 'logger', 'log', 'debug']);

function calleeName(callee) {
  if (!callee) return '';
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property) return callee.property.name;
  return '';
}
function calleeObject(callee) {
  let c = callee;
  while (c && c.type === 'MemberExpression') c = c.object;
  return c && c.type === 'Identifier' ? c.name : '';
}
function propName(key) {
  if (!key) return '';
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal') return String(key.value);
  return '';
}
function attrName(attr) {
  const n = attr.name;
  if (!n) return '';
  if (n.type === 'JSXIdentifier') return n.name;
  if (n.type === 'JSXNamespacedName') return `${n.namespace.name}:${n.name.name}`;
  return '';
}

/**
 * Walks up from a string node and decides: 'ui', 'machine' or 'other'.
 * `chain` is [node, parent, grandparent, ...].
 */
function classify(chain, isApi) {
  const node = chain[0];
  // anything handed to console.* / logger.*, however deeply nested, is a log line
  for (let i = 1; i < chain.length; i += 1) {
    const p = chain[i];
    if (p.type === 'CallExpression' && p.callee !== chain[i - 1] && p.callee.type === 'MemberExpression'
      && LOGGERS.has(calleeObject(p.callee))) return 'log';
  }
  for (let i = 1; i < chain.length; i += 1) {
    const p = chain[i];
    const child = chain[i - 1];
    switch (p.type) {
      case 'ImportDeclaration': case 'ExportNamedDeclaration': case 'ExportAllDeclaration':
      case 'ImportExpression':
        if (p.source === child) return 'machine';
        break;
      case 'BinaryExpression':
        if (['===', '!==', '==', '!=', 'in', 'instanceof'].includes(p.operator)) return 'machine';
        break;
      case 'SwitchCase':
        if (p.test === child) return 'machine';
        break;
      case 'Property':
        if (p.key === child && !p.computed) return 'machine';
        if (p.key === child && p.computed) return 'machine';
        if (p.value === child || (p.value && chain.includes(p.value))) {
          const k = propName(p.key);
          if (isApi) return API_UI_KEYS.has(k) ? 'ui' : 'machine';
          if (MACHINE_KEYS.has(k)) return 'machine';
          if (UI_KEYS.has(k)) return 'ui';
          if (/^(aria|data)-/.test(k)) return k.startsWith('aria') ? 'ui' : 'machine';
          if (/(label|title|text|message|error|placeholder|hint|caption|heading|subtitle|tooltip|desc|description|cta|empty|confirm|prompt|warning|success|info|name|help|tip|copy|blurb)$/i.test(k)) return 'ui';
          if (/(key|id|type|code|status|reason|notes?|value|color|class|style|url|path|route|event|action|mode|kind|slug|format|_at|At)$/i.test(k)) return 'machine';
          return isApi ? 'machine' : 'other';
        }
        break;
      case 'MemberExpression':
        if (p.property === child && p.computed) return 'machine';
        break;
      case 'JSXAttribute': {
        const n = attrName(p);
        const owner = chain[i + 1] && chain[i + 1].name && chain[i + 1].name.name;
        // search-engine metadata is not on screen: <SEOHead description>, <meta content>
        if ((owner === 'SEOHead' || owner === 'meta' || owner === 'Head') && n !== 'title') return 'machine';
        if (UI_ATTRS.has(n) || /^aria-/.test(n)) return 'ui';
        if (MACHINE_ATTRS.has(n) || /^(data-|on[A-Z])/.test(n)) {
          if (/^on[A-Z]/.test(n)) break; // inside a handler: keep walking
          return 'machine';
        }
        if (/(label|title|text|message|error|placeholder|hint|caption|heading|subtitle|tooltip|description|cta|empty|confirm|Label|Title|Text|Message)$/.test(n)) return 'ui';
        return 'other';
      }
      case 'JSXElement': case 'JSXFragment':
        if (child.type === 'JSXText' || child.type === 'JSXExpressionContainer') {
          // a <style> or <script> child is CSS / code
          const nm = p.openingElement && p.openingElement.name && p.openingElement.name.name;
          if (nm === 'style' || nm === 'script' || nm === 'code' || nm === 'pre') return 'machine';
          return 'ui';
        }
        break;
      case 'TaggedTemplateExpression':
        return 'machine'; // css``, sql``, gql``
      case 'NewExpression':
      case 'CallExpression': {
        if (p.callee === child) return 'machine';
        const name = calleeName(p.callee);
        const obj = calleeObject(p.callee);
        if (LOGGERS.has(obj) && p.callee.type === 'MemberExpression') return 'log';
        if (obj === 'toast' || obj === 'notify') return 'ui';
        if (p.type === 'NewExpression' && name === 'Error') return isApi ? 'log' : 'ui';
        if (UI_CALLS.has(name) && p.callee.type === 'Identifier') return 'ui';
        if (UI_CALLS.has(name) && /^set[A-Z]/.test(name)) return 'ui';
        if (name === 'push' && !/^(router|Router|history|window)$/.test(obj)) return 'other';
        if (MACHINE_CALLS.has(name)) return 'machine';
        if (/^use(State|Ref|Memo)$/.test(name)) return 'other';
        if (/^(t|i18n|translate)$/.test(name)) return 'machine';
        return isApi ? 'machine' : 'other';
      }
      case 'ArrayExpression':
        // a member of a list of compared values: ['Cash', 'Tournament'].includes(x)
        if (chain[i + 1] && chain[i + 1].type === 'MemberExpression' && chain[i + 1].object === p) return 'machine';
        break;
      default:
        break;
    }
  }
  return isApi ? 'machine' : 'other';
}

/* ----------------------------------------------------------------- casing */

const STARTS_SENTENCE = /^[^A-Za-z]*[A-Z][a-z]/;
// tokens that are not words: urls, emails, paths, code-ish, units glued to numbers
function isSkippableWord(w) {
  return /[@]|:\/\/|^www\.|^\/|^\.|\.(com|net|org|io|poker|js|png|jpg|webp|csv|pdf|json)\b|=|[{}<>;|_]|^#/i.test(w);
}
// A part of a word that starts lowercase and is meant to be capitalised.
function lowerParts(word) {
  if (isSkippableWord(word)) return [];
  const out = [];
  // split hyphen and slash compounds: "check-in", "and/or"
  const parts = word.split(/([-/\u2013\u2014])/);
  let offset = 0;
  for (const part of parts) {
    const m = part.match(/^([("'\u201c\u2018\[*]*)([a-z])/);
    if (m && !/[A-Z]/.test(part.slice(m[0].length))) {
      // iPhone, eSports, x2 style tokens keep their brand casing: only plain
      // lowercase words are flagged. Single letters ("a", "x") count.
      if (!/^[a-z]\d/.test(part.slice(m[1].length)) && !/^(e\.g|i\.e|am|pm|px|ms|v\d)\.?$/.test(part.slice(m[1].length).replace(/[.,:;!?)"'\]]+$/, '')) ) {
        out.push(offset + m[1].length);
      }
    }
    offset += part.length;
  }
  return out;
}

/**
 * Given pieces of one text (template quasis / JSX texts separated by
 * expressions), returns for each piece the indexes to upper-case.
 * `startsAfterExpr[i]` says whether piece i directly follows an expression.
 */
function planPieces(pieces, startsAfterExpr) {
  const plans = pieces.map(() => []);
  pieces.forEach((text, pi) => {
    const re = /\S+/g;
    let m;
    while ((m = re.exec(text))) {
      // a token glued to a preceding ${expr} is the rest of a word: "${n}th"
      if (m.index === 0 && startsAfterExpr[pi]) continue;
      for (const idx of lowerParts(m[0])) plans[pi].push(m.index + idx);
    }
  });
  return plans;
}

export function wordCount(text) {
  return (text.match(/\S+/g) || []).filter((w) => /[A-Za-z]/.test(w)).length;
}

function looksLikeCode(text) {
  return /=>|\(\)|;\s*$|^\s*(const|let|var|function|return|import)\b|[{}]|sans-serif|monospace|system-ui|rgba?\(|\bvar\(|\d+px\b|^\s*-?\d|\bSELECT\b|\bFROM\b|\bWHERE\b/.test(text)
    || /^[A-Z][a-zA-Z]+(\.[a-zA-Z]+)+$/.test(text.trim());
}

/** Upper-cases text at the planned indexes. */
function applyPlan(text, plan) {
  if (!plan.length) return text;
  const chars = [...text];
  // plan indexes are UTF-16 offsets; rebuild with slices
  let out = '';
  let last = 0;
  for (const i of [...plan].sort((a, b) => a - b)) {
    out += text.slice(last, i) + text[i].toUpperCase();
    last = i + 1;
  }
  void chars;
  return out + text.slice(last);
}

export function toHouseTitleCase(text) {
  return applyPlan(text, planPieces([text], [false])[0]);
}

/* ---------------------------------------------------------------- parsing */

function parse(code) {
  return espree.parse(code, {
    ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true,
    ecmaFeatures: { jsx: true },
  });
}

function walk(node, chain, visit) {
  if (!node || typeof node.type !== 'string') return;
  const here = [node, ...chain];
  visit(node, here);
  for (const k of Object.keys(node)) {
    if (k === 'parent' || k === 'range' || k === 'loc') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, here, visit));
    else if (v && typeof v.type === 'string') walk(v, here, visit);
  }
}

/** Regex fallback for files espree cannot parse (TypeScript). */
function regexUnits(code) {
  const units = [];
  const strRe = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  let m;
  while ((m = strRe.exec(code))) {
    const before = code.slice(Math.max(0, m.index - 60), m.index);
    let ctx = 'other';
    if (/(===|!==|==|!=|case)\s*$/.test(before) || /\b(import|from|require\()\s*$/.test(before) || /console\.\w+\([^)]*$/.test(before) || /(className|href|src|key|id|type|value)=\{?\s*$/.test(before)) ctx = 'machine';
    else if (/(aria-label|placeholder|title|alt|label)=\{?\s*$/.test(before) || /(setError|setMessage|alert|toast\.?\w*)\(\s*$/.test(before)) ctx = 'ui';
    units.push({ pieces: [m[2]], afterExpr: [false], ranges: [[m.index + 1, m.index + 1 + m[2].length]], ctx, line: code.slice(0, m.index).split('\n').length, raw: true });
  }
  const jsxRe = />([^<>{}\n]*[A-Za-z][^<>{}\n]*)</g;
  while ((m = jsxRe.exec(code))) {
    const t = m[1];
    if (/[=;()]|&&|\|\|/.test(t)) continue;
    units.push({ pieces: [t], afterExpr: [false], ranges: [[m.index + 1, m.index + 1 + t.length]], ctx: 'ui', line: code.slice(0, m.index).split('\n').length, raw: true });
  }
  return units;
}

/** Collects text units: each is one text made of pieces. */
function astUnits(code, isApi) {
  const ast = parse(code);
  const units = [];
  walk(ast, [], (node, chain) => {
    if (node.type === 'Literal' && typeof node.value === 'string') {
      const parent = chain[1];
      if (parent && parent.type === 'JSXAttribute') {
        // attribute string: raw text between quotes, no escapes in JSX
        units.push({ pieces: [node.value], afterExpr: [false], ranges: [[node.range[0] + 1, node.range[1] - 1]], ctx: classify(chain, isApi), line: node.loc.start.line, raw: code.slice(node.range[0] + 1, node.range[1] - 1) === node.value });
        return;
      }
      const inner = code.slice(node.range[0] + 1, node.range[1] - 1);
      units.push({ pieces: [inner], afterExpr: [false], ranges: [[node.range[0] + 1, node.range[1] - 1]], ctx: classify(chain, isApi), line: node.loc.start.line, raw: true, value: node.value });
    } else if (node.type === 'TemplateLiteral') {
      if (chain[1] && chain[1].type === 'TaggedTemplateExpression') return;
      const pieces = node.quasis.map((q) => code.slice(q.range[0], q.range[1]).replace(/^`|^\}|`$|\$\{$/g, ''));
      const ranges = node.quasis.map((q) => {
        let [s, e] = q.range;
        const src = code.slice(s, e);
        const lead = src.startsWith('`') || src.startsWith('}') ? 1 : 0;
        const trail = src.endsWith('${') ? 2 : (src.endsWith('`') ? 1 : 0);
        return [s + lead, e - trail];
      });
      units.push({ pieces, afterExpr: pieces.map((_, i) => i > 0), ranges, ctx: classify(chain, isApi), line: node.loc.start.line, raw: true, leadExpr: pieces.length > 1 && !pieces[0].trim() });
    } else if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
      // one unit per run of text + expression children
      let run = null;
      const flush = () => { if (run && run.pieces.length) units.push(run); run = null; };
      for (const c of node.children) {
        if (c.type === 'JSXText') {
          if (!run) run = { pieces: [], afterExpr: [], ranges: [], ctx: classify([c, ...chain], isApi), line: c.loc.start.line, raw: true, prevExpr: false };
          run.pieces.push(c.value);
          run.afterExpr.push(run.prevExpr);
          run.ranges.push([c.range[0], c.range[1]]);
          run.prevExpr = false;
        } else if (c.type === 'JSXExpressionContainer' && c.expression.type !== 'JSXEmptyExpression') {
          if (run) run.prevExpr = true;
          else run = { pieces: [], afterExpr: [], ranges: [], ctx: classify([c, ...chain], isApi), line: c.loc.start.line, raw: true, prevExpr: true, leadExpr: true };
        } else {
          flush();
        }
      }
      flush();
    }
  });
  return units;
}

/**
 * Scans one file. Returns findings:
 *   { file, line, ctx, text, fixed, edits: [[start, end, replacement]] }
 */
export function scanFile(abs, rel) {
  const code = readFileSync(abs, 'utf8');
  const isApi = /^pages\/api\//.test(rel);
  let units;
  try { units = astUnits(code, isApi); } catch { units = regexUnits(code); }
  const findings = [];
  const machineTexts = new Set();
  for (const u of units) {
    const text = u.pieces.join(' {} ').replace(/\s+/g, ' ').trim();
    if (u.ctx === 'machine') { machineTexts.add(u.pieces.join('${}')); continue; }
    // log lines are not UI, and repeating a toast's words in a log line does
    // not make the toast a machine value
    if (u.ctx === 'log') continue;
    if (!u.raw) continue;
    if (isApi && u.ctx !== 'ui') continue;
    // A text that opens with a value ("{n} players", `${m}m ago`) is a label
    // too, but only in a certain UI position: elsewhere a template that opens
    // with ${...} is as likely a class list or a path.
    const opensWithValue = u.ctx === 'ui' && Boolean(u.leadExpr);
    if (!STARTS_SENTENCE.test(text) && !(opensWithValue && /^[^A-Za-z]*[a-z]/.test(text.replace(/^[^A-Za-z]*/, (m) => m) ))) continue;
    const wc = wordCount(text);
    if (wc < (opensWithValue ? 1 : 2) || wc > MAX_WORDS) continue;
    if (looksLikeCode(u.pieces.join(' '))) continue;
    // escape sequences inside a JS string literal are left untouched
    const plans = planPieces(u.pieces, u.afterExpr);
    if (!plans.some((p) => p.length)) continue;
    const edits = [];
    u.pieces.forEach((piece, i) => {
      if (!plans[i].length) return;
      edits.push([u.ranges[i][0], u.ranges[i][1], applyPlan(piece, plans[i])]);
    });
    const fixedText = u.pieces.map((p, i) => (plans[i].length ? applyPlan(p, plans[i]) : p)).join(' {} ').replace(/\s+/g, ' ').trim();
    findings.push({ file: rel, line: u.line, ctx: u.ctx, text, fixed: fixedText, key: u.pieces.join('${}'), edits });
  }
  return { code, findings, machineTexts };
}

function* files(dir) {
  if (!existsSync(dir)) return;
  const st = statSync(dir);
  if (st.isFile()) { if (EXTS.has(extname(dir))) yield dir; return; }
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    yield* files(join(dir, name));
  }
}

export function loadAllowlist() {
  const p = join(ROOT, 'scripts', 'ci', 'title-case-allowlist.json');
  if (!existsSync(p)) return { entries: [] };
  return JSON.parse(readFileSync(p, 'utf8'));
}

function allowed(allow, f) {
  return allow.entries.some((e) => (e.file === f.file || e.file === '*') && e.text === f.text);
}

/**
 * Scans the given paths. Machine texts are collected across ALL scanned
 * files first, so a label that doubles as a compared value is reported as
 * `shared` and never auto-fixed.
 */
export function scan(paths = DEFAULT_PATHS) {
  const results = [];
  const machine = new Set();
  for (const p of paths) {
    for (const abs of files(join(ROOT, p))) {
      const rel = relative(ROOT, abs).split('\\').join('/');
      if (NOT_UI_FILES.some((re) => re.test(rel))) continue;
      const r = scanFile(abs, rel);
      r.machineTexts.forEach((t) => machine.add(t));
      results.push({ abs, rel, ...r });
    }
  }
  const allow = loadAllowlist();
  const findings = [];
  for (const r of results) {
    for (const f of r.findings) {
      f.shared = machine.has(f.key);
      f.allowed = allowed(allow, f);
      findings.push(f);
    }
  }
  return { results, findings };
}

export function fix(results) {
  let changed = 0;
  for (const r of results) {
    const edits = r.findings.filter((f) => !f.shared && !f.allowed).flatMap((f) => f.edits);
    if (!edits.length) continue;
    edits.sort((a, b) => b[0] - a[0]);
    let code = r.code;
    for (const [s, e, rep] of edits) code = code.slice(0, s) + rep + code.slice(e);
    writeFileSync(r.abs, code);
    changed += 1;
  }
  return changed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const doFix = args.includes('--fix');
  const asJson = args.includes('--json');
  const paths = args.filter((a) => !a.startsWith('--'));
  const { results, findings } = scan(paths.length ? paths : DEFAULT_PATHS);
  const open = findings.filter((f) => !f.allowed);
  if (asJson) {
    console.log(JSON.stringify(open.map(({ edits, ...f }) => f), null, 1));
  } else {
    for (const f of open) console.log(`${f.file}:${f.line} [${f.ctx}${f.shared ? ',shared' : ''}] ${JSON.stringify(f.text)} -> ${JSON.stringify(f.fixed)}`);
    console.log(`\n${open.length} sentence-case UI text(s) (${findings.length - open.length} allowlisted)`);
  }
  if (doFix) {
    const n = fix(results);
    console.log(`rewrote ${n} file(s)`);
  } else if (open.length) {
    process.exit(1);
  }
}
