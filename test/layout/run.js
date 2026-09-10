'use strict';

// Regression tests for the METRO MAP LAYOUT — the client-side geometry in
// plugin/src/shared.liquid (band/lane placement, siding kinks and their
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
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const PLUGIN = path.join(ROOT, 'plugin');
const BUILT = path.join(PLUGIN, '_build');
const SRC = path.join(PLUGIN, 'src');
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

// The demo `metro:` block in .trmnlp.yml reaches the built page TWICE: as
// the runtime `var METRO` the script lays the map out from (swapMetro below
// replaces that, which is what a fixture is), and through the Liquid tags
// that draw everything the script never touches: the header, and the
// service alert banner. A fixture cannot reach the second one at all, so a
// test about something Liquid draws needs its own BUILD, with those keys
// patched into the yml. `trmnlp build` is about a second, and each variant
// is built once for the whole run.
const YML = path.join(PLUGIN, '.trmnlp.yml');

// Insert keys at the top of the metro mapping. It is a JSON literal
// embedded in the yml (a YAML flow mapping, so JSON-shaped lines are
// valid), and inserting straight after its opening brace needs no YAML
// parser and cannot disturb the ~600 lines already in there.
function patchDemoMetro(yml, extra) {
  const at = yml.indexOf('\n  metro:');
  if (at < 0) throw new Error('.trmnlp.yml has no metro: block to patch');
  const open = yml.indexOf('{', at);
  const lines = Object.keys(extra)
    .map((k) => '      ' + JSON.stringify(k) + ': ' + JSON.stringify(extra[k]) + ',').join('\n');
  return yml.slice(0, open + 1) + '\n' + lines + yml.slice(open + 1);
}

// One `trmnlp build` writes all four views. `page` picks which of them a
// test renders: they are the SAME template with a different `view` number,
// and the framework's typography is not the same in a quadrant as in a
// full view, so a string that fits on one line in one of them wraps in the
// other. Everything else in this suite renders `full`, which is what a
// mashup slot scales; a case about a view's own build asks for it by name.
const builtHtml = new Map();

// What `trmnlp build` reads. Hashed so a build can be cached on disk like a
// render: with the renders cached, five builds at about a second each were
// most of what a warm run still spent.
function sourceStamp() {
  const parts = [];
  for (const f of fs.readdirSync(SRC).sort()) {
    parts.push(f + ':' + crypto.createHash('sha1').update(fs.readFileSync(path.join(SRC, f))).digest('hex'));
  }
  return parts.join('|');
}

function baseHtml(liquidExtra, page) {
  const key = (liquidExtra ? JSON.stringify(liquidExtra) : '') + '|' + (page || 'full');
  if (builtHtml.has(key)) return builtHtml.get(key);
  const stamp = crypto.createHash('sha1').update(sourceStamp() + '|' + key).digest('hex');
  const cached = path.join(BUILD_CACHE, stamp + '.html');
  if (!CACHE_OFF) {
    try {
      const hit = fs.readFileSync(cached, 'utf-8');
      builtHtml.set(key, hit);
      return hit;
    } catch (e) { /* not built yet */ }
  }
  // The yml is a tracked source file, so it is patched, built and put back
  // in a finally, because a failed build must not leave a test fixture
  // behind in the working tree.
  const orig = fs.readFileSync(YML, 'utf-8');
  try {
    if (liquidExtra) fs.writeFileSync(YML, patchDemoMetro(orig, liquidExtra));
    const tb = Date.now();
    execFileSync('trmnlp', ['build'], { cwd: PLUGIN, stdio: 'pipe', timeout: 120000 });
    spent.builds++;
    spent.buildMs += Date.now() - tb;
  } catch (e) {
    throw new Error('`trmnlp build` failed (is trmnlp on PATH?): ' + (e.stderr || e.message));
  } finally {
    if (liquidExtra) fs.writeFileSync(YML, orig);
  }
  const html = fs.readFileSync(path.join(BUILT, (page || 'full') + '.html'), 'utf-8');
  if (!CACHE_OFF) {
    try {
      fs.mkdirSync(BUILD_CACHE, { recursive: true });
      const part = cached + '.' + process.pid + '.part';
      fs.writeFileSync(part, html);
      fs.renameSync(part, cached);
    } catch (e) { /* a cache that cannot be written is not an error */ }
  }
  builtHtml.set(key, html);
  return html;
}

