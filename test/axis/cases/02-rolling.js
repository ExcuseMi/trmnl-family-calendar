'use strict';

// A WINDOW INTO THE RUN.
//
// A day with almost nothing on it borrows the next one, and the board then
// runs from six in the morning to six the following evening. Which minutes
// those are is transform's decision, taken from the events so that it comes
// out the same at every refresh; all the model does with it is clip the
// same compression profile to those minutes and say whether what comes out
// can be read. Where it cannot, the answer is the ordinary single day: a
// day is better than a run nobody can read.

module.exports = function (test, h) {
  const { fit, ev, DAY, assert, assertEqual } = h;

  const WIN = { from: 6 * 60, to: DAY + 18 * 60 };
  const QUIET = [ev(0, '14:00', '15:00'), ev(1, '09:00', '10:00')];

  test('a window is drawn exactly as asked, not fitted to the content again', () => {
    const m = fit({ axisPx: 2000, days: 2, content: QUIET, window: WIN });
    assertEqual([m.winStart, m.winEnd], [WIN.from, WIN.to], 'the board drew other minutes');
    assertEqual(m.segments[0].from, WIN.from, 'the scale starts somewhere other than the window');
    assertEqual(m.segments[m.segments.length - 1].to, WIN.to, 'the scale stops somewhere other than the window');
    for (let i = 1; i < m.segments.length; i++) {
      assert(Math.abs(m.segments[i].from - m.segments[i - 1].to) < 1e-9,
        'a gap in the scale between ' + m.segments[i - 1].to + ' and ' + m.segments[i].from);
    }
  });

  test('time still only moves forward across the window', () => {
    const m = fit({ axisPx: 2000, days: 2, content: QUIET, window: WIN });
    let last = -Infinity;
    for (let t = WIN.from; t <= WIN.to; t += 7) {
      const p = h.TimeAxis.posOf(m, t);
      assert(p >= last - 1e-9, 'at minute ' + t + ' the axis moved backwards');
      last = p;
    }
  });

  test('the midnight inside the window is marked, and it is the only one', () => {
    const m = fit({ axisPx: 2000, days: 2, content: QUIET, window: WIN });
    assertEqual(m.boundaries.map((b) => b.min), [DAY], 'the wrong midnights: ' + JSON.stringify(m.boundaries));
    assertEqual(m.boundaries[0].day, 1, 'the midnight does not open day 1');
  });

  test('the night either side of it is ten at night to six in the morning', () => {
    // Clamped to the window, because a corridor that ran past the end of
    // the board would be hatching paper that is not the board's.
    const m = fit({ axisPx: 2000, days: 2, content: QUIET, window: WIN });
    assertEqual(m.nights.map((n) => [n.from, n.to]), [[DAY - 120, DAY + 360]],
      'the night is wrong: ' + JSON.stringify(m.nights));
  });

  test('a night is clipped to a window that opens inside it', () => {
    const late = { from: DAY - 60, to: DAY + 18 * 60 };
    const m = fit({ axisPx: 2000, days: 2, content: [ev(0, '23:10', '23:40'), ev(1, '09:00', '10:00')], window: late });
    assertEqual(m.nights.map((n) => [n.from, n.to]), [[DAY - 60, DAY + 360]],
      'the corridor ran off the head of the board: ' + JSON.stringify(m.nights));
  });

  test('a board too small for the run draws the day instead', () => {
    // The rolling view is a way of using room a quiet day is not using. On
    // a panel with no room to give it is not an improvement, it is a
    // 36-hour board with an unreadable hour.
    const m = fit({ axisPx: 180, days: 2, content: QUIET, window: WIN });
    assertEqual([m.winStart, m.winEnd], [0, DAY], 'a tiny board kept the 36-hour window');
    assertEqual(m.boundaries, [], 'and it drew a midnight it has no second day for');
    assertEqual(m.nights, [], 'and a night corridor with no night in the board');
  });

  test('a borrowed day with nothing on it is not worth the axis', () => {
    // The same rule the day counter keeps: a run ending in an empty day is
    // a shorter board with a night stuck on the end. The window is offered
    // whenever the day being shown is quiet, and the day it borrowed can
    // still turn out to have nothing in the hours the window covers.
    const m = fit({ axisPx: 2000, days: 2, content: [ev(0, '14:00', '15:00')], window: WIN });
    assertEqual([m.winStart, m.winEnd], [0, DAY], 'an empty borrowed day was drawn anyway');
  });

  test('a single day is unchanged by any of this', () => {
    // The whole point of the window being absent by default: an ordinary
    // board is the board it always was, night corridor and all.
    const m = fit({ axisPx: 2000, days: 1, content: [ev(0, '09:00', '17:00')] });
    assertEqual([m.winStart, m.winEnd], [0, DAY]);
    assertEqual(m.nights, [], 'a single-day board grew a night corridor');
  });

  test('a run of whole days still gets a night at every midnight', () => {
    const m = fit({ axisPx: 4000, content: [ev(0, '09:00', '10:00'), ev(1, '09:00', '10:00'), ev(2, '09:00', '10:00')] });
    assertEqual(m.dayCount, 3);
    assertEqual(m.nights.map((n) => [n.from, n.to]),
      [[DAY - 120, DAY + 360], [2 * DAY - 120, 2 * DAY + 360]],
      'a three-day board has two nights in it: ' + JSON.stringify(m.nights));
  });
};
