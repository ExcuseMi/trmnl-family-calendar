'use strict';

// The hour scale used to run down the MIDDLE of the board with the lines
// split above and below it, so a grey band cut every person's day in half.
// It is a header now: a strip along the leading edge, with the map running
// the whole depth beside it.

module.exports = function (test, h) {
  const { layout, render, VIEWPORTS, fixtures, pathsWhere, textLabels, assert } = h;

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

  test('one rule marks now across every line', () => {
    const rep = layout(busy, ROOMY);
    const rules = shapes(rep, 'now');
    assert(rules.length === 1, 'expected one now rule, found ' + rules.length);
    const band = bandOf(rep);
    const { lo, hi } = spanOf(rep, rules);
    assert(lo <= band.hi + 2, 'the now rule starts below the band');
    // it has to reach past the outermost line, or it is not "across
    // every line" — the mark that says what time it is on a board where
    // every other mark says what time something else was
    let far = -Infinity;
    for (const p of pathsWhere(rep, 'track')) for (const q of p.pts) far = Math.max(far, q[1]);
    assert(hi >= far - 2, 'the now rule stops ' + Math.round(far - hi) + 'px short of the last line');
  });

  test('the clock is stated as a badge on the scale', () => {
    const rep = layout(busy, ROOMY);
    const pills = textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-pill ') >= 0);
    assert(pills.length === 1, 'expected one clock badge on the scale, found ' + pills.length);
    assert(/\d/.test(pills[0].text), 'the clock badge says "' + pills[0].text + '"');
  });
};
