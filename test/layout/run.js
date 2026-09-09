'use strict';

// Regression tests for the METRO MAP LAYOUT — the client-side geometry in
// plugin/src/shared.liquid (band/lane placement, station kinks and their
// captions, branches, interchange capsules, terminus fan, hour axis).
//
// transform.js has its own suite next door (../transform); that one covers
// the data normalizer and can't see a single pixel. Everything that has
// actually broken in this plugin's layout — a caption with a line drawn
// through it, an interchange capsule falling short of a track that had
// moved, two branches of one line crossing, labels landing on top of each
// other — is geometry, and none of it was catchable until this suite.
//
// How it works: `trmnlp build` renders the real template, we swap the baked
// demo METRO for a fixture, load it in headless Chromium with the real
// TRMNL framework CSS, wait for the layout to settle, and have the page
// report every drawn thing in one coordinate space (screen px, relative to
// the canvas). SVG paths are SAMPLED via getPointAtLength, so a curved or
// rounded path is checked as the shape it really draws rather than as its
// control points. Assertions then run out here in node.
//
// Run with: npm test  (from this directory). Needs `trmnlp` on PATH and the
// Playwright Chromium build; the framework CSS/JS are cached under .cache/.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const PLUGIN = path.join(ROOT, 'plugin');
const BUILT = path.join(PLUGIN, '_build/full.html');
const CACHE = path.join(__dirname, '.cache');

const CHROME = process.env.METRO_CHROME
  || '/home/dev/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';

const CSS_URL = 'https://trmnl.com/css/3.3.1/plugins.css';
const JS_URL = 'https://trmnl.com/js/3.3.1/plugins.js';

// ---------------------------------------------------------------- framework assets

// The framework stylesheet is ~18MB and decides every text metric, so the
// layout can only be measured honestly with the real thing. Cached locally
// (.cache is gitignored); fetched once if missing.
function frameworkAssets() {
  fs.mkdirSync(CACHE, { recursive: true });
  const css = path.join(CACHE, 'plugins.css');
  const js = path.join(CACHE, 'plugins.js');
  for (const [file, url] of [[css, CSS_URL], [js, JS_URL]]) {
    if (fs.existsSync(file) && fs.statSync(file).size > 1000) continue;
    try {
      execFileSync('curl', ['-fsSL', '-o', file, url], { stdio: 'pipe', timeout: 120000 });
    } catch (e) {
      throw new Error('could not fetch ' + url + ' into ' + CACHE + ' (needed for real text metrics): ' + e.message);
    }
  }
  return { css, js };
}

// ---------------------------------------------------------------- page building

let builtHtml = null;
function baseHtml() {
  if (builtHtml) return builtHtml;
  try {
    execFileSync('trmnlp', ['build'], { cwd: PLUGIN, stdio: 'pipe', timeout: 120000 });
  } catch (e) {
    throw new Error('`trmnlp build` failed (is trmnlp on PATH?): ' + (e.stderr || e.message));
  }
  builtHtml = fs.readFileSync(BUILT, 'utf-8');
  return builtHtml;
}

// Replace the baked `var METRO = {...};` literal with a fixture. The JSON is
// emitted on one line, so scanning balanced braces from the opening one is
// exact (and beats a regex that would trip over nested objects).
function swapMetro(html, metro) {
  const marker = 'var METRO = ';
  const at = html.indexOf(marker);
  if (at < 0) throw new Error('could not find the METRO literal in the built page');
  const open = html.indexOf('{', at);
  let depth = 0, i = open, inStr = false, esc = false;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(0, open) + JSON.stringify(metro) + html.slice(i);
}

