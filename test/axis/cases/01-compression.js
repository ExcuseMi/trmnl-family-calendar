'use strict';

// What a minute is worth.
//
// A minute inside the busy part of a day is worth one unit; a minute
// outside it is worth `expressRate` of one. Cropping the quiet hours away
// instead would lose the shape of a day: you cannot see that nothing
// happens before eight, only that the board starts at eight. Compressing
// keeps the whole day present, and it is what makes a night affordable at
// all.

module.exports = function (test, h) {
  const { TimeAxis, fit, ev, DAY, assert, assertEqual } = h;

  const pos = (m, min) => TimeAxis.posOf(m, min);

  test('time only ever moves forward', () => {
    // Everything downstream places marks by asking for a position. A scale
    // that went backwards anywhere would put an afternoon before a morning
    // and no drawing could recover from it.
    const m = fit({ axisPx: 2000, content: [ev(0, '09:00', '17:00'), ev(1, '07:00', '09:00'), ev(2, '18:00', '23:00')] });
    let last = -Infinity;
    for (let t = 0; t <= m.dayCount * DAY; t += 7) {
      const p = pos(m, t);
      assert(p >= last - 1e-9, 'at minute ' + t + ' the axis moved backwards: ' + p + ' after ' + last);
      last = p;
    }
  });

  test('a busy hour is worth more axis than a quiet one', () => {
    const m = fit({ axisPx: 2000, content: [ev(0, '09:00', '17:00')] });
    const busy = pos(m, 10 * 60 + 60) - pos(m, 10 * 60);   // inside the working day
    const quiet = pos(m, 2 * 60 + 60) - pos(m, 2 * 60);    // the small hours
    assert(busy > quiet * 2, 'an hour of the working day is worth ' + busy.toFixed(1)
      + ' and an hour of the night ' + quiet.toFixed(1) + ': the night is not being compressed');
    assert(quiet > 0, 'a quiet hour is worth nothing at all, so the day has been cropped rather '
      + 'than compressed and its shape is lost');
  });

  test('the night between two days is ONE stretch, not two half-nights', () => {
    // The tail of one day and the head of the next are the same night. Left
    // as two segments there is a seam in the scale at midnight, and the
    // compression changes rate across a moment where nothing happens.
    const m = fit({ axisPx: 3000, content: [ev(0, '09:00', '17:00'), ev(1, '09:00', '17:00')] });
    const night = m.segments.filter((s) => s.rate !== 1 && s.from < DAY && s.to > DAY);
    assertEqual(night.length, 1, 'the night across midnight is ' + night.length + ' segment(s)');
    assert(night[0].from < DAY && night[0].to > DAY, 'the night does not span midnight');
  });

  test('the compression profile covers the whole run with no gaps', () => {
    const m = fit({ axisPx: 2000, content: [ev(0, '09:00', '17:00'), ev(1, '09:00', '17:00')] });
    assertEqual(m.segments[0].from, 0, 'the run does not start at zero');
    assertEqual(m.segments[m.segments.length - 1].to, m.dayCount * DAY, 'the run does not reach the end');
    for (let i = 1; i < m.segments.length; i++) {
      assert(Math.abs(m.segments[i].from - m.segments[i - 1].to) < 1e-9,
        'a gap in the scale between ' + m.segments[i - 1].to + ' and ' + m.segments[i].from);
    }
  });

  test('a stretch too short to be worth compressing is not compressed', () => {
    // A seam in the scale that saves four pixels is a seam for nothing.
    const m = fit({ axisPx: 2000, content: [ev(0, '00:20', '23:40')] });
    const tiny = m.segments.filter((s) => s.rate !== 1 && s.to - s.from < 45);
    assertEqual(tiny.length, 0, 'kept ' + tiny.length + ' express stretch(es) shorter than the '
      + 'minimum worth having');
  });

  test('a day with nothing on it is all night', () => {
    // It still takes its place in the run, at a price that reflects having
    // nothing on it.
    const m = fit({ axisPx: 4000, content: [ev(0, '09:00', '10:00'), ev(1, '09:00', '10:00')], days: 2 });
    const dayOne = m.segments.filter((s) => s.from >= 0 && s.to <= DAY);
    assert(dayOne.some((s) => s.rate === 1), 'day 0 has content and no full-rate stretch');
  });

  test('a day is never squeezed to nothing by a single short meeting', () => {
    // One fifteen-minute standup is still a day, not a fifteen-minute board.
    const m = fit({ axisPx: 2000, content: [ev(0, '09:00', '09:15')] });
    const busy = m.segments.filter((s) => s.rate === 1).reduce((n, s) => n + (s.to - s.from), 0);
    assert(busy >= 6 * 60 - 1, 'the whole day came to ' + busy + ' busy minutes');
  });
};
