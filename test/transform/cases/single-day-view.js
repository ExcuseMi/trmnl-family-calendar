module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert, assertEqual } = h;

  // Pinned, not real "today" — see the same note in timed-layout.js/allday-overflow.js.
  const NOW = Date.parse('2026-09-05T12:00:00Z'); // 2026-09-05 is a Saturday

  test('data.single_day collapses hours outside THIS day\'s own events, even when other visible days need a wider shared axis', async () => {
    const events = [
      // Today (day 0): one event fully inside the configured 9-17 core window.
      { uid: 1, start: '20260905T100000Z', end: '20260905T103000Z', summary: 'Today Meeting' },
      // Tomorrow (day 1): an early event that forces the SHARED multi-day window wide open.
      { uid: 2, start: '20260906T050000Z', end: '20260906T053000Z', summary: 'Early Run' },
      // Day 2: a late event that forces the SHARED multi-day window wide open the other way.
      { uid: 3, start: '20260907T220000Z', end: '20260907T223000Z', summary: 'Late Call' },
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', view_days: '3', hours: '9-17' }));

    // The shared (full-view) axis has to stretch to cover the 05:00 and 22:30 events on other
    // days, so hours well outside 9-17 still get real height there.
    assert(r.data.hour_rows[5].pct > 0, 'shared axis must show hour 5 — day 1 has an event then');
    assert(r.data.hour_rows[22].pct > 0, 'shared axis must show hour 22 — day 2 has an event then');

    // data.single_day is laid out against day 0 ALONE, which has nothing outside 9-17 — those
    // hours should collapse to zero height instead of inheriting the other days' wider window.
    const sd = r.data.single_day;
    assert(sd && sd.hour_rows && sd.days && sd.days.length === 1, 'single_day should carry exactly one day\'s worth of hour_rows/days');
    assertEqual(sd.hour_rows[5].pct, 0, 'single_day axis must collapse hour 5 — today has nothing there, regardless of other days');
    assertEqual(sd.hour_rows[22].pct, 0, 'single_day axis must collapse hour 22 — today has nothing there, regardless of other days');
    assert(sd.hour_rows[10].pct > 0, 'single_day axis must still show hour 10 — today\'s own event is then');

    // Today's own event must still be positioned/sized sanely against this tighter axis.
    const todayEvent = sd.days[0].events.find((e) => e.title === 'Today Meeting');
    assert(todayEvent, 'today\'s event should be present in data.single_day.days[0]');
    assert(todayEvent.top_pct >= 0 && todayEvent.top_pct <= 100, 'top_pct should be a sane percentage: got ' + todayEvent.top_pct);
    assert(todayEvent.height_pct > 0, 'height_pct should be positive: got ' + todayEvent.height_pct);
  });

  test('data.single_day falls back to the default core hours (not a fully collapsed axis) on a day with no events at all', async () => {
    const events = [
      { uid: 1, start: '20260906T050000Z', end: '20260906T053000Z', summary: 'Early Run' }, // tomorrow only
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics', view_days: '2', hours: '9-17' }));
    const sd = r.data.single_day;
    // Today (day 0) has nothing at all — should still show the configured 9-17 default core
    // window (not collapse to nothing), since there's no event to anchor a window around.
    assert(sd.hour_rows[9].pct > 0, 'a fully empty day should still show the configured default core window start');
    assert(sd.hour_rows[16].pct > 0, 'a fully empty day should still show the configured default core window end');
    assertEqual(sd.days[0].events.length, 0, 'today really has no events');
  });
};
