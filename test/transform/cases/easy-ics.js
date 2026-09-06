module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert, assertEqual } = h;

  const EVENT_A = { uid: 1, start: '20260905T120000Z', end: '20260905T130000Z', summary: 'From Easy' };
  const EVENT_B = { uid: 2, start: '20260905T140000Z', end: '20260905T150000Z', summary: 'From Advanced' };

  test('Easy ICS and Advanced Configuration calendars combine, they don\'t replace each other', async () => {
    const fetchImpl = async (url) => okText(icsWithEvents([url.includes('a.ics') ? EVENT_A : EVENT_B]));
    const { run } = runTransform(fetchImpl, Date.now());
    const input = baseInput({
      calendars_simple: 'https://example.com/a.ics',
      calendars: JSON.stringify({ calendars: [{ url: 'https://example.com/b.ics', name: 'Advanced Cal' }] }),
    });
    const r = await run(input);
    const titles = r.data.days[0].events.map((e) => e.title).sort();
    assertEqual(titles, ['From Advanced', 'From Easy'], 'events from both sources should appear together');
  });

  test('Easy ICS alone (no Advanced Configuration at all) still works', async () => {
    const fetchImpl = async () => okText(icsWithEvents([EVENT_A]));
    const { run } = runTransform(fetchImpl, Date.now());
    const r = await run(baseInput({ calendars_simple: 'https://example.com/a.ics' }));
    assertEqual(r.data.days[0].events.length, 1);
    assertEqual(r.data.error, null);
  });

  test('neither field set: the friendly "no calendar configured" state, not a crash', async () => {
    const { run } = runTransform(async () => okText(''), Date.now());
    const r = await run(baseInput({}));
    assert(!!r.data.error, 'should report the empty-configuration error');
    assertEqual(r.data.has_events, false);
  });
};