// Replace the baked `var METRO = {...};` literal with a fixture. The JSON is
// emitted on one line, so scanning balanced braces from the opening one is
// exact (and beats a regex that would trip over nested objects).
function swapMetro(html, metro) {
  // Matched loosely on purpose: push.sh minifies the template's script on
  // the way to the device, which closes the spaces up to `var METRO=`. The
  // whole reason that minifier leaves identifiers alone is so this suite can
  // measure the artefact that actually ships, and a marker that only matched
  // the pretty form would have quietly given that up.
  const m = /var\s+METRO\s*=\s*/.exec(html);
  if (!m) throw new Error('could not find the METRO literal in the built page');
  const at = m.index;
  const open = html.indexOf('{', at + m[0].length - 1);
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
      var cs = getComputedStyle(el);
      paths.push({
        role: el.getAttribute('data-metro-role') || 'other',
        owner: el.getAttribute('data-metro-owner') || null,
        // set on the rails of one shared event, so a case can ask about a
        // bundle as a set instead of guessing which branches belong together
        bundle: el.getAttribute('data-metro-bundle') || null,
        stroke: cs.stroke,
        // the drawn stroke, so a test can ask whether a ramp is in its
        // line's own style rather than only where it goes
        dash: (cs.strokeDasharray === 'none' ? '' : cs.strokeDasharray) || '',
        dashOffset: parseFloat(cs.strokeDashoffset) || 0,
        width: parseFloat(cs.strokeWidth) || 0,
        len: len,
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
        // computed, not the attribute: a colour can be a CSS variable now,
        // so it is set through style and there is no attribute to read.
        // The car is paper-filled with a coloured outline, so what says
        // which line it belongs to is the STROKE and the letter inside it.
        fill: getComputedStyle(el.querySelector('rect') || el).fill || null,
        stroke: getComputedStyle(el.querySelector('rect') || el).stroke || null,
        text: (el.textContent || '').trim()
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
    // Every drawn thing, with the paint it ACTUALLY got. An SVG shape with
    // neither stroke nor fill is in the DOM, the right size, in the right
    // place, and invisible — which is how the interchange tie disappeared.
    var painted = [];
    // The paper overlays that give a line its texture. They carry no role —
    // an overlay is not a line, it is a hole in one — so they are collected
    // separately, by the attribute that marks them.
    var overlays = [];
    svg.querySelectorAll('[data-metro-overlay]').forEach(function (el) {
      var cs = getComputedStyle(el);
      overlays.push({
        owner: el.getAttribute('data-metro-overlay') || null,
        dash: (cs.strokeDasharray === 'none' ? '' : cs.strokeDasharray) || '',
        dashOffset: parseFloat(cs.strokeDashoffset) || 0,
        width: parseFloat(cs.strokeWidth) || 0,
        stroke: cs.stroke
      });
    });
    svg.querySelectorAll('[data-metro-role]').forEach(function (el) {
      var cs = getComputedStyle(el);
      var r = el.getBoundingClientRect();
      painted.push({
        role: el.getAttribute('data-metro-role'),
        owner: el.getAttribute('data-metro-owner') || null,
        tag: el.tagName.toLowerCase(),
        stroke: cs.stroke, fill: cs.fill,
        strokeWidth: parseFloat(cs.strokeWidth) || 0,
        opacity: parseFloat(cs.opacity),
        w: r.width, h: r.height
      });
    });
    // The service banner is NOT part of the map: it is a sibling of the
    // canvas, so it takes its height off the canvas rather than covering
    // it. Reported in the same canvas-relative space as everything else,
    // together with the root that both of them share, so a case can ask
    // whether the map really gave up exactly that much room.
    // No regex here. This whole reporter is a template literal in run.js,
    // where a backslash is an escape, so an escaped bracket in a pattern
    // reaches the page unescaped: the test read as a capture group and
    // matched nothing, and every board reported a transparent background.
    function bgOf(el) {
      for (var n = el; n; n = n.parentElement) {
        var c = (getComputedStyle(n).backgroundColor || '').replace(/ /g, '');
        if (c && c !== 'transparent' && c !== 'rgba(0,0,0,0)') return getComputedStyle(n).backgroundColor;
      }
      return null;
    }
    var root = document.querySelector('.metro-root');
    // The slot the board is given: .view when the framework wraps one (a
    // mashup slot takes its box from --full-w/--full-h there), else the
    // screen itself. Reported so a case can ask whether the board still
    // fits what it was given, which is the one thing a device shows by
    // silently cutting the bottom off.
    var viewEl = root.closest('.view') || document.querySelector('.screen');
    var bannerEl = document.querySelector('.metro-banner');
    var banner = null;
    if (bannerEl) {
      var bcs = getComputedStyle(bannerEl);
      banner = Object.assign(rel(bannerEl.getBoundingClientRect()), {
        text: (bannerEl.textContent || '').trim(),
        kind: bannerEl.getAttribute('data-metro-alert'),
        ink: bcs.backgroundColor, paper: bcs.color,
        lineHeight: parseFloat(bcs.lineHeight) || 0
      });
    }
    var dbg = null;
    try { dbg = JSON.parse(canvas.getAttribute('data-metro-debug')); } catch (e) {}
    if (dbg) dbg.runs = window.__metroRuns || 0;
    var out = document.createElement('script');
    out.type = 'application/json';
    out.id = 'metro-report';
    out.textContent = JSON.stringify({
      canvas: { w: cr.width, h: cr.height },
      root: rel(root.getBoundingClientRect()), view: rel(viewEl.getBoundingClientRect()),
      boardBg: bgOf(canvas), banner: banner,
      debug: dbg, labels: labels, paths: paths, rects: rects, painted: painted, overlays: overlays,
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

function pageFor(metro, screenClasses, slot, liquidExtra, page) {
  const fw = frameworkAssets();
  let html = swapMetro(baseHtml(liquidExtra, page), metro);
  html = html.split(CSS_URL).join('file://' + fw.css).split(JS_URL).join('file://' + fw.js);
  // Add the device classes to whatever the build put on the screen element,
  // rather than matching one exact string. The bleed setting changes that
  // string (`screen--no-bleed` appears only when padding is off), and when
  // it did, this replace silently did nothing: the page rendered at a
  // default size and fifteen tests failed looking like layout bugs.
  const screenTag = /class="screen([^"]*)"/;
  if (!screenTag.test(html)) throw new Error('the built page has no .screen element to size');
  html = html.replace(screenTag, (m, rest) => 'class="screen' + rest + ' ' + screenClasses + '"');
  // A half or a quadrant is a SLOT inside the screen, not a smaller screen.
  // The framework pins .screen to the device's own size whatever the window
  // is, so asking for a 400x240 window and calling the result a quadrant
  // rendered a full 800x480 board and cropped the picture: every small-view
  // case in this suite was measuring the full board and saying otherwise.
  // `.view--full` takes its box from --full-w/--full-h, which is the one
  // knob a real mashup slot turns, so overriding those two gives the view
  // the slot's box and leaves the screen and its zoom alone.
  if (slot) {
    html = html.replace('</head>', '<style>.screen{--full-w:' + slot.w + 'px !important;'
      + '--full-h:' + slot.h + 'px !important}</style></head>');
  }
  return html.replace('</body>', REPORTER + '</body>');
}

// ---------------------------------------------------------------- rendering

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metro-layout-'));
let renderSeq = 0;

// What the run spent, printed as one line at the end. A suite this slow
// gets optimised by guess unless it says where the time went.
const spent = { renders: 0, renderMs: 0, hits: 0, disk: 0, builds: 0, buildMs: 0 };

// Renders that survive the process, keyed on the EXACT bytes about to be
// rendered plus the window they are rendered into. That key is the whole
// point: the page embeds the built template, so a change to shared.liquid
// changes every key and nothing stale can come back. Editing only a test
// file changes no key at all, which is the loop this is for, and the one
// that costs the most: rewriting expectations re-renders identical boards
// every time.
//
// Under .cache, which is gitignored, beside the framework assets. Entries
// older than a week are dropped on the way in so it cannot grow forever.
// Two runs at once corrupt the working tree. A build variant PATCHES the
// tracked .trmnlp.yml, builds, and puts it back in a finally; run twice
// over, one run's restore writes back what the other had already patched,
// and a test fixture is left in a source file for good. That happened: an
// "ALERT · Rain" banner ended up committed-adjacent in .trmnlp.yml and the
// next run reported six failures that were nothing but the leftover.
// Both runs also fight over _build, so their numbers are fiction anyway.
const LOCK = path.join(CACHE, 'run.lock');
(function claimTheSuite() {
  fs.mkdirSync(CACHE, { recursive: true });
  try {
    fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' });
  } catch (e) {
    let holder = '';
    try { holder = fs.readFileSync(LOCK, 'utf-8').trim(); } catch (e2) { /* raced away */ }
    // A crashed run leaves its lock behind, so a pid nobody is running is
    // not a reason to refuse.
    let alive = false;
    try { process.kill(+holder, 0); alive = true; } catch (e2) { alive = false; }
    if (alive) {
      console.error('another layout run (pid ' + holder + ') is going. It patches plugin/.trmnlp.yml,'
        + ' so two at once corrupt it. Wait for it, or kill it and delete ' + LOCK + '.');
      process.exit(2);
    }
    fs.writeFileSync(LOCK, String(process.pid));
  }
  const drop = function () { try { fs.unlinkSync(LOCK); } catch (e) { /* already gone */ } };
  process.on('exit', drop);
  process.on('SIGINT', function () { drop(); process.exit(130); });
  process.on('SIGTERM', function () { drop(); process.exit(143); });
})();

const REPORT_CACHE = path.join(CACHE, 'reports');
const BUILD_CACHE = path.join(CACHE, 'builds');
const CACHE_OFF = process.env.METRO_NO_CACHE === '1';
(function pruneReports() {
  if (CACHE_OFF) return;
  try {
    const week = Date.now() - 7 * 24 * 3600 * 1000;
    for (const dir of [REPORT_CACHE, BUILD_CACHE]) {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).mtimeMs < week) fs.unlinkSync(full);
      }
    }
  } catch (e) { /* no cache yet, or nothing to prune */ }
})();

