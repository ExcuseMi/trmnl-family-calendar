'use strict';

// A HOLIDAY IS A PROPERTY OF THE DAY, NOT A STATE OF A LINE.
//
// People subscribe to "Holidays in Belgium", to Apple's equivalent, to a
// school's own term-dates feed. Those feeds are whole-day entries, often
// recurring yearly, often covering a range of days, and they belong to
// everybody in the house rather than to one person.
//
// The plugin had no concept of them. They arrived as ordinary all-day
// events, were routed by whichever rule happened to match, and landed at
// ONE line's head -- or, where the calendar carried a name and nothing
// routed them, put a whole extra LINE on the board called "Holidays in
// Belgium", with both ends drawn as open chevrons, as if the country were
// a member of the family who was away.
//
// `holiday: true`, on a calendar or on a rule, takes the event off the
// line model altogether: it reaches the payload as `data.holidays`, which
// the header states beside the date, and it resolves no owner at all.
//
// These cases pin down the four things that were wrong: that a holiday
// makes no line, that a yearly recurrence is seen at all, that a range
// says which day of it the board is drawing, and that the day an entry
// belongs to survives the trip (it did not: every all-day entry was read
// as day 0, so tomorrow's holiday was announced today and a board set to
// tomorrow threw all of them away).

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, eventItems, assert, assertEqual } = h;

  const NOW = Date.parse('2026-12-25T09:00:00Z');   // Christmas Day, a Friday
  const cfgWith = (json) => ({ config_json: JSON.stringify(json) });

  // A whole-day VEVENT, written the way a real holiday feed writes one:
  // DTSTART;VALUE=DATE with an EXCLUSIVE DTEND. icsWithEvents() always
  // emits a plain DTSTART, so these are built here instead.
  function allDayIcs(entries, calName) {
    let s = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n';
    if (calName) s += 'X-WR-CALNAME:' + calName + '\r\n';
    entries.forEach((e, i) => {
      s += 'BEGIN:VEVENT\r\nUID:hol' + i + '@example\r\nDTSTAMP:20260101T000000Z\r\n';
      s += 'DTSTART;VALUE=DATE:' + e.start + '\r\n';
      if (e.end) s += 'DTEND;VALUE=DATE:' + e.end + '\r\n';
      if (e.rrule) s += 'RRULE:' + e.rrule + '\r\n';
      s += 'SUMMARY:' + e.summary + '\r\nEND:VEVENT\r\n';
    });
    return s + 'END:VCALENDAR\r\n';
  }

  // The holiday feed answers on /hol; everything else answers empty. Served
  // to every URL alike, the holiday ICS also came back as Ada's own
  // calendar, and the case passed or failed on that instead.
  const serve = (text) => async (url) => okText(
    String(url).indexOf('/ada.ics') >= 0 ? icsWithEvents([]) : text);

  // The everyday setup: a line per person, plus a subscribed holiday feed
  // that names nobody.
  function config(over) {
    return Object.assign({
      lines: [{ name: 'Ada' }, { name: 'Bo' }],
      calendars: [
        { url: 'https://example.com/ada.ics', name: 'Ada',
          rules: [{ match: { type: 'any' }, line: 'Ada' }] },
        { url: 'https://example.com/hol.ics', holiday: true },
      ],
    }, over || {});
  }

  // ---------------------------------------------------------------- whose

  test('a holiday belongs to the day, not to anybody', async () => {
    const r = await runTransform(serve(allDayIcs(
      [{ start: '20261225', end: '20261226', summary: 'Christmas Day' }], 'Holidays in Belgium')), NOW)
      .run(baseInput(NOW, cfgWith(config())));
    assertEqual((r.data.holidays || []).map((x) => x.title), ['Christmas Day'],
      'the day is not named');
    assertEqual(r.data.all_day, [],
      'a holiday was declared at a line\'s head: it is nobody\'s state');
  });

  test('a holiday feed puts no line on the board', async () => {
    // The ghost line. A named calendar's name becomes a LINE for anything
    // no rule routes, so a subscribed "Holidays in Belgium" drew a rail of
    // its own, named after a country, on 11 days a year and no others.
    const r = await runTransform(serve(allDayIcs(
      [{ start: '20261225', end: '20261226', summary: 'Christmas Day' }], 'Holidays in Belgium')), NOW)
      .run(baseInput(NOW, cfgWith(config({
        calendars: [
          { url: 'https://example.com/ada.ics', name: 'Ada',
            rules: [{ match: { type: 'any' }, line: 'Ada' }] },
          // named, which is exactly what makes it leak a line without this
          { url: 'https://example.com/hol.ics', name: 'Holidays in Belgium', holiday: true },
        ],
      }))));
    const names = (r.data.legend || []).map((p) => p.name);
    assert(names.indexOf('Holidays in Belgium') < 0,
      'the holiday feed became a line: ' + names.join(', '));
  });

  test('without holiday:true it still lands on a line, which is the shape being fixed', async () => {
    // Stated as a test because the two shapes have to stay distinguishable:
    // one person's leave IS a state of their line and belongs at its head
    // (rule 54), and nothing here may quietly turn every all-day entry into
    // a property of the day.
    const r = await runTransform(serve(allDayIcs(
      [{ start: '20261225', end: '20261226', summary: 'Ada on leave' }])), NOW)
      .run(baseInput(NOW, cfgWith({
        lines: [{ name: 'Ada' }],
        calendars: [{ url: 'https://example.com/a.ics', name: 'Ada' }],
      })));
    assertEqual((r.data.all_day || []).map((a) => a.title), ['Ada on leave'],
      'an ordinary all-day event stopped being declared at its line\'s head');
    assertEqual(r.data.holidays, [], 'and it is not the day\'s');
  });

  test('a rule can say it per event, for a feed that carries both kinds', async () => {
    const r = await runTransform(serve(allDayIcs([
      { start: '20261225', end: '20261226', summary: 'Christmas Day' },
      { start: '20261225', end: '20261226', summary: 'Ada on leave' },
    ])), NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Ada' }],
      calendars: [{
        url: 'https://example.com/a.ics', name: 'Ada',
        rules: [{ match: { type: 'contains', value: 'Christmas' }, holiday: true }],
      }],
    })));
    assertEqual((r.data.holidays || []).map((x) => x.title), ['Christmas Day']);
    assertEqual((r.data.all_day || []).map((a) => a.title), ['Ada on leave'],
      'the rule took the wrong entry, or took both');
  });

  test('a holiday written as a timed block is still a holiday', async () => {
    // Feeds that cannot emit VALUE=DATE write midnight to midnight
    // instead. Which shape the exporter picked is not a fact about the day.
    const r = await runTransform(serve(icsWithEvents([
      { start: '20261225T000000', end: '20261225T235900', summary: 'Christmas Day' },
    ])), NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Ada' }],
      calendars: [{ url: 'https://example.com/h.ics', holiday: true }],
    })));
    assertEqual((r.data.holidays || []).map((x) => x.title), ['Christmas Day']);
    assertEqual(eventItems(r.data).length, 0,
      'a holiday reached the hour scale, which is the one place it cannot be');
  });

  test('the same holiday from two feeds is named once', async () => {
    // Two people in a house subscribing to the same national calendar is
    // the ordinary case, and the header has no room to say it twice.
    const ics = allDayIcs([{ start: '20261225', end: '20261226', summary: 'Christmas Day' }]);
    const r = await runTransform(serve(ics), NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Ada' }],
      calendars: [
        { url: 'https://example.com/h1.ics', holiday: true },
        { url: 'https://example.com/h2.ics', holiday: true },
      ],
    })));
    assertEqual((r.data.holidays || []).map((x) => x.title), ['Christmas Day']);
  });

  test('a day full of observances is still one day', async () => {
    // The header is a single row that already carries a date and a
    // forecast. Two names on it came out as "Christmas D" and "School
    // Holid", each cut mid word: naming the day is the header's job and
    // listing it is not, so the first feed listed wins.
    const r = await runTransform(serve(allDayIcs([
      { start: '20261225', end: '20261226', summary: 'Christmas Day' },
      { start: '20261225', end: '20261226', summary: 'School Holiday' },
      { start: '20261225', end: '20261226', summary: 'Feast of the Nativity' },
      { start: '20261225', end: '20261226', summary: 'Quarter Day' },
    ])), NOW).run(baseInput(NOW, cfgWith(config())));
    assertEqual((r.data.holidays || []).map((x) => x.title), ['Christmas Day']);
  });

  // ------------------------------------------------------------ recurrence

  test('a yearly recurrence is seen on its anniversary', async () => {
    // Apple's holiday calendars and most school-term feeds write the day
    // once with FREQ=YEARLY. Only FREQ=WEEKLY was ever evaluated, so those
    // feeds drew nothing at all in every year after the one they were
    // written in, and nothing said why.
    const when = Date.parse('2027-01-01T09:00:00Z');
    const r = await runTransform(serve(allDayIcs(
      [{ start: '20200101', end: '20200102', rrule: 'FREQ=YEARLY', summary: 'New Year\'s Day' }])), when)
      .run(baseInput(when, cfgWith(config())));
    assertEqual((r.data.holidays || []).map((x) => x.title), ['New Year\'s Day'],
      'a yearly holiday seven years after its DTSTART was dropped');
  });

  test('a yearly recurrence is not seen on every other day of the year', async () => {
    const r = await runTransform(serve(allDayIcs(
      [{ start: '20200101', end: '20200102', rrule: 'FREQ=YEARLY', summary: 'New Year\'s Day' }])), NOW)
      .run(baseInput(NOW, cfgWith(config())));
    assertEqual(r.data.holidays, [], 'Christmas Day is not New Year\'s Day');
  });

  test('an ordinal BYDAY is refused rather than answered approximately', async () => {
    // "The fourth Thursday in November" moves every year, and the
    // anniversary of DTSTART is the WRONG answer rather than a rough one.
    // A feed that needs this is why the one-VEVENT-per-year form exists,
    // and that form still works.
    const when = Date.parse('2027-11-25T09:00:00Z'); // a fourth Thursday
    const r = await runTransform(serve(allDayIcs(
      [{ start: '20261126', end: '20261127', rrule: 'FREQ=YEARLY;BYDAY=4TH;BYMONTH=11', summary: 'Thanksgiving' }])), when)
      .run(baseInput(when, cfgWith(config())));
    assertEqual(r.data.holidays, [],
      'an ordinal weekday rule was evaluated as an anniversary, which lands on the wrong date');
  });

  test('a dated entry per year, which is what Google writes, needs no recurrence at all', async () => {
    const r = await runTransform(serve(allDayIcs([
      { start: '20251225', end: '20251226', summary: 'Christmas Day' },
      { start: '20261225', end: '20261226', summary: 'Christmas Day' },
      { start: '20271225', end: '20271226', summary: 'Christmas Day' },
    ])), NOW).run(baseInput(NOW, cfgWith(config())));
    assertEqual((r.data.holidays || []).map((x) => x.title), ['Christmas Day'],
      'the one whose date is today should be the one that shows');
  });

  // ----------------------------------------------------------------- ranges

  test('a range says which day of it the board is drawing', async () => {
    // Spring Break runs a week and the board draws one day of it. "Day 3
    // of 5" is the only thing distinguishing the Monday from the Thursday,
    // and it is the fact a household actually wants: when does this end.
    const feed = allDayIcs([{ start: '20270405', end: '20270410', summary: 'Spring Break' }]);
    const at = (iso) => Date.parse(iso);
    async function on(iso) {
      const r = await runTransform(serve(feed), at(iso)).run(baseInput(at(iso), cfgWith(config())));
      return (r.data.holidays || [])[0] || null;
    }
    const first = await on('2027-04-05T09:00:00Z');
    assertEqual([first.day_index, first.day_span, first.day_label], [0, 5, 'Day 1 of 5'],
      'the first day of the range');
    const middle = await on('2027-04-07T09:00:00Z');
    assertEqual([middle.day_index, middle.day_span, middle.day_label], [2, 5, 'Day 3 of 5'],
      'a day INSIDE the range has to read differently from its first day');
    const last = await on('2027-04-09T09:00:00Z');
    assertEqual([last.day_index, last.day_span, last.day_label], [4, 5, 'Day 5 of 5']);
  });

  test('the day after a range ends says nothing', async () => {
    // DTEND is EXCLUSIVE: a break ending on the 10th is over on the 10th.
    const when = Date.parse('2027-04-10T09:00:00Z');
    const r = await runTransform(serve(allDayIcs(
      [{ start: '20270405', end: '20270410', summary: 'Spring Break' }])), when)
      .run(baseInput(when, cfgWith(config())));
    assertEqual(r.data.holidays, []);
  });

  test('a single day carries no ordinal to state', async () => {
    const r = await runTransform(serve(allDayIcs(
      [{ start: '20261225', end: '20261226', summary: 'Christmas Day' }])), NOW)
      .run(baseInput(NOW, cfgWith(config())));
    assertEqual(r.data.holidays[0].day_span, 1);
    assertEqual(r.data.holidays[0].day_label, null,
      '"Day 1 of 1" is a sentence about nothing, and header width is board');
  });

  test('the ordinal is translated, not assembled on the client', async () => {
    // Composed here the way the service alert's text is: a braced
    // placeholder inside a Liquid output tag ends the tag and takes the
    // whole template down with it.
    const when = Date.parse('2027-04-07T09:00:00Z');
    const feed = allDayIcs([{ start: '20270405', end: '20270410', summary: 'Spring Break' }]);
    const i18n = JSON.stringify({ holiday_day: 'Dag {n} van {m}' });
    const fetchImpl = async (url) => okText(String(url).indexOf('/i18n/') >= 0 ? i18n : feed);
    const input = baseInput(when, cfgWith(config()));
    input.trmnl.user.locale = 'nl-BE';
    const r = await runTransform(fetchImpl, when).run(input);
    assertEqual(r.data.holidays[0].day_label, 'Dag 3 van 5');
  });

  // -------------------------------------------------------------- which day

  test('a holiday tomorrow is not announced today', async () => {
    // Every all-day entry used to arrive here having lost the day it
    // belongs to, so it was read as day 0 whatever date it carried.
    const r = await runTransform(serve(allDayIcs(
      [{ start: '20261226', end: '20261227', summary: 'Boxing Day' }])), NOW)
      .run(baseInput(NOW, cfgWith(config())));
    assertEqual(r.data.holidays, [],
      'tomorrow\'s holiday was stated on today\'s board');
  });

  test('a board set to tomorrow states tomorrow\'s', async () => {
    const r = await runTransform(serve(allDayIcs(
      [{ start: '20261226', end: '20261227', summary: 'Boxing Day' }])), NOW)
      .run(baseInput(NOW, Object.assign(cfgWith(config()), { show_day: 'tomorrow' })));
    assertEqual((r.data.holidays || []).map((x) => x.title), ['Boxing Day']);
  });

  test('and an all-day event tomorrow reaches a board set to tomorrow', async () => {
    // The same lost-day bug, seen from the line's side: with every entry
    // read as day 0, a board showing tomorrow dropped all of them.
    const r = await runTransform(serve(allDayIcs(
      [{ start: '20261226', end: '20261227', summary: 'Ada on leave' }])), NOW)
      .run(baseInput(NOW, Object.assign(cfgWith({
        lines: [{ name: 'Ada' }],
        calendars: [{ url: 'https://example.com/a.ics', name: 'Ada' }],
      }), { show_day: 'tomorrow' })));
    assertEqual((r.data.all_day || []).map((a) => a.title), ['Ada on leave']);
  });

  test('a range that started before the board still says where it is in it', async () => {
    // The run of days transform gathers is today and tomorrow, so a break
    // that began last Monday has no entry of its own on any day it
    // gathered except by covering it. The ordinal is counted off DTSTART,
    // not off the run.
    const when = Date.parse('2027-04-08T09:00:00Z');
    const r = await runTransform(serve(allDayIcs(
      [{ start: '20270329', end: '20270412', summary: 'Half Term' }])), when)
      .run(baseInput(when, cfgWith(config())));
    assertEqual([r.data.holidays[0].day_index, r.data.holidays[0].day_span], [10, 14]);
    assertEqual(r.data.holidays[0].day_label, 'Day 11 of 14');
  });

  // ------------------------------------------------------------- it is free

  test('a holiday costs the board no line and no depth', async () => {
    // The argument for the header over every other option costed: on a day
    // when nothing else is on, a holiday must not be the reason the board
    // draws a rail. `hideIfEmpty` is on by default, so a line with nothing
    // today gets none -- and an all-day event used to be enough to keep
    // one alive, which is right for a person and wrong for a country.
    const r = await runTransform(async (url) => okText(
      String(url).indexOf('/hol.ics') >= 0
        ? allDayIcs([{ start: '20261225', end: '20261226', summary: 'Christmas Day' }])
        : icsWithEvents([])), NOW)
      .run(baseInput(NOW, cfgWith(config())));
    assertEqual(r.data.legend, [], 'a holiday put a line on an empty board');
    assertEqual((r.data.holidays || []).map((x) => x.title), ['Christmas Day'],
      'and it is still stated');
  });
};
