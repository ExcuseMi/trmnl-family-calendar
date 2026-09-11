'use strict';

// The preview's header against the template's header.
//
// tools/config-editor.html previews a board by running the real
// transform.js and the real layout script out of shared.liquid, but the
// HEADER is hand-built markup: the template's is Liquid, and the editor
// cannot run Liquid. So there are two headers, and they drift.
//
// It matters more than it looks. The header is not decoration, it is depth
// the map does not get: whatever it costs in height comes off the canvas
// the layout engine is then handed. A preview with a header of a different
// height is previewing a different board, which is the one thing this tool
// exists not to do.
//
// They had drifted four ways at once: the editor drew a window pill the
// template had dropped, a swatch legend the board has never had, laid the
// header out as one flat row where the template stacks a top row over its
// alert lines, and used its own grey classes instead of the template's.
//
// Comparing CLASS NAMES rather than markup is deliberate. It is what
// decides both layout and styling here (the framework's classes plus the
// template's own metro-* ones), it survives rewording and reordering, and
// it fails the moment either side gains or loses an element.

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../../..');
const LIQUID = fs.readFileSync(path.join(REPO, 'plugin/src/shared.liquid'), 'utf-8');
const EDITOR = fs.readFileSync(path.join(REPO, 'tools/config-editor.html'), 'utf-8');

// The template's header: the .metro-header block, down to the all-day row
// (which is not a header thing and is empty in every payload now).
function templateHeader() {
  const a = LIQUID.indexOf('class="metro-header');
  const b = LIQUID.indexOf('{% if data.all_day');
  if (a < 0 || b < 0 || b < a) throw new Error('cannot find the template header');
  return LIQUID.slice(a, b);
}

function editorHeader() {
  const a = EDITOR.indexOf('function renderHeader(');
  if (a < 0) throw new Error('the editor has no renderHeader');
  const b = EDITOR.indexOf('\n  }', a);
  return EDITOR.slice(a, b);
}

// The same slice the editor does at run time, so this asserts the real
// extraction rather than a description of it.
function markFromTemplate() {
  const mk = LIQUID.indexOf('<svg class="metro-mark');
  return mk < 0 ? '' : LIQUID.slice(mk, LIQUID.indexOf('</svg>', mk) + 6);
}

function metroClasses(s) {
  return [...new Set(s.match(/metro-[a-z0-9-]+/g) || [])].sort();
}

module.exports = function (test, h) {
  const { assert, assertEqual } = h;

  test('the preview header draws the same elements as the template header', () => {
    const tpl = metroClasses(templateHeader());
    // The mark is pulled out of the template at run time, so its classes
    // reach the preview without ever being written down in the editor.
    const ed = metroClasses(editorHeader() + markFromTemplate());
    assert(tpl.length > 6, 'the template header barely parsed: ' + tpl.join(' '));
    assertEqual(ed.filter((c) => tpl.indexOf(c) < 0), []); // in the preview, not on the board
    assertEqual(tpl.filter((c) => ed.indexOf(c) < 0), []); // on the board, missing from the preview
  });

  test('the preview lifts the mark out of the template instead of copying it', () => {
    const mark = markFromTemplate();
    assert(mark.indexOf('metro-mark-cut') > 0, 'the template mark did not slice cleanly: ' + mark.slice(0, 80));
    assert(EDITOR.indexOf('<svg class="metro-mark') < 0,
      'the editor has its own copy of the mark, which is a second thing to keep in step');
    assert(/indexOf\("<svg class=\\?"metro-mark/.test(EDITOR),
      'the editor does not pull the mark out of the template');
  });

  test('the preview does not print what the payload no longer shows', () => {
    // window_label still travels in the payload for the small views, and
    // the header stopped stating it. The preview kept the pill for months.
    // Read the MARKUP, not the file: the template explains the removal in a
    // Liquid comment, which names the field it no longer prints.
    const markup = templateHeader().replace(/\{%-?\s*comment[\s\S]*?endcomment\s*-?%\}/g, '');
    assert(markup.indexOf('metro-window') < 0, 'the template header states the window again');
    assert(editorHeader().indexOf('window_label') < 0, 'the preview header still prints the window pill');
  });

  test('the preview names the day the board names', () => {
    // A board set to tomorrow says "Friday", not "Today". Both sides read
    // title_word first and fall back to the translated "Today".
    assert(/title_word/.test(templateHeader()), 'the template stopped reading title_word');
    assert(/title_word/.test(editorHeader()), 'the preview would say "Today" on a board showing tomorrow');
  });

  test('the preview shows the two things the board cannot say for itself', () => {
    // A feed that has been down for hours and a forecast replayed from
    // saved state. The first one is the reason a config author is in this
    // tool at all: a URL that 404s has to look like a URL that 404s.
    const ed = editorHeader();
    assert(/calendars_down/.test(ed), 'the preview hides a calendar that is down');
    assert(/weather_stale/.test(ed), 'the preview hides a stale forecast');
  });
};
