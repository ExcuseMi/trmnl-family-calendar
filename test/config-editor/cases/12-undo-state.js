'use strict';

// WHAT UNDO PUTS BACK HAS TO BE EVERYTHING THE LOAD TOOK.
//
// Undo restores the editor from a deep copy of its own state, which is the
// right shape for it, but it was putting back a hand-listed four fields out
// of six. The two it missed are the two this page deliberately has no
// control for -- the clock and the temperature unit -- so nothing on screen
// showed them coming or going, and a config that went in reading "12h" came
// back out of an undo reading whatever the last load happened to leave.

module.exports = function (test, h) {
  const { loadEditor, click, jsonOut, assert, assertEqual } = h;

  function load(document, cfg) {
    document.getElementById('importIn').value = typeof cfg === 'string' ? cfg : JSON.stringify(cfg);
    click(document.getElementById('loadImport'));
  }

  test('undo takes back a clock setting that arrived with a load', () => {
    const { document } = loadEditor();
    load(document, { timeFormat: '12h', temperatureUnit: 'f', calendars: ['https://a.example/x.ics'] });
    assertEqual(jsonOut(document).timeFormat, '12h', 'sanity: the setting came in with the config');
    click(document.getElementById('undoBtn'));
    const out = jsonOut(document);
    assert(!('timeFormat' in out), 'undo left the clock set to a config that is no longer loaded: ' + JSON.stringify(out));
    assert(!('temperatureUnit' in out), 'undo left the temperature unit behind: ' + JSON.stringify(out));
  });

  test('undo puts a clock setting back when that is what was there before', () => {
    const { document } = loadEditor();
    load(document, { timeFormat: '12h', calendars: ['https://a.example/x.ics'] });
    load(document, 'https://a.example/y.ics');
    click(document.getElementById('undoBtn'));
    assertEqual(jsonOut(document).timeFormat, '12h',
      'undoing back to a 12h configuration silently flipped the board to 24h');
  });
};
