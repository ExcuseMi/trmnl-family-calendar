module.exports = function (test, h) {
  const { runTransform, assert } = h;

  function parse(raw) {
    return runTransform().parseConfig(JSON.stringify(raw));
  }

  test('word matcher: matches whole word only, not a substring of a longer one', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', name: 'Cal', exclude: [{ type: 'word', value: 'L1' }] }],
    });
    const rx = cfg.calendars[0].exclude[0];
    assert(rx.test('L1 Trip'), 'should match "L1 Trip"');
    assert(!rx.test('L10 Trip'), 'should NOT match "L10 Trip"');
    assert(!rx.test('XL1'), 'should NOT match "XL1"');
  });

  test('word matcher is case-insensitive', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', personRules: [{ match: { type: 'word', value: 'assembly' }, person: 'Alex' }] }],
    });
    assert(cfg.calendars[0].personRules[0].rx.test('ASSEMBLY today'), 'should match regardless of case');
  });

  test('regex matcher uses the pattern as-is (expert escape hatch)', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', exclude: [{ type: 'regex', value: '\\bK[123]\\b' }] }],
    });
    const rx = cfg.calendars[0].exclude[0];
    assert(rx.test('K2 Assembly'), 'should match K2');
    assert(!rx.test('K4 Assembly'), 'should not match K4 (outside character class)');
  });

  test('a bare string (no type/value object) is not a valid matcher and is dropped', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', exclude: ['L1'] }],
    });
    assert(cfg.calendars[0].exclude.length === 0, 'bare string matcher should be silently dropped, not crash');
  });

  test('exclude accepts a single matcher object or a list, mixing word and regex freely', () => {
    const cfg = parse({
      calendars: [{
        url: 'https://x/a.ics',
        exclude: [{ type: 'word', value: 'L1' }, { type: 'regex', value: '\\bK[123]\\b' }],
      }],
    });
    assert(cfg.calendars[0].exclude.length === 2, 'both matchers should compile');
  });

  test('personRules.match with an invalid matcher (missing value) drops the rule, not the calendar', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', personRules: [{ match: { type: 'word' }, person: 'Alex' }] }],
    });
    assert(cfg.calendars[0].personRules.length === 0, 'rule with no usable match should be dropped');
    assert(cfg.calendars.length === 1, 'the calendar itself should still be kept');
  });
};
