'use strict';

// THE 36-HOUR BOARD, drawn.
//
// A day with almost nothing on it borrows the next one: the board runs from
// six in the morning to six the following evening, with a night corridor
// either side of the midnight it crosses and each day named on the strip.
//
// Four things have to be true of that drawing, and each of them is a way it
// could be well formed and still be a lie: it may not happen on a day that
// is not quiet, the corridor has to cover the hours it claims to, a line
// has to run THROUGH midnight rather than stop at it (a person does not end
// at midnight), and an event on the second day has to be drawn at the
// second day's time and not at the first day's.

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

  test('the night corridor covers ten at night to six in the morning', () => {
    const rep = layout(roll, ROOMY);
    assertEqual(rep.debug.nights.map((n) => [n[0], n[1]]), [[22 * 60, 1440 + 6 * 60]],
      'the model put the night somewhere else');
    const marks = nightMarks(rep);
    assert(marks.length >= 3, 'the corridor is ' + marks.length + ' stroke(s): it cannot read as a zone');
    const Z = rep.debug.Z;
    const lo = Math.min.apply(null, marks.map((m) => m.x));
    const hi = Math.max.apply(null, marks.map((m) => m.x + m.w));
    const want = [rep.debug.nights[0][2] * Z, rep.debug.nights[0][3] * Z];
    assert(Math.abs(lo - want[0]) < 4 && Math.abs(hi - want[1]) < 4,
      'the corridor is drawn at ' + Math.round(lo) + '..' + Math.round(hi)
      + ' for a night the scale puts at ' + Math.round(want[0]) + '..' + Math.round(want[1]));
    // AND IT IS REALLY THOSE HOURS. Nothing happens between 21:45 and 07:45
    // on this board, so the whole corridor is inside one compressed stretch
    // at one rate: two of its eight hours are before midnight, so the bar
    // belongs a quarter of the way along it. Drawn from the wrong minutes,
    // the bar would sit in the middle.
    const mid = rep.debug.midnights[0][1] * Z;
    const share = (mid - lo) / (hi - lo);
    assert(Math.abs(share - 0.25) < 0.06, 'midnight sits ' + Math.round(share * 100)
      + '% of the way through a corridor that should have two of its eight hours before it');
    // the map's own depth, not a mark on the scale: the night is a stretch
    // of the BOARD
    assert(marks.every((m) => m.h > rep.canvas.h * 0.5),
      'the corridor does not run the depth of the board');
  });

  test('the night corridor and the express hatch do not both mark the same hours', () => {
    // Two hatches over one stretch of time say two different things are
    // happening to it. The night is compressed, so they would otherwise sit
    // on exactly the same minutes.
    const rep = layout(roll, ROOMY);
    const Z = rep.debug.Z;
    const [, , na, nb] = rep.debug.nights[0];
    const inside = (rep.rects || []).filter((p) => p.role === 'express'
      && p.x > na * Z + 2 && p.x + p.w < nb * Z - 2);
    assertEqual(inside.length, 0, inside.length + ' express mark(s) inside the night corridor');
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
};
