module.exports = function (test, h) {
  const { loadEditor, fireInput, fireChange, clickButtonByText, byText, jsonOut, assert, assertEqual } = h;

  // Sets up one calendar with a URL, one person named `name`, opens the calendar's "Rules &
  // custom headers" details, adds one rule, and returns the pieces tests need.
  function setupWithOneRule(document, personName) {
    fireInput(document.querySelector('#calendars .field-url'), 'https://example.com/a.ics');
    if (personName) {
      document.getElementById('addPerson').click();
      fireInput(document.querySelector('#people .field-narrow'), personName);
    }
    document.querySelectorAll('#calendars details.advanced').forEach((d) => { d.open = true; });
    clickButtonByText(document.querySelector('#calendars .entry'), '+ Add rule');
    const ruleCard = document.querySelector('#calendars .rule-card');
    return { ruleCard: ruleCard, document: document };
  }

  test('a word-match rule assigning a person exports with rename defaulted true', () => {
    const { document } = loadEditor();
    const { ruleCard } = setupWithOneRule(document, 'Alex');
    fireInput(ruleCard.querySelector('.rule-step .sub-entry input'), 'L6');
    const personSelect = Array.from(ruleCard.querySelectorAll('select')).find((s) => s.multiple);
    Array.from(personSelect.options).find((o) => o.value === 'Alex').selected = true;
    fireChange(personSelect);
    assertEqual(jsonOut(document).calendars[0].rules, [{ match: { type: 'word', value: 'L6' }, person: 'Alex' }]);
  });

  test('the rename checkbox is disabled with no person assigned, and enabled once one is', () => {
    const { document } = loadEditor();
    const { ruleCard } = setupWithOneRule(document, 'Alex');
    const renameChk = byText(ruleCard, 'label', 'rename match to person name').querySelector('input');
    assert(renameChk.disabled, 'should start disabled — no person assigned yet');
    fireInput(ruleCard.querySelector('.rule-step .sub-entry input'), 'L6');
    const personSelect = Array.from(ruleCard.querySelectorAll('select')).find((s) => s.multiple);
    Array.from(personSelect.options).find((o) => o.value === 'Alex').selected = true;
    fireChange(personSelect);
    assert(!renameChk.disabled, 'should become enabled once a person is assigned');
  });

  test('a "status" condition exports the exact confirmed/tentative/cancelled value picked', () => {
    const { document } = loadEditor();
    const { ruleCard } = setupWithOneRule(document);
    const typeSelect = ruleCard.querySelector('.rule-step select');
    fireChange(typeSelect, 'status');
    const statusSelect = Array.from(ruleCard.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === 'tentative'));
    fireChange(statusSelect, 'tentative');
    document.querySelector('input[type=checkbox]').checked; // no-op sanity touch
    const hideChk = byText(ruleCard, 'label', 'hide').querySelector('input');
    hideChk.checked = true;
    fireChange(hideChk);
    assertEqual(jsonOut(document).calendars[0].rules, [{ match: { type: 'status', value: 'tentative' }, hide: true }]);
  });

  test('a "weekday" condition toggles days on and off via the day buttons', () => {
    const { document } = loadEditor();
    const { ruleCard } = setupWithOneRule(document);
    fireChange(ruleCard.querySelector('.rule-step select'), 'weekday');
    clickButtonByText(ruleCard, 'Fri');
    clickButtonByText(ruleCard, 'Sat');
    const hideChk = byText(ruleCard, 'label', 'hide').querySelector('input');
    hideChk.checked = true;
    fireChange(hideChk);
    assertEqual(jsonOut(document).calendars[0].rules, [{ match: { type: 'weekday', value: ['FR', 'SA'] }, hide: true }]);
    // Clicking "Fri" again should remove it.
    clickButtonByText(ruleCard, 'Fri');
    assertEqual(jsonOut(document).calendars[0].rules, [{ match: { type: 'weekday', value: ['SA'] }, hide: true }]);
  });

  test('+ Add condition chains two conditions with the chosen AND/OR combinator', () => {
    const { document } = loadEditor();
    const { ruleCard } = setupWithOneRule(document);
    fireChange(ruleCard.querySelector('.rule-step select'), 'weekday');
    clickButtonByText(ruleCard, 'Fri');
    clickButtonByText(ruleCard, '+ Add condition (AND/OR)');
    // ruleCard has TWO ".rule-step" blocks (the match step and the "Then" step, which also uses
    // .sub-entry rows internally) — scope to the first (the match/conditions step) specifically.
    const matchStep = ruleCard.querySelector('.rule-step');
    const rows = matchStep.querySelectorAll('.sub-entry');
    assertEqual(rows.length, 2, 'should now have two condition rows');
    fireChange(rows[1].querySelector('select'), 'status');
    // Each condition row carries its own status <select>, whether visible or not — scope the
    // query to row[1] specifically, not the whole card, or it'd find row[0]'s (hidden) one too.
    const statusSelect = Array.from(rows[1].querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === 'tentative'));
    fireChange(statusSelect, 'tentative');
    const combSel = Array.from(ruleCard.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === 'or') && Array.from(s.options).some((o) => o.value === 'and'));
    fireChange(combSel, 'or');
    const hideChk = byText(ruleCard, 'label', 'hide').querySelector('input');
    hideChk.checked = true;
    fireChange(hideChk);
    assertEqual(jsonOut(document).calendars[0].rules, [{
      match: { type: 'or', matchers: [{ type: 'weekday', value: ['FR'] }, { type: 'status', value: 'tentative' }] },
      hide: true,
    }]);
  });

  test('removing a condition back down to one collapses the export to a plain (unwrapped) matcher', () => {
    const { document } = loadEditor();
    const { ruleCard } = setupWithOneRule(document);
    fireInput(ruleCard.querySelector('.rule-step .sub-entry input'), 'Standup');
    clickButtonByText(ruleCard, '+ Add condition (AND/OR)');
    // Both rows now show their own "Remove" button — scope to the 2nd (blank) row specifically,
    // or clickButtonByText would find row 1's ("Standup") first and remove the wrong one.
    // ruleCard also has a "Then" .rule-step with its own .sub-entry rows — scope to the match
    // step (the first .rule-step) so index 1 really is the 2nd condition, not a "Then" row.
    const rows = ruleCard.querySelector('.rule-step').querySelectorAll('.sub-entry');
    clickButtonByText(rows[1], 'Remove');
    const hideChk = byText(ruleCard, 'label', 'hide').querySelector('input');
    hideChk.checked = true;
    fireChange(hideChk);
    assertEqual(jsonOut(document).calendars[0].rules, [{ match: { type: 'word', value: 'Standup' }, hide: true }]);
  });

  test('a rule with a match but no effect shows the "won\'t be included" warning, and it clears once an effect is added', () => {
    const { document } = loadEditor();
    const { ruleCard } = setupWithOneRule(document);
    fireInput(ruleCard.querySelector('.rule-step .sub-entry input'), 'Standup');
    const warning = () => ruleCard.querySelector('.status.err');
    assert(warning() && warning().textContent.length > 0, 'should warn: matches but does nothing yet');
    // A calendar whose only rule is a no-op exports with no "rules" key at all (same minimal-
    // JSON convention as an unset color/name), not an empty array.
    assertEqual(jsonOut(document).calendars[0].rules, undefined, 'the no-op rule should not appear in the exported JSON at all');
    const hideChk = byText(ruleCard, 'label', 'hide').querySelector('input');
    hideChk.checked = true;
    fireChange(hideChk);
    assertEqual(warning().textContent, '', 'warning should clear once the rule actually does something');
  });

  test('rename is hinted as ineffective for a multi-condition rule even with a person assigned', () => {
    const { document } = loadEditor();
    const { ruleCard } = setupWithOneRule(document, 'Alex');
    fireInput(ruleCard.querySelector('.rule-step .sub-entry input'), 'Standup');
    clickButtonByText(ruleCard, '+ Add condition (AND/OR)');
    const personSelect = Array.from(ruleCard.querySelectorAll('select')).find((s) => s.multiple);
    Array.from(personSelect.options).find((o) => o.value === 'Alex').selected = true;
    fireChange(personSelect);
    const renameChk = byText(ruleCard, 'label', 'rename match to person name').querySelector('input');
    assert(renameChk.disabled, 'rename should be disabled — the top-level match is now an "and" of 2 conditions, nothing to rename');
  });

  test('global rules (top-level, not per-calendar) use the same builder and export under "rules"', () => {
    const { document } = loadEditor();
    document.getElementById('addGlobalRule').click();
    fireChange(document.querySelector('#globalRules .rule-card .rule-step select'), 'any');
    document.getElementById('addPerson').click();
    fireInput(document.querySelector('#people .field-narrow'), 'Mom');
    // addPerson's handler re-renders #globalRules from scratch (renderGlobal()), so the rule-card
    // queried above no longer exists in the DOM — re-query it fresh rather than reuse that node.
    const ruleCard = document.querySelector('#globalRules .rule-card');
    const personSelect = Array.from(ruleCard.querySelectorAll('select')).find((s) => s.multiple);
    Array.from(personSelect.options).find((o) => o.value === 'Mom').selected = true;
    fireChange(personSelect);
    const out = jsonOut(document);
    // rename isn't explicitly false here — an "any" match defaults the rename CHECKBOX state to
    // unchanged (true) in the editor's own model, but ruleValue() only ever emits an explicit
    // "rename" key when it's false, and transform.js's own compileRule() defaults an absent
    // rename to false for an any/all match anyway — so omitting the key is equally correct.
    assertEqual(out.rules, [{ match: { type: 'any' }, person: 'Mom' }]);
    assert(!out.calendars.length || !out.calendars[0].rules, 'the global rule must not also land on a calendar');
  });
};
