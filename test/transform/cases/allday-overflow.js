module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert, assertEqual } = h;

  function allDayIcs(n) {
    const events = [];
    for (let i = 0; i < n; i++) {
      events.push({ uid: i, allDay: true, start: '20260905', end: '20260906', summary: 'AllDay ' + i });
    }
    return icsWithEvents(events);
  }

  test('all-day events at or under the 3-row cap: every one shows, no "+N more"', async () => {
    const fetchImpl = async () => okText(allDayIcs(3));
    const { run } = runTransform(fetchImpl, Date.now());
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    assertEqual(r.data.allday_bars.length, 3);
    assert(!r.data.allday_bars.some((b) => b.title.includes('more')), 'no overflow summary expected');
    assertEqual(r.data.allday_max_rows, 3);
  });

  test('all-day events beyond the cap: real events truncate to 2, a "+N more" summarizes the rest — nothing silently vanishes', async () => {
    const fetchImpl = async () => okText(allDayIcs(5));
    const { run } = runTransform(fetchImpl, Date.now());
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    const real = r.data.allday_bars.filter((b) => !b.title.includes('more'));
    const overflow = r.data.allday_bars.filter((b) => b.title.includes('more'));
    assertEqual(real.length, 2, 'only 2 real events should render');
    assertEqual(overflow.length, 1, 'exactly one overflow summary bar');
    assertEqual(overflow[0].title, '+3 more', 'the summary should count the 3 events that did not fit');
    assertEqual(r.data.allday_max_rows, 3, 'total row budget should stay the same as the non-overflow case');
  });
};
