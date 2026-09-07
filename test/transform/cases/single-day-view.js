module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert, assertEqual } = h;

  // Pinned, not real "today" — see the same note in timed-layout.js/allday-overflow.js.
  // Noon UTC, so floor(nowH) = 12 and the single-day look-ahead window is [12, 20).
  const NOW = Date.parse('2026-09-05T12:00:00Z'); // 2026-09-05 is a Saturday

  test('data.single_day shows a rolling "next 8 hours" window starting at the current hour, not the shared multi-day axis', async () => {
    const events = [
      { uid: 1, start: '20260905T140000Z', end: '20260905T143000Z', summary: 'This Afternoon' }, // 14:00, inside the window
      // Other visible days force the SHARED axis wide open — must not affect single_day at all.
      { uid: 2, start: '20260906T050000Z', end: '20260906T053000Z', summary: 'Early Run' },
      { uid: 3, start: '20260907T220000Z', end: '20260907T223000Z', summary: 'Late Call' },
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', view_days: '3' }));

    // The shared (full-view) axis still has to stretch for the other days' early/late events.
    assert(r.data.hour_rows[5].pct > 0, 'shared axis must show hour 5 — day 1 has an event then');
    assert(r.data.hour_rows[22].pct > 0, 'shared axis must show hour 22 — day 2 has an event then');

    const sd = r.data.single_day;
    assert(sd && sd.hour_rows && sd.days && sd.days.length === 1, 'single_day should carry exactly one day\'s worth of hour_rows/days');
    // Window is [12, 20) — before "now" (12) and at/after the 8h look-ahead end (20) collapse.
    assertEqual(sd.hour_rows[11].pct, 0, 'hour 11 is before "now" — should collapse');
    assertEqual(sd.hour_rows[20].pct, 0, 'hour 20 is past the 8h look-ahead — should collapse');
    assert(sd.hour_rows[12].pct > 0, 'hour 12 ("now") should be visible');
    assert(sd.hour_rows[14].pct > 0, 'hour 14 (This Afternoon) should be visible');

    const todayEvent = sd.days[0].events.find((e) => e.title === 'This Afternoon');
    assert(todayEvent, 'the in-window event should be present in data.single_day.days[0]');
    assert(todayEvent.top_pct >= 0 && todayEvent.top_pct <= 100, 'top_pct should be a sane percentage: got ' + todayEvent.top_pct);
    assert(todayEvent.height_pct > 0, 'height_pct should be positive: got ' + todayEvent.height_pct);
  });

  test('an event already in progress still shows, clamped to the top of the window rather than cut off', async () => {
    const events = [
      { uid: 1, start: '20260905T100000Z', end: '20260905T130000Z', summary: 'Long Workshop' }, // 10:00-13:00, straddles "now" (12:00)
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    const sd = r.data.single_day;
    const ev = sd.days[0].events.find((e) => e.title === 'Long Workshop');
    assert(ev, 'an in-progress event must still appear, not be dropped for having started before "now"');
    assertEqual(ev.top_pct, 0, 'an event that started before the window should clamp to the very top, not go negative or vanish');
    assert(ev.height_pct > 0, 'the still-ongoing portion (12:00-13:00) should render with real height');
  });

  test('an event beyond the 8-hour look-ahead is deliberately not shown', async () => {
    const events = [
      { uid: 1, start: '20260905T220000Z', end: '20260905T223000Z', summary: 'Tonight Late' }, // 22:00, well past 20:00 cutoff
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    const sd = r.data.single_day;
    assertEqual(sd.hour_rows[22].pct, 0, 'hour 22 is past the look-ahead window and should collapse');
    const ev = sd.days[0].events.find((e) => e.title === 'Tonight Late');
    // The event object is still present (layoutNative doesn't filter events out), but it must
    // collapse to zero visible height rather than showing at the wrong place.
    assert(!ev || ev.height_pct === 0, 'an event entirely past the look-ahead window must not render with real height');
  });

  test('a day with no events at all still shows the current-hour-forward window, not a blank/default axis', async () => {
    const fetchImpl = async () => okText(icsWithEvents([]));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    const sd = r.data.single_day;
    assert(sd.hour_rows[12].pct > 0, 'hour 12 ("now") should still be shown even with nothing scheduled');
    assert(sd.hour_rows[19].pct > 0, 'hour 19 (last hour of the 8h look-ahead) should still be shown');
    assertEqual(sd.hour_rows[11].pct, 0, 'hour 11 (before "now") should still collapse on an empty day too');
    assertEqual(sd.days[0].events.length, 0, 'no events today');
  });

  test('data.single_day.agenda lists timed events chronologically, dropping already-ended ones and flagging the in-progress one', async () => {
    // All-day items (e.g. a "Kantoor" all-day event) are deliberately left out of this list —
    // they're already shown in the existing all-day bar header above it, for every view.
    const events = [
      { uid: 1, allDay: true, start: '20260905', end: '20260906', summary: 'Holiday' },
      { uid: 2, start: '20260905T090000Z', end: '20260905T093000Z', summary: 'Past Standup' }, // ended before noon
      { uid: 3, start: '20260905T140000Z', end: '20260905T150000Z', summary: 'Client Call' },
      { uid: 4, start: '20260905T110000Z', end: '20260905T130000Z', summary: 'Workshop' }, // in progress at noon
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    const agenda = r.data.single_day.agenda;
    assertEqual(agenda.map((i) => i.title), ['Workshop', 'Client Call'], 'timed events sorted by start, past ones dropped, all-day event excluded');
    assertEqual(agenda[0].current, true, 'Workshop (11:00-13:00) is in progress at noon');
    assertEqual(agenda[1].current, false, 'Client Call has not started yet');
    assert(agenda[0].time && agenda[1].time, 'every item here should carry a formatted time label');
  });

  test('data.single_day.agenda is not pre-cut to a display limit — how many fit (and any "+N more") is decided per view in the template', async () => {
    const events = [];
    for (let i = 0; i < 9; i++) {
      const hh = String(12 + i).padStart(2, '0'); // 12:00 through 20:00, all still upcoming/in-progress at noon
      events.push({ uid: i, start: '20260905T' + hh + '0000Z', end: '20260905T' + hh + '3000Z', summary: 'Event ' + i });
    }
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    const agenda = r.data.single_day.agenda;
    // half_horizontal (2 columns) and quadrant (1 column) fit very different numbers of rows —
    // that decision belongs in shared.liquid (agenda_limit per view), not baked in here.
    assertEqual(agenda.length, 9, 'all 9 real events should be present uncapped at the data level');
    assertEqual(agenda.map((i) => i.title), events.map((e) => e.summary), 'still sorted chronologically');
  });

  test('data.single_day.agenda has a hard sanity cap against a pathologically busy day', async () => {
    const events = [];
    for (let i = 0; i < 30; i++) {
      const startMin = i * 15; // packed every 15 minutes from noon onward, each 10 minutes long
      const hh = String(12 + Math.floor(startMin / 60)).padStart(2, '0');
      const mm = String(startMin % 60).padStart(2, '0');
      const endMin = startMin + 10;
      const ehh = String(12 + Math.floor(endMin / 60)).padStart(2, '0');
      const emm = String(endMin % 60).padStart(2, '0');
      events.push({ uid: i, start: '20260905T' + hh + mm + '00Z', end: '20260905T' + ehh + emm + '00Z', summary: 'Event ' + i });
    }
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    assertEqual(r.data.single_day.agenda.length, 20, 'a pathologically busy day should still cap at the hard sanity limit (20)');
  });
};
