'use strict';

// The day model, and which day the board draws.
//
// The board draws ONE day. A run of days on one axis was built and thrown
// away: on a panel this size three days of a family's week is three columns
// of an hour each, and what a wall calendar is for is the day you are in.
//
// One exception, and it has a file of its own (cases/rolling.js): a day with
// almost nothing on it borrows the next one, so the run becomes two days and
// the payload carries a window into it. Every case here is about WHICH day
// is drawn and how it is rebased, which is a different question, so they run
// with that stretch switched off rather than with days busy enough to avoid
// it by accident.
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
      use_demo_data: 'false', lat_lon: '51.05,3.72', rolling_view: 'one',
      config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
    }, fields || {}));
  }

  test('the payload describes exactly the day being drawn', async () => {
    const ics = icsWithEvents([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today' }]);
    const { run } = runTransform(net(ics), NOW);
    const r = await run(input());
    assert(Array.isArray(r.data.days), 'no days array at all');
    assertEqual(r.data.days.length, 1, 'the board draws one day, so it is told about one day');
  });

  test('the day being drawn is rebased onto its own midnight', async () => {
    // Whichever day it is. Everything downstream reads minutes from
    // midnight, and none of it should have to know which midnight.
    const ics = icsWithEvents([{ start: '20260910T090000Z', end: '20260910T100000Z', summary: 'Tomorrow' }]);
    const r = await runTransform(net(ics), NOW).run(input({ show_day: 'tomorrow' }));
    const e = r.data.events.find((i) => i&& i.title === 'Tomorrow');
    assert(e, 'tomorrow\'s event is missing on a board set to tomorrow');
    assertEqual(e.start_min, 9 * 60, 'a 09:00 event on the day being shown should be at 540');
    assertEqual(r.data.days[0].start_min, 0, 'the day being shown does not start at zero');
    assertEqual(r.data.days[0].end_min, DAY, 'the day being shown is not a day long');
  });

  test('the board shows one day, and the setting says which', async () => {
    const ics = icsWithEvents([
      { start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today Meeting' },
      { start: '20260910T090000Z', end: '20260910T100000Z', summary: 'Tomorrow Meeting' },
    ]);
    const t = await runTransform(net(ics), NOW).run(input());
    const titlesT = t.data.events.map((i) => i.title);
    assertEqual(titlesT, ['Today Meeting'], 'a board set to today drew something else');

    const m = await runTransform(net(ics), NOW).run(input({ show_day: 'tomorrow' }));
    const titlesM = m.data.events.map((i) => i.title);
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
    assertEqual(today.data.events.length, 0,
      'a Thursday standup was drawn on a Wednesday board');
    const tomorrow = await runTransform(net(ics), NOW).run(input({ show_day: 'tomorrow' }));
    const t = tomorrow.data.events;
    assertEqual(t.length, 1, 'the Thursday standup is missing from Thursday');
    assertEqual(t[0].start_min, 9 * 60, 'it is not at its own time of day');
  });

  test('the window stays inside the day being drawn', async () => {
    const ics = icsWithEvents([
      { start: '20260909T060000Z', end: '20260909T070000Z', summary: 'Early' },
      { start: '20260909T220000Z', end: '20260909T230000Z', summary: 'Late' },
    ]);
    const r = await runTransform(net(ics), NOW).run(input());
    assert(r.data.day_start_min >= 0, 'the window starts before midnight');
    assert(r.data.day_end_min <= DAY, 'the window runs past midnight into a day nobody asked for');
  });

  test('the forecast is the one for the day being drawn', async () => {
    // A board set to tomorrow that carries today's temperature is wrong
    // about the only day it is drawing.
    const ics = icsWithEvents([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today' }]);
    const today = await runTransform(net(ics), NOW).run(input());
    const tomorrow = await runTransform(net(ics), NOW).run(input({ show_day: 'tomorrow' }));
    assertEqual(today.data.header_weather.hi, 18, 'today\'s high is not today\'s');
    assertEqual(tomorrow.data.header_weather.hi, 21, 'a board set to tomorrow shows today\'s high');
  });

  test('the header names the day it is drawing, and calls it Today only when it is', async () => {
    const ics = icsWithEvents([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today' }]);
    const today = await runTransform(net(ics), NOW).run(input());
    const tomorrow = await runTransform(net(ics), NOW).run(input({ show_day: 'tomorrow' }));
    assert(today.data.date_label !== tomorrow.data.date_label,
      'both boards carry the same date: ' + today.data.date_label);
    assertEqual(today.data.title_word, null, 'a board showing today should keep the word Today');
    assert(tomorrow.data.title_word, 'a board showing tomorrow still says Today, which names the '
      + 'wrong day');
  });

  test('the board reaches tomorrow by rolling, not by giving up on today', async () => {
    // THIS REPLACES A SETTING. There was a "today, then tomorrow from the
    // evening on" option with an hour beside it, and at that hour the board
    // swapped one day for the other -- a cliff, and a lossy one: at nine it
    // threw away whatever was left of the evening while the family was still
    // standing in front of it. The rolling window reaches tomorrow from four
    // in the afternoon and keeps tonight while it does, which is what that
    // setting was trying to buy. So the setting is gone and this case watches
    // the behaviour that replaced it.
    // A BUSY today on purpose: a day with one thing left on it is quiet, and a
    // quiet day borrows tomorrow at any hour, which is a different rule (see
    // cases/rolling.js). What this case is about is the board reaching
    // tomorrow because today is SPENT, so today has to have had something in
    // it to spend.
    const ics = icsWithEvents([
      { start: '20260909T090000Z', end: '20260909T093000Z', summary: 'Standup' },
      { start: '20260909T110000Z', end: '20260909T120000Z', summary: 'Workshop' },
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
      return r.data;
    };
    const morning = await board('2026-09-09T09:00:00Z');
    assertEqual(morning.events.map((i) => i.title).sort(),
      ['Standup', 'Today Meeting', 'Workshop'],
      'the morning board should be today and nothing else');
    assertEqual(morning.rolling, null, 'a busy morning board should not be rolling');

    // By the evening it carries both, and today is still on it: that is the
    // whole difference from the switch it replaced.
    const evening = await board('2026-09-09T19:00:00Z');
    const titles = evening.events.map((i) => i.title);
    assert(titles.indexOf('Tomorrow Meeting') >= 0,
      'the evening board never reached tomorrow: ' + JSON.stringify(titles));
    assert(titles.indexOf('Today Meeting') >= 0,
      'the evening board dropped today to get there: ' + JSON.stringify(titles));

    // ...AND IT REACHES THE END OF TOMORROW ONCE TODAY IS SPENT. Six in the
    // evening of the following day is the right far end for a board opened
    // this morning and the wrong one for a board read at ten at night, which
    // is almost all tomorrow already.
    const late = await board('2026-09-09T22:00:00Z');
    assert(late.rolling, 'a board read late should be rolling');
    assert(late.rolling.end_min >= 24 * 60 + 22 * 60,
      'the window stops at ' + late.rolling.end_min + ', cutting off tomorrow evening');

    // A board somebody had already set to "auto" is read as today rather than
    // refused: rolling is what they were asking for.
    const legacy = await board('2026-09-09T22:00:00Z', { show_day: 'auto' });
    assertEqual(legacy.events.map((i) => i.title).sort(),
      late.events.map((i) => i.title).sort(),
      'a saved "auto" should draw the same board as today does');
    assertEqual(legacy.title_word, late.title_word,
      'a saved "auto" named a different day from today');
  });

  // -------------------------------------------------------------------
  // The sky band, the clock, and the day they belong to.
  //
  // The forecast is fetched for the whole run and the board draws one day
  // of it. Everything read out of that response at a fixed day 0 is right
  // by accident on a board showing today and wrong on every other one.
  // -------------------------------------------------------------------

  // Two days of hourly probabilities, 07:00-21:00 each. Today rains from
  // 13:00 and is still raining at nightfall (one crossing, not two);
  // tomorrow rains from 09:00 to 12:00 (two).
  function twoDayForecast() {
    const time = [], pp = [];
    const push = (date, wet) => {
      for (let hh = 7; hh <= 21; hh++) {
        time.push(date + 'T' + String(hh).padStart(2, '0') + ':00');
        pp.push(wet(hh) ? 80 : 5);
      }
    };
    push('2026-09-09', (hh) => hh >= 13);
    push('2026-09-10', (hh) => hh >= 9 && hh < 12);
    return JSON.stringify({
      daily: {
        temperature_2m_max: [18, 21], temperature_2m_min: [11, 13],
        precipitation_probability_max: [80, 80], weathercode: [61, 61],
        sunrise: ['2026-09-09T06:30', '2026-09-10T06:32'],
        sunset: ['2026-09-09T20:30', '2026-09-10T20:27'],
      },
      hourly: { time: time, precipitation_probability: pp },
    });
  }

  function skyNet(ics) {
    return async (url) => {
      if (String(url).indexOf('api.open-meteo.com') >= 0) return okText(twoDayForecast());
      return okText(ics);
    };
  }

  const BOTH = icsWithEvents([
    { start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today Meeting' },
    { start: '20260910T090000Z', end: '20260910T100000Z', summary: 'Tomorrow Meeting' },
  ]);

  function sky(metro, kind) {
    return metro.weather.filter((i) => i.type === kind).map((i) => i.at_min);
  }

  test('rain markers start and stop within one day, in that order', async () => {
    // Read straight down the response, today borrowed tomorrow's first
    // crossing as soon as it had fewer than two of its own, and carried
    // "it is raining" over the midnight gap: a dry 07:00 tomorrow came out
    // as "Rain Stops 07:00" drawn six hours BEFORE the 13:00 it belonged
    // to. A day's rain starts and stops inside that day or not at all.
    const r = await runTransform(skyNet(BOTH), NOW).run(input());
    const at = sky(r.data, 'weather');
    assertEqual(at, [13 * 60], 'today has one crossing of its own: ' + JSON.stringify(at));
    const labels = r.data.weather.filter((i) => i.type === 'weather').map((i) => i.label);
    assert(/Rain Starts/i.test(labels[0] || ''), 'the one marker should be the rain starting: ' + JSON.stringify(labels));
  });

  test('a board showing tomorrow gets tomorrow\'s rain, not today\'s', async () => {
    const r = await runTransform(skyNet(BOTH), NOW).run(input({ show_day: 'tomorrow' }));
    assertEqual(sky(r.data, 'weather'), [9 * 60, 12 * 60],
      'tomorrow rains 09:00-12:00: ' + JSON.stringify(r.data.weather.filter((i) => i.type === 'weather')));
  });

  test('a board showing tomorrow gets tomorrow\'s sunset', async () => {
    // A couple of minutes, which is the whole point: nobody would ever
    // spot this on the board, so it has to be spotted here.
    const today = await runTransform(skyNet(BOTH), NOW).run(input());
    assertEqual(sky(today.data, 'sun'), [6 * 60 + 30, 20 * 60 + 30], 'today\'s sun');
    const tom = await runTransform(skyNet(BOTH), NOW).run(input({ show_day: 'tomorrow' }));
    assertEqual(sky(tom.data, 'sun'), [6 * 60 + 32, 20 * 60 + 27], 'tomorrow\'s sun');
  });

  test('there is no "now" on a day that is not now', async () => {
    // now_min is what draws the clock badge and parks a car on every line
    // at that minute. On tomorrow's board that minute has not happened to
    // anybody, and the marker would be claiming five people are somewhere
    // they have not been yet.
    const today = await runTransform(skyNet(BOTH), NOW).run(input());
    assertEqual(today.data.now_min, 9 * 60, 'today\'s board should carry the clock');
    const tom = await runTransform(skyNet(BOTH), NOW).run(input({ show_day: 'tomorrow' }));
    assertEqual(tom.data.now_min, null, 'tomorrow\'s board carried a "now": ' + tom.data.now_min);
  });

  test('a board that is not about today carries no clock, and tomorrow\'s sky', async () => {
    // "Now" is a fact about today. Drawn on a board showing tomorrow it points
    // at a minute of a day the board is not about, and the sky marker has to
    // travel with the board for the same reason.
    //
    // This used to be asked of the evening switch-over, which was the state a
    // wall screen was in every single evening. That setting is gone -- the
    // rolling window reaches tomorrow without giving up today -- so the
    // question is asked of the setting that still picks a day outright.
    const evening = Date.parse('2026-09-09T19:00:00Z');
    const r = await runTransform(skyNet(BOTH), evening).run(
      baseInput(evening, {
        use_demo_data: 'false', lat_lon: '51.05,3.72', show_day: 'tomorrow',
        config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
      }));
    assert(r.data.events.some((i) => i && i.title === 'Tomorrow Meeting'),
      'the board should be drawing tomorrow');
    assertEqual(r.data.now_min, null, 'a board about tomorrow carried a "now": ' + r.data.now_min);
    assertEqual(sky(r.data, 'weather'), [9 * 60, 12 * 60], 'and tomorrow\'s rain with it');
  });

  test('the day on the board carries its own forecast in days[0]', async () => {
    // The header and days[0].weather are the same fact told twice, and
    // they disagreed: a snapshot with no run of days in it left the header
    // filled and days[0].weather null.
    const r = await runTransform(skyNet(BOTH), NOW).run(input({ show_day: 'tomorrow' }));
    assert(r.data.days[0].weather, 'no forecast on the day being drawn');
    assertEqual(r.data.days[0].weather.hi, 21, 'tomorrow\'s high');
    assertEqual(r.data.header_weather.hi, 21, 'the header should agree with it');
  });
};