// Emitted into the page: waits for the layout to settle (it re-runs on a
// debounce, on fonts.ready and on resize), then reports every drawn thing in
// ONE coordinate space — screen px relative to the canvas — so label boxes
// and SVG geometry can be compared directly without worrying about the
// framework's own zoom factor.
const REPORTER = `
<script>
(function () {
  var canvas = document.querySelector('.metro-canvas');
  var svg = document.querySelector('.metro-svg');
  // every completed layout rewrites data-metro-debug, so counting writes
  // counts layouts — a view that never settles keeps climbing
  window.__metroRuns = 0;
  new MutationObserver(function () { window.__metroRuns++; })
    .observe(canvas, { attributes: true, attributeFilter: ['data-metro-debug'] });
  function report() {
    var cr = canvas.getBoundingClientRect();
    function rel(r) { return { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height }; }
    var labels = [];
    canvas.querySelectorAll('.metro-gen').forEach(function (n) {
      var r = n.getBoundingClientRect();
      if (!r.width || !r.height) return;
      labels.push(Object.assign(rel(r), { cls: n.className, text: (n.textContent || '').trim() }));
    });
    function ctmPts(el, pts) {
      var m = el.getScreenCTM();
      return pts.map(function (p) {
        var x = m.a * p.x + m.c * p.y + m.e, y = m.b * p.x + m.d * p.y + m.f;
        return [x - cr.left, y - cr.top];
      });
    }
    var paths = [];
    svg.querySelectorAll('path').forEach(function (el) {
      var len = 0;
      try { len = el.getTotalLength(); } catch (e) { return; }
      var stepPx = 2, pts = [];
      for (var l = 0; l <= len; l += stepPx) pts.push(el.getPointAtLength(l));
      if (len > 0) pts.push(el.getPointAtLength(len));
      paths.push({
        role: el.getAttribute('data-metro-role') || 'other',
        owner: el.getAttribute('data-metro-owner') || null,
        pts: ctmPts(el, pts)
      });
    });
    // markers drawn as a shape rather than a circle (the station junction
    // diamond) still have to sit on their line, so report them as markers
    // too — by their bounding box, whose centre is the shape's centre
    var shapeMarkers = [];
    svg.querySelectorAll('g[data-metro-role="car"]').forEach(function (el) {
      var r = el.getBoundingClientRect();
      shapeMarkers.push(Object.assign(rel(r), {
        role: 'car', owner: el.getAttribute('data-metro-owner') || null,
        fill: el.getAttribute('fill') || null
      }));
    });
    svg.querySelectorAll('path[data-metro-role="station-ring"], line[data-metro-role="stop"]').forEach(function (el) {
      shapeMarkers.push(Object.assign(rel(el.getBoundingClientRect()), {
        role: el.getAttribute('data-metro-role'), owner: el.getAttribute('data-metro-owner') || null
      }));
    });
    var rects = [];
    svg.querySelectorAll('rect, line[data-metro-role]').forEach(function (el) {
      var r = el.getBoundingClientRect();
      rects.push(Object.assign(rel(r), {
        role: el.getAttribute('data-metro-role') || 'other',
        owner: el.getAttribute('data-metro-owner') || null
      }));
    });
    var circles = [];
    svg.querySelectorAll('circle').forEach(function (el) {
      var r = el.getBoundingClientRect();
      circles.push(Object.assign(rel(r), {
        role: el.getAttribute('data-metro-role') || 'other',
        owner: el.getAttribute('data-metro-owner') || null
      }));
    });
    var dbg = null;
    try { dbg = JSON.parse(canvas.getAttribute('data-metro-debug')); } catch (e) {}
    if (dbg) dbg.runs = window.__metroRuns || 0;
    var out = document.createElement('script');
    out.type = 'application/json';
    out.id = 'metro-report';
    out.textContent = JSON.stringify({
      canvas: { w: cr.width, h: cr.height },
      debug: dbg, labels: labels, paths: paths, rects: rects,
      circles: circles.concat(shapeMarkers)
    });
    document.body.appendChild(out);
  }
  // the layout debounces at 60ms and re-runs on load/fonts; give it room to
  // settle, then require the debug attribute to be present before reporting
  var tries = 0;
  (function wait() {
    if (++tries > 60) { report(); return; }
    if (!canvas.getAttribute('data-metro-debug')) return setTimeout(wait, 50);
    setTimeout(report, 250);
  })();
})();
</script>
`;

function pageFor(metro, screenClasses) {
  const fw = frameworkAssets();
  let html = swapMetro(baseHtml(), metro);
  html = html.split(CSS_URL).join('file://' + fw.css).split(JS_URL).join('file://' + fw.js);
  html = html.replace('class="screen screen--no-bleed"', 'class="screen screen--no-bleed ' + screenClasses + '"');
  return html.replace('</body>', REPORTER + '</body>');
}

// ---------------------------------------------------------------- rendering

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metro-layout-'));
let renderSeq = 0;

function render(metro, viewport) {
  const file = path.join(tmpDir, 'page' + (renderSeq++) + '.html');
  fs.writeFileSync(file, pageFor(metro, viewport.classes));
  const dom = execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=' + viewport.w + ',' + viewport.h,
    '--virtual-time-budget=8000', '--dump-dom', 'file://' + file,
  ], { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024, timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] });
  const m = dom.match(/<script type="application\/json" id="metro-report">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('the page produced no layout report (did the metro script throw?)');
  const rep = JSON.parse(m[1]);
  if (!rep.debug) throw new Error('the layout never published data-metro-debug');
  return rep;
}

