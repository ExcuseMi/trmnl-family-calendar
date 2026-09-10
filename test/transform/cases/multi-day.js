'use strict';

// The day model, and which day the board draws.
//
// The board draws ONE day. A run of days on one axis was built and thrown
// away: on a panel this size three days of a family's week is three columns
// of an hour each, and what a wall calendar is for is the day you are in.
//
// What stayed is the day MODEL, because it is right for its own reasons.
// Transform gathers today and tomorrow, and every minute it works in is
// absolute across that pair: 09:00 tomorrow is 1980, not 540. That is what
// lets a recurrence be evaluated per day, an EXDATE be matched to the day
// it names, and an event crossing midnight stay one event. The day being
// SHOWN is then rebased onto its own midnight, so everything downstream
// sees an ordinary single-day board and none of it has to know which day
// it is looking at.

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

  test('the payload describes exactly the day being drawn', async () => {
    const ics = icsWithEvents([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today' }]);
    const { run } = runTransform(net(ics), NOW);
    const r = await run(input());
    assert(Array.isArray(r.metro.days), 'no days array at all');
    assertEqual(r.metro.days.length, 1, 'the board draws one day, so it is told about one day');
  });

  test('the day being drawn is rebased onto its own midnight', async () => {
    // Whichever day it is. Everything downstream reads minutes from
    // midnight, and none of it should have to know which midnight.
    const ics = icsWithEvents([{ start: '20260910T090000Z', end: '20260910T100000Z', summary: 'Tomorrow' }]);
    const r = await runTransform(net(ics), NOW).run(input({ show_day: 'tomorrow' }));
    const e = r.metro.items.find((i) => i.type === 'event' && i.title === 'Tomorrow');
    assert(e, 'tomorrow\'s event is missing on a board set to tomorrow');
    assertEqual(e.start_min, 9 * 60, 'a 09:00 event on the day being shown should be at 540');
    assertEqual(r.metro.days[0].start_min, 0, 'the day being shown does not start at zero');
    assertEqual(r.metro.days[0].end_min, DAY, 'the day being shown is not a day long');
  });

  test('the board shows one day, and the setting says which', async () => {
    const ics = icsWithEvents([
      { start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today Meeting' },
      { start: '20260910T090000Z', end: '20260910T100000Z', summary: 'Tomorrow Meeting' },
    ]);
    const t = await runTransform(net(ics), NOW).run(input());
    const titlesT = t.metro.items.filter((i) => i.type === 'event').map((i) => i.title);
    assertEqual(titlesT, ['Today Meeting'], 'a board set to today drew something else');

    const m = await runTransform(net(ics), NOW).run(input({ show_day: 'tomorrow' }));
    const titlesM = m.metro.items.filter((i) => i.type === 'event').map((i) => i.title);
    assertEqual(titlesM, ['Tomorrow Meeting'], 'a board set to tomorrow drew something else');
  });

  test('a recurrence is evaluated against the day being shown', async () => {
    // It is Wednesday. A Thursday-only standup is not on today's board and
    // IS on tomorrow's. Evaluated against today whichever day is drawn, a
    // board set to tomorrow would show today's meetings at tomorrow's date,
    // which is the worst of both.
    const ics = icsWithEvents([
      { start: '20260903T090000Z', end: '20260903T091500Z', summary: 'Thursday Standup',
        rrule: 'FREQ=WEEKLY;BYDAY=TH' },
    ]);
    const today = await runTransform(net(ics), NOW).run(input());
    assertEqual(today.metro.items.filter((i) => i.type === 'event').length, 0,
      'a Thursday standup was drawn on a Wednesday board');
    const tomorrow = await runTransform(net(ics), NOW).run(input({ show_day: 'tomorrow' }));
    const t = tomorrow.metro.items.filter((i) => i.type === 'event');
    assertEqual(t.length, 1, 'the Thursday standup is missing from Thursday');
    assertEqual(t[0].start_min, 9 * 60, 'it is not at its own time of day');
  });

  test('the window stays inside the day being drawn', async () => {
    const ics = icsWithEvents([
      { start: '20260909T060000Z', end: '20260909T070000Z', summary: 'Early' },
      { start: '20260909T220000Z', end: '20260909T230000Z', summary: 'Late' },
    ]);
    const r = await runTransform(net(ics), NOW).run(input());
    assert(r.metro.day_start_min >= 0, 'the window starts before midnight');
    assert(r.metro.day_end_min <= DAY, 'the window runs past midnight into a day nobody asked for');
  });

  test('the forecast is the one for the day being drawn', async () => {
    // A board set to tomorrow that carries today's temperature is wrong
    // about the only day it is drawing.
    const ics = icsWithEvents([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today' }]);
    const today = await runTransform(net(ics), NOW).run(input());
    const tomorrow = await runTransform(net(ics), NOW).run(input({ show_day: 'tomorrow' }));
    assertEqual(today.metro.header_weather.hi, 18, 'today\'s high is not today\'s');
    assertEqual(tomorrow.metro.header_weather.hi, 21, 'a board set to tomorrow shows today\'s high');
  });

  test('the header names the day it is drawing, and calls it Today only when it is', async () => {
    const ics = icsWithEvents([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today' }]);
    const today = await runTransform(net(ics), NOW).run(input());
    const tomorrow = await runTransform(net(ics), NOW).run(input({ show_day: 'tomorrow' }));
    assert(today.metro.date_label !== tomorrow.metro.date_label,
      'both boards carry the same date: ' + today.metro.date_label);
    assertEqual(today.metro.title_word, null, 'a board showing today should keep the word Today');
    assert(tomorrow.metro.title_word, 'a board showing tomorrow still says Today, which names the '
      + 'wrong day');
  });

  test('switching over in the evening shows tomorrow, and not before', async () => {
    // A screen on a wall: in the evening what you need to see is what you
    // are getting up to, and by then today has already happened.
    const ics = icsWithEvents([
      { start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today Meeting' },
      { start: '20260910T090000Z', end: '20260910T100000Z', summary: 'Tomorrow Meeting' },
    ]);
    const at = (iso) => Date.parse(iso);
    const board = async (nowIso, fields) => {
      const when = at(nowIso);
      const r = await runTransform(net(ics), when).run(
        baseInput(when, Object.assign({
          use_demo_data: 'false', lat_lon: '51.05,3.72',
          config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
        }, fields)));
      return r.metro.items.filter((i) => i.type === 'event').map((i) => i.title);
    };
    assertEqual(await board('2026-09-09T09:00:00Z', { show_day: 'auto' }), ['Today Meeting'],
      'the morning board should still be today');
    assertEqual(await board('2026-09-09T19:00:00Z', { show_day: 'auto' }), ['Tomorrow Meeting'],
      'the evening board should have switched over');
    // and the hour is the reader's to set
    assertEqual(await board('2026-09-09T15:00:00Z', { show_day: 'auto', switch_hour: '14' }),
      ['Tomorrow Meeting'], 'a switch hour of 14 did not take effect at 15:00');
    assertEqual(await board('2026-09-09T13:00:00Z', { show_day: 'auto', switch_hour: '14' }),
      ['Today Meeting'], 'a switch hour of 14 took effect at 13:00');
  });

  test('a nonsense switch hour falls back rather than breaking the board', async () => {
    const ics = icsWithEvents([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today Meeting' }]);
    for (const bad of ['', 'evening', '99', '-3']) {
      const r = await runTransform(net(ics), NOW).run(input({ show_day: 'auto', switch_hour: bad }));
      assert(Array.isArray(r.metro.items), 'a switch hour of ' + JSON.stringify(bad) + ' broke the payload');
    }
  });
};
