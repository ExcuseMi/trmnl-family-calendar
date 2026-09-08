const fs = require('fs');
const path = require('path');
module.exports = function (test, h) {
  const { loadEditor, click, jsonOut, assert, assertEqual } = h;
  const demo = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../demo-config.json'), 'utf-8'));

  test('the demo configuration round-trips through the editor', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify(demo);
    click(document.getElementById('loadImport'));
    const out = jsonOut(document);
    assertEqual(out.people, demo.people);
    assertEqual(out.calendars, demo.calendars);
    assertEqual(out.timeZone, demo.timeZone);
    assert(document.querySelectorAll('#people .card').length === demo.people.length);
  });

  test('a plain list of ICS links imports as bare calendars', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = 'https://a.example/x.ics\nwebcal://b.example/y.ics\n';
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document).calendars, [{ url: 'https://a.example/x.ics' }, { url: 'webcal://b.example/y.ics' }]);
  });

  test('people named only in rules are added to the people list on import', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({ calendars: [{ url: 'https://a.example/x.ics', rules: [{ match: { type: 'word', value: 'Yoga' }, person: 'Alex' }] }] });
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document).people, [{ name: 'Alex' }]);
    assertEqual(jsonOut(document).calendars[0].rules, [{ match: { type: 'word', value: 'Yoga' }, person: 'Alex' }]);
  });

  test('the editor parses its own output with the plugin\'s parseConfig', () => {
    const { window, document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify(demo);
    click(document.getElementById('loadImport'));
    const parsed = window.parseConfig(document.getElementById('jsonOut').value);
    assert(parsed.calendars.length === demo.calendars.length);
    assert(Object.keys(parsed.people).length === demo.people.length);
    assert(parsed.people['sam'].side === 'left');
  });
};
