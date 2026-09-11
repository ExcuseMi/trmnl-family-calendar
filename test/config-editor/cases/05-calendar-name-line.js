'use strict';

// A calendar's `name` is not a caption. Any event in it that no rule routes falls back to
// that name, and the fallback name is drawn as a LINE. Someone had an assistant write a
// configuration where every calendar got a descriptive name, and the board came back with
// seven lines for five people: two of them were calendar names that had each caught one
// stray event. Nothing in the JSON said so. The editor now does.

module.exports = function (test, h) {
  const { loadEditor, fireInput, click, assert, assertEqual } = h;

  function warnings(document) {
    return [...document.querySelectorAll('#calendars .cal-name-warn')].map((n) => n.textContent);
  }

  test('a calendar named after something that is not a track is flagged', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      lines: [{ name: 'Fry' }, { name: 'Leela' }],
      calendars: [
        { name: 'Fry', url: 'https://a.example/fry.ics' },
        { name: 'Deliveries', url: 'https://a.example/deliveries.ics' },
        { url: 'https://a.example/unnamed.ics' },
      ],
    });
    click(document.getElementById('loadImport'));
    const w = warnings(document);
    assertEqual(w.length, 3);
    assertEqual(w[0], '', 'a calendar named after a track is fine: ' + w[0]);
    assert(/Deliveries/.test(w[1]), 'the offending name is not flagged');
    assert(/line/i.test(w[1]), 'the warning never says what the name actually does: ' + w[1]);
    // ...and it has to name the control that fixes it. The warning used to
    // offer three remedies -- rename the calendar, add a line, clear the
    // name -- and omit the one right beside it, which is the one most
    // people actually want: put this feed on somebody's line.
    assert(/assign a line/i.test(w[1]),
      'the warning does not mention the control sitting next to it: ' + w[1]);
    assertEqual(w[2], '', 'an unnamed calendar has nothing to fall back to: ' + w[2]);
  });

  test('the warning appears as the name is typed, and clears when a track matches it', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      lines: [{ name: 'Fry' }],
      calendars: [{ url: 'https://a.example/x.ics' }],
    });
    click(document.getElementById('loadImport'));
    assertEqual(warnings(document)[0], '');

    fireInput(document.querySelector('#calendars .card .title-input'), 'Planet Express');
    assert(/Planet Express/.test(warnings(document)[0]), 'typing a non-track name is not flagged');

    // matching a track is the fix the warning asks for, so it has to actually clear
    fireInput(document.querySelector('#calendars .card .title-input'), 'fry');
    assertEqual(warnings(document)[0], '', 'a name that matches a track (any case) must not warn');
  });

  test('adding the missing track clears the warning on the calendar named after it', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      lines: [{ name: 'Fry' }],
      calendars: [{ name: 'Leela', url: 'https://a.example/x.ics' }],
    });
    click(document.getElementById('loadImport'));
    assert(warnings(document)[0].length > 0, 'the imported name should be flagged');
    const blank = [...document.querySelectorAll('#lines .card .title-input')].pop();
    click(document.getElementById('addLine'));
    fireInput([...document.querySelectorAll('#lines .card .title-input')].pop(), 'Leela');
    assertEqual(warnings(document)[0], '', 'naming the track should settle it');
    assert(blank, 'sanity: the tracks list rendered');
  });
};
