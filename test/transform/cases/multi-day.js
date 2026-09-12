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
      use_demo_data: 'false', lat_lon: '51.05,3.72',
      config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
    }, fields || {}));
  }
  // A DAY WITH ENOUGH ON IT TO STAY ONE DAY. These cases used to ask for a
  // single-day board with `rolling_view: 'one'`; that setting is gone and a
  // quiet day always borrows the next one now, so a case that wants one day
  // has to earn it the way a real board does -- by having a day on it.
  const BUSY_TODAY = [
    { start: '20260909T090000Z', end: '20260909T093000Z', summary: 'Standup' },
    { start: '20260909T110000Z', end: '20260909T120000Z', summary: 'Workshop' },
    { start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Today' },
  ];

  test('the payload describes exactly the days being drawn', async () => {
    const busy = await runTransform(net(icsWithEvents(BUSY_TODAY)), NOW).run(input());
    assert(Array.isArray(busy.data.days), 'no days array at all');
    assertEqual(busy.data.days.length, 1, 'a busy board draws one day, so it is told about one');

    // ...and a quiet one is told about the day it borrowed, and no more.
    const quiet = await runTransform(net(icsWithEvents([BUSY_TODAY[2]])), NOW).run(input());
    assertEqual(quiet.data.days.length, 2, 'a quiet board did not borrow tomorrow');
  });

  test('the day being drawn is rebased onto its own midnight', async () => {
    // Everything downstream reads minutes from midnight, and none of it
    // should have to know which midnight.
    const r = await runTransform(net(icsWithEvents(BUSY_TODAY)), NOW).run(input());
    const e = r.data.events.find((i) => i && i.title === 'Today');
    assert(e, 'the afternoon event is missing');
    assertEqual(e.start_min, 14 * 60, 'a 14:00 event should be at 840');
    assertEqual(r.data.days[0].start_min, 0, 'the day being shown does not start at zero');
    assertEqual(r.data.days[0].end_min, DAY, 'the day being shown is not a day long');
  });

  test('a busy board draws today and nothing else', async () => {
    // THE SETTING THAT USED TO SAY WHICH DAY IS GONE. "Tomorrow" drew
    // tomorrow all day long, which on a screen on a wall is a board that is
    // wrong every morning: it cannot say what time it is, because now is not
    // on it. What a reader wanted from it they get from the afternoon onward
    // anyway, and with today still underneath.
    const ics = icsWithEvents(BUSY_TODAY.concat([
      { start: '20260910T090000Z', end: '20260910T100000Z', summary: 'Tomorrow Meeting' },
    ]));
    const t = await runTransform(net(ics), NOW).run(input());
    assertEqual(t.data.events.map((i) => i.title).sort(),
      ['Standup', 'Today', 'Workshop'], 'a busy morning board drew another day');
    assertEqual(t.data.title_word, null, 'a board about today should not name a different day');
  });

  test('a recurrence is evaluated against the day it lands on', async () => {
    // It is Wednesday. A Thursday-only standup is not on a board about
    // Wednesday, and IS on the Thursday a quiet Wednesday borrows. Evaluated
    // against today whichever day it is drawn on, the borrowed day would show
    // Wednesday's meetings at Thursday's date, which is the worst of both.
    const rec = { start: '20260903T090000Z', end: '20260903T091500Z', summary: 'Thursday Standup',
      rrule: 'FREQ=WEEKLY;BYDAY=TH' };
    const busy = await runTransform(net(icsWithEvents(BUSY_TODAY.concat([rec]))), NOW).run(input());
    assertEqual(busy.data.events.filter((e) => e.title === 'Thursday Standup').length, 0,
      'a Thursday standup was drawn on a busy Wednesday board');

    const quiet = await runTransform(net(icsWithEvents([rec])), NOW).run(input());
    const t = quiet.data.events.filter((e) => e.title === 'Thursday Standup');
    assertEqual(t.length, 1, 'the Thursday standup is missing from the borrowed Thursday');
    assertEqual(t[0].start_min, DAY + 9 * 60, 'it is not at its own time of day');
  });

  test('the window stays inside the day being drawn, unless the board rolled', async () => {
    const ics = icsWithEvents(BUSY_TODAY.concat([
      { start: '20260909T060000Z', end: '20260909T070000Z', summary: 'Early' },
      { start: '20260909T220000Z', end: '20260909T230000Z', summary: 'Late' },
    ]));
    const r = await runTransform(net(ics), NOW).run(input());
    assertEqual(r.data.rolling, null, 'this board should be busy enough to stay one day');
    assert(r.data.day_start_min >= 0, 'the window starts before midnight');
    assert(r.data.day_end_min <= DAY, 'the window runs past midnight into a day nobody asked for');
  });

  test('the forecast is the one for the day it is about', async () => {
    const busy = await runTransform(net(icsWithEvents(BUSY_TODAY)), NOW).run(input());
    assertEqual(busy.data.header_weather.hi, 18, 'today\'s high is not today\'s');
    assertEqual(busy.data.days[0].weather.hi, 18, 'the drawn day carries somebody else\'s weather');

    // ...and the borrowed day carries its own, which is the whole reason a
    // rolling board has two of them.
    const quiet = await runTransform(net(icsWithEvents([BUSY_TODAY[2]])), NOW).run(input());
    assertEqual(quiet.data.days.length, 2, 'a quiet board did not borrow tomorrow');
    assertEqual(quiet.data.days[1].weather.hi, 21,
      'the borrowed day shows today\'s high, which is a fact about the wrong day');
  });

  test('the board is always about today, and says so', async () => {
    // `title_word` names the day when the board is NOT about today. Nothing
    // draws another day outright any more -- a rolling board is today PLUS
    // tomorrow, not tomorrow instead of today -- so it is always null, and
    // the date is always today's.
    const r = await runTransform(net(icsWithEvents(BUSY_TODAY)), NOW).run(input());
    assertEqual(r.data.title_word, null, 'the board named a day other than today');
    assert(r.data.date_label, 'the board carries no date at all');
    assert(r.data.now_min != null, 'a board about today should carry the time');
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

  test('the sky belongs to the day the board opens on', async () => {
    // This used to be about the sun: a couple of minutes between one day's
    // sunset and the next, which nobody would ever spot on the board, so it
    // was spotted here. The sun markers are gone, and what the case is
    // really guarding is that the sky is read per day rather than at a
    // fixed [0] -- so it asks that of the markers that are left.
    const today = await runTransform(skyNet(BOTH), NOW).run(input());
    assertEqual(sky(today.data, 'sun'), [], 'a sun marker came back');
    assert(sky(today.data, 'weather').length > 0,
      'the day lost its rain markers along with its sun');
  });

  test('the board carries the clock, because it is about now', async () => {
    // now_min is what draws the clock badge and parks a car on every line at
    // that minute. It used to be withheld from a board set to tomorrow, where
    // that minute had not happened to anybody. There is no such board now:
    // a rolling board is today PLUS tomorrow, and now is on the today half.
    const r = await runTransform(skyNet(BOTH), NOW).run(input());
    assertEqual(r.data.now_min, 9 * 60, 'the board should carry the clock');
  });

  test('the day on the board carries its own forecast in days[0]', async () => {
    // The header and days[0].weather are the same fact told twice, and
    // they disagreed: a snapshot with no run of days in it left the header
    // filled and days[0].weather null.
    const r = await runTransform(skyNet(BOTH), NOW).run(input());
    assert(r.data.days[0].weather, 'no forecast on the day being drawn');
    assertEqual(r.data.days[0].weather.hi, 18, 'today\'s high');
    assertEqual(r.data.header_weather.hi, 18, 'the header should agree with it');
  });
};
