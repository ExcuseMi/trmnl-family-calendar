'use strict';

// A rail that stops in open space.
//
// Reported off a screenshot as "floating track in the middle": a stretch of
// Amy's line drawn across the board with nothing at either end of it. It
// was the express half of a siding whose siding was never drawn. A solo
// station is a loop (the main line carries straight on, the station leaves
// it and comes back), and the express is the straight half; where that
// station was nested inside a corridor its own line was already in,
// stationRaiseAt gave the whole overlap to the corridor, no loop was drawn,
// and the express was left lying on a baseline the line had left.
//
// Nothing in the suite noticed, because every other property held: the
// segment was the right colour, the right weight, on the canvas, out of
// everybody's text, and no marker claimed to be on it. It was simply a line
// that was not true, and the only thing wrong with it was that it went
// nowhere.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, pathsWhere, pointIn, inflate, assert } = h;

  const byName = (n) => VIEWPORTS.find((v) => v.name === n);

  // A rail may end where it meets another rail, under a mark that caps it
  // (a terminus bar, a stop tick, a ring), or at the edge of the board,
  // which is where the full-bleed spine ends.
  //
  // 8px: an end that is meant to meet another line is placed by the same
  // arithmetic that drew it, so the two agree to a rounding error, but both
  // are SAMPLED every 2px and a corner is drawn rounded, so the nearest
  // sample can be a couple of px along the fillet. The defect this catches
  // missed by a full station raise (32px at 1x, 64px on an X).
  const NEAR = 8;
  const EDGE = 6;

  function endsOf(p) { return [p.pts[0], p.pts[p.pts.length - 1]]; }
  function dist(a, b) { return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1])); }

  for (const f of fixtures) {
    for (const vname of ['x-landscape', 'og-landscape']) {
      test('no rail ends in mid-air: ' + f.name + '/' + vname, () => {
        const rep = layout(f, byName(vname));
        const rails = pathsWhere(rep, 'track')
          .concat(pathsWhere(rep, 'branch'), pathsWhere(rep, 'fork'));
        // everything drawn that can legitimately cap a rail
        const marks = rep.circles.concat(rep.rects);
        const bad = [];
        for (const p of rails) {
          if (p.len < 1) continue;   // a fillet that collapsed to a point caps nothing and needs nothing
          for (const end of endsOf(p)) {
            if (end[0] <= EDGE || end[0] >= rep.canvas.w - EDGE) continue;
            if (end[1] <= EDGE || end[1] >= rep.canvas.h - EDGE) continue;
            let met = false;
            for (const q of rails) {
              if (q === p) continue;
              for (const pt of q.pts) if (dist(pt, end) <= NEAR) { met = true; break; }
              if (met) break;
            }
            if (met) continue;
            if (marks.some((m) => pointIn(end, inflate(m, NEAR)))) continue;
            bad.push(p.role + '/' + p.owner + ' ends at ' + Math.round(end[0]) + ','
              + Math.round(end[1]) + ' (' + Math.round(p.len) + 'px long) touching nothing');
          }
        }
        assert(bad.length === 0, bad.length + ' loose rail end(s): ' + bad.slice(0, 6).join('; '));
      });
    }
  }
};
