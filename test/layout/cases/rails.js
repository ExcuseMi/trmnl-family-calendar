'use strict';

// A spur's job is to say when. Its length used to be set by how wide the
// label was, so it drew a line through time the event does not occupy — and
// then the label, being the longest thing, decided how long the event
// looked. The rail now runs from the event's start to its end, the ticks
// mark both, and the label is free to overhang.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, pathsWhere, eventsIn, assert } = h;

  const ROOMY = VIEWPORTS.find((v) => v.name === 'x-landscape');

  // Axis px per minute in the BUSY stretch. The scale is not linear: the
  // quiet ends of the day are compressed to a fifth so the whole day can be
  // on the board at all, so the width over the window is the average of a
  // fast stretch and a slow one, and it understates the scale the events
  // are actually drawn at by about a third: an honest 90-minute rail read
  // as a rail a third too long.
  //
  // Measured off the hour labels, which are drawn at their real positions:
  // the widest gap per minute between two of them is the full-rate scale.
  function scale(rep) {
    const hours = rep.labels
      .filter((l) => (' ' + l.cls + ' ').indexOf(' metro-hour ') >= 0 && /^\d{1,2}:\d{2}/.test(l.text))
      .map((l) => {
        const [hh, mm] = l.text.split(':').map(Number);
        return { clock: hh * 60 + mm, x: l.x + l.w / 2 };
      })
      .sort((a, b) => a.x - b.x);
    let best = 0;
    for (let i = 1; i < hours.length; i++) {
      let mins = hours[i].clock - hours[i - 1].clock;
      if (mins <= 0) mins += 1440;                        // past a midnight
      best = Math.max(best, (hours[i].x - hours[i - 1].x) / mins);
    }
    if (best > 0) return best;
    const [from, to] = rep.debug.win;
    return rep.canvas.w / (to - from);
  }

  // AN EVENT IS AS LONG AS IT IS, NOT AS LONG AS ITS NAME.
  //
  // The defect this guards is a real one and it has happened: a rail drawn
  // to fit its caption rather than its hours, so a fifteen-minute stand-up
  // occupied an hour of board and the reader had no way to know it had not.
  //
  // It used to look for that on a flat SPUR -- a rail out in a lane with the
  // line branching to it and back. There are none left to look at: on every
  // fixture in the suite, at every size, the count of `branch` paths is
  // zero. An event is drawn ON its line now (`_onLine`), or as a
  // convergence, and the lane holds only the words. The case was asserting
  // against a shape the board had stopped drawing, so it failed on boards
  // with nothing wrong with them.
  //
  // The guarantee survives the shape change, so it is asked of what is
  // actually drawn: the stretch of line an event claims, from its node to
  // its end, against the minutes it really lasts. Its caption may be any
  // length at all and must not move either end.
  test('an event claims as much line as it lasts, not as much as its label', () => {
    for (const name of ['busy-day', 'long-event-day', 'crew-day']) {
      const f = fixtures.find((x) => x.name === name);
      const rep = layout(f, ROOMY);
      const pxPerMin = scale(rep);
      const byTitle = {};
      f.metro.events.forEach((e) => { byTitle[e.title] = e; });

      let checked = 0;
      for (const e of eventsIn(rep).filter((x) => x.status === 'ok')) {
        const src = byTitle[e.title];
        if (!src || src.end_min == null) continue;
        const drawn = Math.abs(e.endA - e.nodeA);
        const want = (src.end_min - src.start_min) * pxPerMin;
        // A moment has no length to check, and a corner radius is the
        // tolerance: an event's ends are rounded, not mitred.
        if (want < 4) continue;
        assert(drawn <= want + 16, name + ': "' + e.title + '" lasts '
          + (src.end_min - src.start_min) + 'min (' + Math.round(want)
          + 'px) but claims ' + Math.round(drawn) + 'px of line'
          + (e.textLen ? ', with a ' + Math.round(e.textLen) + 'px caption' : ''));
        checked++;
      }
      assert(checked > 0, name + ': no event with a real duration was laid out');
    }
  });

  test('every event is marked at its start, and its end is either ticked or rejoined', () => {
    const f = fixtures.find((x) => x.name === 'busy-day');
    const rep = layout(f, ROOMY);
    const placed = eventsIn(rep).filter((e) => e.status === 'ok');
    // interchanges are marked with rings on each line they join, not ticks
    const interchange = new Set(f.metro.events
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
    // The START's own mark is a hollow DOT, not a tick. A tick is a bar
    // drawn across the line and the start of a rail is usually a bend, so
    // one there read as the line overshooting its own rail. Events after
    // the first in a group ride a rail that is already lying flat and have
    // no ramp of their own, so the dot is the only thing marking them:
    // counting ticks and ramp corners alone, "Client Workshop" read as an
    // event nothing pointed at while its dot was sitting on its own minute.
    const dots = rep.circles.filter((c) => c.role === 'stop-start');
    const unmarked = placed.filter((e) => {
      const a = e.nodeA * Z;
      if (ticks.some((t) => Math.abs(t.x + t.w / 2 - a) < 8)) return false;
      if (dots.some((d) => Math.abs(d.x + d.w / 2 - a) < 8)) return false;
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
      f.metro.events.forEach((i) => { spec[i.title] = i; });
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

  // A LONG SOLO EVENT NEVER LEAVES ITS LINE, SO IT NEVER COMES BACK.
  //
  // This used to assert the opposite: that a five-hour block loops out to a
  // lane and rejoins. It does not, and cannot. `runTooLongForAShelf` makes
  // any solo event of four hours or more `_onLine` -- drawn along its own
  // line with a leader back from the caption, no rail and no lane -- and the
  // rejoin gate needs four hours too (`MIN_REJOIN_MIN`, the same 240). An
  // event long enough to rejoin is by then long enough to have never left.
  // Measured: zero rejoins across all fourteen fixtures at both sizes.
  //
  // So the guarantee worth holding is the one the board actually offers --
  // the block stays ON the line, which is what lets its hours be read off
  // the line's own length. The dead branch is issues.md E17.
  test('a long solo event stays on its line rather than looping out to a lane', () => {
    const f = fixtures.find((x) => x.name === 'quiet-day');
    const rep = layout(f, ROOMY);
    const laid = eventsIn(rep).find((e) => e.title === 'Rehearsal Day');
    assert(laid, 'the five-hour block was not laid out at all');
    assert(laid.mark, 'the five-hour block took a lane instead of its own line');
    assert(!laid.merged, 'it rejoined, which means it left, which it should not have');
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
      // A STUB is a piece of rail with nothing before it: the lane spine
      // started a corner radius early so an arriving diagonal would have
      // flat line to land on, and with nothing arriving it poked out past
      // the corner into minutes before the event began.
      //
      // Where the lane already carries the rail of an EARLIER event on the
      // same line, what sits before the drop is that rail, not a stub:
      // "Client Workshop" was flagged for Quick Sync's rail, which ends 20
      // minutes and 20px before it. The two are the same length and in the
      // same place, so the drawing cannot tell them apart. The DATA can.
      // Every event's rail runs from where it leaves the trunk to its own
      // end (or a corner past its elbow, whichever is further), so a lane
      // mate whose rail reaches into the window owns the line there.
      const all = eventsIn(rep).filter((o) => o.status === 'ok');
      const corner = rep.debug.corner || 0;
      const laneMateRail = (e, from, to) => all.some((o) => {
        if (o === e || o.sign !== e.sign || Math.abs(o.laneDist - e.laneDist) > 1) return false;
        const lo = Math.min(o.diagFrom, o.elbow) * Z;
        const hi = Math.max(o.endA, o.elbow + corner) * Z;
        return hi > from - 1 && lo < to + 1;
      });
      const bad = [];
      for (const e of drops) {
        const laneY = (rep.debug.spineC + e.sign * e.laneDist) * Z;
        // Only the corner's own width before the drop, at that lane's own
        // height. The artefact this guards against is a stub of exactly one
        // corner radius attached to the drop; widen the window much past
        // that and it starts flagging the tail of the PREVIOUS event's rail
        // in the same lane, which is simply two rails near each other.
        const from = (e.elbow - 12) * Z, to = (e.elbow * Z) - 3;
        if (laneMateRail(e, from, to)) continue;
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
        // A mark's rail is the stretch of its own line between its start
        // dot and its end tick; there is no elbow to measure from. The
        // words belong over that run or near either end of it.
        // A convergence is measured against its pill for the same reason a
        // mark is measured against its run: neither has an elbow to be
        // beside, and both name a stretch of board rather than a rail.
        const drift = (e.mark || e.shared)
          ? (e.textStart > e.endA ? e.textStart - e.endA
             : e.textStart + e.textLen < e.nodeA ? e.nodeA - (e.textStart + e.textLen) : 0)
          : Math.abs(e.textStart - (e.dir > 0 ? e.elbow : e.elbow - e.textLen));
        if (drift > e.textLen) bad.push('"' + e.title + '" is ' + Math.round(drift)
          + 'px from its rail (label is ' + Math.round(e.textLen) + 'px wide)');
      }
      assert(bad.length === 0, bad.length + ' label(s) adrift from their rail: '
        + bad.slice(0, 4).join('; '));
    });
  }
};
