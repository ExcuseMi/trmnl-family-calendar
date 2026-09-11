'use strict';

// AN ALL-DAY EVENT HAS NO HOUR, SO IT GETS NO PLACE ON A SCALE OF HOURS.
//
// It used to be drawn as an event spanning the whole visible window, which
// meant the board printed its OWN window back as the event's hours: every
// render carried "6am - 11pm / Spring Break", which is not when the holiday
// is, it is when the board decided to start and stop looking. On a
// multi-day board it was worse, because the window covers the run and a
// Tuesday holiday got stamped across Wednesday and Thursday.
//
// It is a STATE a line is in -- half term, leave, a night shift -- not a
// place it goes at a time. The board already has one thing that says what a
// line IS, which is its head, so that is where it is declared: a second row
// under the name, with rule 28's concentric rings, and nothing whatever
// between the first hour and the last.
//
// Both ends of such a line become open chevrons, because a day that is a
// slice of something longer did not begin at six and will not end at
// eleven, and a terminus slash says it did.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, pathsWhere, assert, assertEqual } = h;

  const ROOMY = VIEWPORTS.find((v) => v.name === 'x-landscape');
  const withAllDay = fixtures.filter((f) => (f.metro.all_day || []).length);

  function routeRows(rep) {
    return rep.labels.filter((l) => (' ' + l.cls + ' ').indexOf(' metro-route ') >= 0);
  }

  test('there is a fixture with an all-day event at all', () => {
    // Otherwise every case below passes by having nothing to look at.
    assert(withAllDay.length > 0, 'no fixture declares metro.all_day');
  });

  for (const f of withAllDay) {
    test('every all-day title is written at a head: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const said = routeRows(rep).map((l) => l.text).join(' ');
      for (const a of f.metro.all_day) {
        assert(said.indexOf(a.title) >= 0,
          '"' + a.title + '" is declared on no line\'s head');
      }
    });
  }

  for (const f of withAllDay) {
    test('an all-day title is written once, however many lines share it: ' + f.name, () => {
      // Three people are not on three holidays. They are on one.
      const rep = layout(f, ROOMY);
      const texts = routeRows(rep).map((l) => l.text);
      for (const a of f.metro.all_day) {
        const n = texts.filter((t) => t.indexOf(a.title) >= 0).length;
        assertEqual(n, 1, '"' + a.title + '" appears at ' + n + ' heads');
      }
    });
  }

  for (const f of withAllDay) {
    test('nothing is drawn on the axis for it: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      // The captions on the board are the timed events and nothing else.
      // A holiday with a start time is the bug this whole shape exists to
      // remove, so the giveaway to look for is its words out on the map.
      const titles = f.metro.all_day.map((a) => a.title);
      for (const l of rep.labels) {
        if ((' ' + l.cls + ' ').indexOf(' metro-route ') >= 0) continue;
        for (const t of titles) {
          assert(l.text.indexOf(t) < 0,
            '"' + t + '" is written on the map at ' + Math.round(l.x) + ','
            + Math.round(l.y) + ' as well as at its head. An all-day event '
            + 'has no hour to put it at.');
        }
      }
    });
  }

  for (const f of withAllDay) {
    test('a line whose day is a slice of something longer ends open: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const inIt = new Set();
      f.metro.all_day.forEach((a) => (a.owners || []).forEach((k) => inIt.add(k)));
      const open = pathsWhere(rep, 'terminal-open');
      for (const k of inIt) {
        const mine = open.filter((p) => p.owner === k);
        assertEqual(mine.length, 2,
          k + ' has ' + mine.length + ' open ends, not two. Both ends open: '
          + 'the holiday neither started at the first hour on the scale nor '
          + 'stops at the last.');
      }
      // and nobody else's line is opened up
      for (const p of open) {
        assert(inIt.has(p.owner),
          p.owner + ' ends open without being in an all-day event');
      }
    });
  }

  test('a shared title ties the heads together instead of repeating itself', () => {
    const shared = fixtures.find((f) => (f.metro.all_day || [])
      .some((a) => (a.owners || []).length > 1));
    if (!shared) return;       // no fixture has one; the transform suite covers the shape
    const rep = layout(shared, ROOMY);
    assert(pathsWhere(rep, 'origin-tie').length > 0,
      'two lines share an all-day title and nothing links their heads, so the '
      + 'words sit against one line and say nothing about the other');
  });
};