// results are reused across assertions in a case file, so render once per
// (fixture, viewport) pair and memoise
const renderCache = new Map();
function layout(fixture, viewport) {
  const key = fixture.name + '|' + viewport.name;
  if (!renderCache.has(key)) renderCache.set(key, render(fixture.metro, viewport));
  return renderCache.get(key);
}

// ---------------------------------------------------------------- geometry helpers

function inflate(r, by) { return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by }; }
function overlap(a, b) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0 && oy > 0 ? { w: ox, h: oy, area: ox * oy } : null;
}
function pointIn(p, r) { return p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h; }

function hasClass(label, cls) { return (' ' + label.cls + ' ').indexOf(' ' + cls + ' ') >= 0; }
// the text boxes a reader is meant to read: event labels, station captions,
// terminus names, hour ticks and the sky band
function textLabels(rep) {
  return rep.labels.filter((l) => hasClass(l, 'metro-label') || hasClass(l, 'metro-terminus')
    || hasClass(l, 'metro-hour') || hasClass(l, 'metro-sky') || hasClass(l, 'metro-axis-note'));
}
function pathsWhere(rep, role) { return rep.paths.filter((p) => p.role === role); }

// how far a path strays inside a box, in px — 0 when it never enters it
function deepestIntrusion(pathPts, box) {
  let worst = 0;
  for (const p of pathPts) {
    if (!pointIn(p, box)) continue;
    const d = Math.min(p[0] - box.x, box.x + box.w - p[0], p[1] - box.y, box.y + box.h - p[1]);
    worst = Math.max(worst, d);
  }
  return worst;
}

function eventsIn(rep) { return (rep.debug.events || []).map((e) => ({
  title: e[0], side: e[1], status: e[2], lane: e[3], dir: e[4],
  nodeA: e[5], elbow: e[6], textStart: e[7], textLen: e[8], trackDist: e[9],
})); }

// ---------------------------------------------------------------- viewports

const VIEWPORTS = [
  { name: 'og-landscape', w: 800, h: 480, classes: 'screen--og screen--md screen--1bit screen--density-1x' },
  { name: 'x-landscape', w: 1872, h: 1404, classes: 'screen--v2 screen--lg screen--4bit screen--density-2x' },
  { name: 'x-portrait', w: 1404, h: 1872, classes: 'screen--v2 screen--lg screen--4bit screen--density-2x screen--portrait' },
  { name: 'og-half', w: 400, h: 480, classes: 'screen--og screen--md screen--1bit screen--density-1x' },
];

// ---------------------------------------------------------------- tiny test runner

// A test may be registered with `{ known: 'why' }`: a defect that is real,
// understood and not fixed yet. A known issue that still fails is reported
// and does NOT fail the run; a known issue that starts PASSING does fail it,
// so a fix can't land without the marker being removed. Nothing gets to be
// quietly broken, and nothing gets to be quietly fixed.
const tests = [];
function test(name, fn, opts) { tests.push({ name, fn, known: opts && opts.known }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg ? msg + ': ' : '') + 'expected ' + e + ', got ' + a);
}

const helpers = {
  layout, render, VIEWPORTS, fixtures: require('./fixtures'),
  overlap, inflate, pointIn, hasClass, textLabels, pathsWhere, deepestIntrusion, eventsIn,
  assert, assertEqual,
};

for (const file of fs.readdirSync(path.join(__dirname, 'cases')).sort()) {
  if (!file.endsWith('.js')) continue;
  require(path.join(__dirname, 'cases', file))(test, helpers);
}

(async function main() {
  let pass = 0, fail = 0, known = 0;
  const only = process.argv[2];
  for (const t of tests) {
    if (only && t.name.indexOf(only) < 0) continue;
    let err = null;
    try { await t.fn(); } catch (e) { err = e; }
    if (t.known && err) {
      console.log('≈ ' + t.name + '\n    known: ' + t.known + '\n    ' + (err.message || err));
      known++;
    } else if (t.known && !err) {
      console.log('✗ ' + t.name + '\n    this is marked as a known issue but now passes — remove the marker');
      fail++;
    } else if (err) {
      console.log('✗ ' + t.name + '\n    ' + (err.message || err));
      fail++;
    } else {
      console.log('✓ ' + t.name);
      pass++;
    }
  }
  console.log('\n' + pass + '/' + (pass + known + fail) + ' passed, ' + known + ' known issue(s), ' + fail + ' failure(s)');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
})();
