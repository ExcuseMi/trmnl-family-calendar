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

  test("a long event's name gets the gap beside its own line", () => {
    // A long event is drawn ON the line, so it has no branch running out to
    // a lane and its name has to sit against the line itself. Outward is
    // where that line's branches already write, so it goes inward, into the
    // gap between this line and whatever is inside it -- and the gap has to
    // widen to hold it, which is the whole claim. It used to be the room a
    // 32px kink needed, back when a long block moved the line instead.
    // On a board with lines either side of it, so the widening is the
    // thing being measured. Alone on a roomy canvas the line does not have
    // to move at all: the gap beside it was already a caption deep, and the
    // rung simply goes there.
    const plain = solve(board(['a:1', 'b:1'], ['c:1']));
    const long = solve(board(['a:1|long', 'b:1'], ['c:1']));
    const inward = long.lanes.A.filter((l) => l.side === -1 && l.owner === 'a');
    assert(inward.length === 1, 'a long event got ' + inward.length + ' rungs inward, not one');
    assert(inward[0].dist < long.dist.a, 'the rung is meant to be between the line and the spine');
    assert(long.dist.a - plain.dist.a >= 30, 'the line moved out only '
      + Math.round(long.dist.a - plain.dist.a) + 'px, which is not a caption');
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
