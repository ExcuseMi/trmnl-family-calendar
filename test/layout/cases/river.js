'use strict';

// THE RIVER IS THE ONE THING ON THIS BOARD THAT MEANS NOTHING.
//
// It is scenery: a piece of geography under the map so the panel reads as a
// place rather than a chart. Which makes it the only element here whose
// contract is almost entirely negative -- it may not say anything, so most
// of the rules about it are rules about what it must not disturb.
//
// It runs TOP TO BOTTOM, across the grain of a board whose every rail runs
// left to right. That is the whole reason it is not mistaken for a sixth
// line: nothing else on this map descends, so nothing else can be confused
// with the thing that does. It follows that it must cross baselines, and
// the question is never whether but where -- so the solver reads what the
// captions and rails already claimed and picks the time column that crosses
// fewest things.
//
// Crossing a rail is fine and is not masked. See
// `feedback/research/mini-metro.png`: lines run over the water there and
// read perfectly, because water is a wash and a rail is ink. Crossing a
// WORD is not fine, at any z-order, because grey behind letterforms is a
// smudge -- so text is the one thing the walk may never enter.
//
// The river is also allowed NOT TO EXIST. A crowded day has no descent, and
// no river beats a river squeezed through the two free cells of a busy
// Tuesday. Every case here is conditional on there being one; none demand
// it.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, pathsWhere, assert, assertEqual } = h;

  const ROOMY = VIEWPORTS.find((v) => v.name === 'x-landscape');
  const oneBit = {
    name: 'x-1bit', w: 1872, h: 1404,
    classes: 'screen--v2 screen--lg screen--1bit screen--density-2x',
  };

  function river(rep) { return pathsWhere(rep, 'landmark-river')[0] || null; }
  // Every piece of scenery, whatever kind: the water, its shore, a lake, a
  // range. They share one contract, so they are tested as one set.
  function scenery(rep) {
    return rep.paths.filter((p) => /^landmark/.test(p.role || ''));
  }

  // ---- 1. it never runs under a word ----------------------------------

  for (const f of fixtures) {
    test('no scenery runs under a caption: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      for (const g of scenery(rep)) {       // nothing today is also an answer
        const half = g.width / 2;
        for (const box of rep.labels) {
          for (const [x, y] of g.pts) {
            const hit = x >= box.x - half && x <= box.x + box.w + half
              && y >= box.y - half && y <= box.y + box.h + half;
            assert(!hit, g.role + ' runs under "' + box.text + '" at '
              + JSON.stringify([Math.round(x), Math.round(y)])
              + '. Grey behind letterforms is a smudge whatever the z-order '
              + 'says, so text is solid to the solver -- something is missing '
              + 'from the occupancy map.');
          }
        }
      }
    });
  }

  for (const f of fixtures) {
    test('a lake or a range sits on paper, never on a rail: ' + f.name, () => {
      // The river is allowed to cross a baseline -- that is the point of
      // running top to bottom. Nothing else is: a lake over a rail has no
      // excuse and reads as a printing fault.
      const rep = layout(f, ROOMY);
      const still = scenery(rep).filter((g) => !/river|shore/.test(g.role));
      if (!still.length) return;
      const rails = rep.paths.filter((p) => p.role === 'track');
      for (const g of still) {
        const half = g.width / 2;
        for (const [x, y] of g.pts) {
          for (const p of rails) {
            for (const [rx, ry] of p.pts) {
              assert(Math.hypot(rx - x, ry - y) > half + p.width / 2,
                g.role + ' overlaps a rail at '
                + JSON.stringify([Math.round(x), Math.round(y)]));
            }
          }
        }
      }
    });
  }

  // ---- 2. it descends, and only descends ------------------------------

  for (const f of fixtures) {
    test('the river runs down the board, never along it: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const r = river(rep);
      if (!r) return;
      // Octilinear by construction: every step is straight down or a 45
      // degree shift, so no sample may ever be further sideways than it is
      // down. A horizontal run would read as a sixth line.
      for (let i = 1; i < r.pts.length; i++) {
        const dx = Math.abs(r.pts[i][0] - r.pts[i - 1][0]);
        const dy = Math.abs(r.pts[i][1] - r.pts[i - 1][1]);
        assert(dx <= dy + 1.5,
          'the river runs sideways at ' + JSON.stringify(r.pts[i].map(Math.round))
          + ' (' + dx.toFixed(1) + 'px across for ' + dy.toFixed(1) + 'px down). '
          + 'It is octilinear and top-down: 45 degrees is the flattest it gets.');
      }
    });
  }

  for (const f of fixtures) {
    test('the river reaches both edges of the map: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const r = river(rep);
      if (!r) return;
      // A river with two visible ends is a shape, not a river: the eye goes
      // to the severed end instead of past it.
      // Measured against the RAILS, not against the canvas: the hour scale
      // owns the top of the panel and is not map, so "reaches the top" can
      // only mean "is already there before the first baseline".
      const ys = r.pts.map((p) => p[1]);
      const rails = rep.paths.filter((p) => p.role === 'track');
      if (!rails.length) return;
      const first = Math.min(...rails.map((p) => Math.min(...p.pts.map((q) => q[1]))));
      const last = Math.max(...rails.map((p) => Math.max(...p.pts.map((q) => q[1]))));
      assert(Math.min(...ys) < first,
        f.name + ': the river starts below the topmost rail ('
        + Math.round(Math.min(...ys)) + ' against ' + Math.round(first)
        + '), so it has a visible source instead of running off the map');
      assert(Math.max(...ys) > last,
        f.name + ': the river stops above the lowest rail ('
        + Math.round(Math.max(...ys)) + ' against ' + Math.round(last)
        + '), so it has a visible mouth instead of running off the map');
    });
  }

  // ---- 3. it sits under everything ------------------------------------

  for (const f of fixtures) {
    test('the scenery is the first thing drawn: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const land = scenery(rep);
      if (!land.length) return;
      // Not "it was drawn carefully" -- "it is at the bottom of the stack".
      // Every piece of scenery comes before every piece of map, with no map
      // interleaved: one unbroken run at the foot of the document.
      const roles = rep.paths.map((p) => /^landmark/.test(p.role || ''));
      assertEqual(roles.slice(0, land.length).every(Boolean), true,
        f.name + ': something is painted beneath the scenery');
      assertEqual(roles.slice(land.length).some(Boolean), false,
        f.name + ': a piece of scenery is painted on top of the map');
    });
  }

  // ---- 4. it needs greys to exist -------------------------------------

  test('a one-bit panel gets no scenery at all', () => {
    // The river is a thirteen percent wash. One bit has no thirteen percent:
    // it would come out as solid ink, which on this board is a sixth line.
    for (const f of fixtures) {
      assertEqual(scenery(layout(f, oneBit)).length, 0,
        f.name + ': a 1-bit panel drew scenery, and 1-bit has no wash to draw it in');
    }
  });

  // ---- 5. the same day draws the same water ---------------------------

  test('the river is seeded from the date, not from chance', () => {
    const f = fixtures.find((x) => x.name === 'busy-day') || fixtures[0];
    const a = river(layout(f, ROOMY));
    const b = river(layout(f, { ...ROOMY, name: ROOMY.name + '-again' }));
    assertEqual(b && b.pts.map((p) => p.map(Math.round)),
      a && a.pts.map((p) => p.map(Math.round)),
      'two renders of one day drew two different rivers');
  });
};
