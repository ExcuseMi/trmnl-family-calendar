'use strict';

// WHAT THE PROMPT SAYS ABOUT ITSELF HAS TO BE TRUE OF THE PROMPT.
//
// The status line under Generate is the tool's own verdict on the round trip
// about to be spent: how many calendars are in the prompt and how many of
// them carry events. It is read instead of the prompt, so when it counts
// something else the reader is told a wasted copy is a good one.

module.exports = function (test, h) {
  const { loadEditor, click, assert } = h;

  test('the prompt status counts the calendars in the editor, not every feed ever read', () => {
    const { window, document } = loadEditor();
    window.confirm = () => true;
    // An example arrives with seven feeds of its own, all of them read.
    click(document.querySelector('#presets button[data-preset="family4"]'));
    // Then the user pastes their own single link, which replaces the lot.
    document.getElementById('importIn').value = 'https://mine.example/a.ics';
    click(document.getElementById('loadImport'));

    click(document.getElementById('makePrompt'));
    const st = document.getElementById('promptStatus').textContent;
    assert(!/\b7\b/.test(st),
      'the status counted the example feeds, which are not in this configuration: ' + st);
    assert(/no events/.test(st),
      'the one configured feed has not been read, and the status says otherwise: ' + st);
    assert(document.getElementById('promptStatus').className.indexOf('err') >= 0,
      'a prompt that will come back as a refusal is reported as fine');
  });
};
