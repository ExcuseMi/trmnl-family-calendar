'use strict';

// Regression tests for metro-plugin/src/transform.js's CONFIG HANDLING —
// parseConfig, the rule/matcher engine (compileMatcher/compileRule/
// applyCalendarRules), and the ICS parsing pieces that feed it (RRULE
// bounded-weekly matching, RECURRENCE-ID override dedup). This does NOT
// cover the metro-map layout/geometry itself (that's all client-side in
// shared.liquid, untestable here) or demo-data rendering.
//
// Adapted from ../../test/transform/run.js (the other plugin's own
// harness) — same vm-sandbox-per-test-file technique, same fake-Date
// approach for pinning "today" across a run() call, trimmed to what this
// plugin's simpler single-day `run(input) -> {metro}` shape needs (no
// days[], no trmnl_state, no multi-day windows).
//
// Run with: npm test  (from this directory) — no Docker needed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TRANSFORM_PATH = process.env.TRANSFORM_PATH
  || path.join(__dirname, '../../plugin/src/transform.js');

const TRANSFORM_SRC = fs.readFileSync(TRANSFORM_PATH, 'utf-8');

// A Date subclass fixed at `ms` for `new Date()` / `Date.now()` — lets a
// test pin "today" precisely (RRULE weekly-match, RECURRENCE-ID dedup are
// both date-sensitive) without waiting on the real clock.
function makeFakeDate(getNowMs) {
  const RealDate = Date;
  return class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(getNowMs());
      else super(...args);
    }
    static now() { return getNowMs(); }
  };
}

// Loads a fresh copy of transform.js into its own vm context (module-level
// caches like _safeZoneCache never leak between calls/tests), with
// `fetchImpl` standing in for the real network and, if `nowMs` is given,
// Date/Date.now() pinned for every call made against the returned `run`/
// `parseConfig`.
function runTransform(fetchImpl, nowMs) {
  const sandbox = {
    fetch: fetchImpl,
    console,
    Date: nowMs != null ? makeFakeDate(() => nowMs) : Date,
    Math, Array, Object, JSON, String, Number, Boolean, RegExp, Promise, Map, Set,
    AbortController, setTimeout, clearTimeout, URLSearchParams, Intl,
    module: { exports: {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(TRANSFORM_SRC + '\nmodule.exports = { run, parseConfig, applyCalendarRules, parseIcs, fromEpoch };', sandbox);
  return sandbox.module.exports;
}

function icsWithEvents(events) {
  let s = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n';
  for (const e of events) {
    s += 'BEGIN:VEVENT\r\nUID:' + (e.uid || Math.random()) + '\r\nDTSTAMP:20260101T000000Z\r\n';
    if (e.recurrenceId) s += 'RECURRENCE-ID:' + e.recurrenceId + '\r\n';
    s += 'DTSTART:' + e.start + '\r\nDTEND:' + e.end + '\r\n';
    if (e.rrule) s += 'RRULE:' + e.rrule + '\r\n';
    s += 'SUMMARY:' + e.summary + '\r\n';
    if (e.description) s += 'DESCRIPTION:' + e.description + '\r\n';
    if (e.status) s += 'STATUS:' + e.status + '\r\n';
    if (e.location) s += 'LOCATION:' + e.location + '\r\n';
    s += 'END:VEVENT\r\n';
  }
  s += 'END:VCALENDAR\r\n';
  return s;
}

function okText(text) { return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) }; }
function fail(status) { return { ok: false, status, text: async () => '', json: async () => ({}) }; }

// input.trmnl.system.timestamp_utc must be set explicitly to match the
// fake-Date `nowMs` passed to runTransform() — Date.now() out here (this
// file, not the vm sandbox) is the real wall clock, not the pinned one.
function baseInput(nowMs, customFields) {
  return {
    trmnl: {
      system: { timestamp_utc: Math.floor(nowMs / 1000) },
      user: { locale: 'en', time_zone_iana: 'UTC' },
      plugin_settings: { instance_name: 'Test', custom_fields_values: Object.assign({ use_demo_data: 'false' }, customFields) },
    },
  };
}

function eventItems(metro) { return metro.items.filter((i) => i.type === 'event'); }

// ---------------------------------------------------------------------------- tiny test runner

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg ? msg + ': ' : '') + 'expected ' + e + ', got ' + a);
}

const helpers = { runTransform, icsWithEvents, okText, fail, baseInput, eventItems, assert, assertEqual };

for (const file of fs.readdirSync(path.join(__dirname, 'cases')).sort()) {
  if (!file.endsWith('.js')) continue;
  require(path.join(__dirname, 'cases', file))(test, helpers);
}

async function main() {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log('✓ ' + t.name);
    } catch (e) {
      console.error('✗ ' + t.name + ': ' + e.message);
      failed++;
    }
  }
  console.log('\n' + (tests.length - failed) + '/' + tests.length + ' passed');
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal: ' + (err && err.stack || err));
  process.exit(1);
});
