'use strict';

// The answer's shape, and the things that would be nonsense whatever the
// board is. Everything here holds for every input the solver accepts.

module.exports = function (test, h) {
  const { solve, board, allTracks, lanesOwnedBy, assert, assertEqual } = h;

  test('a board comes back with a place for every track', () => {
    const b = board(['work:2', 'alex:1'], ['sam:1', 'kids:3']);
    const out = solve(b);
    for (const t of allTracks(b)) {
      assert(typeof out.dist[t.key] === 'number' && isFinite(out.dist[t.key]),
        t.key + ' got no distance: ' + out.dist[t.key]);
      assert(out.dist[t.key] > 0, t.key + ' sits on the spine itself at ' + out.dist[t.key]);
    }
  });

  test('tracks are ordered outward in the order they were given', () => {
    // The side is a chain: the caller has already decided who is innermost,
    // and the solver may not reorder it. A board that reordered here would
    // put an interchange tie across a line it does not touch.
    const b = board(['a:1', 'b:1', 'c:1'], ['d:1', 'e:1']);
    const out = solve(b);
    for (const side of ['A', 'B']) {
      const ds = b.sides[side].map((t) => out.dist[t.key]);
      for (let i = 1; i < ds.length; i++) {
        assert(ds[i] > ds[i - 1], side + ': ' + b.sides[side][i].key + ' at ' + ds[i]
          + ' is not outside ' + b.sides[side][i - 1].key + ' at ' + ds[i - 1]);
      }
    }
  });

  test('every lane rung sits on the side of its own line that it says it does', () => {
    // A lane is where a label hangs off its own track, and a track hangs
    // them on BOTH sides of its line (A15): the gap between two lines is
    // where the outer one's inward labels belong. So the claim is not that
    // every rung is outward, it is that `side` and the geometry agree --
    // an outward rung past the line, an inward one between the line and
    // whatever is inside it, and never a rung that claims one and draws
    // the other.
    const b = board(['work:3'], ['kids:2|long']);
    const out = solve(b);
    for (const side of ['A', 'B']) {
      for (const l of out.lanes[side]) {
        if (!l.owner) continue;
        const inward = l.side === -1;
        assert(inward ? l.dist < out.dist[l.owner] : l.dist > out.dist[l.owner],
          'a rung for ' + l.owner + ' at ' + l.dist + ' says side ' + l.side
          + ' and its own line is at ' + out.dist[l.owner]);
      }
    }
  });

  test('a rung is never handed to a track on the other side', () => {
    const b = board(['a:2'], ['b:2']);
    const out = solve(b);
    const keysA = new Set(b.sides.A.map((t) => t.key));
    for (const l of out.lanes.A) if (l.owner) assert(keysA.has(l.owner), 'side A rung owned by ' + l.owner);
    const keysB = new Set(b.sides.B.map((t) => t.key));
    for (const l of out.lanes.B) if (l.owner) assert(keysB.has(l.owner), 'side B rung owned by ' + l.owner);
  });

  test('an empty board does not throw and asks for nothing', () => {
    const out = solve(board([], []));
    assertEqual(out.lanes.A, []);
    assertEqual(out.lanes.B, []);
    assert(out.fits, 'a board with no lines does not fit its own canvas');
  });

  test('a track with no events gets no rungs, and still gets a place', () => {
    const b = board(['a:0', 'b:2'], []);
    const out = solve(b);
    assertEqual(lanesOwnedBy(out, 'a').length, 0, 'a track with no events took a lane');
    assert(out.dist.a > 0 && out.dist.b > out.dist.a, 'the empty track lost its place in the order');
  });

  test('the same board twice gives the same answer', () => {
    // It is called several times per render, once per text tier, and a
    // solver that drifted would make the tier ladder compare boards that
    // differ for no reason.
    const spec = () => board(['w:3', 'a:1|long'], ['s:2', 'k:4']);
    assertEqual(solve(spec()), solve(spec()));
  });
};
