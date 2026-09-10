'use strict';

// Regression tests for the TIME AXIS: how many days the board draws, and
// how much of its length each minute is worth.
//
// The model is a pure function in plugin/src/shared.liquid between the
// TIME_AXIS markers. It touches no DOM and reads no closure, so this suite
// extracts that block and calls it: no browser, no build, a full run in
// milliseconds. Same arrangement as test/cross, and for the same reason.
//
// Everything is in ABSOLUTE minutes across the run of days transform sent:
// day n is [n*1440, (n+1)*1440). Positions come back in UNITS, where one
// unit is a minute of the busy part of a day.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../plugin/src/shared.liquid');

function loadAxis() {
  const src = fs.readFileSync(SRC, 'utf-8');
  const a = src.indexOf('// ==== TIME_AXIS_BEGIN ====');
  const b = src.indexOf('// ==== TIME_AXIS_END ====');
  if (a < 0 || b < 0) {
    throw new Error('could not find the TIME_AXIS markers in shared.liquid. They are what '
      + 'makes the axis testable without a browser: if the block moved, move the markers with it.');
  }
  // eslint-disable-next-line no-new-func
  return new Function(src.slice(a, b) + '\nreturn TimeAxis;')();
}

const TimeAxis = loadAxis();
const DAY = 1440;

// The real constants, from shared.liquid.
function consts(over) {
  return Object.assign({
    contentPad: 75,       // minutes of air kept around what is on a day
    minDaySpan: 6 * 60,   // a day with one meeting on it is still a day
    minExpress: 45,       // shorter than this is not worth compressing
    expressRate: 0.22,    // what a quiet minute is worth against a busy one
    minPxPerHour: 46,     // below this an hour cannot be read on a single-day board
    minPxPerHourRun: 26,  // a run is allowed tighter: the lane carries the label, not the hour
  }, over || {});
}

// events written as [day, "HH:MM", "HH:MM"]
function ev(day, from, to) {
  const m = (t) => Number(t.split(':')[0]) * 60 + Number(t.split(':')[1]);
  return { start_min: day * DAY + m(from), end_min: day * DAY + m(to) };
}

function fit(over) {
  return TimeAxis.fit(Object.assign({ days: 3, content: [], axisPx: 1000, k: consts() }, over || {}));
}

const tests = [];
function test(name, fn, opts) { tests.push({ name, fn, known: opts && opts.known }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg ? msg + ': ' : '') + 'expected ' + e + ', got ' + a);
}

const helpers = { TimeAxis, fit, consts, ev, DAY, assert, assertEqual };
for (const file of fs.readdirSync(path.join(__dirname, 'cases')).sort()) {
  if (!file.endsWith('.js')) continue;
  require(path.join(__dirname, 'cases', file))(test, helpers);
}

let pass = 0, fail = 0, known = 0;
const only = process.argv[2];
for (const t of tests) {
  if (only && t.name.indexOf(only) < 0) continue;
  let err = null;
  try { t.fn(); } catch (e) { err = e; }
  if (t.known && err) { console.log('≈ ' + t.name + '\n    known: ' + t.known + '\n    ' + (err.message || err)); known++; }
  else if (t.known && !err) { console.log('✗ ' + t.name + '\n    marked known but now passes: remove the marker'); fail++; }
  else if (err) { console.log('✗ ' + t.name + '\n    ' + (err.message || err)); fail++; }
  else { console.log('✓ ' + t.name); pass++; }
}
console.log('\n' + pass + '/' + (pass + known + fail) + ' passed, ' + known + ' known issue(s), ' + fail + ' failure(s)');
process.exit(fail ? 1 : 0);
