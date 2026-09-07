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

  test('word matcher is case-insensitive', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'assembly' }, person: 'Alex' }] }],
    });
    assert(cfg.calendars[0].rules[0].rx.test('ASSEMBLY today'), 'should match regardless of case');
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
    assert(rx.test('Team Meeting'), 'should match at a word boundary too');
    assert(rx.test('Steam Room'), 'should match mid-word, unlike "word"');
    assert(!rx.test('Tea Room'), 'should not match when the substring genuinely is not present');
  });

  test('"exact" matcher: the whole title must equal the value, nothing more', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'exact', value: 'Desk booking' }, hide: true }] }],
    });
    const rx = cfg.calendars[0].rules[0].rx;
    assert(rx.test('Desk booking'), 'should match the exact title');
    assert(rx.test('DESK BOOKING'), 'should still be case-insensitive');
    assert(!rx.test('Desk booking (extended)'), 'should not match a title that merely contains it');
    assert(!rx.test('booking'), 'should not match a partial title');
  });

  test('"any"/"all" matcher matches every title, empty or not, no value needed', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'any' }, hide: true }] }],
    });
    const rx = cfg.calendars[0].rules[0].rx;
    assert(rx.test('literally anything'), 'should match a normal title');
    assert(rx.test(''), 'should match an empty title too');
    const cfg2 = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'all' }, hide: true }] }],
    });
    assert(cfg2.calendars[0].rules[0].rx.test('anything'), '"all" should be accepted as a synonym for "any"');
  });

  test('an "any" match assigning a person defaults rename to false (opt-in, not opt-out)', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'any' }, person: 'Ward' }] }],
    });
    assert(cfg.calendars[0].rules[0].rename === false, 'rename should default to false for a catch-all match — there is no specific text to rename');
  });

  test('an "any" match can still opt into rename explicitly', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'any' }, person: 'Ward', rename: true }] }],
    });
    assert(cfg.calendars[0].rules[0].rename === true, 'rename:true should still be honored when explicitly set on an "any" match');
  });

  test('a word/regex match still defaults rename to true, unchanged from before "any" existed', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'L6' }, person: 'Alex' }] }],
    });
    assert(cfg.calendars[0].rules[0].rename === true, 'word/regex matches should be unaffected by the "any" default change');
  });

  test('a rule with no match is dropped, not crash', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ hide: true }] }],
    });
    assert(cfg.calendars[0].rules.length === 0, 'a rule missing "match" entirely should be silently dropped');
  });

  test('a rule with no effect (no person/allDay/hide) is dropped', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'L1' } }] }],
    });
    assert(cfg.calendars[0].rules.length === 0, 'a rule that does nothing should be dropped, not kept as a no-op');
  });

  test('one rule can combine person, allDay, and hide at once', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'L1' }, person: 'Alex', allDay: true }] }],
    });
    const rule = cfg.calendars[0].rules[0];
    assert(rule.allDay === true, 'allDay should be set');
    assert(rule.hide === false, 'hide should default to false');
    assert(JSON.stringify(rule.person) === JSON.stringify(['Alex']), 'person should be normalized to an array');
  });

  test('legacy exclude/personRules still compile into the same rules list', () => {
    const cfg = parse({
      calendars: [{
        url: 'https://x/a.ics',
        exclude: [{ type: 'word', value: 'L1' }, { type: 'regex', value: '\\bK[123]\\b' }],
        personRules: [{ match: { type: 'word', value: 'assembly' }, person: 'Alex' }],
      }],
    });
    assert(cfg.calendars[0].rules.length === 3, 'both legacy exclude entries and the personRule should compile');
    assert(cfg.calendars[0].rules.filter((r) => r.hide).length === 2, 'both exclude entries should carry hide:true');
  });

  test('personRules.match with an invalid matcher (missing value) drops the rule, not the calendar', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', personRules: [{ match: { type: 'word' }, person: 'Alex' }] }],
    });
    assert(cfg.calendars[0].rules.length === 0, 'rule with no usable match should be dropped');
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
};
