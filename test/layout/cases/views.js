'use strict';

// The plugin ships four views and renders at two device scales, and until
// now everything was asserted at one size in one orientation. The vertical
// layouts were badly broken for a long time without anything noticing:
// every measurement that says "width" is a length along the axis lying
// down, but a thickness across it standing up, and code that hardcodes one
// reads fine and draws nonsense.

module.exports = function (test, h) {
  const { render, fixtures, overlap, textLabels, pathsWhere, deepestIntrusion, eventsIn, assert } = h;

  const VIEWS = [
    { view: 'full', name: 'x-portrait', w: 1404, h: 1872, classes: 'screen--v2 screen--lg screen--4bit screen--density-2x screen--portrait' },
    { view: 'full', name: 'og-portrait', w: 480, h: 800, classes: 'screen--og screen--md screen--1bit screen--density-1x' },
    { view: 'full', name: 'x-half-vertical', w: 936, h: 1404, classes: 'screen--v2 screen--lg screen--4bit screen--density-2x' },
    { view: 'full', name: 'og-half-vertical', w: 400, h: 480, classes: 'screen--og screen--md screen--1bit screen--density-1x' },
    { view: 'full', name: 'og-quadrant', w: 400, h: 240, classes: 'screen--og screen--md screen--1bit screen--density-1x' },
  ];

  const busy = fixtures.find((f) => f.name === 'busy-day');

  // A vertical layout has to actually be vertical. The giveaway when the
  // orientation logic half-applies is a track that runs the wrong way.
  test('a tall canvas lays the tracks out along its long side', () => {
    const rep = render(busy.metro, VIEWS[0]);
    assert(rep.debug.horizontal === false, 'a 1404x1872 canvas chose the horizontal layout');
    for (const t of pathsWhere(rep, 'track')) {
      const xs = t.pts.map((p) => p[0]), ys = t.pts.map((p) => p[1]);
      const spanX = Math.max.apply(null, xs) - Math.min.apply(null, xs);
      const spanY = Math.max.apply(null, ys) - Math.min.apply(null, ys);
      assert(spanY > spanX, 'track ' + t.owner + ' runs across the short side of a tall canvas');
    }
  });

  for (const v of VIEWS) {
    test('everything stays on the canvas: ' + v.name, () => {
      const rep = render(busy.metro, v);
      const off = textLabels(rep).filter((l) =>
        l.x < -2 || l.y < -2 || l.x + l.w > rep.canvas.w + 2 || l.y + l.h > rep.canvas.h + 2);
      assert(off.length === 0, off.length + ' label(s) off-canvas: '
        + off.slice(0, 4).map((l) => '"' + l.text + '"').join(', '));
    });

    test('markers sit on their line: ' + v.name, () => {
      const rep = render(busy.metro, v);
      const lines = pathsWhere(rep, 'track').concat(pathsWhere(rep, 'branch'));
      const missed = [];
      for (const c of rep.circles.filter((c) => c.role === 'ring' || c.role === 'station-ring' || c.role === 'stop')) {
        const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
        let best = Infinity;
        for (const p of lines) for (const pt of p.pts) {
          const d = Math.hypot(pt[0] - cx, pt[1] - cy);
          if (d < best) best = d;
        }
        if (best > 8) missed.push(c.role + ' off by ' + best.toFixed(1) + 'px');
      }
      assert(missed.length === 0, missed.length + ' marker(s) adrift: ' + missed.slice(0, 4).join('; '));
    });
  }

  // The name of each line has to be readable and its own — the failure here
  // was every name stacking in the middle of the map, all on top of one
  // another, because they were placed with horizontal axes regardless.
  test('each line is named at its own head, without the names colliding', () => {
    for (const v of [VIEWS[0], VIEWS[2]]) {
      const rep = render(busy.metro, v);
      const names = rep.labels.filter((l) => (' ' + l.cls + ' ').indexOf(' metro-terminus ') >= 0);
      assert(names.length >= 2, v.name + ': expected a name per line, got ' + names.length);
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const o = overlap(names[i], names[j]);
          assert(!o || o.w <= 2 || o.h <= 2,
            v.name + ': line names "' + names[i].text + '" and "' + names[j].text + '" overlap');
        }
      }
    }
  });
};
