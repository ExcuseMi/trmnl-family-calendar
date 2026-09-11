'use strict';

// The same invariants, over boards nobody wrote down.
//
// The solver has to survive whatever the day contains: a family of seven
// where six of them are on one side, a single line with thirty overlapping
// meetings, a quadrant with less depth than one label is tall. Those boards
// are tedious to build as fixtures and instant to generate, and the model
// is pure, so a few thousand of them cost less than one render.
//
// Seeded, so a failure names a board that can be replayed rather than one
// that happened once in CI.

module.exports = function (test, h) {
  const { solve, board, laneCount, assert } = h;

  // xorshift: same sequence every run, and every case reports its seed
  function rng(seed) {
    let x = seed || 1;
    return function () {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x |= 0;
      return ((x >>> 0) % 100000) / 100000;
    };
  }

  function randomBoard(seed) {
    const r = rng(seed);
    const S = r() < 0.5 ? 1 : 2;
    const depth = Math.round(120 + r() * 1300);
    const n = 1 + Math.floor(r() * 7);
    const A = [], B = [];
    for (let i = 0; i < n; i++) {
      const spec = 't' + i + ':' + Math.floor(r() * 5) + (r() < 0.3 ? '|long' : '');
      (r() < 0.5 ? A : B).push(spec);
    }
    return board(A, B, { S: S, depth: depth, maxLabelThick: Math.round((20 + r() * 40) * S) });
  }

  const SEEDS = [];
  for (let i = 1; i <= 400; i++) SEEDS.push(i * 7919);

  test('any board at all comes back with a usable answer', () => {
    for (const seed of SEEDS) {
      const b = randomBoard(seed);
      let out;
      try { out = solve(b); } catch (e) { throw new Error('seed ' + seed + ' threw: ' + e.message); }
      for (const t of b.sides.A.concat(b.sides.B)) {
        const d = out.dist[t.key];
        assert(typeof d === 'number' && isFinite(d) && d > 0,
          'seed ' + seed + ': ' + t.key + ' got ' + d);
      }
      assert(isFinite(out.spineC) && isFinite(out.step) && isFinite(out.sep),
        'seed ' + seed + ': spine ' + out.spineC + ' step ' + out.step + ' sep ' + out.sep);
      assert(out.step > 0, 'seed ' + seed + ': a lane pitch of ' + out.step);
    }
  });

  test('bands never overlap, on any board', () => {
    for (const seed of SEEDS) {
      const b = randomBoard(seed);
      const out = solve(b);
      if (out.packed) continue;
      for (const side of ['A', 'B']) {
        const ts = b.sides[side];
        for (let i = 1; i < ts.length; i++) {
          assert(out.bandEnd[ts[i - 1].key] <= out.dist[ts[i].key] + 0.001,
            'seed ' + seed + ' ' + side + ': ' + ts[i - 1].key + ' ends at '
            + Math.round(out.bandEnd[ts[i - 1].key]) + ', ' + ts[i].key + ' starts at '
            + Math.round(out.dist[ts[i].key]));
        }
      }
    }
  });

  test('a rung always sits where it says it does, on any board', () => {
    // Outward past its own line, or inward between that line and whatever
    // is inside it, and never one while claiming the other.
    for (const seed of SEEDS) {
      const b = randomBoard(seed);
      const out = solve(b);
      for (const side of ['A', 'B']) {
        for (const l of out.lanes[side]) {
          if (!l.owner) continue;
          const inward = l.side === -1;
          assert(inward ? l.dist < out.dist[l.owner] : l.dist > out.dist[l.owner],
            'seed ' + seed + ': rung for ' + l.owner + ' at ' + Math.round(l.dist)
            + ' says side ' + l.side + ' and its line is at ' + Math.round(out.dist[l.owner]));
        }
      }
    }
  });

  test('a deeper canvas never fits less, on any board', () => {
    // The A14 property, over boards nobody chose. Same board, two depths:
    // the deeper one may not grant fewer rungs.
    for (const seed of SEEDS.slice(0, 120)) {
      const b = randomBoard(seed);
      let prev = null;
      for (let extra = 0; extra <= 600; extra += 50) {
        const deeper = Object.assign({}, b, { k: Object.assign({}, b.k, { depth: b.k.depth + extra }) });
        const n = laneCount(solve(deeper));
        if (prev !== null) {
          assert(n >= prev.n, 'seed ' + seed + ': at ' + (b.k.depth + extra) + 'px it grants '
            + n + ' rungs, where ' + (b.k.depth + prev.extra) + 'px granted ' + prev.n);
        }
        prev = { n: n, extra: extra };
      }
    }
  });

  test('a board that says it fits really does, on any board', () => {
    for (const seed of SEEDS) {
      const b = randomBoard(seed);
      const out = solve(b);
      if (!out.fits) continue;
      assert(out.needA + out.needB <= out.room + 0.001, 'seed ' + seed + ': claims to fit but '
        + 'needs ' + Math.round(out.needA + out.needB) + ' of ' + Math.round(out.room));
      assert(out.spineC - out.needA >= -0.001 && out.spineC + out.needB <= b.k.depth + 0.001,
        'seed ' + seed + ': the spine at ' + Math.round(out.spineC) + ' puts side A ('
        + Math.round(out.needA) + ') or side B (' + Math.round(out.needB) + ') off a '
        + b.k.depth + 'px canvas');
    }
  });

  test('never more rungs than were asked for', () => {
    // A rung nobody wants is a gap in the middle of the map.
    for (const seed of SEEDS) {
      const b = randomBoard(seed);
      const out = solve(b);
      const want = Object.keys(b.demand).reduce((n, key) => n + b.demand[key], 0);
      assert(laneCount(out) <= want, 'seed ' + seed + ': granted ' + laneCount(out)
        + ' rungs for a demand of ' + want);
    }
  });
};
