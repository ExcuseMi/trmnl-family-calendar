'use strict';

// The day model.
//
// This plugin drew one day for its whole life: one `day_start_min`, one
// `day_end_min`, `forecast_days=1`, and every minute counted from that
// day's own midnight. A second day is not a second copy of any of that, it
// is a different shape of number line.
//
// Everything here is about that shape. Minutes are ABSOLUTE across the run
// the board may draw: 09:00 on day 1 is 1980, not 540. One number line is
// what lets a night be a stretch of axis like any other, an event that
// crosses midnight be one event rather than two halves, and every
// downstream comparison stay a plain comparison instead of a pair of
// (day, minute) tuples that have to be unpacked before they can be sorted.
//
// How many of those days get DRAWN is not decided here. Transform sends
// what it has; the client picks against the real canvas.

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-09T09:00:00Z');   // a Wednesday
  const DAY = 24 * 60;

  function net(ics) {
    return async (url) => {
      if (String(url).indexOf('api.open-meteo.com') >= 0) {
        return okText(JSON.stringify({
          daily: {
            temperature_2m_max: [18, 21, 15], temperature_2m_min: [11, 13, 9],
            precipitation_probability_max: [10, 80, 40], weathercode: [0, 61, 3],
            sunrise: ['2026-09-09T06:30'], sunset: ['2026-09-09T20:30'],
          },
          hourly: { time: [], precipitation_probability: [] },
        }));
      }
      return okText(ics);
    };
  }
  function input(fields) {
    return baseInput(NOW, Object.assign({
      use_demo_data: 'false', lat_lon: '51.05,3.72',
      config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
    }, fields || {}));
  }

  test('the payload carries a run of days, not a day', async () => {
    const ics = icsWithEvents([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today' }]);
    const { run } = runTransform(net(ics), NOW);
    const r = await run(input());
    assert(Array.isArray(r.metro.days), 'no days array at all');
    assert(r.metro.days.length >= 1, 'the run is empty');
    assert(r.metro.days.length <= 3, 'more than three days: past that a day gets less axis '
      + 'than its own events need, so there is no point fetching it');
  });

  test('each day owns a block of the same number line', async () => {
    // Day n is [n*1440, (n+1)*1440). Anything else and "is this event on
    // day 2" stops being arithmetic.
    const ics = icsWithEvents([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today' }]);
    const r = await runTransform(net(ics), NOW).run(input());
    r.metro.days.forEach((d, i) => {
      assertEqual(d.index, i, 'day ' + i + ' is misnumbered');
      assertEqual(d.start_min, i * DAY, 'day ' + i + ' starts at the wrong minute');
      assertEqual(d.end_min, (i + 1) * DAY, 'day ' + i + ' ends at the wrong minute');
    });
  });

  test('an event tomorrow lands on tomorrow, at tomorrow\'s minutes', async () => {
    // The whole point. Counted from its own midnight it would be
    // indistinguishable from the same meeting today.
    const ics = icsWithEvents([
      { start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today Meeting' },
      { start: '20260910T090000Z', end: '20260910T100000Z', summary: 'Tomorrow Meeting' },
    ]);
    const r = await runTransform(net(ics), NOW).run(input());
    const evs = r.metro.items.filter((i) => i.type === 'event');
    const today = evs.find((e) => e.title === 'Today Meeting');
    const tomorrow = evs.find((e) => e.title === 'Tomorrow Meeting');
    assert(today, 'today\'s event is missing');
    assert(tomorrow, 'tomorrow\'s event is missing: the board only ever looked at one day');
    assert(today.start_min < DAY, 'today\'s event is not on day 0: ' + today.start_min);
    assert(tomorrow.start_min >= DAY && tomorrow.start_min < 2 * DAY,
      'tomorrow\'s event is at ' + tomorrow.start_min + ', which is not day 1');
    // and the two are ordered on one line, without unpacking anything
    assert(tomorrow.start_min > today.start_min,
      'tomorrow sorts before today, so the number line is not one line');
  });

  test('a weekly meeting recurs on every day of the run', async () => {
    // It is Wednesday. A Wednesday standup appears on day 0 only; a daily
    // habit expressed as BYDAY over the week appears on all three.
    const ics = icsWithEvents([
      { start: '20260909T090000Z', end: '20260909T091500Z', summary: 'Standup',
        rrule: 'FREQ=WEEKLY;BYDAY=WE,TH,FR' },
    ]);
    const r = await runTransform(net(ics), NOW).run(input());
    const standups = r.metro.items.filter((i) => i.type === 'event' && i.title === 'Standup');
    assertEqual(standups.length, 3, 'a Wed/Thu/Fri standup should land on all three days of the run');
    const dayOf = standups.map((e) => Math.floor(e.start_min / DAY)).sort();
    assertEqual(dayOf, [0, 1, 2], 'the three occurrences are not one per day');
  });

  test('the window may reach past midnight', async () => {
    // Clamped to 24 * 60 it could never show anything on day 1, whatever
    // was on it.
    const ics = icsWithEvents([
      { start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today' },
      { start: '20260910T090000Z', end: '20260910T100000Z', summary: 'Tomorrow' },
    ]);
    const r = await runTransform(net(ics), NOW).run(input());
    assert(r.metro.day_end_min > DAY, 'the window stops at midnight (' + r.metro.day_end_min
      + '), so nothing on day 1 could ever be drawn');
  });

  test('every day carries its own forecast', async () => {
    // A two-day board showing one high and low is telling the truth about
    // one of the days and inventing it for the other.
    const ics = icsWithEvents([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today' }]);
    const r = await runTransform(net(ics), NOW).run(input());
    const withWx = r.metro.days.filter((d) => d.weather && d.weather.hi != null);
    assert(withWx.length >= 2, 'only ' + withWx.length + ' day(s) have a forecast');
    const his = withWx.map((d) => d.weather.hi);
    assert(new Set(his).size > 1, 'every day was given the same high (' + his.join(', ')
      + '), which is one day\'s forecast copied');
  });

  test('every day is named', async () => {
    const ics = icsWithEvents([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today' }]);
    const r = await runTransform(net(ics), NOW).run(input());
    r.metro.days.forEach((d, i) => {
      assert(d.date_label && d.date_label.length, 'day ' + i + ' has no date label, so a range '
        + 'header has nothing to print');
    });
    const labels = r.metro.days.map((d) => d.date_label);
    assert(new Set(labels).size === labels.length, 'two days share a label: ' + labels.join(' / '));
  });
};
