'use strict';

// A COMMA MEANS TWO DIFFERENT THINGS, AND ONLY ONE OF THEM IS A LIST.
//
// The value box takes "Dentist, Piano" and compiles it to an "or" of both
// words, which is the plain-language way to write "any of these". A regex
// was run through the same splitter, and a comma in a regex is a
// quantifier: "^L[0-9]{1,2}" came out as the two patterns "^L[0-9]{1" and
// "2}", the first of which does not compile at all -- the plugin drops a
// matcher it cannot compile -- and the second of which matches the literal
// text "2}". Nothing said so. The rule sat there in the editor reading like
// a regex and routed nothing.

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, fireChange, checkByLabel, jsonOut, assert, assertEqual } = h;

  const PATTERN = '^L[0-9]{1,2}\\b';

  test('a regex keeps its commas, because they are quantifiers and not a list', () => {
    const { window, document } = loadEditor();
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    fireChange(rule.querySelector('.cond-type'), 'regex');
    fireInput(rule.querySelector('.cond-value'), PATTERN);
    const hide = checkByLabel(rule, 'hide it from the map');
    hide.checked = true; fireChange(hide);

    assertEqual(jsonOut(document).rules, [{ match: { type: 'regex', value: PATTERN }, hide: true }],
      'the regex was split into pieces at its quantifier');

    // and the plugin can still compile what the editor wrote
    const parsed = window.parseConfig(document.getElementById('jsonOut').value);
    assertEqual(parsed.globalRules.length, 1, 'the plugin dropped the rule the editor produced');
  });

  test('a regex with a comma in it survives a trip through the editor', () => {
    const { document } = loadEditor();
    const cfg = {
      lines: [{ name: 'Bart' }],
      calendars: [{ url: 'https://a.example/school.ics',
        rules: [{ match: { type: 'regex', value: PATTERN }, line: 'Bart', rename: false }] }],
    };
    document.getElementById('importIn').value = JSON.stringify(cfg);
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document).calendars[0].rules, cfg.calendars[0].rules,
      'loading a config with a quantifier in a regex broke the regex on the way out');
    // the value box shows the whole pattern, not a piece of it
    assertEqual(document.querySelector('#calendars .rule .cond-value').value, PATTERN);
    assert(true);
  });
};