// Every render is a Chromium launch, and the cases render the same board at
// the same size over and over — a case that mutates a fixture and hands it
// to render() directly missed the (fixture, viewport) cache below entirely.
// Keyed on the CONTENT instead, every one of those is a cache hit, which is
// most of the suite's wall time.
const contentCache = new Map();
function render(metro, viewport, liquidExtra) {
  const key = viewport.name + '|' + viewport.w + 'x' + viewport.h
    + '|' + (viewport.slot ? viewport.slot.w + 'x' + viewport.slot.h : 'full') + '|'
    + '|' + (viewport.page || 'full') + '|'
    + crypto.createHash('sha1').update(JSON.stringify(metro) + '|' + JSON.stringify(liquidExtra || null)).digest('hex');
  if (contentCache.has(key)) spent.hits++;
  else contentCache.set(key, renderUncached(metro, viewport, liquidExtra));
  return contentCache.get(key);
}

function renderUncached(metro, viewport, liquidExtra) {
  const html = pageFor(metro, viewport.classes, viewport.slot, liquidExtra, viewport.page);
  // The bytes AND the window AND the browser: everything that can change
  // what comes back. Hashing the finished page rather than its ingredients
  // means no ingredient can be forgotten.
  const disk = path.join(REPORT_CACHE, crypto.createHash('sha1')
    .update(html + '|' + viewport.w + 'x' + viewport.h + '|' + CHROME).digest('hex') + '.json');
  if (!CACHE_OFF) {
    try {
      const hit = JSON.parse(fs.readFileSync(disk, 'utf-8'));
      spent.disk++;
      return hit;
    } catch (e) { /* not cached, or half-written: render it */ }
  }
  const file = path.join(tmpDir, 'page' + (renderSeq++) + '.html');
  fs.writeFileSync(file, html);
  const t0 = Date.now();
  const dom = execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=' + viewport.w + ',' + viewport.h,
    '--virtual-time-budget=8000', '--dump-dom', 'file://' + file,
  ], { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024, timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] });
  const m = dom.match(/<script type="application\/json" id="metro-report">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('the page produced no layout report (did the metro script throw?)');
  const rep = JSON.parse(m[1]);
  if (!rep.debug) throw new Error('the layout never published data-metro-debug');
  spent.renders++;
  spent.renderMs += Date.now() - t0;
  if (!CACHE_OFF) {
    // Written through a temp name: a run killed mid-write must not leave a
    // truncated report behind for the next one to read as a hit.
    try {
      fs.mkdirSync(REPORT_CACHE, { recursive: true });
      const part = disk + '.' + process.pid + '.part';
      fs.writeFileSync(part, JSON.stringify(rep));
      fs.renameSync(part, disk);
    } catch (e) { /* a cache that cannot be written is not an error */ }
  }
  return rep;
}

