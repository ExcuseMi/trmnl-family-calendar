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
    // Halves and quadrants are SLOTS inside a whole screen. Asked for as a
    // smaller window they rendered the whole board and cropped it, so every
    // case below has been measuring a full-size board under a small view's
    // name. `slot` gives the view the box a mashup would.
    { view: 'full', name: 'x-half-vertical', w: 1872, h: 1404, slot: { w: 936, h: 1404 }, classes: 'screen--v2 screen--lg screen--4bit screen--density-2x' },
    { view: 'full', name: 'og-half-vertical', w: 800, h: 480, slot: { w: 400, h: 480 }, classes: 'screen--og screen--md screen--1bit screen--density-1x' },
    { view: 'full', name: 'og-quadrant', w: 800, h: 480, slot: { w: 400, h: 240 }, classes: 'screen--og screen--md screen--1bit screen--density-1x' },
    // the shortest board there is: five lines' worth of labels do not fit in
    // 240px of height, so this is where the layout has to CUT rather than
    // overflow. It went uncovered, and overflowed.
    { view: 'full', name: 'og-half-horizontal', w: 800, h: 480, slot: { w: 800, h: 240 }, classes: 'screen--og screen--md screen--1bit screen--density-1x' },
  ];

  const busy = fixtures.find((f) => f.name === 'busy-day');

  // A vertical layout has to actually be vertical. The giveaway when the
  // orientation logic half-applies is a track that runs the wrong way.
  test('a tall canvas lays the tracks out along its long side', () => {
    const rep = render(busy.metro, VIEWS[0]);
    assert(rep.debug.horizontal === false, 'a 1404x1872 canvas chose the horizontal layout');
    // The COURSE, not the drawn runs: the ink is cut wherever a line passes
    // under something, so one run of it can legitimately be a short sideways
    // jog -- and a fillet that collapsed to a point is a run of zero length
    // with no orientation at all, which `spanY > spanX` reads as a track
    // laid out the wrong way round. Where the line GOES is the question.
    for (const t of pathsWhere(rep, 'course')) {
      if (t.len < 1) continue;
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
      const lines = pathsWhere(rep, 'track').concat(pathsWhere(rep, 'branch'), pathsWhere(rep, 'fork'));
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

  // A name sits ABOVE its line when the lines are far enough apart to hold
  // it, and ON its line — masked by its own paper outline — when they are
  // not. The room it needs is not just its own height: it sits between two
  // rails, so it has to clear the one above as well. Measured a side at a
  // time that neighbour was invisible, because each side's innermost track
  // sits half a pitch off the spine and those two are neighbours with
  // nothing between them: "Marge" was set hard against the bottom of
  // Homer's rail and read as underlining it.
  // Only lying down: stood up the names run ALONG their lines in a column
  // at the head of the map, where this cannot happen.
  const FLAT = [
    { view: 'full', name: 'x-landscape', w: 1872, h: 1404, classes: 'screen--v2 screen--lg screen--4bit screen--density-2x' },
    { view: 'full', name: 'og-landscape', w: 800, h: 480, classes: 'screen--og screen--md screen--1bit screen--density-1x' },
    VIEWS.find((v) => v.name === 'og-half-horizontal'),
  ];
  const five = fixtures.find((f) => f.name === 'five-lines');
  test('a line name never lands on somebody else\'s rail', () => {
    for (const f of [busy, five]) for (const v of FLAT) {
      const rep = render(f.metro, v);
      const owns = {};
      for (const t of f.metro.legend) owns[t.name] = t.key;
      const names = rep.labels.filter((l) => (' ' + l.cls + ' ').indexOf(' metro-terminus ') >= 0);
      const bad = [];
      for (const n of names) {
        for (const p of pathsWhere(rep, 'track')) {
          if (owns[n.text] === p.owner) continue;   // its own line, by design
          const d = deepestIntrusion(p.pts, n);
          if (d > 2) bad.push('"' + n.text + '" on ' + p.owner + "'s rail by " + Math.round(d) + 'px');
        }
      }
      assert(bad.length === 0, f.name + '/' + v.name + ': ' + bad.length + ' name(s) on the wrong rail: '
        + [...new Set(bad)].slice(0, 4).join('; '));
    }
  });

  // The bar at the head of a line is the mark that says the line starts
  // here, and the name says whose line it is. Two statements about the same
  // point: they may sit beside each other, never on top of each other.
  //
  // Measured as clear air between the boxes, not as overlap. Overlap never
  // happened and never would: a label carries its own padding, so the bar
  // landed in the padding rather than on the glyph and a non-overlap
  // assertion passed on the broken drawing as happily as on the fixed one.
  // What was actually wrong was the SIZE of the gap. The terminal bar is
  // drawn with a round cap, so it reaches half a stroke past the radius it
  // nominally spans; measured as if it stopped there, every name on every
  // board sat exactly 3.6px from its bar and the first letter read as
  // struck through ("Crew" as "|Crew"). With the cap accounted for the same
  // boards draw 7.2 to 9.9px. The threshold sits between the two, near
  // enough to the old value to catch the regression and far enough from the
  // new one not to be brittle.
  test('a line name keeps clear of its own terminal bar', () => {
    for (const f of [busy, five, fixtures.find((x) => x.name === 'seven-lines')]) {
      for (const v of FLAT.concat([VIEWS[0]])) {
        const rep = render(f.metro, v);
        const names = rep.labels.filter((l) => (' ' + l.cls + ' ').indexOf(' metro-terminus ') >= 0);
        const bars = (rep.rects || []).filter((r) => r.role === 'terminal');
        assert(bars.length > 0, v.name + ': no terminal bars drawn at all');
        // debug reports layout px; the drawn report is screen px, which the
        // framework zooms by Z on a high-density panel
        const need = 3 * (rep.debug.S || 1) * (rep.debug.Z || 1);
        const bad = [];
        for (const n of names) {
          let nearest = Infinity;
          for (const b of bars) {
            const dx = Math.max(b.x - (n.x + n.w), n.x - (b.x + b.w));
            const dy = Math.max(b.y - (n.y + n.h), n.y - (b.y + b.h));
            nearest = Math.min(nearest, Math.max(dx, dy));
          }
          if (nearest < need) {
            bad.push('"' + n.text + '" is ' + nearest.toFixed(1) + 'px from a terminal bar, under '
              + need.toFixed(1));
          }
        }
        assert(bad.length === 0, f.name + '/' + v.name + ': ' + bad.join('; '));
      }
    }
  });
};
