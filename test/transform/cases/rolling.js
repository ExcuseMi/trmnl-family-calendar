'use strict';

// A QUIET DAY BORROWS THE NEXT ONE.
//
// Two appointments leave a board that is mostly empty paper, spent on hours
// nobody has anything in. At or below QUIET_DAY_MAX_EVENTS the run becomes
// two days and the payload carries a window into it: six in the morning of
// the day being shown through to six the following evening. Anything busier
// is the single-day board it always was, byte for byte.
//
// The count is of what is STILL TO COME, not of what the day had. "Was this
// a quiet day" is a question nobody asks; "what is coming" is the one a
// board on a wall is standing there to answer, and it is asked in the
// evening, when a busy Tuesday has one thing left on it and eleven that
// already happened.
//
// What must not go wrong is STABILITY. The panel refreshes every fifteen
// minutes, so neither the count nor the window may be read from the clock
// continuously: everything would slide left four times an hour. So the
// boundary both are measured from moves exactly once a day, at four in the
// afternoon. The COUNT of what is still to come is taken on the hour, so the
// board notices an evening emptying out; that is safe only because the set of
// events still to come can only shrink, so a board gains tomorrow once and
// cannot lose it again. The case that pins both down is 'the board gains
// tomorrow once, on an hour, and never gives it back'.

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

  // THE OPT-OUT IS GONE, AND SO IS THE DAY PICKER.
  //
  // Two cases lived here. One turned the stretch off ("Quiet Days: always one
  // day") and checked the board came out exactly as it used to; the other set
  // the board to tomorrow and checked the stretch followed it into the day
  // after.
  //
  // The opt-out existed because a board that changes shape on its own needs a
  // way to be told not to -- and what made that alarming was the shape
  // changing WHILE somebody read it, which the four o'clock boundary fixed
  // (see 'a day has two shapes at most, and it changes at four'). A board that
  // quietly shows more of what is coming needs no opt-out. The day picker went
  // with it: a board about tomorrow cannot say what time it is.
  //
  // What is left of both is that a board somebody already saved with either
  // setting still draws a board, which the case below checks.

  test('a setting the board no longer reads still draws a board', async () => {
    const at = Date.parse('2026-09-09T21:00:00Z');
    const rows = [['20260910', '1400', '1500', 'Dentist'], ['20260911', '0900', '1000', 'Sprint Review']];
    const run = async (fields) => (await runTransform(net(feed(rows)), at).run(baseInput(at,
      Object.assign({ use_demo_data: 'false', lat_lon: '51.05,3.72',
        config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
      }, fields)))).data;
    const plain = await run({});
    for (const stale of [{ show_day: 'auto' }, { show_day: 'tomorrow' }, { rolling_view: 'one' },
                         { show_day: 'auto', switch_hour: '18', rolling_view: 'one' }]) {
      const r = await run(stale);
      assertEqual(r.events.map((e) => e.title).sort(), plain.events.map((e) => e.title).sort(),
        JSON.stringify(stale) + ' drew a different board');
      assertEqual(r.title_word, plain.title_word, JSON.stringify(stale) + ' named a different day');
      assertEqual(r.days.length, plain.days.length, JSON.stringify(stale) + ' drew a different run of days');
    }
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

  test('the board gains tomorrow once, on an hour, and never gives it back', async () => {
    // THE STABILITY CASE, AS THE RULE NOW STANDS, and the rule changed twice
    // before it was right. A board keyed to the clock would lose events as
    // the day went on, stretch itself the moment the count dropped, and
    // rearrange under whoever was reading it: an e-ink panel refreshes every
    // fifteen minutes, so the window would slide four times an hour.
    //
    // The first answer was one fixed boundary at four, which held the board
    // still and made it blind -- a day with three or more things after four
    // never reached tomorrow at all. The second was a fixed boundary at nine
    // on top of it, which guessed at what the count could be asked and was
    // still wrong at a quarter past eight.
    //
    // What holds both ends is separating the two: the WINDOW moves once, at
    // four, so nothing slides; the COUNT is taken on the hour, so the board
    // notices the evening emptying out. That is safe in one direction only,
    // and the reason is what this case pins: the set of events still to come
    // only ever shrinks, so a board can gain tomorrow and cannot lose it.
    const rows = [
      ['20260909', '0900', '0915', 'Standup'],
      ['20260909', '1100', '1200', 'Workshop'],
      ['20260909', '1400', '1500', 'Dentist'],
      ['20260909', '1900', '2000', 'Book Club'],
      ['20260910', '0900', '1000', 'Sprint Review'],
    ];
    async function shapeAt(hh) {
      const when = Date.parse('2026-09-09T' + hh.slice(0, 2) + ':' + hh.slice(2) + ':00Z');
      const r = (await runTransform(net(feed(rows)), when).run(baseInput(when, {
        use_demo_data: 'false', lat_lon: '51.05,3.72',
        config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
      }))).data;
      return { rolling: !!r.rolling, shape: r.days.length + ' day(s) ' + JSON.stringify(r.rolling) };
    }
    // Every quarter of an hour through the whole day, which is how often the
    // panel actually redraws.
    const seen = [];
    for (let min = 0; min < 24 * 60; min += 15) {
      const hh = String(Math.floor(min / 60)).padStart(2, '0') + String(min % 60).padStart(2, '0');
      seen.push(Object.assign({ at: hh }, await shapeAt(hh)));
    }
    // ONCE. Not never, not twice, not four times an hour.
    const flips = seen.filter((s, i) => i > 0 && s.shape !== seen[i - 1].shape);
    assertEqual(flips.length, 1, 'the board changed shape ' + flips.length + ' time(s): '
      + flips.map((f) => f.at + ' -> ' + f.shape).join(' | '));
    // ...on an hour, so it never happens mid-quarter under a reader.
    assertEqual(flips[0].at.slice(2), '00', 'the board changed shape at ' + flips[0].at
      + ', which is not an hour boundary');
    // ...and in the direction that gains a day, never the one that loses it.
    assertEqual(flips[0].rolling, true, 'the board gave tomorrow back at ' + flips[0].at);
    // Monotone all the way to midnight: once it has tomorrow it keeps it.
    const first = seen.findIndex((s) => s.rolling);
    assert(first > 0, 'this day never borrowed tomorrow at all');
    assert(seen.slice(first).every((s) => s.rolling),
      'the board lost tomorrow again after gaining it');
  });

  test('a busy evening reaches tomorrow as soon as the evening empties out', async () => {
    // THE CASE THAT WAS MISSING, AND IT COST TWO WRONG ANSWERS ON A REAL
    // BOARD. The count used to be taken at four and never taken again, so a
    // day with three or more things after four never reached tomorrow at all:
    // the panel was still drawing only Saturday at ten to eight, and again at
    // a quarter past eight with one event left on it.
    //
    // A fixed second boundary at nine was tried and was the wrong shape of
    // answer -- it guessed at what the count could simply be asked, and was
    // still wrong at 8:15. The count is taken on the hour now.
    const rows = [
      ['20260909', '0900', '1000', 'Book Club'],
      ['20260909', '1400', '1500', 'Reactor Core Check'],
      ['20260909', '1700', '1800', 'Skate Park'],
      ['20260909', '1900', '2000', 'Moe\'s Tavern'],
      ['20260909', '1930', '2030', 'Family Dinner'],
      ['20260910', '1000', '1100', 'Sunday Swim'],
    ];
    const at = async (hh) => {
      const when = Date.parse('2026-09-09T' + hh + ':00Z');
      return (await runTransform(net(feed(rows)), when).run(baseInput(when, {
        use_demo_data: 'false', lat_lon: '51.05,3.72',
        config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
      }))).data;
    };
    // Three things still to come at half past five, so the board is today's.
    assertEqual((await at('17:30')).rolling, null,
      'the board reached tomorrow with three things still to come tonight');

    // Two at half past six, and that is the whole day it has left.
    const evening = await at('18:30');
    assert(evening.rolling, 'the board never noticed the evening emptying out');
    const titles = evening.events.map((e) => e.title);
    assert(titles.indexOf('Sunday Swim') >= 0, 'tomorrow never arrived: ' + JSON.stringify(titles));
    assert(titles.indexOf('Family Dinner') >= 0,
      'tonight was thrown away to get there, which is the thing this replaced');
    assert(titles.indexOf('Book Club') >= 0,
      'the morning fell off: the window opens at four, whatever the count saw');

    // ...and it does not change its mind back, at any hour after.
    for (const hh of ['19:50', '20:15', '22:00', '23:45']) {
      assert((await at(hh)).rolling, 'the board gave tomorrow back at ' + hh);
    }
  });

  test('a rolling board carries no sunrise and no sunset', async () => {
    // It used to carry three: today's sunrise, today's sunset, and the
    // borrowed day's sunrise, each shifted onto the window's own number
    // line. That was the most intricate piece of the sky code and it drew
    // the two marks nobody was reading. The whole branch is gone, so what
    // is worth asserting is that it stays gone: a payload with anything but
    // a weather marker in `weather` is the old path back.
    const r = await board(QUIET);
    assertEqual(r.weather.filter((i) => i.type !== 'weather'), [],
      'a rolling board put sky markers back on: ' + JSON.stringify(r.weather));
  });
};
