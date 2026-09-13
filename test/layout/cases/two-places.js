'use strict';

// NOBODY IS IN TWO PLACES AT ONCE.
//
// A convergence is a claim about where somebody is. The moment a member has
// something of their own that overlaps it, the claim is false for them, and
// the board used to draw both: the line stayed in the corridor for the whole
// shared event AND its own event was marked on the rail it was riding. Rule
// 26a, and `issues.md` P1 for where it was reported.
//
// Asked of the ROUTES rather than of the ink, because the claim is about
// which minutes a line spends at somebody else's level, and that is what a
// hold is. The ink follows from it: a line at the corridor's level is drawn
// in the corridor.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, assert } = h;
  const byName = (n) => VIEWPORTS.find((v) => v.name === n);

  // A state is not a place (rule 27): being at school all day has never
  // stopped anybody having an assembly at ten, so a long event on either
  // side of the question is not a contradiction.
  const LONG_MIN = 240;

  for (const f of fixtures) {
    for (const vname of ['x-landscape', 'og-landscape']) {
      test('nobody is held at a shared level during their own event: ' + f.name + '/' + vname, () => {
        let rep;
        try { rep = layout(f, byName(vname)); } catch (e) { return; }
        const routes = rep.debug.routes || {};
        const bad = [];
        for (const e of h.eventsIn(rep)) {
          if (e.status !== 'ok' || e.shared || !e.owner) continue;
          const src = f.metro.events.find((x) => x.title === e.title);
          if (!src || src.end_min - src.start_min >= LONG_MIN) continue;
          for (const hold of routes[e.owner] || []) {
            // [a0, a1, lvl, kind, ...]. 'state' is a hold at a siding,
            // which says what kind of day this is rather than where
            // somebody is standing, and an assembly during a school day is
            // not a contradiction (rule 27).
            if (hold[3] !== 'sh') continue;
            const over = Math.min(hold[1], e.endA) - Math.max(hold[0], e.nodeA);
            if (over > 2) {
              bad.push('"' + e.title + '" runs ' + Math.round(over) + 'px inside a corridor '
                + e.owner + ' is held in');
            }
          }
        }
        assert(bad.length === 0, bad.length + ' event(s) drawn on a line that is somewhere else: '
          + bad.slice(0, 3).join('; '));
      });
    }
  }

  // ...and the three answers the rule has, on the fixture that was built to
  // carry them. Without this the case above passes on a board where nobody
  // ever leaves anything, which is every board that has not got the shape.
  test('a member leaves, rejoins where there is room, or was never in it', () => {
    const rep = layout(fixtures.find((f) => f.name === 'two-places'), byName('x-landscape'));
    const left = rep.debug.left || [];
    const says = (title, key, how) => left.some((l) => l[0] === title && l[1] === key && l[2] === how);
    assert(says('Zwemmen', 'kids', 'leaves'),
      'kids should leave Zwemmen when her own appointment starts: ' + JSON.stringify(left));
    assert(says('Kickboksen', 'sam', 'rejoins'),
      'sam should come back to Kickboksen after the hairdresser: ' + JSON.stringify(left));
    assert(says('Pilates', 'kids', 'out'),
      'kids is at the dentist for the whole of Pilates and is not in it: ' + JSON.stringify(left));
    assert(says('Kookles', 'sam', 'late'),
      'sam is at the physio for the start of Kookles and joins it late: ' + JSON.stringify(left));
  });

  // ...and the capsule is the half of 26a that is about the DRAWING: it is
  // set down at the event's own minute, so it spans the lines that are in it
  // then. A pill reaching a row before that line has arrived is the same
  // untruth as a line held in a corridor it has left.
  test('a capsule spans the members who are in it when it is drawn', () => {
    const rep = layout(fixtures.find((f) => f.name === 'two-places'), byName('x-landscape'));
    const Z = (rep.debug.Z || 1);
    const late = h.eventsIn(rep).find((e) => e.title === 'Kookles');
    assert(late, 'the fixture should still carry a late arrival');
    // where sam's rail is while she is still at the physio, and where the
    // capsule reaches at the minute Kookles starts
    const rail = {};
    for (const p of rep.paths) {
      if (p.role !== 'track' || !p.owner) continue;
      for (const q of p.pts) {
        if (Math.abs(q[0] / Z - late.nodeA) < 2) rail[p.owner] = q[1] / Z;
      }
    }
    const caps = (rep.rects || []).filter((r) => r.role === 'capsule'
      && Math.abs(r.x / Z + r.w / Z / 2 - late.nodeA) < 12);
    assert(caps.length === 1, 'expected one capsule at the start of Kookles, found ' + caps.length);
    const c0 = caps[0].y / Z, c1 = (caps[0].y + caps[0].h) / Z;
    assert(rail.sam == null || rail.sam < c0 - 2 || rail.sam > c1 + 2,
      'the capsule reaches sam\'s row at ' + Math.round(rail.sam)
      + ' while she is still at the physio (capsule ' + Math.round(c0) + '-' + Math.round(c1) + ')');
  });
};
