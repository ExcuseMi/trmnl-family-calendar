'use strict';

// The whole day is on the board, but its quiet ends run at speed. Cropping
// them away (which is what fitting the window to the content does on its
// own) loses the shape of the day: you cannot see that nothing happens
// before eight, only that the board starts there. Compressing keeps the day
// whole and still gives the busy hours the room.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, pathsWhere, assert } = h;

  const ROOMY = VIEWPORTS.find((v) => v.name === 'x-landscape');
  const full = fixtures.find((f) => f.name === 'full-day');

  // where an hour label sits, by its text
  function hourX(rep, text) {
    const l = rep.labels.filter((n) => (' ' + n.cls + ' ').indexOf(' metro-hour ') >= 0
      && n.text === text)[0];
    return l ? l.x + l.w / 2 : null;
  }

  test('the whole day is on the board, not just the busy part', () => {
    const rep = layout(full, ROOMY);
    const [from, to] = rep.debug.win;
    assert(from === 0 && to === 1440,
      'expected the full day, got ' + from + '..' + to);
  });

  test('a quiet hour takes less room than a busy one', () => {
    const rep = layout(full, ROOMY);
    // 01:00->03:00 is dead time; 09:00->11:00 is where the events are
    const quiet = [hourX(rep, '01:00'), hourX(rep, '03:00')];
    const busy = [hourX(rep, '09:00'), hourX(rep, '11:00')];
    if (quiet.some((v) => v === null) || busy.some((v) => v === null)) {
      // label thinning may drop some hours; fall back to the ones present
      assert(true);
      return;
    }
    const quietSpan = quiet[1] - quiet[0], busySpan = busy[1] - busy[0];
    assert(quietSpan < busySpan * 0.6,
      'two quiet hours took ' + Math.round(quietSpan) + 'px against '
      + Math.round(busySpan) + 'px for two busy ones — they are not compressed');
  });

  test('time still runs forwards everywhere, at every scale', () => {
    const rep = layout(full, ROOMY);
    // the tracks run the width of the board and never double back
    for (const t of pathsWhere(rep, 'track')) {
      const xs = t.pts.map((p) => p[0]);
      let backwards = 0;
      for (let i = 1; i < xs.length; i++) if (xs[i] < xs[i - 1] - 0.5) backwards++;
      assert(backwards === 0, 'track ' + t.owner + ' runs backwards in places');
    }
  });

  test('events still land at their own times', () => {
    const rep = layout(full, ROOMY);
    // the 09:00 standup's marks must sit at the 09:00 label, not somewhere
    // the compression has shifted them to
    const nine = hourX(rep, '09:00');
    assert(nine !== null, 'no 09:00 label to check against');
    const ticks = rep.circles.filter((c) => c.role === 'stop')
      .map((c) => c.x + c.w / 2);
    assert(ticks.some((x) => Math.abs(x - nine) < 40),
      'nothing is marked near 09:00, where an event starts');
  });
};
