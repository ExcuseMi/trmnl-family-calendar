module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, eventItems, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-07T12:00:00Z'); // a Monday

  function cfgWith(json) {
    return { config_json: JSON.stringify(json) };
  }

  test('a rule can turn a timed event into an all-day one, which then runs the whole day', async () => {
    // The event says 14:00 to 15:00; the rule says the training is a
    // whole-day thing. The rule wins, and the hour it came in with is
    // gone. There was a stretch when the plugin had nowhere to put an
    // all-day event and quietly dropped it, so the one assertion worth
    // making is that it is still on the board.
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Staff Training Day' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'Training' }, allDay: true }] }],
    })));
    // Promoted OFF the axis: an all-day event has no hour, so it is not an
    // item at all. It is declared at the head of whichever lines are in it.
    assertEqual(eventItems(r.data), [], 'nothing on the timeline');
    assertEqual(r.data.all_day.map((a) => a.title), ['Staff Training Day'],
      'the rule promoted it');
  });

  test('a rule can hide an event by title match', async () => {
    const evA = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Keep Me' };
    const evB = { start: '20260907T160000Z', end: '20260907T170000Z', summary: 'Hide Me' };
    const fetchImpl = async () => okText(icsWithEvents([evA, evB]));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'Hide Me' }, hide: true }] }],
    })));
    assertEqual(eventItems(r.data).map((e) => e.title), ['Keep Me']);
  });

  test('a rule can match against an event\'s description, but only when the calendar opts in via includeDescription', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Team Sync', description: 'cancelled' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const cfgOff = { calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'cancelled' }, hide: true }] }] };
    const rOff = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith(cfgOff)));
    assertEqual(eventItems(rOff.data).length, 1, 'without includeDescription, the desc is never parsed, so the rule can\'t see it');

    const cfgOn = { calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', includeDescription: true, rules: [{ match: { type: 'word', value: 'cancelled' }, hide: true }] }] };
    const rOn = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith(cfgOn)));
    assertEqual(eventItems(rOn.data).length, 0, 'with includeDescription, the rule sees the description and hides it');
  });

  test('a rewrite rule replaces the matched text with literal text, independent of track', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'L6 Swim Class' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'L6' }, rewrite: 'Lesson 6' }] }],
    })));
    assertEqual(eventItems(r.data).map((e) => e.title), ['Lesson 6 Swim Class']);
  });

  test('a catch-all ".*" match with rename does not duplicate the title (WardWard bug)', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Schoolfotografie' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'regex', value: '.*' }, line: 'Ward', rename: true }] }],
    })));
    assertEqual(eventItems(r.data).map((e) => e.title), ['Ward'], 'a single non-global replace should produce "Ward", never "WardWard"');
  });

  test('a catch-all ".*" match with rename:false assigns the track without touching the title', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Schoolfotografie' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Ward' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'regex', value: '.*' }, line: 'Ward', rename: false }] }],
    })));
    assertEqual(eventItems(r.data).map((e) => e.title), ['Schoolfotografie']);
  });

  test('the "any" match type is the intended way to write a catch-all rule — badges without renaming, by default', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Schoolfotografie' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Ward' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, line: 'Ward' }] }],
    })));
    assertEqual(eventItems(r.data).map((e) => e.title), ['Schoolfotografie'], 'an "any" match should badge Ward without needing an explicit rename:false');
    assertEqual(r.data.legend.map((p) => p.name), ['Ward']);
  });

  test('rewriteFull replaces the whole title, not just the matched substring', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'L6 Swim Class with Jane' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'L6' }, rewrite: 'Swimming', rewriteFull: true }] }],
    })));
    assertEqual(eventItems(r.data).map((e) => e.title), ['Swimming']);
  });

  test('rewrite without rewriteFull still supports regex backreferences against the match', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Sprint 26-08' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'regex', value: 'Sprint (\\d+-\\d+)' }, rewrite: 'Sprint #$1' }] }],
    })));
    assertEqual(eventItems(r.data).map((e) => e.title), ['Sprint #26-08']);
  });

  test('a rewrite rule wins over a rename from a track assignment on the same title', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'L6 Swim Class' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Alex' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [
        { match: { type: 'word', value: 'L6' }, line: 'Alex' },
        { match: { type: 'word', value: 'L6' }, rewrite: 'Lesson 6' },
      ] }],
    })));
    assertEqual(eventItems(r.data).map((e) => e.title), ['Lesson 6 Swim Class']);
  });

  test('a global rule assigns a track across every calendar, not just one', async () => {
    const fetchImpl = async (url) => okText(icsWithEvents([{
      start: '20260907T140000Z', end: '20260907T150000Z',
      summary: url.includes('a.ics') ? 'Doctor Appointment' : 'Something Else',
    }]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      rules: [{ match: { type: 'word', value: 'Doctor' }, line: 'Mom' }],
      lines: [{ name: 'Mom', badge: 'M' }],
      calendars: [{ url: 'https://example.com/a.ics' }, { url: 'https://example.com/b.ics' }],
    })));
    const doctorEvent = eventItems(r.data).find((e) => e.title.indexOf('Mom') !== -1 || e.title.indexOf('Doctor') !== -1);
    assert(!!doctorEvent, 'the global rule should have assigned Mom regardless of which calendar the event came from');
  });

  test('a calendar\'s own rule overrides a global rule\'s track assignment for the same event', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Doctor Appointment' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      rules: [{ match: { type: 'word', value: 'Doctor' }, line: 'Mom' }],
      lines: [{ name: 'Mom', badge: 'M' }, { name: 'Dad', badge: 'D' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'Doctor' }, line: 'Dad' }] }],
    })));
    const ev0 = eventItems(r.data)[0];
    const dadTrack = r.data.legend.find((p) => p.name === 'Dad');
    assertEqual(ev0.owner, dadTrack.key, 'the calendar-specific rule should win over the global one');
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

  test('the first track in tracks[] (everyoneTrack) claims any event no rule assigns a track to', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Unclaimed Event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Everyone', badge: '★' }],
      calendars: [{ url: 'https://example.com/a.ics' }],
    })));
    assertEqual(eventItems(r.data).length, 1);
    assertEqual(r.data.legend.map((p) => p.name), ['Everyone']);
  });

  test('an unruled calendar named after a configured track falls back to that track, not everyoneTrack (Kato/Nala real-world bug)', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Extra turnen' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Familie', badge: '★' }, { name: 'Kato', badge: 'K' }],
      calendars: [{ url: 'https://example.com/a.ics', name: 'Kato' }],
    })));
    const ev0 = eventItems(r.data)[0];
    const katoTrack = r.data.legend.find((p) => p.name === 'Kato');
    assertEqual(ev0.owner, katoTrack.key, 'a calendar with no rules should fall back to its own name, not the first tracks[] entry');
  });

  test('a rule\'s own track assignment still wins over the everyoneTrack fallback', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Alex event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Everyone', badge: '★' }, { name: 'Alex', badge: 'A' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'Alex' }, line: 'Alex' }] }],
    })));
    const ev0 = eventItems(r.data)[0];
    const alexTrack = r.data.legend.find((p) => p.name === 'Alex');
    assertEqual(ev0.owner, alexTrack.key);
  });

  test('a rule with a multi-name track list produces an event with co_owners (an interchange, client-side)', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Family Dinner' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, line: ['Alex', 'Kids'] }] }],
    })));
    const ev0 = eventItems(r.data)[0];
    assertEqual(ev0.owner, r.data.legend.find((p) => p.name === 'Alex').key, 'the first name becomes the primary owner');
    assertEqual(ev0.co_owners.length, 1, 'the remaining name(s) become co_owners');
  });

  test('string-shorthand calendar entries (a bare URL, not {url:...}) are accepted', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Everyone' }],
      calendars: ['https://example.com/a.ics'],
    })));
    assertEqual(eventItems(r.data).length, 1);
  });

  test('non-JSON config text falls back to a newline-separated URL list', async () => {
    const { parseConfig } = runTransform();
    const cfg = parseConfig('https://a.example.com/x.ics\nhttps://b.example.com/y.ics\n');
    assertEqual(cfg.calendars.map((c) => c.url), ['https://a.example.com/x.ics', 'https://b.example.com/y.ics']);
  });

  test('valid JSON with no usable calendars falls all the way back to demo data, not a crash', async () => {
    const r = await runTransform(async () => okText(icsWithEvents([])), NOW).run(baseInput(NOW, { config_json: '{}' }));
    assert(eventItems(r.data).length > 0, 'demo data should have kicked in');
  });

  test('non-JSON config text with no non-blank lines also falls back to demo data', async () => {
    const r = await runTransform(async () => okText(icsWithEvents([])), NOW).run(baseInput(NOW, { config_json: '   \n   \n' }));
    assert(eventItems(r.data).length > 0, 'demo data should have kicked in');
  });

  test('a configured track with no events today gets no legend entry (no empty track)', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Busy track only' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Idle', side: 'left' }, { name: 'Busy', side: 'left' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, line: 'Busy' }] }],
    })));
    assertEqual(r.data.legend.map((p) => p.name), ['Busy'], 'Idle has nothing today, so it should not get a track at all');
  });

  test('removing an empty track compacts the remaining offsets on that side, no gap left behind', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'C event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'A', side: 'left' }, { name: 'B', side: 'left' }, { name: 'C', side: 'left' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, line: 'C' }] }],
    })));
    assertEqual(r.data.legend.length, 1);
    assertEqual(r.data.legend[0].line_offset, -10, 'C should sit at the first left slot, not the third, since A and B left no gap');
  });

  test('an emoji badge does not get mangled by taking only half its UTF-16 surrogate pair', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Everyone', badge: '👪 Family' }],
      calendars: [{ url: 'https://example.com/a.ics' }],
    })));
    assertEqual(r.data.legend[0].initial, '👪', 'the full emoji codepoint should survive, not a broken half-surrogate');
  });

  // `tracks`/`track` are the current field names (tracks were called
  // "people" before this rename); a config written before the rename,
  // still sitting pasted into someone's live device, must keep working
  // exactly as before with zero edits.

  test('a long block carries its location and earns its owner a legend entry', async () => {
    // Eleven hours at a desk. This used to need `siding: true` in the
    // config and came back in a `sidings` array of its own; it is an
    // ordinary event now, and nothing about it is declared anywhere. What
    // is worth holding on to is that it is still a whole event: the
    // location is what the caption says where, and a track whose only
    // entry today is a block like this one still counts as active, so it
    // gets a line and a name.
    const ev = { start: '20260907T080000Z', end: '20260907T190000Z', summary: 'Desk booking', location: 'BE-Ghent A01' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Ward' }],
    })));
    const items = eventItems(r.data);
    assertEqual(items.length, 1, 'a long block belongs on the timeline like anything else');
    assertEqual(items[0].title, 'Desk booking');
    assertEqual(items[0].location, 'BE-Ghent A01');
    assertEqual(items[0].start_min, 8 * 60);
    assertEqual(items[0].end_min, 19 * 60);
    const wardTrack = r.data.legend.find((p) => p.name === 'Ward');
    assertEqual(items[0].owner, wardTrack.key, 'a track carrying only a long block is still "active"');
  });

  test('an all-day event is declared at the line\'s head, never on the axis', async () => {
    // It was an item spanning the visible window, which made the board
    // print its own window back as the event's hours -- "6am - 11pm /
    // Staff Training Day", which is not when the training is, it is when
    // the board decided to start looking. An all-day event has no hour to
    // show, so it gets no place on a scale of hours.
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Staff Training Day' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'Training' }, allDay: true }] }],
    })));
    assertEqual(eventItems(r.data), [], 'nothing between the first hour and the last');
    assertEqual(r.data.sidings, undefined, 'and not split into a payload of its own either');
    assertEqual(r.data.all_day.length, 1, 'it is declared once');
    const st = r.data.all_day[0];
    assertEqual(st.title, 'Staff Training Day');
    const calTrack = r.data.legend.find((p) => p.name === 'Cal');
    assertEqual(st.owners, [calTrack.key], 'against the line whose day it is');
    assertEqual(st.hue, undefined, 'presentation is the frontend\'s');
  });

  test('one all-day title shared by several lines is one origin, named once', async () => {
    // Three people are not on three holidays; they are on one. Naming it
    // per line would put the same words at three heads and say there were
    // three of them.
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Half Term' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [
        { url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'Half' }, allDay: true }] },
        { url: 'https://example.com/b.ics', name: 'Two', rules: [{ match: { type: 'word', value: 'Half' }, allDay: true }] },
      ],
    })));
    assertEqual(r.data.all_day.length, 1, 'one row, not one per line');
    assertEqual(r.data.all_day[0].owners.length, 2, 'carrying both lines');
  });

  test('a real meeting inside a long block\'s span still renders normally alongside it', async () => {
    // A standup at nine while somebody is at a desk from eight to seven.
    // Both are events, they overlap, and neither swallows the other: the
    // long one used to be filtered off the timeline, and the fear on the
    // other side of that was that the short one would go with it.
    const evLong = { start: '20260907T080000Z', end: '20260907T190000Z', summary: 'Desk booking' };
    const evMeeting = { start: '20260907T090000Z', end: '20260907T093000Z', summary: 'Standup' };
    const fetchImpl = async () => okText(icsWithEvents([evLong, evMeeting]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Ward' }],
    })));
    assertEqual(eventItems(r.data).map((e) => e.title), ['Desk booking', 'Standup'],
      'in start order, both on the timeline');
  });
};
