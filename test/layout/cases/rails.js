'use strict';

// A spur's job is to say when. Its length used to be set by how wide the
// label was, so it drew a line through time the event does not occupy — and
// then the label, being the longest thing, decided how long the event
// looked. The rail now runs from the event's start to its end, the ticks
// mark both, and the label is free to overhang.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, pathsWhere, eventsIn, assert } = h;

  const ROOMY = VIEWPORTS.find((v) => v.name === 'x-landscape');

  // axis px per minute in the BUSY stretch — the quiet ends run compressed,
  // so the whole-day average would understate the scale events are drawn at
  function scale(rep) {
    const [from, to] = rep.debug.busy || rep.debug.win;
    return rep.canvas.w / (to - from);
  }

  test('a rail is as long as its event, not as long as its label', () => {
    const f = fixtures.find((x) => x.name === 'busy-day');
    const rep = layout(f, ROOMY);
    const pxPerMin = scale(rep);
    const byTitle = {};
    f.metro.items.filter((i) => i.type === 'event').forEach((e) => { byTitle[e.title] = e; });

    // the flat run of each branch, in axis px
    const flats = pathsWhere(rep, 'branch').map((p) => {
      const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1]);
      return { len: Math.max.apply(null, xs) - Math.min.apply(null, xs),
               flat: Math.max.apply(null, ys) - Math.min.apply(null, ys) < 2 };
    }).filter((r) => r.flat && r.len > 1);

    assert(flats.length > 0, 'no flat spur runs found at all');

    // The longest event in the fixture is 90 minutes; nothing should draw a
    // flat rail dramatically longer than the longest event, which is what a
    // label-length rail did.
    const longestMin = Math.max.apply(null, f.metro.items
      .filter((i) => i.type === 'event').map((e) => e.end_min - e.start_min));
    const budget = (longestMin + 30) * pxPerMin;
    const over = flats.filter((r) => r.len > budget);
    assert(over.length === 0,
      over.length + ' rail(s) longer than the longest event (' + longestMin
      + 'min): ' + over.map((r) => Math.round(r.len) + 'px').join(', ')
      + ' vs a budget of ' + Math.round(budget) + 'px');
  });

  test('every event is marked at its start, and its end is either ticked or rejoined', () => {
    const f = fixtures.find((x) => x.name === 'busy-day');
    const rep = layout(f, ROOMY);
    const placed = eventsIn(rep).filter((e) => e.status === 'ok');
    // interchanges are marked with rings on each line they join, not ticks
    const interchange = new Set(f.metro.items
      .filter((i) => i.type === 'event' && (i.co_owners || []).length).map((i) => i.title));
    const solo = placed.filter((e) => !interchange.has(e.title));
    const ticks = rep.circles.filter((c) => c.role === 'stop');

    assert(solo.length > 0, 'fixture has no single-track events');
    // Every end is marked. A start is marked too, but not always by a tick:
    // where the event's own ramp arrives at its start minute, the corner is
    // the mark, and a tick drawn on top of it read as the line overshooting
    // its rail. So the count to assert is the ends — one per event — plus
    // however many starts sit on rail an earlier event brought down.
    assert(ticks.length >= solo.length - 2,
      'expected about one tick per event for their ends, found ' + ticks.length
      + ' for ' + solo.length + ' single-track events');
    // and every event must be reachable: no event may be left with neither a
    // tick nor a ramp corner at its start
    const Z = rep.debug.Z || 1;
    const corners = pathsWhere(rep, 'fork').map((r) => r.pts[r.pts.length - 1]).filter(Boolean);
    const unmarked = placed.filter((e) => {
      const a = e.nodeA * Z;
      if (ticks.some((t) => Math.abs(t.x + t.w / 2 - a) < 8)) return false;
      if (corners.some((c) => Math.abs(c[0] - a) < 40)) return false;
      return !interchange.has(e.title);
    });
    assert(unmarked.length === 0,
      unmarked.length + ' event(s) with neither a tick nor a ramp at their start: '
      + unmarked.map((e) => e.title).join(', '));
  });

  // Rejoins are the exception. A spur that dives to a lane and climbs back
  // reserves that lane across everything between, and on an hour-long
  // meeting the whole loop is over before it reads as one — it looked like
  // a wobble in the line rather than a departure and a return. A shared
  // event never rejoins at all: its spur hangs off the OUTERMOST line of
  // several, so the climb back is the longest on the board and lands on a
  // line the event does not belong to on its own.
  const MIN_REJOIN_MIN = 240;

  for (const f of fixtures) {
    test('only a long solo event rejoins its line: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const spec = {};
      f.metro.items.filter((i) => i.type === 'event').forEach((i) => { spec[i.title] = i; });
      const bad = [];
      for (const e of eventsIn(rep)) {
        if (!e.merged) continue;
        const item = spec[e.title];
        if (!item) continue;
        const mins = item.end_min - item.start_min;
        if ((item.co_owners || []).length) bad.push('"' + e.title + '" is shared across tracks');
        else if (mins < MIN_REJOIN_MIN) bad.push('"' + e.title + '" runs only ' + mins + 'min');
      }
      assert(bad.length === 0, bad.length + ' event(s) rejoined that should end on a terminus: ' + bad.join('; '));
    });
  }

  test('a long solo event still does rejoin — the rule is not "never"', () => {
    const f = fixtures.find((x) => x.name === 'quiet-day');
    const rep = layout(f, ROOMY);
    const merged = eventsIn(rep).filter((e) => e.merged).map((e) => e.title);
    assert(merged.indexOf('Rehearsal Day') >= 0,
      'the five-hour block should loop back to its line, got rejoins on: '
      + (merged.join(', ') || 'nothing'));
  });

  // A spur that drops straight down needs no run-up. The lane spine starts a
  // corner radius before the elbow so an arriving diagonal has flat line to
  // land on; with nothing arriving from the left that stretch is a stub
  // poking out past the corner, and it sits at minutes before the event
  // began. Reported as "a bit sticking out the left of the track".
  for (const f of fixtures) {
    test('a straight-down branch starts at its corner, with nothing before it: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      // Forward branches only. A branch near the end of the axis runs
      // BACKWARD — its label sits before the drop and its rail runs back to
      // reach it — so line before the drop is the whole point there.
      const drops = eventsIn(rep).filter((e) => e.status === 'ok' && e.dir > 0 && e.diagFrom === e.elbow);
      if (!drops.length) { assert(true); return; }
      const lines = pathsWhere(rep, 'branch').concat(pathsWhere(rep, 'fork'));
      // the debug attribute reports layout px; the drawn report is in screen
      // px, which on a 2x-density panel the framework zooms by Z
      const Z = rep.debug.Z || 1;
      const bad = [];
      for (const e of drops) {
        const laneY = (rep.debug.spineC + e.sign * e.laneDist) * Z;
        // Only the corner's own width before the drop, at that lane's own
        // height. The artefact this guards against is a stub of exactly one
        // corner radius attached to the drop; widen the window much past
        // that and it starts flagging the tail of the PREVIOUS event's rail
        // in the same lane, which is simply two rails near each other.
        const from = (e.elbow - 12) * Z, to = (e.elbow * Z) - 3;
        for (const p of lines) {
          for (const pt of p.pts) {
            if (pt[0] >= from && pt[0] <= to && Math.abs(pt[1] - laneY) < 4) {
              bad.push('"' + e.title + '" has line at x' + Math.round(pt[0])
                + ', ' + Math.round(e.elbow * Z - pt[0]) + 'px before its drop');
            }
          }
        }
      }
      assert(bad.length === 0, bad.length + ' stub(s) before a straight-down drop: '
        + bad.slice(0, 3).join('; '));
    });
  }

  for (const f of fixtures) {
    test('every label sits by the rail it names: ' + f.name, () => {
      // A full lane slides labels along it rather than refusing them, and
      // the slides accumulate: on a line with five wide captions the last
      // one sat two hours right of its own branch, which reads as a caption
      // with no branch at all rather than as a caption that moved.
      const rep = layout(f, ROOMY);
      const bad = [];
      for (const e of eventsIn(rep)) {
        if (e.status !== 'ok') continue;
        const want = e.dir > 0 ? e.elbow : e.elbow - e.textLen;
        const drift = Math.abs(e.textStart - want);
        if (drift > e.textLen) bad.push('"' + e.title + '" is ' + Math.round(drift)
          + 'px from its rail (label is ' + Math.round(e.textLen) + 'px wide)');
      }
      assert(bad.length === 0, bad.length + ' label(s) adrift from their rail: '
        + bad.slice(0, 4).join('; '));
    });
  }
};
