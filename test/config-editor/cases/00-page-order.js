'use strict';

const fs = require('fs');
const path = require('path');

// THE PAGE OPENS ON WHAT IT DRAWS, NOT ON WHAT YOU HAVE TO FILL IN.
//
// It used to open as the whole form at once: paste box, AI, lines, calendars,
// rules, preview, JSON, with the three examples a small row inside the first
// of them. Somebody arriving has not decided to configure anything yet, they
// are deciding whether this is worth configuring, and a board they have
// watched draw answers that better than seven sections they have not filled
// in. So the examples come first and everything else is gated behind a choice
// of how to do it for real.
//
// The gate is CSS on a data attribute, never a section taken out of the page:
// a section that is not in the DOM cannot be linked to, cannot be read by a
// screen reader walking the document, and loses whatever was typed in it.

module.exports = function (test, h) {
  const { loadEditor, click, assert, assertEqual } = h;

  test('the page opens on the examples, with nothing to fill in yet', () => {
    const { document } = loadEditor();
    assertEqual(document.getElementById('page').getAttribute('data-stage'), 'demo');
    // still all there, just not shown
    ['station-agent', 'station-start', 'station-lines', 'station-calendars',
      'station-rules', 'station-output'].forEach((id) => {
      assert(document.getElementById(id), id + ' was taken out of the page rather than hidden');
    });
  });

  test('the steps run in the order somebody does them, with the preview beside them', () => {
    const { document } = loadEditor();
    const ids = [...document.querySelectorAll('.col-steps > section')].map((s) => s.id);
    assertEqual(ids, [
      'station-demo', 'station-agent', 'station-start', 'station-lines',
      'station-calendars', 'station-rules', 'station-output',
    ]);
    // The preview is not a step: it is the panel the steps draw into, and it
    // sits in its own column so it stays in view.
    const panel = document.querySelector('.col-preview #station-preview');
    assert(panel, 'the preview is not in the preview column');
    assert(document.getElementById('runPreview'), 'the draw button went missing in the move');
  });

  test('"I am ready to do this for real" offers the two ways, and either one clears the example', () => {
    const { document } = loadEditor();
    assert(document.getElementById('realChoice').hidden, 'the choice is showing before it is asked for');
    click(document.getElementById('goReal'));
    assert(!document.getElementById('realChoice').hidden, 'the choice did not open');

    click(document.getElementById('chooseManual'));
    assertEqual(document.getElementById('page').getAttribute('data-stage'), 'build');
    assertEqual(document.getElementById('importIn').value, '', 'the example was left in the paste box');
    const out = JSON.parse(document.getElementById('jsonOut').value || '{}');
    assertEqual(out.calendars || [], [], 'the example config survived into the real one');
    assertEqual(out.lines || [], [], 'the example lines survived into the real one');
  });

  test('the AI choice lands on the prompt, not on the form', () => {
    const { document } = loadEditor();
    click(document.getElementById('goReal'));
    click(document.getElementById('chooseAi'));
    assertEqual(document.getElementById('page').getAttribute('data-stage'), 'ai');
  });

  test('pasting a configuration goes straight to the form, whatever stage it was in', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      lines: [{ name: 'Sam' }], calendars: [{ url: 'https://a.example/s.ics', name: 'Sam' }],
    });
    click(document.getElementById('loadImport'));
    assertEqual(document.getElementById('page').getAttribute('data-stage'), 'build');
  });

  // A LINE CARD ALSO CARRIES THE CLASS "line".
  //
  // So the two-column page grid, written as a bare `.line`, landed on every
  // line card as well: each card became a two-column grid, with the swatch,
  // the name, the arrows and Remove stacked one per row and the hint beside
  // them in the second column. The page rule has to name the element.
  test('the page grid is scoped to the page, not to anything called a line', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../tools/config-editor.html'), 'utf-8');
    const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
    css.split('\n').forEach((line) => {
      const sel = line.split('{')[0];
      if (!/display:\s*grid/.test(line)) return;
      assert(!/(^|[\s,])\.line\b/.test(sel),
        'a bare ".line" rule sets display:grid, which also hits every line card: ' + sel.trim());
    });
  });

  test('the page nav follows the page, and every section id is still reachable', () => {
    const { document } = loadEditor();
    const hrefs = [...document.querySelectorAll('.mc-top nav a')]
      .map((a) => a.getAttribute('href')).filter((hr) => hr.charAt(0) === '#');
    assertEqual(hrefs, ['#station-demo', '#station-agent', '#station-start', '#station-lines',
      '#station-calendars', '#station-output']);
    // ids are load-bearing: they are what the nav, the docs and every deep link point at
    hrefs.forEach((hr) => assert(document.querySelector(hr), 'nav points at a section that is not there: ' + hr));
  });
};
