'use strict';

// Bands. The whole point of giving each track its own stretch of the cross
// axis is that a branch can never reach across a neighbour, so it can never
// cross one. That is a property of the numbers, and this is where it is
// checked: if two bands overlap, the drawing cannot be right however
// carefully the rest of the file draws it.

module.exports = function (test, h) {
  const { solve, board, assert } = h;

  test('one track\'s band never reaches into the next one\'s', () => {
    for (const b of [
      board(['a:1', 'b:1', 'c:1'], ['d:1']),
      board(['a:3', 'b:1'], ['c:2', 'd:2']),
      board(['a:2|siding', 'b:2'], ['c:1|siding']),
      board(['a:1'], ['b:1', 'c:1', 'd:1', 'e:1']),
    ]) {
      const out = solve(b);
      if (out.packed) continue;   // packed shares one ladder on purpose
      for (const side of ['A', 'B']) {
        const ts = b.sides[side];
        for (let i = 1; i < ts.length; i++) {
          assert(out.bandEnd[ts[i - 1].key] <= out.dist[ts[i].key] + 0.001,
            side + ': ' + ts[i - 1].key + '\'s band ends at ' + out.bandEnd[ts[i - 1].key]
            + ' but ' + ts[i].key + ' starts at ' + out.dist[ts[i].key]);
        }
      }
    }
  });

  test('a track\'s rungs all lie inside its own band', () => {
    const b = board(['a:3', 'b:2'], ['c:2|siding', 'd:1']);
    const out = solve(b);
    if (out.packed) return;
    for (const side of ['A', 'B']) {
      for (const l of out.lanes[side]) {
        if (!l.owner) continue;
        assert(l.dist >= out.dist[l.owner] && l.dist <= out.bandEnd[l.owner] + 0.001,
          'a rung for ' + l.owner + ' at ' + l.dist + ' is outside its band ['
          + out.dist[l.owner] + ', ' + out.bandEnd[l.owner] + ']');
      }
    }
  });

  test('rungs climb outward at the solved pitch', () => {
    const b = board(['a:4'], []);
    const out = solve(b);
    const mine = out.lanes.A.filter((l) => l.owner === 'a').map((l) => l.dist);
    for (let i = 1; i < mine.length; i++) {
      assert(Math.abs((mine[i] - mine[i - 1]) - out.step) < 0.001,
        'rung ' + i + ' is ' + (mine[i] - mine[i - 1]) + 'px past the last, not the solved step '
        + out.step);
    }
  });

  test('a track carrying a siding is given the room its kink needs', () => {
    // The line leaves its baseline by a full raise for the length of the
    // siding. A first lane placed as if it had not would be drawn straight
    // through the kink.
    const plain = solve(board(['a:1'], []));
    const kinked = solve(board(['a:1|siding'], []));
    const gapPlain = plain.lanes.A[0].dist - plain.dist.a;
    const gapKinked = kinked.lanes.A[0].dist - kinked.dist.a;
    assert(gapKinked - gapPlain >= 30, 'a siding bought only ' + Math.round(gapKinked - gapPlain)
      + 'px of extra room, and the kink alone is a 32px raise plus its clearance');
  });

  test('the innermost line on each side sits half a pitch off the spine', () => {
    // With no gutter in the middle the two innermost lines would sit a
    // double pitch apart, which reads as a missing line rather than as the
    // middle of the map.
    const b = board(['a:1', 'b:1'], ['c:1']);
    const out = solve(b);
    if (out.packed) return;
    const first = out.dist.a;
    const secondGap = out.dist.b - out.dist.a;
    assert(secondGap > first * 1.5, 'the first line is ' + first + ' off the spine and the next '
      + secondGap + ' beyond it: the innermost gap should be about half the pitch');
  });
};
