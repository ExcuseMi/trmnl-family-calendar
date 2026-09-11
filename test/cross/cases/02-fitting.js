'use strict';

// Fitting. A lane is an event that would otherwise be dropped, so the order
// things are given up in is the whole policy: slack between lanes goes
// first, then a lane off the greediest track, and only when nothing is left
// does the board fall back to packing.

module.exports = function (test, h) {
  const { solve, board, lanesOwnedBy, laneCount, assert, assertEqual } = h;

  test('a board with room to spare keeps every lane it asked for', () => {
    const b = board(['a:2'], ['b:2'], { depth: 1300, S: 2 });
    const out = solve(b);
    assertEqual(out.alloc, { a: 2, b: 2 }, 'a roomy board should grant the whole demand');
    assertEqual(lanesOwnedBy(out, 'a').length, 2);
    assertEqual(lanesOwnedBy(out, 'b').length, 2);
  });

  test('slack between lanes is spent before anybody loses one', () => {
    // Squeeze until it only just fits. The pitch should have come down and
    // the lane count should not have.
    const roomy = solve(board(['a:3'], ['b:3'], { depth: 1300, S: 2 }));
    const tight = solve(board(['a:3'], ['b:3'], { depth: 900, S: 2 }));
    assertEqual(tight.alloc, roomy.alloc, 'a lane was given up while there was still pitch to give');
    assert(tight.step < roomy.step, 'the pitch did not come down at all: ' + tight.step
      + ' against ' + roomy.step);
  });

  test('the greediest track loses a lane first', () => {
    // Squeezing a two-lane track down to one to make room for a neighbour
    // that only ever needed one is how a busy line ends up with six
    // meetings stacked in a single row.
    const b = board(['big:5', 'small:1'], [], { depth: 300 });
    const out = solve(b);
    assert(out.alloc.small === 1, 'the one-lane track was trimmed: ' + out.alloc.small);
    assert(out.alloc.big < 5, 'nothing was trimmed at all on a board this shallow');
  });

  test('a track with events is never trimmed to nothing', () => {
    // A track with no lane drops every event it has, which is worse than
    // any amount of crowding.
    for (const depth of [120, 160, 200, 240, 300, 400]) {
      const b = board(['a:3', 'b:2'], ['c:2', 'd:1'], { depth: depth });
      const out = solve(b);
      if (out.packed) continue;   // packed pools the rungs; ownership is not per track there
      for (const key of ['a', 'b', 'c', 'd']) {
        assert(out.alloc[key] >= 1, 'at depth ' + depth + ', ' + key + ' was left with '
          + out.alloc[key] + ' lanes and has events to place');
      }
    }
  });

  test('when bands cannot fit at their tightest, the board packs', () => {
    // Better a correct packed map than a beautiful one with a track
    // hanging off the bottom edge.
    const out = solve(board(['a:2|long', 'b:2|long', 'c:2'], ['d:2|long', 'e:2'], { depth: 401 }));
    assert(out.packed, 'five lines each wanting the gap beside them, on an 800x480 panel, should have packed');
    assert(out.fits, 'the packed board does not fit either: needA ' + Math.round(out.needA)
      + ' + needB ' + Math.round(out.needB) + ' against ' + Math.round(out.room));
  });

  test('asked for more than the canvas holds, it says so rather than pretending', () => {
    // Upstream, fitLines decides how many lines the board carries and drops
    // the quietest until each survivor has room for its line, its inward
    // and one lane. The solver is not given that power, so all it can do
    // about an impossible board is report it: a caller that ignored `fits`
    // would draw a track hanging off the edge.
    const out = solve(board(['a:2|long', 'b:2|long', 'c:2'], ['d:2|long', 'e:2'], { depth: 200 }));
    assert(!out.fits, 'five lines each wanting the gap beside them, on a 200px canvas, claimed to fit');
    assert(out.needA + out.needB > out.room, 'fits is false but the numbers say otherwise');
  });

  test('a packed board pools its rungs instead of owning them', () => {
    const out = solve(board(['a:2|long', 'b:2|long', 'c:2'], ['d:2|long', 'e:2'], { depth: 200 }));
    assert(out.packed, 'expected a packed board');
    for (const side of ['A', 'B'])
      for (const l of out.lanes[side]) assertEqual(l.owner, null, 'a packed rung claims an owner');
  });

  test('packing gives the next rung to the side that wants it more', () => {
    const out = solve(board(['a:6|long', 'b:6|long'], ['c:1|long'], { depth: 210 }));
    assert(out.packed, 'expected a packed board');
    assert(out.lanes.A.length >= out.lanes.B.length, 'the side wanting 12 rungs got '
      + out.lanes.A.length + ' and the side wanting 1 got ' + out.lanes.B.length);
  });

  test('a board that fits says so, and stays inside the canvas', () => {
    for (const depth of [200, 300, 500, 900, 1400]) {
      const out = solve(board(['a:2', 'b:1|long'], ['c:3'], { depth: depth }));
      if (!out.fits) continue;
      assert(out.needA + out.needB <= out.room + 0.001, 'at depth ' + depth
        + ' it claims to fit but needs ' + Math.round(out.needA + out.needB) + ' of ' + Math.round(out.room));
    }
  });

  test('the spine leaves each side the room it said it needed', () => {
    for (const depth of [240, 400, 700, 1400]) {
      const out = solve(board(['a:2', 'b:2'], ['c:1'], { depth: depth }));
      if (!out.fits) continue;
      assert(out.spineC >= 0 && out.spineC <= depth, 'the spine at ' + Math.round(out.spineC)
        + ' is off a ' + depth + 'px canvas');
      // side A reaches inward from the spine and side B outward from it,
      // so both have to land on the canvas
      assert(out.spineC - out.needA >= -0.001, 'at depth ' + depth + ' side A needs '
        + Math.round(out.needA) + ' above a spine at ' + Math.round(out.spineC));
      assert(out.spineC + out.needB <= depth + 0.001, 'at depth ' + depth + ' side B needs '
        + Math.round(out.needB) + ' below a spine at ' + Math.round(out.spineC));
    }
  });
};
