'use strict';

// A QUIET DAY BORROWS THE NEXT ONE.
//
// Two appointments leave a board that is mostly empty paper, spent on hours
// nobody has anything in. At or below QUIET_DAY_MAX_EVENTS the run becomes
// two days and the payload carries a window into it: six in the morning of
// the day being shown through to six the following evening. Anything busier
// is the single-day board it always was, byte for byte.
//
// The two things that must not go wrong are both about STABILITY. The panel
// refreshes every fifteen minutes, so the count may not be read from the
// clock forwards (a board would flip into the rolling view during the
// afternoon and back at midnight), and the window may not be anchored to
// "now" (every event would slide left four times an hour). Both are decided
// per civil day, and the cases that pin that down are the last two here.

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-09T09:00:00Z');   // a Wednesday
  const DAY = 24 * 60;

  function net(ics) {
    return async (url) => {
      if (String(url).indexOf('api.open-meteo.com') >= 0) {
        return okText(JSON.stringify({
          daily: {
            temperature_2m_max: [18, 21], temperature_2m_min: [11, 13],
            precipitation_probability_max: [10, 80], weathercode: [0, 61],
            sunrise: ['2026-09-09T06:30', '2026-09-10T06:32'],
            sunset: ['2026-09-09T20:30', '2026-09-10T20:27'],
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
  // events written as [YYYYMMDD, "HHMM", "HHMM", title]
  function feed(rows) {
    return icsWithEvents(rows.map((r) => ({
      start: r[0] + 'T' + r[1] + '00Z', end: r[0] + 'T' + r[2] + '00Z', summary: r[3],
    })));
  }
  const board = async (rows, fields) => (await runTransform(net(feed(rows)), NOW).run(input(fields))).data;

  const QUIET = [
    ['20260909', '1400', '1500', 'Dentist'],
    ['20260910', '0900', '1000', 'Sprint Review'],
    ['20260910', '1900', '2000', 'Book Club'],
  ];

  test('a quiet day is drawn with the next one, a busy day on its own', async () => {
    const quiet = await board(QUIET);
    assertEqual(quiet.days.length, 2, 'one event today should have borrowed tomorrow');
    // Three is past the threshold, so nothing changes about the board at all.
    const busy = await board([
      ['20260909', '0900', '0915', 'Standup'],
      ['20260909', '1100', '1200', 'Workshop'],
      ['20260909', '1400', '1500', 'Dentist'],
      ['20260910', '0900', '1000', 'Sprint Review'],
    ]);
    assertEqual(busy.days.length, 1, 'a three-event day was stretched anyway');
    assertEqual(busy.rolling, null, 'a busy board carries a window it does not need');
    assertEqual(busy.events.map((e) => e.title).sort(),
      ['Dentist', 'Standup', 'Workshop'], 'a busy board drew another day\'s events');
  });

  test('three lines at one dinner is one event, not three', async () => {
    // The count is the count the BOARD has, after every rule and every
    // merge: one thing that three calendars describe is one stop on the map,
    // so a household whose evening is shared still reads as a quiet day.
    const shared = JSON.stringify({
      lines: [{ name: 'Ada' }, { name: 'Bo' }, { name: 'Cy' }],
      calendars: [{ url: 'https://example.com/a.ics',
        rules: [{ match: { type: 'contains', value: 'Dinner' },
          line: ['Ada', 'Bo', 'Cy'], rename: false }] }],
    });
    const r = await board([
      ['20260909', '1800', '1900', 'Family Dinner'],
      ['20260910', '0900', '1000', 'Sprint Review'],
    ], { config_json: shared });
    assertEqual(r.days.length, 2, 'a shared dinner was counted once per line');
  });

  test('an all-day state is not an event on the scale of hours', async () => {
    // It has no hour, so it takes no room a quiet day is short of. Counted
    // as content, a line on half term would have stopped the stretch from
    // happening on exactly the emptiest day of the year.
    let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n';
    ics += 'BEGIN:VEVENT\r\nUID:h\r\nDTSTART;VALUE=DATE:20260909\r\nDTEND;VALUE=DATE:20260912\r\n'
      + 'SUMMARY:Half Term\r\nEND:VEVENT\r\n';
    ics += 'BEGIN:VEVENT\r\nUID:t\r\nDTSTART:20260910T090000Z\r\nDTEND:20260910T100000Z\r\n'
      + 'SUMMARY:Sprint Review\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const r = (await runTransform(net(ics), NOW).run(input())).data;
    assertEqual(r.days.length, 2, 'an all-day entry was counted as an event');
    assertEqual(r.all_day.map((a) => a.title), ['Half Term'],
      'the state itself should still be declared, once, at its line\'s head');
  });

  test('the window is the 36 hours, on the hour, from the shown day\'s own midnight', async () => {
    const r = await board(QUIET);
    assert(r.rolling, 'no window on a rolling board');
    assertEqual(r.rolling.start_min, 6 * 60, 'the window should open at six in the morning');
    assertEqual(r.rolling.end_min, DAY + 18 * 60, 'the window should close at six the next evening');
    assertEqual([r.day_start_min, r.day_end_min], [6 * 60, DAY + 18 * 60],
      'the stated window and the drawn one disagree');
    // Minute zero is still the shown day's midnight, which is what lets
    // everything downstream go on reading one number line.
    assertEqual(r.days.map((d) => d.start_min), [0, DAY], 'the run is not rebased onto the shown day');
    assert(r.days[0].date_label && r.days[1].date_label
      && r.days[0].date_label !== r.days[1].date_label,
      'both days have to name themselves: ' + JSON.stringify(r.days.map((d) => d.date_label)));
    assert(r.days[1].weekday_short, 'a day with no short weekday has nothing to write in a narrow strip');
  });

  test('tomorrow morning lands at tomorrow\'s time, and tomorrow night is not drawn', async () => {
    const r = await board(QUIET);
    const by = {};
    r.events.forEach((e) => { by[e.title] = e; });
    assertEqual(by.Dentist.start_min, 14 * 60, 'today\'s event moved');
    assert(by['Sprint Review'], 'tomorrow\'s 09:00 is missing from a 36-hour board');
    assertEqual(by['Sprint Review'].start_min, DAY + 9 * 60,
      'tomorrow\'s 09:00 has to be 09:00 of the SECOND day, not of the first');
    assert(!by['Book Club'], 'a 19:00 event past the end of the window was drawn anyway');
  });

  test('the window opens earlier for a day that starts earlier, and closes later for an event still running', async () => {
    // A window that cut an event it had already decided to draw would be
    // drawing half of it.
    const early = await board([
      ['20260909', '0430', '0530', 'Early Shift'],
      ['20260910', '0900', '1000', 'Sprint Review'],
    ]);
    assertEqual(early.rolling.start_min, 3 * 60,
      'a 04:30 start should pull the window back to the hour before it');
    const late = await board([
      ['20260909', '1400', '1500', 'Dentist'],
      ['20260910', '1600', '1730', 'Handover'],
    ]);
    assertEqual(late.rolling.end_min, DAY + 19 * 60,
      'an event running to 17:30 needs room past it for its own caption');
  });

  test('the reader can ask for one day and get exactly the old board', async () => {
    const off = await board(QUIET, { rolling_view: 'one' });
    assertEqual(off.days.length, 1, 'the stretch happened with the setting off');
    assertEqual(off.rolling, null, 'a window was sent with the setting off');
    assertEqual(off.events.map((e) => e.title), ['Dentist'], 'another day\'s events were drawn');
  });

  test('the stretch follows the day the Show setting picked', async () => {
    // Tomorrow, quiet, borrows the day after it: which means the day after
    // has to have been fetched at all, and the board has to be about
    // tomorrow rather than about today plus one.
    const r = await board([
      ['20260910', '1400', '1500', 'Dentist'],
      ['20260911', '0900', '1000', 'Sprint Review'],
    ], { show_day: 'tomorrow' });
    assertEqual(r.days.length, 2, 'a quiet tomorrow did not borrow the day after it');
    const titles = r.events.map((e) => [e.title, e.start_min]);
    assertEqual(titles.sort(), [['Dentist', 14 * 60], ['Sprint Review', DAY + 9 * 60]],
      'a board about tomorrow drew the wrong two days: ' + JSON.stringify(titles));
    assertEqual(r.now_min, null, 'a board that is not about today still carried a clock');
    // And the evening switch-over takes the whole window with it.
    const at = Date.parse('2026-09-09T21:00:00Z');
    const auto = (await runTransform(net(feed([
      ['20260910', '1400', '1500', 'Dentist'],
      ['20260911', '0900', '1000', 'Sprint Review'],
    ])), at).run(baseInput(at, {
      use_demo_data: 'false', lat_lon: '51.05,3.72', show_day: 'auto',
      config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
    }))).data;
    assertEqual(auto.events.map((e) => e.title).sort(), ['Dentist', 'Sprint Review'],
      'the evening board should have switched over to tomorrow and kept rolling');
  });

  test('a day the board is not drawing leaves the board as it found it', async () => {
    // The run has to be fetched before the count is known, so a busy board
    // has read a day it will not draw. Nothing about that day may reach the
    // drawing: not an event, not a line of its own, not a line's weight.
    const cfg = JSON.stringify({
      calendars: [
        { url: 'https://example.com/a.ics', name: 'Ada' },
        { url: 'https://example.com/b.ics', name: 'Bo' },
      ],
    });
    const netTwo = async (url) => {
      if (String(url).indexOf('api.open-meteo.com') >= 0) return okText('{}');
      if (String(url).indexOf('/b.ics') >= 0) {
        // Bo exists on the day after tomorrow and on no other day.
        return okText(feed([['20260911', '1000', '1100', 'Bo Only']]));
      }
      // Busy enough on the day being shown that nothing is borrowed.
      return okText(feed([
        ['20260910', '0900', '0915', 'Standup'],
        ['20260910', '1100', '1200', 'Workshop'],
        ['20260910', '1400', '1500', 'Dentist'],
      ]));
    };
    const r = (await runTransform(netTwo, NOW).run(baseInput(NOW, {
      use_demo_data: 'false', config_json: cfg, show_day: 'tomorrow',
    }))).data;
    assertEqual(r.legend.map((t) => t.name), ['Ada'],
      'a line that exists only on a day the board is not drawing got a rail: '
      + JSON.stringify(r.legend.map((t) => t.name)));
  });

  test('the same day reads the same at every hour of it', async () => {
    // THE STABILITY CASE. Counted from the clock forwards, a day loses
    // events as it goes: a four-event day would drop to two by mid
    // afternoon and stretch itself then, and an e-ink panel refreshing
    // every fifteen minutes would rearrange under whoever was reading it.
    // Anchored to "now", the window would slide four times an hour.
    const rows = [
      ['20260909', '0900', '0915', 'Standup'],
      ['20260909', '1100', '1200', 'Workshop'],
      ['20260909', '1400', '1500', 'Dentist'],
      ['20260909', '1900', '2000', 'Book Club'],
      ['20260910', '0900', '1000', 'Sprint Review'],
    ];
    const shapes = [];
    for (const hh of ['0015', '0700', '1215', '1600', '2030']) {
      const when = Date.parse('2026-09-09T' + hh.slice(0, 2) + ':' + hh.slice(2) + ':00Z');
      const r = (await runTransform(net(feed(rows)), when).run(baseInput(when, {
        use_demo_data: 'false', lat_lon: '51.05,3.72',
        config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
      }))).data;
      shapes.push({ at: hh, shape: r.days.length + ' day(s) ' + JSON.stringify(r.rolling) });
    }
    assertEqual([...new Set(shapes.map((s) => s.shape))].length, 1,
      'the board changed shape during the day: '
      + shapes.map((s) => s.at + ' ' + s.shape).join(' | '));

    // And a quiet day is quiet at every hour of it too, window and all.
    const quiet = [];
    for (const hh of ['0015', '0700', '1600', '2030']) {
      const when = Date.parse('2026-09-09T' + hh.slice(0, 2) + ':' + hh.slice(2) + ':00Z');
      const r = (await runTransform(net(feed(QUIET)), when).run(baseInput(when, {
        use_demo_data: 'false', lat_lon: '51.05,3.72',
        config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
      }))).data;
      quiet.push({ at: hh, shape: JSON.stringify(r.rolling) + ' '
        + JSON.stringify(r.events.map((e) => e.start_min)) });
    }
    assertEqual([...new Set(quiet.map((s) => s.shape))].length, 1,
      'the rolling window moved with the clock: '
      + quiet.map((s) => s.at + ' ' + s.shape).join(' | '));
  });

  test('the sky of the day after is on the board, and only the part of it that is', async () => {
    const r = await board(QUIET);
    const sun = r.weather.filter((i) => i.type === 'sun').map((i) => i.at_min);
    assertEqual(sun, [6 * 60 + 30, 20 * 60 + 30, DAY + 6 * 60 + 32],
      'expected today\'s sunrise and sunset and tomorrow\'s sunrise, got ' + JSON.stringify(sun));
  });
};
