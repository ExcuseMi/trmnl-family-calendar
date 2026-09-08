module.exports = function (test, h) {
  const { runTransform, assert } = h;

  function parse(raw) {
    return runTransform().parseConfig(JSON.stringify(raw));
  }

  test('word matcher: matches whole word only, not a substring of a longer one', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'L1' }, hide: true }] }],
    });
    const rx = cfg.calendars[0].rules[0].rx;
    assert(rx.test('L1 Trip'), 'should match "L1 Trip"');
    assert(!rx.test('L10 Trip'), 'should NOT match "L10 Trip"');
    assert(!rx.test('XL1'), 'should NOT match "XL1"');
  });

  test('regex matcher uses the pattern as-is (expert escape hatch)', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'regex', value: '\\bK[123]\\b' }, hide: true }] }],
    });
    const rx = cfg.calendars[0].rules[0].rx;
    assert(rx.test('K2 Assembly'), 'should match K2');
    assert(!rx.test('K4 Assembly'), 'should not match K4 (outside character class)');
  });

  test('"contains" matcher: plain substring anywhere, no word boundaries', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'contains', value: 'team' }, hide: true }] }],
    });
    const rx = cfg.calendars[0].rules[0].rx;
    assert(rx.test('Steam Room'), 'should match mid-word, unlike "word"');
    assert(!rx.test('Tea Room'), 'should not match when the substring genuinely is not present');
  });

  test('"exact" matcher: the whole title must equal the value, nothing more', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'exact', value: 'Desk booking' }, hide: true }] }],
    });
    const rx = cfg.calendars[0].rules[0].rx;
    assert(rx.test('DESK BOOKING'), 'should still be case-insensitive');
    assert(!rx.test('Desk booking (extended)'), 'should not match a title that merely contains it');
  });

  test('"any"/"all" matcher matches every title, empty or not, no value needed', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'any' }, hide: true }] }],
    });
    assert(cfg.calendars[0].rules[0].rx.test(''), 'should match an empty title too');
    const cfg2 = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'all' }, hide: true }] }],
    });
    assert(cfg2.calendars[0].rules[0].rx.test('anything'), '"all" should be accepted as a synonym for "any"');
  });

  test('an "any" match assigning a person defaults rename to false (opt-in, not opt-out)', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'any' }, person: 'Ward' }] }],
    });
    assert(cfg.calendars[0].rules[0].rename === false, 'rename should default to false for a catch-all match');
  });

  test('an "any" match can still opt into rename explicitly', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'any' }, person: 'Ward', rename: true }] }],
    });
    assert(cfg.calendars[0].rules[0].rename === true, 'rename:true should still be honored when explicitly set on an "any" match');
  });

  test('a word/regex match still defaults rename to true, unaffected by the "any" default change', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'L6' }, person: 'Alex' }] }],
    });
    assert(cfg.calendars[0].rules[0].rename === true);
  });

  test('a rule with no match is dropped, not crash', () => {
    const cfg = parse({ calendars: [{ url: 'https://x/a.ics', rules: [{ hide: true }] }] });
    assert(cfg.calendars[0].rules.length === 0, 'a rule missing "match" entirely should be silently dropped');
  });

  test('a rule with no effect (no person/allDay/hide/rewrite) is dropped', () => {
    const cfg = parse({ calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'L1' } }] }] });
    assert(cfg.calendars[0].rules.length === 0, 'a rule that does nothing should be dropped, not kept as a no-op');
  });

  test('a rule\'s person is normalized to an array even when given a single string', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'L1' }, person: 'Alex', allDay: true }] }],
    });
    const rule = cfg.calendars[0].rules[0];
    assert(rule.allDay === true);
    assert(rule.hide === false, 'hide should default to false');
    assert(JSON.stringify(rule.person) === JSON.stringify(['Alex']));
  });

  test('a rule\'s person field also accepts a list directly', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'Dinner' }, person: ['Alex', 'Kids'] }] }],
    });
    assert(JSON.stringify(cfg.calendars[0].rules[0].person) === JSON.stringify(['Alex', 'Kids']));
  });

  test('a calendar rule with an invalid matcher (missing value) drops the rule, not the calendar', () => {
    const cfg = parse({ calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word' }, person: 'Alex' }] }] });
    assert(cfg.calendars[0].rules.length === 0);
    assert(cfg.calendars.length === 1, 'the calendar itself should still be kept');
  });

  test('global (top-level) rules compile separately from any calendar\'s own', () => {
    const cfg = parse({
      rules: [{ match: { type: 'word', value: 'Doctor' }, person: 'Mom' }],
      calendars: [{ url: 'https://x/a.ics' }],
    });
    assert(cfg.globalRules.length === 1, 'the top-level rule should compile');
    assert(cfg.calendars[0].rules.length === 0, 'it should not leak into the calendar\'s own rules');
  });

  function ctx(overrides) {
    return Object.assign({ title: '', desc: '', status: '', weekday: null }, overrides);
  }

  test('"and" matcher only matches when every sub-matcher matches', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{
        match: { type: 'and', matchers: [{ type: 'word', value: 'Standup' }, { type: 'weekday', value: 'FR' }] },
        hide: true,
      }] }],
    });
    const m = cfg.calendars[0].rules[0].match;
    assert(m(ctx({ title: 'Standup', weekday: 4 })), 'Friday (weekday 4) Standup should match');
    assert(!m(ctx({ title: 'Standup', weekday: 0 })), 'Monday Standup should NOT match');
    assert(!m(ctx({ title: 'Retro', weekday: 4 })), 'Friday Retro should NOT match');
  });

  test('"or" matcher matches when any sub-matcher matches', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{
        match: { type: 'or', matchers: [{ type: 'word', value: 'Vacation' }, { type: 'status', value: 'cancelled' }] },
        hide: true,
      }] }],
    });
    const m = cfg.calendars[0].rules[0].match;
    assert(m(ctx({ title: 'Vacation', status: 'CONFIRMED' })));
    assert(m(ctx({ title: 'Team Sync', status: 'CANCELLED' })));
    assert(!m(ctx({ title: 'Team Sync', status: 'CONFIRMED' })));
  });

  test('"status" matcher compares case-insensitively against the event\'s ICS STATUS', () => {
    const cfg = parse({ calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'status', value: 'tentative' }, hide: true }] }] });
    const m = cfg.calendars[0].rules[0].match;
    assert(m(ctx({ status: 'TENTATIVE' })));
    assert(!m(ctx({ status: 'CONFIRMED' })));
  });

  test('"weekday" matcher accepts a single day or a list, by 2-letter or full name', () => {
    const single = parse({ calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'weekday', value: 'Monday' }, hide: true }] }] }).calendars[0].rules[0].match;
    assert(single(ctx({ weekday: 0 })), 'weekday 0 (Monday) should match "Monday"');
    assert(!single(ctx({ weekday: 1 })));

    const list = parse({ calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'weekday', value: ['SA', 'SU'] }, hide: true }] }] }).calendars[0].rules[0].match;
    assert(list(ctx({ weekday: 5 })));
    assert(list(ctx({ weekday: 6 })));
    assert(!list(ctx({ weekday: 2 })));
  });

  test('a rule can hide events only on a specific weekday, end to end', async () => {
    const { runTransform, icsWithEvents, okText, baseInput, eventItems, assertEqual } = h;
    // A weekly-Monday-and-Wednesday-alike series, expressed as one weekly
    // master (matches every Monday from 2026-09-07 on) — checked against
    // two different "todays" since this plugin only ever shows one day.
    const events = [{ uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE', summary: 'Weekly Sync' }];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const cfg = JSON.stringify({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'weekday', value: 'MO' }, hide: true }] }],
    });

    const MONDAY = Date.parse('2026-09-07T12:00:00Z');
    const rMon = await runTransform(fetchImpl, MONDAY).run(baseInput(MONDAY, { config_json: cfg }));
    assertEqual(eventItems(rMon.metro).length, 0, 'Monday occurrence should be hidden by the weekday rule');

    const WEDNESDAY = Date.parse('2026-09-09T12:00:00Z');
    const rWed = await runTransform(fetchImpl, WEDNESDAY).run(baseInput(WEDNESDAY, { config_json: cfg }));
    assertEqual(eventItems(rWed.metro).length, 1, 'Wednesday occurrence should still show — the rule only targets Monday');
  });
};
