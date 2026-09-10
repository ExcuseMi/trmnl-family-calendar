'use strict';

// The hour scale used to run down the MIDDLE of the board with the lines
// split above and below it, so a grey band cut every person's day in half.
// It is a header now: a strip along the leading edge, with the map running
// the whole depth beside it.

module.exports = function (test, h) {
  const { layout, render, VIEWPORTS, fixtures, pathsWhere, textLabels, overlap, assert } = h;

  const byName = (n) => VIEWPORTS.find((v) => v.name === n);
  const ROOMY = byName('x-landscape');
  const busy = fixtures.find((f) => f.name === 'busy-day');

  // "across" is y when the board is lying down and x when it is stood up:
  // every measurement here is on the cross axis, whichever one that is
  const cross = (rep) => (rep.debug.horizontal ? 1 : 0);
  function spanOf(rep, parts) {
    const i = cross(rep);
    let lo = Infinity, hi = -Infinity;
    for (const p of parts) {
      if (p.pts) { for (const q of p.pts) { lo = Math.min(lo, q[i]); hi = Math.max(hi, q[i]); } }
      else { lo = Math.min(lo, i ? p.y : p.x); hi = Math.max(hi, (i ? p.y + p.h : p.x + p.w)); }
    }
    return { lo, hi };
  }
  const shapes = (rep, role) => (rep.paths || []).concat(rep.rects || []).filter((p) => p.role === role);
  function bandOf(rep) { return spanOf(rep, shapes(rep, 'river')); }

  for (const f of fixtures) {
    test('no line crosses the hour band: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const band = bandOf(rep);
      assert(isFinite(band.lo), 'no hour band drawn');
      const bad = [];
      for (const p of pathsWhere(rep, 'track').concat(pathsWhere(rep, 'branch'), pathsWhere(rep, 'fork'))) {
        // the strip is a header, so nothing belonging to the map may reach
        // into it — a line that does is the old "band through the middle"
        for (const q of p.pts) if (q[1] < band.hi - 1) { bad.push(p.role + ' ' + p.owner); break; }
      }
      assert(bad.length === 0, bad.length + ' line(s) reaching into the hour band: '
        + [...new Set(bad)].slice(0, 4).join(', '));
    });
  }

  test('the hour band sits at the leading edge, not through the map', () => {
    for (const v of [ROOMY, byName('x-portrait'), byName('og-landscape'), byName('og-half')]) {
      const rep = render(busy.metro, v);
      const band = bandOf(rep);
      const depth = rep.debug.horizontal ? rep.canvas.h : rep.canvas.w;
      assert(band.lo <= 2, v.name + ': the band starts ' + Math.round(band.lo) + 'px in, not at the edge');
      assert(band.hi < depth * 0.35, v.name + ': the band reaches ' + Math.round(band.hi)
        + 'px into a ' + Math.round(depth) + 'px board');
    }
  });

  test('the hours are written on the band', () => {
    const rep = layout(busy, ROOMY);
    const band = bandOf(rep);
    const hours = textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-hour ') >= 0);
    assert(hours.length >= 3, 'expected the hour scale, found ' + hours.length + ' hour label(s)');
    const off = hours.filter((l) => l.y < band.lo - 2 || l.y + l.h > band.hi + 2);
    assert(off.length === 0, off.length + ' hour label(s) off the band: '
      + off.map((l) => '"' + l.text + '"').join(', '));
  });

  // Nothing is drawn across the board at "now". A rule there was the one
  // line drawn at a minute rather than belonging to anybody, so nothing
  // routed around it and it cut through captions the whole width of the
  // map. The badge on the scale says what time it is; each line's car says
  // where that person is.
  test('nothing is ruled across the board at a moment in time', () => {
    for (const v of [ROOMY, byName('x-portrait')]) {
      const rep = render(SKY, v);
      assert(shapes(rep, 'now').length === 0,
        v.name + ': something is still drawn across the board at now');
      // sunrise, sunset and the weather markers used to drop one too
      const band = bandOf(rep);
      const i = cross(rep);
      const depth = rep.debug.horizontal ? rep.canvas.h : rep.canvas.w;
      const long = (rep.paths || []).filter((p) => {
        const at = p.pts.map((q) => q[i]);
        return Math.max.apply(null, at) - Math.min.apply(null, at) > depth * 0.5
          && Math.min.apply(null, at) < band.hi + 4;
      });
      assert(long.length === 0, v.name + ': ' + long.length
        + ' line(s) still run from the scale across the whole board');
    }
  });

  test('the clock is stated as a badge on the scale', () => {
    const rep = layout(busy, ROOMY);
    const pills = textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-pill ') >= 0);
    assert(pills.length === 1, 'expected one clock badge on the scale, found ' + pills.length);
    assert(/\d/.test(pills[0].text), 'the clock badge says "' + pills[0].text + '"');
  });

  // Sunrise/sunset markers used to be set at the very top of the canvas.
  // The hour scale moved there, and nothing said so: sunset's "9:12pm" was
  // written straight over the "9pm" tick on the strip.
  const SKY = JSON.parse(JSON.stringify(busy.metro));
  const DOT = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>"
    + "<circle cx='12' cy='12' r='6' fill='black'/></svg>";
  SKY.items = SKY.items.concat([
    { type: 'sun', at_min: SKY.day_start_min + 40, icon: DOT, label: 'sunrise' },
    // deliberately just before the end of the window, where the last hour
    // tick and the "+n more" note both live
    { type: 'sun', at_min: SKY.day_end_min - 12, icon: DOT, label: 'sunset' },
  ]);

  test('a sky marker never lands on the hour scale', () => {
    for (const v of [ROOMY, byName('og-landscape')]) {
      const rep = render(SKY, v);
      const sky = textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-sky ') >= 0);
      if (!sky.length) continue;   // too small a board to carry them at all
      const scale = textLabels(rep).filter((l) => {
        const c = ' ' + l.cls + ' ';
        return c.indexOf(' metro-hour ') >= 0 || c.indexOf(' metro-axis-note ') >= 0;
      });
      const bad = [];
      for (const m of sky) for (const t of scale) {
        const o = overlap(m, t);
        if (o && o.w > 1 && o.h > 1) bad.push('"' + m.text + '" over "' + t.text + '"');
      }
      assert(bad.length === 0, v.name + ': ' + bad.length + ' sky marker(s) on the scale: '
        + [...new Set(bad)].join('; '));
      // and below the strip, not floating in it
      const band = bandOf(rep);
      const i = cross(rep);
      const inside = sky.filter((m) => (i ? m.y : m.x) < band.hi - 1);
      assert(inside.length === 0, v.name + ': ' + inside.length + ' sky marker(s) inside the strip');
    }
  });

  // The interchange capsule and the rail leaving it are one move through the
  // board. Crushed by the packed-board weight scale the rail came out barely
  // heavier than an ordinary track — a thread hanging off a fat pill.
  test('the rail leaving an interchange reads with the capsule', () => {
    for (const v of [ROOMY, byName('og-landscape'), byName('x-portrait')]) {
      const rep = render(busy.metro, v);
      const caps = shapes(rep, 'capsule');
      assert(caps.length > 0, v.name + ': no interchange capsule drawn');
      // shapes are measured in screen px, stroke widths come from computed
      // style in layout px — the framework zooms high-density screens, so
      // one has to be brought into the other's space before they compare
      const Z = rep.debug.Z;
      const i = cross(rep);
      const capW = Math.min.apply(null, caps.map((c) => (i ? c.w : c.h)));
      const forks = pathsWhere(rep, 'fork').concat(pathsWhere(rep, 'branch'));
      const bold = Math.max.apply(null, forks.map((f) => f.width)) * Z;
      // A shared rail leaves its host line visibly heavier than the line
      // itself: that weight is the whole statement.
      const host = {};
      for (const t of pathsWhere(rep, 'track')) host[t.owner] = t.width * Z;
      const boldFork = forks.filter((f) => f.width * Z >= bold - 0.01)[0];
      assert(bold > host[boldFork.owner] * 1.2, v.name + ': the shared rail is ' + bold.toFixed(1)
        + 'px on a ' + host[boldFork.owner].toFixed(1) + 'px line — it has to read as the heavier one');
      assert(capW < bold * 3, v.name + ': a ' + Math.round(capW) + 'px capsule on a '
        + bold.toFixed(1) + 'px rail reads as a pill with a thread hanging off it');
    }
  });
};
