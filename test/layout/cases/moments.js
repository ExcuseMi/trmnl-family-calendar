'use strict';

// An event with no duration.
//
// Real calendars are full of them: a birthday, a bin day, a reminder saved
// at a moment, an invitation accepted with no end time. transform.js passes
// start and end through as it finds them, so `end_min === start_min` reaches
// the drawing, and everything that reasons about a span meets a span of
// zero.
//
// Reported off a device photo, where a shared event with no duration was
// captioned "6:30pm - 6:30pm": the same time printed twice with a dash
// between it and itself, which reads as a range whose ends happen to be
// equal rather than as a moment.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, textLabels, hasClass, assert } = h;

  const byName = (n) => VIEWPORTS.find((v) => v.name === n);
  const moments = fixtures.find((f) => f.name === 'moment-day');

  test('an event with no duration is captioned with one time, not a range', () => {
    for (const vname of ['x-landscape', 'og-landscape']) {
      const rep = layout(moments, byName(vname));
      const labels = textLabels(rep).filter((l) => hasClass(l, 'metro-label'));
      const bad = labels.filter((l) => /(\d{1,2}[:.]\d{2}\s*(?:am|pm)?)\s*[–-]\s*\1/i.test(l.text));
      assert(bad.length === 0, vname + ': ' + bad.length + ' label(s) print the same time twice: '
        + bad.map((l) => JSON.stringify(l.text)).join('; '));
    }
  });

  test('a real span still gets both of its times', () => {
    // The fix must not swallow the range on events that have one, which is
    // most of them.
    const rep = layout(moments, byName('x-landscape'));
    const swim = textLabels(rep).find((l) => /Swim/.test(l.text));
    assert(swim, 'the timed event was not drawn at all');
    assert(/–/.test(swim.text), 'a 60-minute event lost its range: ' + JSON.stringify(swim.text));
  });

  test('a moment gets one mark, not two at the same point', () => {
    // A start dot and an end tick at one point say the line called there
    // and left again, and the tick lands on top of the dot to say it. It
    // is worse on a shared event, whose rail is placed by its label rather
    // than by its length: a backward one runs away from its own minute, so
    // the tick for an end that does not exist landed clear of the rail
    // with nothing under it at all.
    //
    // Stated as a distance rather than by owner, because a line carries
    // moments and real events at once and only the coincident pair is the
    // fault. 5px: the two marks are placed by the same arithmetic from the
    // same minute, so on a moment they land on each other exactly, while
    // the shortest real event on any fixture puts them further apart than
    // this.
    const TOGETHER = 5;
    for (const vname of ['x-landscape', 'og-landscape']) {
      const rep = layout(moments, byName(vname));
      const dots = rep.circles.filter((c) => c.role === 'stop-start');
      const ticks = rep.circles.filter((c) => c.role === 'stop');
      const bad = [];
      for (const d of dots) {
        for (const t of ticks) {
          if (t.owner !== d.owner) continue;
          const dx = (t.x + t.w / 2) - (d.x + d.w / 2);
          const dy = (t.y + t.h / 2) - (d.y + d.h / 2);
          if (Math.sqrt(dx * dx + dy * dy) <= TOGETHER) {
            bad.push(d.owner + ' has both marks at ' + Math.round(d.x) + ',' + Math.round(d.y));
          }
        }
      }
      assert(bad.length === 0, vname + ': ' + bad.length + ' event(s) marked twice at one point: '
        + bad.join('; '));
    }
  });

  test('a board of moments still draws every one of them', () => {
    // A zero-length event has no rail to speak of, and the danger is that
    // something measuring its span drops it or draws it as nothing.
    for (const vname of ['x-landscape', 'og-landscape']) {
      const rep = layout(moments, byName(vname));
      const text = textLabels(rep).map((l) => l.text).join(' | ');
      for (const title of ['Bin Day', 'Family Dinner', 'Standup', 'Swim']) {
        assert(text.indexOf(title) >= 0, vname + ': "' + title + '" is not on the board');
      }
    }
  });
};
