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
    assertEqual(out.tracks, demo.tracks);
    assertEqual(out.calendars, demo.calendars);
    assertEqual(out.timeZone, demo.timeZone);
    assert(document.querySelectorAll('#tracks .card').length === demo.tracks.length);
  });

  test('a plain list of ICS links imports as bare calendars', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = 'https://a.example/x.ics\nwebcal://b.example/y.ics\n';
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document).calendars, [{ url: 'https://a.example/x.ics' }, { url: 'webcal://b.example/y.ics' }]);
  });

  test('tracks named only in rules are added to the tracks list on import', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({ calendars: [{ url: 'https://a.example/x.ics', rules: [{ match: { type: 'word', value: 'Yoga' }, track: 'Alex' }] }] });
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document).tracks, [{ name: 'Alex' }]);
    assertEqual(jsonOut(document).calendars[0].rules, [{ match: { type: 'word', value: 'Yoga' }, track: 'Alex' }]);
  });

  test('the editor parses its own output with the plugin\'s parseConfig', () => {
    const { window, document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify(demo);
    click(document.getElementById('loadImport'));
    const parsed = window.parseConfig(document.getElementById('jsonOut').value);
    assert(parsed.calendars.length === demo.calendars.length);
    assert(Object.keys(parsed.tracks).length === demo.tracks.length);
    assert(parsed.tracks['sam'].side === 'left');
  });

  test('importing a legacy config (top-level "people", rule "person") still loads tracks and rules correctly', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      people: [{ name: 'Nala', color: 'gray-40' }],
      calendars: [{ url: 'https://a.example/x.ics', rules: [{ match: { type: 'word', value: 'L6' }, person: 'Nala' }] }],
    });
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document).tracks, [{ name: 'Nala', color: 'gray-40' }]);
    assertEqual(jsonOut(document).calendars[0].rules, [{ match: { type: 'word', value: 'L6' }, track: 'Nala' }]);
  });

  test('importing a "siding" rule round-trips and checks the siding box', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      tracks: [{ name: 'Ward' }],
      calendars: [{ url: 'https://a.example/x.ics', rules: [{ match: { type: 'word', value: 'Desk booking' }, siding: true }] }],
    });
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document).calendars[0].rules, [{ match: { type: 'word', value: 'Desk booking' }, siding: true }]);
    const rule = document.querySelector('#calendars .card .rule');
    assert(rule.querySelectorAll('input[type=checkbox]')[3].checked, 'the siding checkbox should reflect the imported rule');
  });

  test('importing hideIfEmpty:false round-trips and ticks the keep-empty box', () => {
    // the switch that keeps a quiet person's line on the board: it has to
    // survive a trip through the editor, or anyone who opens their config
    // there loses it without being told
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      calendars: [
        { name: 'Quiet', url: 'https://a.example/q.ics', hideIfEmpty: false },
        { name: 'Busy', url: 'https://a.example/b.ics' },
      ],
    });
    click(document.getElementById('loadImport'));
    const out = jsonOut(document).calendars;
    assertEqual(out[0].hideIfEmpty, false);
    assert(!('hideIfEmpty' in out[1]), 'the default should not be written out: ' + JSON.stringify(out[1]));
    const cards = document.querySelectorAll('#calendars .card');
    const boxOf = (card) => [...card.querySelectorAll('.adv-body label.check input[type=checkbox]')].pop();
    assert(boxOf(cards[0]).checked, 'the keep-empty box should be ticked for the imported calendar');
    assert(!boxOf(cards[1]).checked, 'the other calendar should be left alone');
  });
  // What comes back out of a chat window is not what went in: the answer is
  // wrapped in a code fence, every bracket escaped for markdown, every line
  // ended with a backslash. The box people paste into is the same box, so it
  // has to read that too. (The plugin's own parser does the same thing; the
  // two are tested apart because a config that only loads in the tool and
  // not on the device is worse than one that loads in neither.)
  test('a configuration copied out of a chat window imports', () => {
    const cfg = { tracks: [{ name: 'Fry' }], calendars: [{ url: 'https://a.example/x.ics' }] };
    const pretty = JSON.stringify(cfg, null, 1);
    const mangled = 'Here you go:\n\n```json\n'
      + pretty.replace(/([[\]{}])/g, '\\$1').split('\n').join('\\\n')
      + '\n```\n\nPaste that into TRMNL.';
    const { document } = loadEditor();
    document.getElementById('importIn').value = mangled;
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document).tracks, cfg.tracks, 'the tracks did not survive the paste');
    assertEqual(jsonOut(document).calendars, cfg.calendars, 'the calendars did not survive the paste');
  });

};
