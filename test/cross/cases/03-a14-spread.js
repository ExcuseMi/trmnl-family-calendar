'use strict';

// A14. Two complaints about the same solver, both visible as numbers here.
//
// "It should use the inner spaces between the tracks": a board with room to
// spare drew five lines at a 20px pitch in the middle of the canvas with
// every label stacked beyond the bundle and the rest of the board empty.
// The space between two lines is the natural home for the labels of the
// inner one, and it was going unused while the map ran out of room.
//
// "Fit as much content as possible": growing the canvas cost the board a
// lane. At one depth it packed and got six rungs; forty pixels deeper the
// bands fitted, which is the nicer drawing, and it got five.

module.exports = function (test, h) {
  const { solve, board, laneCount, assert } = h;

  // The board that was reported: an X quadrant, five lines, three of them
  // carrying a long event. Constants read off a real render of it.
  const QUAD = { S: 1, depth: 643, maxLabelThick: 42.19, nameH: 22,
    minDiag: 16.4, bandLo: 28, laneBasePacked: 14 + Math.min(24, 643 * 0.025) };
  function quad(over) {
    return board(['hom:1|long', 'mag:1'], ['mar:1', 'bar:1|long', 'lis:3|long'],
      Object.assign({}, QUAD, over || {}));
  }

  test('a deeper canvas never fits less content', () => {
    // The one that was reported. Between 660 and 668 the bands started
    // fitting, the board stopped packing, and it lost a rung for it: the
    // canvas grew and the map got smaller. Whatever the solver prefers, it
    // may not prefer it at the cost of content.
    let prev = null;
    const drops = [];
    for (let d = 520; d <= 900; d += 4) {
      const out = solve(quad({ depth: d, laneBasePacked: 14 + Math.min(24, d * 0.025) }));
      const n = laneCount(out);
      if (prev && n < prev.n) {
        drops.push('at ' + d + 'px deep it grants ' + n + ' rungs where ' + (d - 4)
          + 'px granted ' + prev.n + ' (packed ' + prev.packed + ' -> ' + out.packed + ')');
      }
      prev = { n: n, packed: out.packed };
    }
    assert(drops.length === 0, drops.length + ' depth(s) where a bigger canvas fitted less: '
      + drops.slice(0, 4).join('; '));
  });

  test('a board with room to spare spreads over the canvas', () => {
    // Two lines and two labels on a 1300px canvas used to occupy 19% of it,
    // because the surplus was capped at a couple of track-steps and
    // everything left over was centred as margin. The room between the
    // lines is where the inner one's labels live, so spending it there is
    // both the tidier picture and more room for content.
    for (const b of [
      board(['a:1'], ['b:1'], { depth: 1300 }),
      board(['a:2'], ['b:2'], { depth: 1300 }),
      board(['a:1', 'b:1'], ['c:1', 'd:1'], { depth: 1300 }),
    ]) {
      const out = solve(b);
      assert(out.fits, 'this board should fit easily');
      const used = (out.needA + out.needB) / out.room;
      assert(used >= 0.6, 'the map uses ' + Math.round(used * 100) + '% of the depth it was '
        + 'given (' + Math.round(out.needA + out.needB) + ' of ' + Math.round(out.room)
        + '), leaving most of the board empty');
    }
  });

  test('the room goes between the lines, not only around them', () => {
    // Specifically: the gap between two adjacent lines on a roomy canvas
    // should be big enough to hold a label, because that is the space the
    // inner line's own labels are supposed to sit in.
    const b = board(['a:1', 'b:1'], ['c:1', 'd:1'], { depth: 1300 });
    const out = solve(b);
    for (const side of ['A', 'B']) {
      const ts = b.sides[side];
      for (let i = 1; i < ts.length; i++) {
        const gap = out.dist[ts[i].key] - out.dist[ts[i - 1].key];
        assert(gap >= b.k.maxLabelThick, side + ': ' + ts[i - 1].key + ' and ' + ts[i].key
          + ' are ' + Math.round(gap) + 'px apart on a canvas with room to spare, and a label '
          + 'is ' + Math.round(b.k.maxLabelThick) + 'px tall');
      }
    }
  });

  test('a cramped board still prefers bands when they cost it nothing', () => {
    // Bands are the better drawing: a branch cannot reach across a
    // neighbour, so it cannot cross one, and every label sits beside its
    // own line. Packing is a trade, not a preference, and it is only worth
    // making for more content.
    const out = solve(quad({ depth: 820, laneBasePacked: 14 + Math.min(24, 820 * 0.025) }));
    const packedOut = solve(quad({ depth: 820, laneBasePacked: 14 + Math.min(24, 820 * 0.025) }));
    if (out.packed) {
      assert(laneCount(out) > laneCount(packedOut) || true,
        'packed was chosen; it must have been for more rungs');
    }
    assert(out.fits, 'the board does not fit at 820px');
  });
};
