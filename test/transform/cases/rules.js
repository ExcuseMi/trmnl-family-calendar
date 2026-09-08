module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, eventItems, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-07T12:00:00Z'); // a Monday

  function cfgWith(json) {
    return { config_json: JSON.stringify(json) };
  }

  test('a rule can turn a timed event into an all-day one, which this plugin then drops (no all-day lane yet)', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Staff Training Day' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'Training' }, allDay: true }] }],
    })));
    assertEqual(eventItems(r.metro).length, 0);
  });

  test('a rule can hide an event by title match', async () => {
    const evA = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Keep Me' };
    const evB = { start: '20260907T160000Z', end: '20260907T170000Z', summary: 'Hide Me' };
    const fetchImpl = async () => okText(icsWithEvents([evA, evB]));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'Hide Me' }, hide: true }] }],
    })));
    assertEqual(eventItems(r.metro).map((e) => e.title), ['Keep Me']);
  });

  test('a rule can match against an event\'s description, but only when the calendar opts in via includeDescription', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Team Sync', description: 'cancelled' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const cfgOff = { calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'cancelled' }, hide: true }] }] };
    const rOff = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith(cfgOff)));
    assertEqual(eventItems(rOff.metro).length, 1, 'without includeDescription, the desc is never parsed, so the rule can\'t see it');

    const cfgOn = { calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', includeDescription: true, rules: [{ match: { type: 'word', value: 'cancelled' }, hide: true }] }] };
    const rOn = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith(cfgOn)));
    assertEqual(eventItems(rOn.metro).length, 0, 'with includeDescription, the rule sees the description and hides it');
  });

  test('a rewrite rule replaces the matched text with literal text, independent of person', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'L6 Swim Class' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'L6' }, rewrite: 'Lesson 6' }] }],
    })));
    assertEqual(eventItems(r.metro).map((e) => e.title), ['Lesson 6 Swim Class']);
  });

  test('a catch-all ".*" match with rename does not duplicate the title (WardWard bug)', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Schoolfotografie' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'regex', value: '.*' }, person: 'Ward', rename: true }] }],
    })));
    assertEqual(eventItems(r.metro).map((e) => e.title), ['Ward'], 'a single non-global replace should produce "Ward", never "WardWard"');
  });

  test('a catch-all ".*" match with rename:false assigns the person without touching the title', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Schoolfotografie' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      people: [{ name: 'Ward' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'regex', value: '.*' }, person: 'Ward', rename: false }] }],
    })));
    assertEqual(eventItems(r.metro).map((e) => e.title), ['Schoolfotografie']);
  });

  test('the "any" match type is the intended way to write a catch-all rule — badges without renaming, by default', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Schoolfotografie' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      people: [{ name: 'Ward' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, person: 'Ward' }] }],
    })));
    assertEqual(eventItems(r.metro).map((e) => e.title), ['Schoolfotografie'], 'an "any" match should badge Ward without needing an explicit rename:false');
    assertEqual(r.metro.legend.map((p) => p.name), ['Ward']);
  });

  test('rewriteFull replaces the whole title, not just the matched substring', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'L6 Swim Class with Jane' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'L6' }, rewrite: 'Swimming', rewriteFull: true }] }],
    })));
    assertEqual(eventItems(r.metro).map((e) => e.title), ['Swimming']);
  });

  test('rewrite without rewriteFull still supports regex backreferences against the match', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Sprint 26-08' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'regex', value: 'Sprint (\\d+-\\d+)' }, rewrite: 'Sprint #$1' }] }],
    })));
    assertEqual(eventItems(r.metro).map((e) => e.title), ['Sprint #26-08']);
  });

  test('a rewrite rule wins over a rename from a person assignment on the same title', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'L6 Swim Class' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      people: [{ name: 'Alex' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [
        { match: { type: 'word', value: 'L6' }, person: 'Alex' },
        { match: { type: 'word', value: 'L6' }, rewrite: 'Lesson 6' },
      ] }],
    })));
    assertEqual(eventItems(r.metro).map((e) => e.title), ['Lesson 6 Swim Class']);
  });

  test('a global rule assigns a person across every calendar, not just one', async () => {
    const fetchImpl = async (url) => okText(icsWithEvents([{
      start: '20260907T140000Z', end: '20260907T150000Z',
      summary: url.includes('a.ics') ? 'Doctor Appointment' : 'Something Else',
    }]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      rules: [{ match: { type: 'word', value: 'Doctor' }, person: 'Mom' }],
      people: [{ name: 'Mom', badge: 'M' }],
      calendars: [{ url: 'https://example.com/a.ics' }, { url: 'https://example.com/b.ics' }],
    })));
    const doctorEvent = eventItems(r.metro).find((e) => e.title.indexOf('Mom') !== -1 || e.title.indexOf('Doctor') !== -1);
    assert(!!doctorEvent, 'the global rule should have assigned Mom regardless of which calendar the event came from');
  });

  test('a calendar\'s own rule overrides a global rule\'s person assignment for the same event', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Doctor Appointment' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      rules: [{ match: { type: 'word', value: 'Doctor' }, person: 'Mom' }],
      people: [{ name: 'Mom', badge: 'M' }, { name: 'Dad', badge: 'D' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'Doctor' }, person: 'Dad' }] }],
    })));
    const ev0 = eventItems(r.metro)[0];
    const dadTrack = r.metro.legend.find((p) => p.name === 'Dad');
    assertEqual(ev0.hue, dadTrack.hue, 'the calendar-specific rule should win over the global one');
  });

  test('a calendar\'s custom headers are sent on its ICS fetch, alongside the default User-Agent', async () => {
    let capturedHeaders = null;
    const fetchImpl = async (url, opts) => { capturedHeaders = opts && opts.headers; return okText(icsWithEvents([])); };
    await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', headers: { Authorization: 'Bearer secret-token' } }],
    })));
    assertEqual(capturedHeaders.Authorization, 'Bearer secret-token');
    assertEqual(capturedHeaders['User-Agent'], 'TRMNL-Metro-Calendar', 'the default User-Agent should still be sent alongside it');
  });

  test('non-string values in a calendar\'s headers are dropped rather than sent as-is', async () => {
    let capturedHeaders = null;
    const fetchImpl = async (url, opts) => { capturedHeaders = opts && opts.headers; return okText(icsWithEvents([])); };
    await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', headers: { 'X-Ok': 'fine', 'X-Bad': { nested: true } } }],
    })));
    assertEqual(capturedHeaders['X-Ok'], 'fine');
    assertEqual('X-Bad' in capturedHeaders, false, 'a non-string header value should be dropped, not passed through');
  });

  test('the first person in people[] (everyonePerson) claims any event no rule assigns a person to', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Unclaimed Event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      people: [{ name: 'Everyone', badge: '★' }],
      calendars: [{ url: 'https://example.com/a.ics' }],
    })));
    assertEqual(eventItems(r.metro).length, 1);
    assertEqual(r.metro.legend.map((p) => p.name), ['Everyone']);
  });

  test('a rule\'s own person assignment still wins over the everyonePerson fallback', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Alex event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      people: [{ name: 'Everyone', badge: '★' }, { name: 'Alex', badge: 'A' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'Alex' }, person: 'Alex' }] }],
    })));
    const ev0 = eventItems(r.metro)[0];
    const alexTrack = r.metro.legend.find((p) => p.name === 'Alex');
    assertEqual(ev0.hue, alexTrack.hue);
  });

  test('a rule with a multi-name person list produces an event with co_owners (an interchange, client-side)', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Family Dinner' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, person: ['Alex', 'Kids'] }] }],
    })));
    const ev0 = eventItems(r.metro)[0];
    assertEqual(ev0.owner, r.metro.legend.find((p) => p.name === 'Alex').key, 'the first name becomes the primary owner');
    assertEqual(ev0.co_owners.length, 1, 'the remaining name(s) become co_owners');
  });

  test('string-shorthand calendar entries (a bare URL, not {url:...}) are accepted', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      people: [{ name: 'Everyone' }],
      calendars: ['https://example.com/a.ics'],
    })));
    assertEqual(eventItems(r.metro).length, 1);
  });

  test('non-JSON config text falls back to a newline-separated URL list', async () => {
    const { parseConfig } = runTransform();
    const cfg = parseConfig('https://a.example.com/x.ics\nhttps://b.example.com/y.ics\n');
    assertEqual(cfg.calendars.map((c) => c.url), ['https://a.example.com/x.ics', 'https://b.example.com/y.ics']);
  });

  test('valid JSON with no usable calendars falls all the way back to demo data, not a crash', async () => {
    const r = await runTransform(async () => okText(icsWithEvents([])), NOW).run(baseInput(NOW, { config_json: '{}' }));
    assert(eventItems(r.metro).length > 0, 'demo data should have kicked in');
  });

  test('non-JSON config text with no non-blank lines also falls back to demo data', async () => {
    const r = await runTransform(async () => okText(icsWithEvents([])), NOW).run(baseInput(NOW, { config_json: '   \n   \n' }));
    assert(eventItems(r.metro).length > 0, 'demo data should have kicked in');
  });

  test('an emoji badge does not get mangled by taking only half its UTF-16 surrogate pair', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      people: [{ name: 'Everyone', badge: '👪 Family' }],
      calendars: [{ url: 'https://example.com/a.ics' }],
    })));
    assertEqual(r.metro.legend[0].initial, '👪', 'the full emoji codepoint should survive, not a broken half-surrogate');
  });
};