// results are reused across assertions in a case file, so render once per
// (fixture, viewport) pair and memoise
function layout(fixture, viewport, liquidExtra) { return render(fixture.metro, viewport, liquidExtra); }

// ---------------------------------------------------------------- geometry helpers

function inflate(r, by) { return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by }; }
function overlap(a, b) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0 && oy > 0 ? { w: ox, h: oy, area: ox * oy } : null;
}
function pointIn(p, r) { return p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h; }

function hasClass(label, cls) { return (' ' + label.cls + ' ').indexOf(' ' + cls + ' ') >= 0; }
// the text boxes a reader is meant to read: event labels, siding captions,
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
  merged: e[10] === 'merge', diagFrom: e[11], laneDist: e[12], sign: e[13], endA: e[14],
})); }

// ---------------------------------------------------------------- viewports

const VIEWPORTS = [
  { name: 'og-landscape', w: 800, h: 480, classes: 'screen--og screen--md screen--1bit screen--density-1x' },
  { name: 'x-landscape', w: 1872, h: 1404, classes: 'screen--v2 screen--lg screen--4bit screen--density-2x' },
  { name: 'x-portrait', w: 1404, h: 1872, classes: 'screen--v2 screen--lg screen--4bit screen--density-2x screen--portrait' },
  // a slot inside the screen, not a smaller screen: see pageFor
  { name: 'og-half', w: 800, h: 480, slot: { w: 400, h: 480 }, classes: 'screen--og screen--md screen--1bit screen--density-1x' },
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
  console.log(spent.renders + ' render(s) ' + (spent.renderMs / 1000).toFixed(1) + 's, '
    + spent.disk + ' from cache, ' + spent.hits + ' repeated, '
    + spent.builds + ' build(s) ' + (spent.buildMs / 1000).toFixed(1) + 's'
    + (CACHE_OFF ? ' (cache off)' : ''));
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
})();
