'use strict';

// A board that fits with room to spare has to USE that room. The packed
// fallback (the layout every crowded board lands in) had no separation term
// at all: it drew every line at the minimum pitch however much depth was
// going spare, so a seven-line day came out crammed into a third of the
// canvas with each line's name lying across its own rail and 700px of empty
// paper underneath.

module.exports = function (test, h) {
  const { render, VIEWPORTS, fixtures, pathsWhere, textLabels, overlap, assert } = h;

  const byName = (n) => VIEWPORTS.find((v) => v.name === n);
  const FLAT = [byName('x-landscape'), byName('og-landscape')];
  const TALL = [byName('x-portrait')];
  const seven = fixtures.find((f) => f.name === 'seven-lines');

  const names = (rep) => textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-terminus ') >= 0);

  // The bug's own signature: the pitch stayed at its floor while the board
  // had depth to give. `sep` is the extra separation the solver bought with
  // the leftover room, so it going to zero on a board with slack IS the
  // defect, whichever way the lines were then drawn.
  test('spare depth is spent on separating the lines', () => {
    for (const f of fixtures) for (const v of FLAT.concat(TALL)) {
      const rep = render(f.metro, v);
      const d = rep.debug;
      const spare = d.crossPx - (d.needA + d.needB);
      // A fifth of the board is the complaint ("why is everything squished
      // together"), not a few px: one growth step costs a slice on every
      // gap at once, so a board can honestly have room for none.
      if (spare <= d.crossPx * 0.2) continue;
      assert(d.sep > 0, f.name + '/' + v.name + ': ' + Math.round(spare)
        + 'px of depth going spare and the lines still drawn at the minimum pitch');
    }
  });

  // What the reader sees when that happens. Two names one under the other
  // is the same defect as a name on a rail, and the existing rail test could
  // not see it.
  test('no line name lands on another line name', () => {
    for (const f of fixtures) for (const v of FLAT.concat(TALL)) {
      const rep = render(f.metro, v);
      const ns = names(rep);
      const bad = [];
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const o = overlap(ns[i], ns[j]);
          if (o && o.w > 2 && o.h > 2) bad.push('"' + ns[i].text + '" over "' + ns[j].text + '"');
        }
      }
      assert(bad.length === 0, f.name + '/' + v.name + ': ' + bad.join('; '));
    }
  });

  // Seven lines is the board that broke, and it is not an exotic one: it is
  // what you get from a config that gives each calendar a name, since an
  // event no rule claims falls back to that name and the name becomes a
  // line. The map has to stay legible at that count.
  test('seven lines still get a rail apart from their neighbours', () => {
    for (const v of FLAT) {
      const rep = render(seven.metro, v);
      // one line is drawn as several paths, because the ink is cut wherever
      // it passes under something, so a rail is a per-OWNER position rather
      // than a per-path one
      const at = {};
      for (const t of pathsWhere(rep, 'track')) {
        const ys = t.pts.map((p) => p[1]);
        const e = at[t.owner] || (at[t.owner] = { owner: t.owner, sum: 0, n: 0, w: 0 });
        e.sum += ys.reduce((a, b) => a + b, 0); e.n += ys.length;
        e.w = Math.max(e.w, t.width * rep.debug.Z);
      }
      const rails = Object.keys(at).map((k) => ({ owner: k, y: at[k].sum / at[k].n, w: at[k].w }))
        .sort((a, b) => a.y - b.y);
      // An 800x480 panel cannot hold seven lines and says so by dropping
      // the ones it cannot draw, which is the honest answer. Only the board
      // with the depth for them has to show them all.
      if (v.name === 'x-landscape') {
        assert(rails.length === 7, v.name + ': expected 7 rails, drew ' + rails.length);
      }
      for (let i = 1; i < rails.length; i++) {
        const gap = rails[i].y - rails[i - 1].y - (rails[i].w + rails[i - 1].w) / 2;
        // two strokes with less than a stroke of paper between them read as
        // one thick line, not as two lines
        assert(gap > Math.max(rails[i].w, rails[i - 1].w), v.name + ': ' + rails[i - 1].owner
          + ' and ' + rails[i].owner + ' are ' + Math.round(gap) + 'px apart');
      }
    }
  });
};
