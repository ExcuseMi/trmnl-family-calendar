module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-05T12:00:00Z');

  function cfgWith(json) {
    return { advanced_config_enabled: 'true', calendars: JSON.stringify(json) };
  }

  test('a rule can turn a timed event into an all-day one', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Staff Training Day' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'Training' }, allDay: true }] }],
    })));
    const r = await run(input);
    assertEqual(r.data.days.some((d) => d.events.length), false, 'the event should not show up in the timed grid');
    assert(r.data.allday_bars.some((b) => b.title === 'Staff Training Day'), 'it should show up as an all-day bar instead');
  });

  test('a rule can hide an event by title match', async () => {
    const evA = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Keep Me' };
    const evB = { uid: 2, start: '20260907T160000Z', end: '20260907T170000Z', summary: 'Hide Me' };
    const fetchImpl = async () => okText(icsWithEvents([evA, evB]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'Hide Me' }, hide: true }] }],
    })));
    const r = await run(input);
    const titles = r.data.days.flatMap((d) => d.events.map((e) => e.title));
    assertEqual(titles, ['Keep Me']);
  });

  test('a rewrite rule replaces the matched text with literal text, independent of person', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'L6 Swim Class' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'L6' }, rewrite: 'Lesson 6' }] }],
    })));
    const r = await run(input);
    const titles = r.data.days.flatMap((d) => d.events.map((e) => e.title));
    assertEqual(titles, ['Lesson 6 Swim Class']);
  });

  test('a rewrite rule wins over a rename from a person assignment on the same title', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'L6 Swim Class' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      people: [{ name: 'Alex' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [
        { match: { type: 'word', value: 'L6' }, person: 'Alex' },
        { match: { type: 'word', value: 'L6' }, rewrite: 'Lesson 6' },
      ] }],
    })));
    const r = await run(input);
    const titles = r.data.days.flatMap((d) => d.events.map((e) => e.title));
    assertEqual(titles, ['Lesson 6 Swim Class']);
  });

  test('a global rule assigns a person across every calendar, not just one', async () => {
    const fetchImpl = async (url) => okText(icsWithEvents([{
      uid: 1, start: '20260907T140000Z', end: '20260907T150000Z',
      summary: url.includes('a.ics') ? 'Doctor Appointment' : 'Something Else',
    }]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      rules: [{ match: { type: 'word', value: 'Doctor' }, person: 'Mom' }],
      people: [{ name: 'Mom', badge: 'M' }],
      calendars: [{ url: 'https://example.com/a.ics' }, { url: 'https://example.com/b.ics' }],
    })));
    const r = await run(input);
    const badged = r.data.people.find((p) => p.person === 'Mom');
    assert(!!badged, 'the global rule should have assigned Mom regardless of which calendar the event came from');
  });

  test('a calendar\'s own rule overrides a global rule\'s person assignment for the same event', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Doctor Appointment' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      rules: [{ match: { type: 'word', value: 'Doctor' }, person: 'Mom' }],
      people: [{ name: 'Mom', badge: 'M' }, { name: 'Dad', badge: 'D' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'Doctor' }, person: 'Dad' }] }],
    })));
    const r = await run(input);
    assertEqual(r.data.people.map((p) => p.person), ['Dad'], 'the calendar-specific rule should win over the global one');
  });

  test('a top-level defaultPerson badges any event with no other person assigned', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Unclaimed Event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      defaultPerson: 'Everyone',
      people: [{ name: 'Everyone', badge: '★' }],
      calendars: [{ url: 'https://example.com/a.ics' }],
    })));
    const r = await run(input);
    assertEqual(r.data.people, [{ text: '★', person: 'Everyone', hue: 'black', fg: 'white' }]);
  });

  test('a calendar\'s own defaultPerson wins over the top-level one', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      defaultPerson: 'Everyone',
      people: [{ name: 'Everyone', badge: '★' }, { name: 'Alex', badge: 'A' }],
      calendars: [{ url: 'https://example.com/a.ics', defaultPerson: 'Alex' }],
    })));
    const r = await run(input);
    assertEqual(r.data.people.map((p) => p.person), ['Alex']);
  });

  test('no defaultPerson anywhere: event just has no badge, not a crash', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3', calendars_simple: 'https://example.com/a.ics' }));
    const r = await run(input);
    assertEqual(r.data.people, []);
    assertEqual(r.data.error, null);
  });

  test('an emoji badge does not get mangled by taking only half its UTF-16 surrogate pair', async () => {
    const ev = { uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const input = baseInput(Object.assign({ view_days: '3' }, cfgWith({
      defaultPerson: 'Everyone',
      people: [{ name: 'Everyone', badge: '👪 Family' }],
      calendars: [{ url: 'https://example.com/a.ics' }],
    })));
    const r = await run(input);
    assertEqual(r.data.people[0].text, '👪', 'the full emoji codepoint should survive, not a broken half-surrogate');
  });
};
