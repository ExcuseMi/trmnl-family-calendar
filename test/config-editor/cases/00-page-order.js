'use strict';

// The order of the page is part of what it teaches. "Let an AI do it" used to sit after
// Preview, near the bottom: you filled in every track, calendar and rule by hand and were
// then offered a machine that would have written them for you. It now sits directly after
// Start, which is the only place it is any use.

module.exports = function (test, h) {
  const { loadEditor, assert, assertEqual } = h;

  test('the AI section comes straight after Start, before anything to fill in by hand', () => {
    const { document } = loadEditor();
    const ids = [...document.querySelectorAll('main.line > section')].map((s) => s.id);
    assertEqual(ids, [
      'station-start', 'station-agent', 'station-lines', 'station-calendars',
      'station-rules', 'station-preview', 'station-output',
    ]);
  });

  test('the page nav follows the page, and every section id is still reachable', () => {
    const { document } = loadEditor();
    const hrefs = [...document.querySelectorAll('.mc-top nav a')]
      .map((a) => a.getAttribute('href')).filter((hr) => hr.charAt(0) === '#');
    assertEqual(hrefs, ['#station-agent', '#station-lines', '#station-calendars', '#station-preview', '#station-output']);
    // ids are load-bearing: they are what the nav, the docs and every deep link point at
    hrefs.forEach((hr) => assert(document.querySelector(hr), 'nav points at a section that is not there: ' + hr));
  });
};
