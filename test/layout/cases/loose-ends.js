'use strict';

// A rail that stops in open space.
//
// Reported off a screenshot as "floating track in the middle": a stretch of
// Amy's line drawn across the board with nothing at either end of it. A
// long event used to be drawn as a loop, the main line carrying straight
// on at the baseline while the block left it and came back, and this was
// the straight half. Where the block was nested inside a corridor its own
// line was already in, the whole overlap went to the corridor, no loop was
// drawn, and that straight half was left lying on a baseline the line had
// left.
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
  // missed by the whole depth a long block used to be lifted out by (32px
  // at 1x, 64px on an X).
  const NEAR = 8;
  const EDGE = 6;

  function endsOf(p) { return [p.pts[0], p.pts[p.pts.length - 1]]; }
  function dist(a, b) { return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1])); }

  // A TUNNEL MOUTH is not a loose end. A rail crossing a line it does not
  // belong to is broken for it. That is how the map says "passes under",
  // and it needs no extra drawing, because the gap simply shows the line
  // underneath. So a rail drawn in several pieces has ends in open space
  // BY DESIGN, and this case, written before rails tunnelled, read every
  // one of them as a rail that went nowhere.
  //
  // What makes a mouth a mouth, and keeps this from waving through the
  // defect it was written for: the SAME rail resumes on the other side,
  // with the line it passes under lying between the two mouths. A rail
  // that simply stops has no continuation to find, whatever is near it.
  //
  // The hole is the crossed line's own width plus air, so the two mouths
  // are at most that far apart; measured generously here (a whole label
  // gap either side) because the exact figure is the drawing's business
  // and the load-bearing half of this test is the line in between.
  function tunnelMouth(end, p, rails) {
    for (const q of rails) {
      if (q === p || q.owner !== p.owner || q.len < 1) continue;
      for (const f of endsOf(q)) {
        const gap = dist(end, f);
        // A TUNNEL GAP IS AS WIDE AS THE CROSSING IS SHALLOW. It used to be
        // a fixed clearance, so sixty pixels covered every case; now it is
        // set by how fast the two lines close, and a trunk cutting across
        // another at a narrow angle stays within a stroke of it for a long
        // way. The midpoint test below is what makes this safe -- somebody
        // else's line has to actually be in the gap -- so the bound only
        // has to rule out two unrelated ends happening to face each other.
        if (gap < 0.5 || gap > 200) continue;
        // TWO ENDS OF ONE LINE FACING EACH OTHER IS A TUNNEL, and that is
        // the whole of it. This used to insist on finding the line being
        // passed under, in the middle of the gap -- which is right until
        // BOTH lines are off their baselines near the same place, when each
        // may be cut a little way from the other and neither has ink at the
        // other's midpoint. A trunk is only ever drawn in pieces because it
        // dives under something, so a piece that continues on the far side
        // of a gap is the evidence.
        if (p.role === 'track' && q.role === 'track') return true;
        const mid = [(end[0] + f[0]) / 2, (end[1] + f[1]) / 2];
        for (const t of rails) {
          if (t.owner === p.owner) continue;       // the line it passes under is somebody else's
          for (const pt of t.pts) if (dist(pt, mid) <= gap / 2 + 1) return true;
        }
      }
    }
    return false;
  }

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
            if (tunnelMouth(end, p, rails)) continue;
            bad.push(p.role + '/' + p.owner + ' ends at ' + Math.round(end[0]) + ','
              + Math.round(end[1]) + ' (' + Math.round(p.len) + 'px long) touching nothing');
          }
        }
        assert(bad.length === 0, bad.length + ' loose rail end(s): ' + bad.slice(0, 6).join('; '));
      });
    }
  }
};
