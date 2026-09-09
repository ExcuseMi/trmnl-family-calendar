// The demo is driven by DEMO_CONFIG in transform.js against the ICS files in
// this repo's demo/ folder. Those two have to stay in step: a renamed track,
// a changed class code or a moved file breaks the demo for every device that
// hasn't been configured yet, and nothing else would notice.
//
// Fetches are served from demo/*.ics on disk, so this tests the real config
// against the real calendars without touching the network.

const fs = require('fs');
const path = require('path');

const DEMO_DIR = path.join(__dirname, '../../../demo');

module.exports = function (test, h) {
  const { runTransform, okText, fail, baseInput, eventItems, assert } = h;

  // a Wednesday, so the weekday-limited entries (L6 Field Trip) are on
  const NOW = Date.parse('2026-09-09T09:00:00Z');

  function serveDemoFiles(missing) {
    return async (url) => {
      const file = String(url).split('/').pop();
      const full = path.join(DEMO_DIR, file);
      if ((missing || []).indexOf(file) >= 0 || !fs.existsSync(full)) return fail(404);
      return okText(fs.readFileSync(full, 'utf-8'));
    };
  }

  function demoInput(nowMs) {
    return baseInput(nowMs, { use_demo_data: 'true' });
  }

  test('the demo config resolves against the repo ICS files, with a line per family member', async () => {
    const { run } = runTransform(serveDemoFiles(), NOW);
    const r = await run(demoInput(NOW));
    const names = r.metro.legend.map((t) => t.name).sort();
    assert(names.length > 0, 'demo produced no tracks at all');
    for (const who of ['Bart', 'Homer', 'Lisa', 'Maggie', 'Marge']) {
      assert(names.indexOf(who) >= 0, 'no line for ' + who + ' (got ' + names.join(', ') + ')');
    }
  });

  test('every demo calendar the config names actually exists in demo/', async () => {
    const seen = [];
    const { run } = runTransform(async (url) => {
      const file = String(url).split('/').pop();
      seen.push(file);
      const full = path.join(DEMO_DIR, file);
      assert(fs.existsSync(full), 'config points at demo/' + file + ', which is not in the repo');
      return okText(fs.readFileSync(full, 'utf-8'));
    }, NOW);
    await run(demoInput(NOW));
    assert(seen.length >= 5, 'expected the demo to fetch a calendar per member, saw ' + seen.length);
  });

  test('school entries land on the right child by class code', async () => {
    const { run } = runTransform(serveDemoFiles(), NOW);
    const r = await run(demoInput(NOW));
    const owners = {};
    eventItems(r.metro).forEach((e) => { owners[e.title] = e.owner; });
    const bartKey = r.metro.legend.filter((t) => t.name === 'Bart').map((t) => t.key)[0];
    const lisaKey = r.metro.legend.filter((t) => t.name === 'Lisa').map((t) => t.key)[0];
    // the class code routes the entry and is then stripped from the title —
    // "L6 School Day" belongs to Bart and reads as "School Day"
    const schoolDays = (r.metro.stations || []).filter((s) => s.title === 'School Day').map((s) => s.owner).sort();
    assert(schoolDays.length === 2, 'expected a School Day station for each child, got ' + schoolDays.length);
    assert(schoolDays.indexOf(bartKey) >= 0, 'no School Day on Bart');
    assert(schoolDays.indexOf(lisaKey) >= 0, 'no School Day on Lisa');
    assert(owners['Field Trip'] === bartKey, 'the L6 field trip should sit on Bart, got ' + owners['Field Trip']);
  });

  test('the family calendar produces an interchange across everyone', async () => {
    const { run } = runTransform(serveDemoFiles(), NOW);
    const r = await run(demoInput(NOW));
    const dinner = eventItems(r.metro).filter((e) => /Family Dinner/.test(e.title))[0];
    assert(dinner, 'no Family Dinner in the demo');
    assert(dinner.co_owners.length >= 3,
      'Family Dinner should join the whole family, got ' + (dinner.co_owners.length + 1) + ' track(s)');
  });

  test('an unreachable GitHub falls back to the built-in day rather than an empty board', async () => {
    const { run } = runTransform(async () => fail(500), NOW);
    const r = await run(demoInput(NOW));
    assert(r.metro.legend.length > 0, 'offline demo produced no tracks');
    assert(eventItems(r.metro).length > 0, 'offline demo produced no events');
  });
};
