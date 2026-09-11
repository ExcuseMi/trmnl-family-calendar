module.exports = function (test, h) {
  const { loadEditor, fireInput, fireChange, click, buttonByText, checkByLabel, jsonOut, selectMulti, assert, assertEqual } = h;

  test('a fresh editor exports an empty configuration', () => {
    const { document } = loadEditor();
    assertEqual(jsonOut(document), { lines: [], calendars: [] });
  });

  // Side and colour used to be two <select>s on every track card. They are gone: the
  // plugin balances sides against the day's real event counts and picks colours from the
  // panel's theme, and neither could be guessed well from this page. What must NOT happen
  // is that opening an old configuration here silently strips them, so the two halves are
  // tested apart: no control to set one, but an imported one survives the round trip.
  test('a line card offers no side or colour control', () => {
    const { document } = loadEditor();
    const card = document.querySelector('#lines .card');
    fireInput(card.querySelector('.title-input'), 'Sam');
    assertEqual(card.querySelectorAll('select').length, 0);
    assertEqual(jsonOut(document).lines, [{ name: 'Sam' }]);
    const labels = [...document.querySelectorAll('#lines label')].map((l) => l.textContent);
    assert(!labels.some((t) => /side|colour|color/i.test(t)), 'a side/colour control is still offered: ' + JSON.stringify(labels));
  });

  test('a side and colour that came in with an imported config are still exported', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      lines: [{ name: 'Sam', color: 'gray-20', side: 'left' }, { name: 'Alex' }],
      calendars: [{ url: 'https://example.com/a.ics' }],
    });
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document).lines, [{ name: 'Sam', color: 'gray-20', side: 'left' }, { name: 'Alex' }]);
  });

  test('a calendar assigned to a track exports a leading "any" rule', () => {
    const { document } = loadEditor();
    fireInput(document.querySelector('#lines .card .title-input'), 'Alex');
    fireChange(document.querySelector('#lines .card .title-input'));
    const cal = document.querySelector('#calendars .card');
    fireInput(cal.querySelector('input[type=text]:not(.title-input)'), 'https://example.com/a.ics');
    fireInput(cal.querySelector('.title-input'), 'Alex');
    selectMulti(cal.querySelector('select[multiple]'), ['Alex']);
    assertEqual(jsonOut(document).calendars, [{ url: 'https://example.com/a.ics', name: 'Alex', rules: [{ match: { type: 'any' }, line: 'Alex' }] }]);
  });

  test('a global rule with a word condition, a track and hide exports correctly', () => {
    const { document } = loadEditor();
    fireInput(document.querySelector('#lines .card .title-input'), 'Kids');
    fireChange(document.querySelector('#lines .card .title-input'));
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    fireInput(rule.querySelector('.cond input[type=text]'), 'L2');
    selectMulti(rule.querySelector('select[multiple]'), ['Kids']);
    assertEqual(jsonOut(document).rules, [{ match: { type: 'word', value: 'L2' }, line: 'Kids' }]);
    const hide = checkByLabel(rule, 'hide it from the map');
    hide.checked = true; fireChange(hide);
    assertEqual(jsonOut(document).rules[0].hide, true);
  });

  // THE TWO ACTIONS YOU USED TO HAVE TO HAND-EDIT JSON FOR.
  //
  // Both survived a round trip already, so a config carrying one was safe
  // in the editor; neither could be SET in it. Stripping a class code is
  // the commonest thing anybody wants a rule for, and it is written as an
  // empty `rewrite` -- which a text box cannot express, since every rule
  // starts with an empty box.
  test('a rule can delete the matched text, which no text box can say', () => {
    const { document } = loadEditor();
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    fireInput(rule.querySelector('.cond input[type=text]'), 'L6');
    const wipe = checkByLabel(rule, 'delete the matched text');
    wipe.checked = true; fireChange(wipe);
    assertEqual(jsonOut(document).rules, [{ match: { type: 'word', value: 'L6' }, rewrite: '' }]);
    // and it takes the rename box out of play: a rule cannot both delete
    // the matched text and put something else there
    assert(rule.querySelector('input[type=text][placeholder^="new title"]').disabled,
      'the rename box is still live under a rule that deletes what it matched');
  });

  test('a rule can move a timed event to the head of the line', () => {
    const { document } = loadEditor();
    fireInput(document.querySelector('#lines .card .title-input'), 'Mia');
    fireChange(document.querySelector('#lines .card .title-input'));
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    fireInput(rule.querySelector('.cond input[type=text]'), 'Leave');
    selectMulti(rule.querySelector('select[multiple]'), ['Mia']);
    const allDay = checkByLabel(rule, 'head of the line');
    allDay.checked = true; fireChange(allDay);
    assertEqual(jsonOut(document).rules[0].allDay, true);
  });

  test('a rule with no action is left out of the JSON and flagged', () => {
    const { document } = loadEditor();
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    fireInput(rule.querySelector('.cond input[type=text]'), 'Dentist');
    assert(!jsonOut(document).rules, 'rule without action must not export');
    assert(rule.querySelector('.status.err').textContent.length > 0, 'warning shown');
  });

  test('two conditions export as an and-matcher', () => {
    const { document } = loadEditor();
    fireInput(document.querySelector('#lines .card .title-input'), 'Sam');
    fireChange(document.querySelector('#lines .card .title-input'));
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    fireInput(rule.querySelector('.cond input[type=text]'), 'Piano');
    click(buttonByText(rule, '+ condition'));
    const conds = rule.querySelectorAll('.cond');
    // By class, not by index: the row grew a field select between these
    // two the day matching stopped being title-only.
    fireChange(conds[1].querySelector('.cond-comb'), 'or');
    fireChange(conds[1].querySelector('.cond-type'), 'weekday');
    click(buttonByText(conds[1], 'Wed'));
    selectMulti(rule.querySelector('select[multiple]'), ['Sam']);
    assertEqual(jsonOut(document).rules[0].match, { type: 'or', matchers: [{ type: 'word', value: 'Piano' }, { type: 'weekday', value: ['WE'] }] });
  });
};
