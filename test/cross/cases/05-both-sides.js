'use strict';

// A15: a track carries events on BOTH sides of its line.
// A17: a corridor gets a gap wide enough to run down.
//
// Both are about the same piece of board: the space BETWEEN two lines.
// Every lane used to sit outward of the line that owns it, so a line at
// the edge of the bundle had all its labels on one side and the gap
// between it and its neighbour went unused, while a bundle of rails
// dropped into that same gap without anything having reserved it.
//
// They are options rather than new behaviour, so the first thing checked
// is that a caller asking for neither gets exactly the board it got
// before. That is what lets them land ahead of the drawing that reads
// them.

module.exports = function (test, h) {
  const { solve, board, assert, assertEqual } = h;

  function both(b) { return Object.assign({}, b, { bothSides: true }); }
  function sideOf(out, key) {
    return out.lanes.A.concat(out.lanes.B).filter((l) => l.owner === key);
  }
  function inwardOf(out, key) { return sideOf(out, key).filter((l) => l.side === -1); }

  // A roomy board: several tracks a side, each wanting more than one lane,
  // on a deep panel, so there is a real gap between the lines to use.
  const ROOMY = () => board(['a:2', 'b:3', 'c:2'], ['d:2', 'e:3'], { depth: 900, S: 1 });

  test('asking for nothing changes nothing', () => {
    const b = ROOMY();
    const plain = solve(b);
    assert(plain.lanes.A.concat(plain.lanes.B).every((l) => l.side !== -1),
      'a rung landed inward on a board that never asked for one');
    // and the same board with the option on must still be a board
    const on = solve(both(b));
    assert(on.dist.a > 0 && on.dist.b > on.dist.a, 'the sides came out in the wrong order');
  });

  test('a track puts rungs in the gap between it and its neighbour', () => {
    const out = solve(both(ROOMY()));
    if (out.packed) return; // packing shares one ladder on purpose
    assert(inwardOf(out, 'b').length > 0,
      'b sits between two lines with room to spare and still hung everything on one side');
  });

  test('the innermost line may use its inward side, and pays by sitting further out', () => {
    // It used to be excluded, on the grounds that its inward neighbour is
    // the spine and the hour strip. That stopped being true when the hour
    // axis moved to the leading edge: what is between the middle and the
    // first line is empty canvas. And the busiest line on a side is always
    // the innermost one, so excluding it withheld the second side from the
    // line with the most to put on it.
    const b = both(ROOMY());
    const plain = solve(ROOMY()), out = solve(b);
    if (out.packed || plain.packed) return;
    assert(inwardOf(out, 'a').length > 0, 'the innermost line still hung everything on one side');
    assert(out.dist.a >= plain.dist.a - 0.001,
      'it moved TOWARD the middle to make room, which is the one direction there is nothing to take');
  });

  test('nothing an innermost line writes reaches across the middle', () => {
    // Distance is measured from the middle outward, so a label that runs
    // past zero is on the other side of the board, among somebody else's
    // lines.
    const b = both(ROOMY());
    const out = solve(b);
    if (out.packed) return;
    for (const [side, key] of [['A', 'a'], ['B', 'd']]) {
      const mine = out.lanes[side].filter((l) => l.owner === key && l.side === -1);
      if (!mine.length) continue;
      const reach = Math.min(...mine.map((l) => l.dist)) - b.k.lineGap - b.k.maxLabelThick;
      assert(reach >= -0.001, key + "'s inward label reaches to " + Math.round(reach) + ', past the middle');
    }
  });

  test('a track keeps at least one rung on the outward side', () => {
    const out = solve(both(ROOMY()));
    for (const key of ['b', 'c', 'e']) {
      const mine = sideOf(out, key);
      if (!mine.length) continue;
      assert(mine.some((l) => l.side !== -1), key + ' moved every one of its rungs inward');
    }
  });

  test('an inward rung and its label never reach into the band before it', () => {
    // The label hangs on the far side of a rung from its own line, so an
    // inward rung's words run toward the neighbour. This is the invariant
    // that makes the whole idea safe.
    const b = both(ROOMY());
    const out = solve(b);
    if (out.packed) return;
    for (const side of ['A', 'B']) {
      const ts = b.sides[side];
      for (let i = 0; i < ts.length; i++) {
        const mine = out.lanes[side].filter((l) => l.owner === ts[i].key && l.side === -1);
        if (!mine.length) continue;
        const nearest = Math.min(...mine.map((l) => l.dist));
        const reach = nearest - b.k.lineGap - b.k.maxLabelThick;
        // for the innermost line the thing before it is the middle itself
        const floor = i ? out.bandEnd[ts[i - 1].key] : 0;
        assert(reach >= floor - 0.001,
          ts[i].key + "'s inward label reaches to " + Math.round(reach)
          + ' but the band before it ends at ' + Math.round(floor));
      }
    }
  });

  test('using both sides never costs depth, and usually saves it', () => {
    // Measured at a FIXED pitch, on buildSide itself. Through solve() the
    // depth this frees is spent again immediately, on lane pitch and on
    // separating the tracks, which grows the other side: the saving is
    // real but invisible in the totals, because the solver's whole job is
    // to give the room back to the map.
    const k = board([], []).k;
    let saved = 0;
    for (const spec of [[['a', 2], ['b', 3], ['c', 2]], [['a', 1], ['b', 4]],
      [['a', 3], ['b', 3], ['c', 3]], [['a', 2], ['b', 1], ['c', 5]]]) {
      const tracks = spec.map(([key]) => ({ key: key, long: 0, needIn: 0 }));
      const lanes = (t) => spec.find(([key]) => key === t.key)[1];
      for (const sep of [0, 20, 60]) {
        const plain = h.buildSide(k, tracks, lanes, k.laneStep, sep, {});
        const on = h.buildSide(k, tracks, lanes, k.laneStep, sep, { bothSides: true });
        assert(on.extent <= plain.extent + 0.001,
          'sep ' + sep + ': the side got deeper, ' + Math.round(on.extent)
          + ' against ' + Math.round(plain.extent));
        assert(on.slots.length === plain.slots.length,
          'a rung went missing: ' + on.slots.length + ' against ' + plain.slots.length);
        if (on.extent < plain.extent - 0.001) saved++;
      }
    }
    assert(saved > 0, 'no side anywhere got shallower, so nothing was actually moved');
  });

  test('what it saves, the board spends on the map', () => {
    // The point of the depth it frees is not a shallower board, it is more
    // rungs: a rung is an event that would otherwise be dropped.
    const b = board(['a:3', 'b:3', 'c:3'], ['d:2', 'e:2'], { depth: 620 });
    const plain = solve(b), on = solve(both(b));
    const rungs = (o) => o.lanes.A.length + o.lanes.B.length;
    assert(rungs(on) >= rungs(plain),
      'both sides handed out fewer rungs: ' + rungs(on) + ' against ' + rungs(plain));
  });

  test('every rung asked for is still handed out', () => {
    // Moving a rung to the other side of a line must not lose it.
    const b = both(ROOMY());
    const out = solve(b);
    for (const key of Object.keys(b.demand)) {
      assert(sideOf(out, key).length <= b.demand[key],
        key + ' got more rungs than it asked for');
    }
    const total = out.lanes.A.length + out.lanes.B.length;
    const plain = solve(ROOMY());
    assert(total >= plain.lanes.A.length + plain.lanes.B.length,
      'using both sides handed out fewer rungs than using one');
  });

  test('the ladder is still innermost first, whichever side a rung hangs on', () => {
    // Everything downstream reads this as "nearest rung first", so an
    // inward rung has to take its place in that order rather than being
    // appended after its own line's outward ones.
    const out = solve(both(ROOMY()));
    for (const side of ['A', 'B']) {
      const ds = out.lanes[side].map((l) => l.dist);
      for (let i = 1; i < ds.length; i++) {
        assert(ds[i] >= ds[i - 1] - 0.001, side + ': rung ' + i + ' at ' + ds[i]
          + ' comes after ' + ds[i - 1]);
      }
    }
  });

  test('a track in a corridor keeps its rungs on one side', () => {
    // A corridor is planned after the lanes are handed out and its caption
    // is placed outside the lane grid, so it is the one thing a lane
    // cannot be checked against, and it sits in exactly the gap an inward
    // rung wants. On the demo board that put "Assembly", on an inward
    // rung, straight through "School Run", the caption of a bundle in the
    // same gap.
    const b = both(ROOMY());
    b.sides.A[1].shared = 2;         // b is in two shared events
    const out = solve(b);
    if (out.packed) return;
    assertEqual(inwardOf(out, 'b').length, 0, 'b is in a corridor and still hung rungs inward');
    assert(inwardOf(out, 'c').length > 0, 'c is in none and should still use both sides');
  });

  // ---- A17: a corridor's gap ------------------------------------------

  function withGap(b, a, bb, px) {
    return Object.assign({}, b, { gaps: [{ a: a, b: bb, px: px }] });
  }

  test('a corridor gets the gap it asked for', () => {
    const b = board(['a:1', 'b:1', 'c:1'], ['d:1'], { depth: 900 });
    const plain = solve(b);
    if (plain.packed) return;
    const want = (plain.dist.b - plain.dist.a) + 60;
    const out = solve(withGap(b, 'a', 'b', want));
    if (out.packed) return;
    assert(out.dist.b - out.dist.a >= want - 0.001,
      'asked for ' + Math.round(want) + 'px between a and b, got '
      + Math.round(out.dist.b - out.dist.a));
  });

  test('a gap is asked for by name, in either order', () => {
    const b = board(['a:1', 'b:1'], ['c:1'], { depth: 900 });
    const want = (solve(b).dist.b - solve(b).dist.a) + 40;
    const fwd = solve(withGap(b, 'a', 'b', want));
    const rev = solve(withGap(b, 'b', 'a', want));
    if (fwd.packed || rev.packed) return;
    assertEqual(Math.round(fwd.dist.b - fwd.dist.a), Math.round(rev.dist.b - rev.dist.a));
  });

  test('a gap between lines that are not neighbours is not invented', () => {
    // Only adjacent tracks have a gap between them to widen. A request
    // naming a pair with a line in between has nowhere to put the room,
    // and must not silently push the whole side out.
    const b = board(['a:1', 'b:1', 'c:1'], ['d:1'], { depth: 900 });
    const plain = solve(b);
    const far = solve(withGap(b, 'a', 'c', 400));
    if (plain.packed) return;
    assertEqual(Math.round(far.extentA), Math.round(plain.extentA), 'a to c is not a neighbouring pair');
  });

  test('the two innermost lines are neighbours across the middle', () => {
    // They are adjacent on the board even though they are on opposite
    // sides, and the gap between them is the one place a same-side rule
    // cannot reach: each stands half a pitch off the spine, so the pair is
    // closer together than any other pair on the board. Two lines
    // exchanging places there (the weave) need it widened, and the only lever is
    // how far each side holds its first line off the middle.
    const b = board(['a:1', 'b:1'], ['c:1', 'd:1'], { depth: 900 });
    const plain = solve(b);
    const wide = solve(withGap(b, 'a', 'c', 200));
    if (plain.packed || wide.packed) return;
    assert(plain.dist.a + plain.dist.c < 200, 'the fixture is not tight enough to be testing anything');
    assert(wide.dist.a + wide.dist.c >= 200 - 0.001,
      'asked for 200px across the middle, got ' + Math.round(wide.dist.a + wide.dist.c));
    // and it is shared out, not taken from one side
    assert(Math.abs(wide.dist.a - wide.dist.c) < 0.001, 'one side paid for all of it');
  });

  test('a gap nobody can afford does not break the board', () => {
    // The solver still has to answer, and every line still has to be
    // somewhere, in order, on a board this deep.
    const b = board(['a:2', 'b:2', 'c:2'], ['d:2'], { depth: 300 });
    const out = solve(withGap(b, 'a', 'b', 5000));
    assert(out.dist.a > 0 && out.dist.b > out.dist.a && out.dist.c > out.dist.b,
      'the lines came out of order or on top of each other');
    assert(isFinite(out.needA) && isFinite(out.needB), 'the solve produced nothing usable');
  });

  test('the widest request between one pair wins', () => {
    const b = board(['a:1', 'b:1'], ['c:1'], { depth: 900 });
    const base = solve(b).dist.b - solve(b).dist.a;
    const out = solve(Object.assign({}, b, { gaps: [
      { a: 'a', b: 'b', px: base + 30 },
      { a: 'b', b: 'a', px: base + 90 },
      { a: 'a', b: 'b', px: base + 10 },
    ] }));
    if (out.packed) return;
    assert(out.dist.b - out.dist.a >= base + 90 - 0.001,
      'took a narrower request than the widest one on the pair');
  });
};
