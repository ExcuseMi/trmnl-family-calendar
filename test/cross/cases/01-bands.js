'use strict';

// Bands. The whole point of giving each track its own stretch of the cross
// axis is that a branch can never reach across a neighbour, so it can never
// cross one. That is a property of the numbers, and this is where it is
// checked: if two bands overlap, the drawing cannot be right however
// carefully the rest of the file draws it.

module.exports = function (test, h) {
  const { solve, board, consts, assert } = h;

  test('one track\'s band never reaches into the next one\'s', () => {
    for (const b of [
      board(['a:1', 'b:1', 'c:1'], ['d:1']),
      board(['a:3', 'b:1'], ['c:2', 'd:2']),
      board(['a:2|long', 'b:2'], ['c:1|long']),
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
    const b = board(['a:3', 'b:2'], ['c:2|long', 'd:1']);
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

  test('an event on the line gets the gap beside its own line', () => {
    // An event drawn ON the line has no branch running out to a lane, so
    // its name has to sit against the line itself, in the gap between this
    // line and whatever is inside it -- and the gap has to be wide enough
    // to hold a name, which is the whole claim.
    //
    // It used to be asked for as a RUNG, and only by events over four
    // hours. Both of those are gone: an event on the line is an event on
    // the line whatever its length, and what it needs is a gap rather than
    // a place on the ladder. A rung costs three times as much and buys the
    // clearance for a ring that is never drawn.
    const k = consts();
    const plain = solve(board(['a:1', 'b:1'], ['c:1']));
    const onLine = solve(board(['a:1|mark', 'b:1'], ['c:1']));
    assert(onLine.lanes.A.filter((l) => l.side === -1 && l.owner === 'a').length === 0,
      'an event on the line took a rung on the ladder, which it has no rail to reach');
    assert(onLine.dist.a >= k.maxLabelThick + k.lineGap,
      'the gap beside the line is ' + Math.round(onLine.dist.a)
      + 'px, which will not hold a ' + k.maxLabelThick + 'px name');
    assert(onLine.dist.a > plain.dist.a,
      'the line did not move out at all to make room for its own name');
  });

  test('a track the drawing found pierced is given the same gap', () => {
    // The other way into the inward side, and the one no arithmetic on
    // sizes could ever reach: Marge has one lane, south of her line, and at
    // four in the afternoon two trunks lean up across it on their way to
    // dinner. shared.liquid draws the board, counts the labels with
    // somebody else's line through them, and asks again with this set.
    const plain = solve(board(['a:2'], []));
    const asked = solve(board(['a:2|needin'], []));
    const inward = asked.lanes.A.filter((l) => l.side === -1 && l.owner === 'a');
    assert(inward.length >= 1, 'a track that asked for its inward side got no rung there');
    assert(asked.dist.a >= plain.dist.a, 'the gap it writes in has to be paid for');
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
