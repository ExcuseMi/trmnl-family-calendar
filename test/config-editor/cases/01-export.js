module.exports = function (test, h) {
  const { loadEditor, fireInput, fireChange, click, buttonByText, jsonOut, selectMulti, assert, assertEqual } = h;

  test('a fresh editor exports an empty configuration', () => {
    const { document } = loadEditor();
    assertEqual(jsonOut(document), { people: [], calendars: [] });
  });

  test('a person with a side and colour exports as { name, color, side }', () => {
    const { document } = loadEditor();
    const card = document.querySelector('#people .card');
    fireInput(card.querySelector('.title-input'), 'Sam');
    const selects = card.querySelectorAll('select');
    fireChange(selects[0], 'left');
    fireChange(document.querySelector('#people .card').querySelectorAll('select')[1], 'gray-20');
    assertEqual(jsonOut(document).people, [{ name: 'Sam', color: 'gray-20', side: 'left' }]);
  });

  test('a calendar assigned to a person exports a leading "any" rule', () => {
    const { document } = loadEditor();
    fireInput(document.querySelector('#people .card .title-input'), 'Alex');
    fireChange(document.querySelector('#people .card .title-input'));
    const cal = document.querySelector('#calendars .card');
    fireInput(cal.querySelector('input[type=text]:not(.title-input)'), 'https://example.com/a.ics');
    fireInput(cal.querySelector('.title-input'), 'Alex');
    selectMulti(cal.querySelector('select[multiple]'), ['Alex']);
    assertEqual(jsonOut(document).calendars, [{ url: 'https://example.com/a.ics', name: 'Alex', rules: [{ match: { type: 'any' }, person: 'Alex' }] }]);
  });

  test('a global rule with a word condition, a person and hide exports correctly', () => {
    const { document } = loadEditor();
    fireInput(document.querySelector('#people .card .title-input'), 'Kids');
    fireChange(document.querySelector('#people .card .title-input'));
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    fireInput(rule.querySelector('.cond input[type=text]'), 'L2');
    selectMulti(rule.querySelector('select[multiple]'), ['Kids']);
    assertEqual(jsonOut(document).rules, [{ match: { type: 'word', value: 'L2' }, person: 'Kids' }]);
    const hide = rule.querySelectorAll('input[type=checkbox]')[2];
    hide.checked = true; fireChange(hide);
    assertEqual(jsonOut(document).rules[0].hide, true);
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
    fireInput(document.querySelector('#people .card .title-input'), 'Sam');
    fireChange(document.querySelector('#people .card .title-input'));
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    fireInput(rule.querySelector('.cond input[type=text]'), 'Piano');
    click(buttonByText(rule, '+ condition'));
    const conds = rule.querySelectorAll('.cond');
    fireChange(conds[1].querySelector('select'), 'or');
    fireChange(conds[1].querySelectorAll('select')[1], 'weekday');
    click(buttonByText(conds[1], 'Wed'));
    selectMulti(rule.querySelector('select[multiple]'), ['Sam']);
    assertEqual(jsonOut(document).rules[0].match, { type: 'or', matchers: [{ type: 'word', value: 'Piano' }, { type: 'weekday', value: ['WE'] }] });
  });
};
