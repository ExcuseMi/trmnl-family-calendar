'use strict';

// LEAVING AN INTERCHANGE IS THE ONE PLACE LINES ARE GUARANTEED TO BE TOUCHING.
//
// Everywhere else on the board a line has a band to itself. At a shared event
// they are deliberately in one place, and then they all have to get back to
// their own baselines at once. Dropped on a single shared column that reads as
// ONE line with a gap in it, and the reader has no way to tell which of the
// people at that table is which afterwards.
//
// So every rail leaving a capsule gets its own column, they are spaced far
// enough apart to read as separate stems, and each turns on its own filleted
// elbow rather than merging into its neighbour's drop. Which channel a line
// takes is chronological: the one needed somewhere else soonest leaves first,
// so the fan reads left to right like a departure board.
//
// This case measures the columns. What the columns are FOR -- telling the
// lines apart once they have separated -- is the tone and texture work in
// cases/bitdepth.js.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, assert } = h;

  const ROOMY = VIEWPORTS.find((v) => v.name === 'x-landscape');
  const PITCH = 8;          // the mandated minimum, in layout px

  // Every near-vertical run a line draws, by owner: the stems are what a rail
  // leaves an interchange on, and a stem is the only thing on this board that
  // descends far without moving sideways.
  function stemsByOwner(rep, S) {
    const out = {};
    for (const p of rep.paths) {
      if (!p.owner || p.role === 'landmark') continue;
      for (let i = 1; i < p.pts.length; i++) {
        const [x0, y0] = p.pts[i - 1], [x1, y1] = p.pts[i];
        if (Math.abs(x1 - x0) < 2 * S && Math.abs(y1 - y0) > 20 * S) {
          (out[p.owner] = out[p.owner] || []).push(Math.round(x0));
        }
      }
    }
    return out;
  }

  for (const f of fixtures) {
    test('no two lines drop on the same column: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const S = (rep.debug.S || 1) * (rep.debug.Z || 1);
      const byOwner = stemsByOwner(rep, S);
      const owners = Object.keys(byOwner);
      if (owners.length < 2) return;      // nothing converges on this board
      const bad = [];
      for (let i = 0; i < owners.length; i++) {
        for (let j = i + 1; j < owners.length; j++) {
          for (const a of new Set(byOwner[owners[i]])) {
            for (const b of new Set(byOwner[owners[j]])) {
              const gap = Math.abs(a - b);
              // Only stems that are actually neighbours: two lines dropping
              // at opposite ends of the day share no channel and owe each
              // other nothing.
              if (gap > 0 && gap < PITCH * S) {
                bad.push(owners[i] + '@' + a + ' and ' + owners[j] + '@' + b
                  + ' are ' + gap.toFixed(1) + 'px apart, under ' + (PITCH * S).toFixed(1));
              }
              if (gap === 0) {
                bad.push(owners[i] + ' and ' + owners[j] + ' both drop on x=' + a);
              }
            }
          }
        }
      }
      assert(bad.length === 0, bad.length + ' coincident or crowded drop(s): '
        + bad.slice(0, 4).join('; ')
        + '. Two rails on one column read as one line with a gap in it.');
    });
  }
};
