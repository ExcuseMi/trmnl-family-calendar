'use strict';

// Regression tests for tools/config-editor.html: the page is loaded into jsdom together with
// plugin/src/transform.js, then driven like a person would (type, click, read #jsonOut).
// Run with: npm test (from this directory). Installs jsdom on first run; no browser needed.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const REPO_ROOT = path.join(__dirname, '../..');
const EDITOR_HTML = fs.readFileSync(path.join(REPO_ROOT, 'tools/config-editor.html'), 'utf-8');
const TRANSFORM_SRC = fs.readFileSync(path.join(REPO_ROOT, 'plugin/src/transform.js'), 'utf-8');

const INLINE_RE = /<script>([\s\S]*?)<\/script>\s*<\/body>/;
const inline = EDITOR_HTML.match(INLINE_RE);
if (!inline) throw new Error("config-editor.html: inline <script> before </body> not found");
const INLINE_SCRIPT = inline[1];
const SKELETON = EDITOR_HTML.replace(/<script src="\.\.\/plugin\/src\/transform\.js"><\/script>\s*/, '').replace(INLINE_RE, '</body>');

function loadEditor() {
  const dom = new JSDOM(SKELETON, { url: 'http://localhost/tools/config-editor.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.fetch = () => Promise.reject(new Error('network disabled in tests'));
  window.eval(TRANSFORM_SRC);
  window.eval(INLINE_SCRIPT);
  return { window, document: window.document };
}
const h = {
  loadEditor,
  fireInput(el, value) { if (value !== undefined) el.value = value; el.dispatchEvent(new el.ownerDocument.defaultView.Event('input', { bubbles: true })); },
  fireChange(el, value) { if (value !== undefined) el.value = value; el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true })); },
  click(el) { el.dispatchEvent(new el.ownerDocument.defaultView.Event('click', { bubbles: true })); },
  buttonByText(container, text) {
    const b = Array.from(container.querySelectorAll('button')).find((e) => e.textContent.trim() === text);
    if (!b) throw new Error('no button "' + text + '"');
    return b;
  },
  jsonOut(document) { return JSON.parse(document.getElementById('jsonOut').value); },
  selectMulti(sel, values) {
    Array.from(sel.options).forEach((o) => { o.selected = values.indexOf(o.value) !== -1; });
    sel.dispatchEvent(new sel.ownerDocument.defaultView.Event('change', { bubbles: true }));
  },
  assert,
  assertEqual(a, b) { assert.deepStrictEqual(a, b); },
};

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
const casesDir = path.join(__dirname, 'cases');
fs.readdirSync(casesDir).filter((f) => f.endsWith('.js')).sort().forEach((f) => require(path.join(casesDir, f))(test, h));

let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log('✓ ' + t.name); }
  catch (e) { failed++; console.log('✗ ' + t.name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e)); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
