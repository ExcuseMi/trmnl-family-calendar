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
  // The rule this case enforces is the unambiguous half: no two lines may be
  // assigned the SAME column. The 8px pitch is a separate question and a
  // softer one -- two lines that happen to turn seven pixels apart at
  // opposite ends of the board are not a fan-out and owe each other nothing,
  // so policing it globally flags pairs that were never related. What cannot
  // be argued with is two rails turning on one x: that is one line with a
  // gap in it, whatever else is true.
  const SAME = 3;           // layout px: closer than this is the same column

  // Two boards still reuse a column, and both were invisible until this case
  // learned to measure runs instead of adjacent samples. Neither is the run
  // home: they are morning convergences, where the lines involved have more
  // of the day to come, so the stagger that was fixed for the last hold does
  // not reach them. See issues.md E15.
  const KNOWN = {
    'five-lines': 'bar and lis turn 1px apart leaving the school run: E15',
    'crew-day': 'amy and fry share a column leaving the delivery: E15',
  };

  // Every near-vertical RUN a line draws, by owner.
  //
  // Accumulated over consecutive samples, not read off adjacent pairs. The
  // harness samples a path every 2px, so no two neighbouring points are ever
  // more than about 2px apart in y -- asking for a single step that descends
  // 36px finds nothing at all, on any board, and the case passes by having
  // nothing to look at. It did exactly that while four lines were leaving
  // Family Dinner on one shared column.
  function stemsByOwner(rep, S) {
    const out = {};
    for (const p of rep.paths) {
      if (!p.owner || /^landmark/.test(p.role || '')) continue;
      let i = 0;
      while (i < p.pts.length) {
        const x0 = p.pts[i][0];
        let j = i;
        while (j + 1 < p.pts.length && Math.abs(p.pts[j + 1][0] - x0) < 2 * S) j++;
        const span = Math.abs(p.pts[j][1] - p.pts[i][1]);
        if (j > i && span > 20 * S) (out[p.owner] = out[p.owner] || []).push(Math.round(x0));
        i = j > i ? j : i + 1;
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
              if (gap < SAME * S) {
                bad.push(owners[i] + ' and ' + owners[j] + ' both turn at x='
                  + a + (gap ? ' and ' + b : '')
                  + (gap ? ' (' + gap.toFixed(1) + 'px apart)' : ''));
              }
            }
          }
        }
      }
      assert(bad.length === 0, bad.length + ' shared drop column(s): '
        + bad.slice(0, 4).join('; ')
        + '. Two rails on one column read as one line with a gap in it.');
    }, KNOWN[f.name] && { known: KNOWN[f.name] });
  }
};
