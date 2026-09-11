'use strict';

// WHAT THE PROMPT SAYS ABOUT ITSELF HAS TO BE TRUE OF THE PROMPT.
//
// The status line under Generate is the tool's own verdict on the round trip
// about to be spent: how many calendars are in the prompt and how many of
// them carry events. It is read instead of the prompt, so when it counts
// something else the reader is told a wasted copy is a good one.

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, assert } = h;

  const ICS = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:1@x', 'SUMMARY:Choir practice',
    'DTSTART:20260101T190000', 'DTEND:20260101T200000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO', 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n');

  function withOneCalendar() {
    const { document } = loadEditor();
    // jsdom has no clipboard and no execCommand, so a copy would report that
    // it could not copy. The page's fallback is what is under test elsewhere;
    // here it just has to succeed.
    document.execCommand = () => true;
    document.getElementById('importIn').value = 'https://a.example/crew.ics';
    click(document.getElementById('loadImport'));
    return document;
  }
  function pasteFeed(document, text) {
    const ta = document.querySelector('#sources textarea');
    fireInput(ta, text);
    return ta;
  }

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

  // COPY COPIES WHAT IS TRUE NOW, NOT WHAT WAS TRUE AT GENERATE.
  //
  // Generate is pressed first, reads "none of your feeds has been read", and
  // the whole point of the two ways out offered next to it -- paste the .ics
  // under the map, fetch it through the relay -- is that they happen AFTER
  // that press. Copy then took whatever text Generate had left in the box,
  // so the prompt handed to the assistant still said "NOT READ. The browser
  // could not fetch it" about a calendar whose events were sitting in the
  // page, and the assistant duly asked for a file the user had already
  // supplied.
  test('Copy prompt copies the prompt as it is now, not the one Generate left behind', () => {
    const document = withOneCalendar();
    click(document.getElementById('makePrompt'));
    assert(/NOT READ/.test(document.getElementById('promptOut').value),
      'sanity: with nothing read the prompt should say so');

    pasteFeed(document, ICS);
    click(document.getElementById('copyPrompt'));
    const p = document.getElementById('promptOut').value;
    assert(!/NOT READ/.test(p), 'the copied prompt still calls the pasted feed unread');
    assert(/Choir practice/.test(p), 'the events pasted in never reached the copied prompt');
  });
};
