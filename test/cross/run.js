'use strict';

// Regression tests for the CROSS-AXIS SOLVER: where every line sits across
// the board and which rungs each of them gets to hang labels on.
//
// The solver is a pure function in plugin/src/shared.liquid, between the
// CROSS_SOLVER_BEGIN/END markers. It touches no DOM and reads no closure,
// so this suite extracts that block, evaluates it, and runs it directly.
// No browser, no build, no fixtures: a full run is milliseconds, which is
// what makes it worth asking the solver about thousands of boards instead
// of the ten the layout suite can afford to render.
//
// The split it tests is "what can be decided from sizes" against "what has
// to be tried". How many lanes a track WANTS comes from actually placing
// its labels and arrives here as `demand`; everything downstream of that
// number is arithmetic, and arithmetic is what this file is for.
//
// Run with: node run.js  (from this directory), or ../../test.sh.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../plugin/src/shared.liquid');

function loadSolver() {
  const src = fs.readFileSync(SRC, 'utf-8');
  const a = src.indexOf('// ==== CROSS_SOLVER_BEGIN ====');
  const b = src.indexOf('// ==== CROSS_SOLVER_END ====');
  if (a < 0 || b < 0) {
    throw new Error('could not find the CROSS_SOLVER markers in shared.liquid. '
      + 'They are what makes the solver testable without a browser: if the block '
      + 'moved, move the markers with it rather than deleting them.');
  }
  const block = src.slice(a, b);
  // eslint-disable-next-line no-new-func
  return new Function(block + '\nreturn CrossSolver;')();
}

const CrossSolver = loadSolver();

// ---------------------------------------------------------------- inputs

// The real constants, at a device scale. S=1 is an 800x480 OG panel, S=2 a
// TRMNL X. Taken from shared.liquid rather than invented, so a board built
// here is a board the plugin could actually be asked to draw.
function consts(over) {
  const S = (over && over.S) || 1;
  const depth = (over && over.depth) || 401;
  const maxLabelThick = (over && over.maxLabelThick) || 37 * S;
  const k = {
    lineStep: 20 * S, lineGap: 6 * S, laneGap: 12 * S,
    minDiag: Math.max(10 * S, 6 * 2.4 * S + 2 * S),
    nodeR: 6 * S,
    maxLabelThick: maxLabelThick,
    laneStep: maxLabelThick + 6 * S + 12 * S,
    laneBasePacked: 14 * S + Math.min(24 * S, depth * 0.025),
    nameH: 22 * S, edge: 8 * S, alertBand: 0, capClear: 12 * S,
    depth: depth, bandLo: 30 * S,
  };
  if (over) for (const key of Object.keys(over)) if (key in k) k[key] = over[key];
  return k;
}

// A board: `spec` is a list like ['a:2', 'b:1|mark'] per side. The flag says
// what the track carries beyond a count of lanes: `mark` is a track carrying
// events drawn ON the line as a dot and a tick, of any length, whose names
// are set against the line by the caption pass rather than hung off a rung.
// Those need a name's thickness of clear board beside the line and nothing
// else, which is about a third of what a rung costs, and getting it wrong in
// either direction is what these cases are about.
// `needin` is a track the DRAWING found to have somebody else's trunk
// through its labels with no rung outward that escapes (shared.liquid's
// settleSides measures that and feeds it back in). Both ask the solver for a
// rung on the inward side; neither is free, and which of them a board can
// afford is what these cases are about.
function board(aSpec, bSpec, over) {
  const sides = { A: [], B: [] };
  const demand = {};
  for (const [side, spec] of [['A', aSpec || []], ['B', bSpec || []]]) {
    for (const s of spec) {
      const [key, rest] = s.split(':');
      const [lanes, flag] = (rest || '1').split('|');
      sides[side].push({ key: key,
                         marks: (flag === 'mark' || flag === 'long') ? 1 : 0,
                         needIn: flag === 'needin' ? 1 : 0 });
      demand[key] = Number(lanes);
    }
  }
  return { k: consts(over), sides: sides, demand: demand };
}

function solve(input) { return CrossSolver.solve(input); }
// The side builder on its own, for the claims that only mean anything at a
// fixed pitch (see 05-both-sides.js).
function buildSide(k, tracks, lanesFor, stepPx, sepPx, opts) {
  return CrossSolver.buildSide(k, tracks, lanesFor, stepPx, sepPx, opts);
}

// ---------------------------------------------------------------- helpers

function allTracks(input) { return input.sides.A.concat(input.sides.B); }
function lanesOwnedBy(out, key) {
  return out.lanes.A.concat(out.lanes.B).filter((l) => l.owner === key);
}
function laneCount(out) { return out.lanes.A.length + out.lanes.B.length; }

// ---------------------------------------------------------------- runner

const tests = [];
function test(name, fn, opts) { tests.push({ name, fn, known: opts && opts.known }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg ? msg + ': ' : '') + 'expected ' + e + ', got ' + a);
}
function close(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error((msg ? msg + ': ' : '') + a + ' is not within ' + tol + ' of ' + b);
}

const helpers = { buildSide, CrossSolver, solve, board, consts, allTracks, lanesOwnedBy, laneCount,
  assert, assertEqual, close };

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
