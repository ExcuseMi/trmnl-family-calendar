'use strict';

// The prompt the tool hands to an AI assistant. It has to carry everything
// the assistant cannot see for itself: what this plugin draws, the shape of
// a configuration, what makes a board read well, and above all what is
// actually in the calendars, since fetching an ICS is the one part most
// assistants cannot do.

module.exports = function (test, h) {
  const { loadEditor, click, assert, jsonOut } = h;

  const ICS = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Planet Express',
    'BEGIN:VEVENT', 'UID:1@x', 'SUMMARY:Fry: Coffee (100 cups)',
    'DTSTART:20240101T073000', 'DTEND:20240101T080000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'LOCATION:Kitchen', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:2@x', 'SUMMARY:Leela: Pre-flight Check',
    'DTSTART:20240101T080000', 'DTEND:20240101T083000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TU', 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n');

  function withOneCalendar() {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      calendars: [{ url: 'https://a.example/crew.ics' }],
    });
    click(document.getElementById('loadImport'));
    return document;
  }

  test('the prompt states the task, the format and the design rules', () => {
    const document = withOneCalendar();
    click(document.getElementById('makePrompt'));
    const p = document.getElementById('promptOut').value;
    assert(p.length > 800, 'the prompt is only ' + p.length + ' characters');
    for (const must of ['Metro Calendar', '## What to do', '## Format', '## Calendars',
      '"station": true', 'hideIfEmpty', 'ONE JSON object']) {
      assert(p.indexOf(must) >= 0, 'the prompt never mentions ' + JSON.stringify(must));
    }
    // the schema is quoted from the page's own reference, not a second copy
    const ref = document.getElementById('schemaRef').textContent.trim().split('\n')[1];
    assert(p.indexOf(ref) >= 0, 'the prompt does not carry the page\'s own schema');
  });

  test('the prompt lists the calendars, and says so when it has not read one', () => {
    const document = withOneCalendar();
    click(document.getElementById('makePrompt'));
    const p = document.getElementById('promptOut').value;
    assert(p.indexOf('https://a.example/crew.ics') >= 0, 'the URL is missing');
    assert(/Fetch this URL yourself/.test(p), 'an unread feed should tell the assistant to fetch it');
  });

  test('a feed the tool has read is digested into the prompt', () => {
    // this is the part that makes the answer good: the titles, when they
    // run and on which days are what a pattern looks like
    const document = withOneCalendar();
    const ta = document.querySelector('#sources textarea');
    ta.value = ICS;
    ta.dispatchEvent(new document.defaultView.Event('input'));
    click(document.getElementById('makePrompt'));
    const p = document.getElementById('promptOut').value;
    assert(p.indexOf('Fry: Coffee (100 cups)') >= 0, 'the event titles are missing');
    assert(p.indexOf('07:30-08:00') >= 0, 'the times are missing');
    assert(p.indexOf('MO,TU,WE,TH,FR') >= 0, 'the days are missing');
    assert(p.indexOf('@ Kitchen') >= 0, 'the location is missing');
    assert(p.indexOf('Feed name: Planet Express') >= 0, "the feed's own name is missing");
    assert(!/Fetch this URL yourself/.test(p), 'it should not ask for a feed it already has');
  });

  test('an existing configuration is handed over to improve on', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      tracks: [{ name: 'Fry' }],
      calendars: [{ url: 'https://a.example/crew.ics',
        rules: [{ match: { type: 'regex', value: '^Fry:' }, track: 'Fry', rename: false }] }],
    });
    click(document.getElementById('loadImport'));
    click(document.getElementById('makePrompt'));
    const p = document.getElementById('promptOut').value;
    assert(p.indexOf('## The configuration so far') >= 0, 'the existing config is not offered');
    assert(p.indexOf('"^Fry:"') >= 0, 'the existing rules are not in it');
    // and it is the same JSON the tool would hand to TRMNL
    assert(p.indexOf(JSON.stringify(jsonOut(document), null, 2)) >= 0,
      'the config in the prompt is not the one the tool produces');
  });

  test('with nothing configured the prompt still generates', () => {
    const { document } = loadEditor();
    click(document.getElementById('makePrompt'));
    const p = document.getElementById('promptOut').value;
    assert(p.indexOf('(none added yet)') >= 0, 'an empty tool should say it has no calendars');
    assert(p.indexOf('## The configuration so far') < 0, 'there is no configuration to offer yet');
  });
};
