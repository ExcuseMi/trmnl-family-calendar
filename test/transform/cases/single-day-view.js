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
};
