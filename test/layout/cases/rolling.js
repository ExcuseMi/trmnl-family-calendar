'use strict';

// THE 36-HOUR BOARD, drawn.
//
// A day with almost nothing on it borrows the next one: the board runs from
// six in the morning to six the following evening, crossing one midnight,
// with each day named on the strip.
//
// Four things have to be true of that drawing, and each of them is a way it
// could be well formed and still be a lie: it may not happen on a day that
// is not quiet, the midnight it crosses has to be the only vertical mark in
// the night (the corridor that used to be there is gone -- see below), a
// line has to run THROUGH midnight rather than stop at it (a person does
// not end at midnight), and an event on the second day has to be drawn at
// the second day's time and not at the first day's.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, pathsWhere, textLabels, overlap, assert, assertEqual } = h;

  const byName = (n) => VIEWPORTS.find((v) => v.name === n);
  const ROOMY = byName('x-landscape');
  const roll = fixtures.find((f) => f.name === 'rolling-quiet');
  const busy = fixtures.find((f) => f.name === 'busy-day');

  const hasCls = (l, c) => (' ' + l.cls + ' ').indexOf(' ' + c + ' ') >= 0;
  // A DAYBREAK IS A MIDNIGHT THE BOARD CROSSES. The badge at the head of the
  // axis is not one -- the board opens there, it did not cross into anything
  // -- so it wears `metro-daybadge` without `metro-daybreak`, and a single-day
  // board naming its own date is not naming a daybreak. `dayNames` is the
  // other question: how many of the days on this board say which day they are.
  const daybreaks = (rep) => rep.labels.filter((l) => hasCls(l, 'metro-daybreak'));
  const dayNames = (rep) => rep.labels.filter((l) => hasCls(l, 'metro-daybadge') || hasCls(l, 'metro-daybreak'));
  const nightMarks = (rep) => (rep.rects || []).filter((p) => p.role === 'night');
  const midnightMarks = (rep) => (rep.rects || []).filter((p) => p.role === 'midnight');

  test('a quiet day is drawn with the next one', () => {
    const rep = layout(roll, ROOMY);
    assertEqual(rep.debug.win, [6 * 60, 1440 + 18 * 60],
      'the board drew minutes other than the window it was given');
    assertEqual(rep.debug.days, 2, 'the run is not two days long');
    assertEqual(rep.debug.midnights.length, 1, 'a two-day board has one midnight in it');
  });

  test('a busy day is the single day it always was', () => {
    // The whole reason the window is absent by default. An ordinary board
    // may not grow a midnight, a night corridor or a date marker.
    const rep = layout(busy, ROOMY);
    assertEqual(rep.debug.win, [0, 1440], 'a busy board drew something other than its day');
    assertEqual(rep.debug.midnights, [], 'a single-day board drew a midnight');
    assertEqual(nightMarks(rep).length, 0, 'a single-day board drew a night corridor');
    assertEqual(daybreaks(rep).length, 0, 'a single-day board named a daybreak');
  });

  test('the second day is named on the strip, where the midnight is', () => {
    for (const v of [ROOMY, byName('og-landscape')]) {
      const rep = layout(roll, v);
      const marks = daybreaks(rep);
      assert(marks.length >= 1, v.name + ': no date marker at all on a two-day board');
      const mid = rep.debug.midnights[0][1] * rep.debug.Z;
      // It names the day the midnight OPENS, so it belongs at that midnight
      // and not somewhere the strip had room. Half the marker's own width
      // of slack: it is set past the bar rather than centred on it, and the
      // note machinery may slide it clear of the clock badge.
      const at = marks.filter((l) => Math.abs(l.x - mid) < l.w + 20);
      assert(at.length >= 1, v.name + ': the date marker is at x' + Math.round(marks[0].x)
        + ' and the midnight is at x' + Math.round(mid));
      // On the strip, with the hours, not floating over the map.
      const band = Math.max.apply(null, (rep.rects || []).filter((p) => p.role === 'river')
        .map((p) => p.y + p.h));
      assert(marks.every((l) => l.y + l.h <= band + 2),
        v.name + ': a date marker is written below the hour strip, in the map');
    }
  });

  test('a date marker has nothing written over it', () => {
    // It is set among the hour labels, the clock badge and the overflow
    // notes, all of which are pinned to the same strip: "+3 earlier1:32am"
    // is what that looks like when it goes wrong.
    for (const v of [ROOMY, byName('og-landscape'), byName('og-half')]) {
      const rep = layout(roll, v);
      const marks = daybreaks(rep);
      const others = textLabels(rep).filter((l) => !hasCls(l, 'metro-daybreak'));
      const bad = [];
      for (const m of marks) {
        for (const o of others) {
          const ov = overlap(m, o);
          if (ov && ov.w > 1 && ov.h > 1) bad.push('"' + m.text + '" over "' + o.text + '"');
        }
      }
      assertEqual(bad, [], v.name + ': ' + bad.length + ' date marker collision(s)');
    }
  });

  test('a board with no header of its own names its first day too', () => {
    // A slot in a mashup has already given up the header, so nothing else
    // on it says which day the left-hand half of a 36-hour scale is. A wide
    // shallow slot is the case to ask on: it is headerless (half the
    // panel's depth or less) and still long enough along the axis to keep
    // the 36-hour window, where a narrow slot simply falls back to one day
    // and has one day to name.
    //
    // With the clock somewhere other than the first hour of the window: the
    // head of the strip is one slot and the clock badge has first claim on
    // it, so a board being read at twenty past nine on a window that opened
    // at six spends the head on the time and names only the day it crosses
    // into. That is the right order of precedence and it is not what this
    // case is about.
    const slot = { name: 'x-half-horizontal', w: 1872, h: 1404,
      slot: { w: 1040, h: 390 },
      classes: 'screen--v2 screen--lg screen--4bit screen--density-2x' };
    const rep = h.render(Object.assign({}, roll.metro, { now_min: 900 }), slot);
    const shown = rep.header && rep.header.items.some((i) =>
      (' ' + i.cls + ' ').indexOf(' metro-date ') >= 0 && i.shown);
    if (shown) { assert(true); return; }             // this slot kept its header after all
    if (!rep.debug.midnights.length) { assert(true); return; }  // and this one fell back to one day
    assert(dayNames(rep).length >= 2, 'a headerless two-day board named '
      + dayNames(rep).length + ' of its days');
  });

  test('the night is not drawn as a corridor any more', () => {
    // THE CORRIDOR IS GONE, and these two cases used to be the whole of its
    // specification: eight hours of upright hairlines the depth of the
    // board, and the express hatch standing off them so two hatches never
    // marked one stretch of time.
    //
    // It never read as the duration it was meant to be. A rolling board
    // compresses the night hardest, so the zone it draws is exactly where
    // there is least room to draw one, and it came out as a handful of
    // vertical rules bunched a thumb apart beside the midnight bar. Two
    // rounds of thinning made it quieter without making it legible, and the
    // person reading the actual panel asked, twice, what the vertical lines
    // were. A mark nobody can name is not quiet, it is noise.
    //
    // The model still knows where the night is -- that is how the axis
    // knows a run has one, and the express portals still ask -- so what
    // this holds is that nothing DRAWS it.
    const rep = layout(roll, ROOMY);
    assertEqual(rep.debug.nights.map((n) => [n[0], n[1]]), [[22 * 60, 1440 + 6 * 60]],
      'the model stopped tracking the night, which the axis needs');
    assertEqual(nightMarks(rep).length, 0,
      'the corridor is back: ' + nightMarks(rep).length + ' stroke(s)');
  });

  test('one vertical mark in the night, and it is the midnight', () => {
    // What the corridor's removal is FOR. The reader should find a single
    // vertical in that stretch and know what it is without being told; the
    // corridor's edges and infill were three more that nobody could name,
    // and the express portals used to stand off the corridor for the same
    // reason they still stand off the night.
    const rep = layout(roll, ROOMY);
    const Z = rep.debug.Z;
    const [, , na, nb] = rep.debug.nights[0];
    const tall = (rep.rects || []).filter((p) => p.h > rep.canvas.h * 0.5
      && p.x > na * Z - 4 && p.x + p.w < nb * Z + 4);
    const roles = [...new Set(tall.map((p) => p.role))];
    assertEqual(roles, ['midnight'],
      'the night carries ' + JSON.stringify(roles) + ', not just the midnight bar');
  });

  test('the strip says the night is compressed, now nothing else does', () => {
    // The hatch used to draw only the parts of a compressed stretch that
    // were NOT night, because the corridor spoke for those hours. With the
    // corridor gone, standing off would leave the most compressed hours on
    // the board unmarked, so the hatch covers them -- and it is the only
    // thing left saying the scale changes there.
    const rep = layout(roll, ROOMY);
    const Z = rep.debug.Z;
    const [, , na, nb] = rep.debug.nights[0];
    const inside = (rep.rects || []).filter((p) => p.role === 'express'
      && p.x > na * Z + 2 && p.x + p.w < nb * Z - 2);
    assert(inside.length > 0, 'the compressed night carries no express hatch at all');
  });

  for (const vname of ['x-landscape', 'og-landscape', 'x-portrait']) {
    test('a line runs through midnight rather than stopping at it: ' + vname, () => {
      // Rule: a person does not end at midnight. The bar is drawn BEHIND
      // the lines for this reason, and the run home, the terminus fan and
      // every ramp have to leave the trunk whole across it.
      const rep = layout(roll, byName(vname));
      const Z = rep.debug.Z;
      const horiz = rep.debug.horizontal;
      const mid = rep.debug.midnights[0][1] * Z;
      const bad = [];
      for (const p of rep.debug.bands.map((b) => b[0])) {
        const pts = [];
        for (const path of pathsWhere(rep, 'track').filter((t) => t.owner === p)) {
          for (const q of path.pts) pts.push(q[horiz ? 0 : 1]);
        }
        if (!pts.length) { bad.push(p + ' has no line at all'); continue; }
        // every sample within an hour's reach of the midnight, in order:
        // the biggest step between two of them is the biggest hole in the
        // line there. A tunnel gap where two lines cross is about a line's
        // own width; anything past 10px is the line stopping.
        const near = pts.filter((x) => Math.abs(x - mid) < 60).sort((a, b) => a - b);
        assert(near.length > 1, p + ' has no line within 60px of midnight');
        let worst = 0;
        for (let i = 1; i < near.length; i++) worst = Math.max(worst, near[i] - near[i - 1]);
        if (worst > 10) bad.push(p + ' has a ' + Math.round(worst) + 'px gap at midnight');
        assert(Math.min.apply(null, near) < mid - 10 && Math.max.apply(null, near) > mid + 10,
          p + ' does not reach both sides of midnight');
      }
      assertEqual(bad, [], vname + ': ' + bad.join('; '));
    });
  }

  test('an event on the second day is drawn at the second day\'s time', () => {
    // The one that matters. Everything else here can be right while the
    // board draws tomorrow's parkrun at this morning's nine o'clock, which
    // is the board telling the reader to get up tomorrow for something that
    // already happened.
    const rep = layout(roll, ROOMY);
    const Z = rep.debug.Z;
    const mid = rep.debug.midnights[0][1] * Z;
    const nightEnd = rep.debug.nights[0][3] * Z;
    const ev = (rep.debug.events || []).map((e) => ({ title: e[0], nodeA: e[5] * Z }));
    const parkrun = ev.filter((e) => e.title === 'Parkrun')[0];
    assert(parkrun, 'tomorrow\'s parkrun was not drawn at all');
    assert(parkrun.nodeA > mid, 'the 09:00 of the SECOND day is drawn '
      + Math.round(mid - parkrun.nodeA) + 'px before midnight');
    assert(parkrun.nodeA > nightEnd, 'it is drawn inside the night, before six in the morning');
    // and at nine, not just after dawn: the hour labels are the reader's
    // own scale, and 09:00 is one hour before the 10:00 on the second day.
    const hours = rep.labels.filter((l) => hasCls(l, 'metro-hour') && l.x > mid)
      .map((l) => ({ text: l.text, x: l.x + l.w / 2 })).sort((a, b) => a.x - b.x);
    const at = (t) => (hours.filter((hh) => hh.text === t)[0] || {}).x;
    const ten = at('10:00'), twelve = at('12:00');
    if (ten == null || twelve == null) { assert(true); return; }   // labels thinned out
    const hour = (twelve - ten) / 2;
    assert(Math.abs((ten - parkrun.nodeA) - hour) < hour * 0.3,
      'a 09:00 event is ' + Math.round(ten - parkrun.nodeA) + 'px before the 10:00 mark, '
      + 'where an hour on this board is ' + Math.round(hour) + 'px');
  });

  test('nothing is counted as missing that the board is drawing', () => {
    // A 36-hour board that says "+3 more" about the three events it just
    // drew would be worse than the one-day board it replaced.
    const rep = layout(roll, ROOMY);
    const notes = rep.labels.filter((l) => hasCls(l, 'metro-axis-note') && /^\+/.test(l.text));
    assertEqual(notes.map((l) => l.text), [], 'the board is counting events it drew as missing');
    const drawn = (rep.debug.events || []).filter((e) => e[2] !== 'DROP').length;
    assertEqual(drawn, 5, 'expected all five events on the board, drew ' + drawn);
  });
  test('no caption is written across a midnight', () => {
    // Position along this axis means WHEN, and the midnight bar is the one
    // place on the board where it also means WHICH DAY. A caption that
    // straddles it gets read on the wrong side of it.
    //
    // Reported from the panel as an event being on the wrong day. It was
    // not: a Sunday afternoon had slid far enough right that its words sat
    // in Monday. Nothing caught it, and every clash test it passed was
    // telling the truth -- it was not written over anything. It was written
    // over a DATE, and the bar is three pixels of ink, so no test that asks
    // "is this on top of something" was ever going to see it.
    for (const f of fixtures) {
      for (const vname of ['x-landscape', 'og-landscape']) {
        const rep = layout(f, byName(vname));
        if (!rep.debug.midnights.length || !rep.debug.horizontal) continue;
        const Z = rep.debug.Z;
        for (const m of rep.debug.midnights) {
          const mx = m[1] * Z;
          for (const c of textLabels(rep)) {
            if (!hasCls(c, 'metro-label')) continue;
            assert(!(c.x < mx - 1 && c.x + c.w > mx + 1),
              f.name + '/' + vname + ': "' + c.text + '" is written across the midnight at x'
              + Math.round(mx) + ', so it reads as the wrong day');
          }
        }
      }
    }
  });
};
