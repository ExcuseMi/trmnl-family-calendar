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

  // Demo calendars live under demo/<show>/, so the path after the repo's
  // own base is what names the file — not the last segment, which would
  // resolve every show's homer.ics to the same place.
  const relOf = (url) => String(url).split('/main/demo/').pop();

  function serveDemoFiles(missing) {
    return async (url) => {
      const rel = relOf(url);
      const full = path.join(DEMO_DIR, rel);
      if ((missing || []).indexOf(rel) >= 0 || !fs.existsSync(full)) return fail(404);
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
    // exactly these five: every school and family entry has to be routed to
    // a person by a rule, so a stray line means a rule stopped matching and
    // the calendar's own name leaked in as a track
    assert(names.join(',') === 'Bart,Homer,Lisa,Maggie,Marge',
      'expected exactly the five family lines, got: ' + names.join(', '));
  });

  test('a stale copy of one calendar falls back rather than mixing someone else in', async () => {
    // raw.githubusercontent serves a changed file from cache for a few
    // minutes, so right after a push some calendars are current and one is
    // not. That renders a board that is nobody's day, and it must not ship.
    const stale = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Demo - School\r\n'
      + 'BEGIN:VEVENT\r\nUID:stale@x\r\nDTSTAMP:20240101T000000Z\r\nSUMMARY:Zwemles L2\r\n'
      + 'DTSTART:20240101T100000\r\nDTEND:20240101T110000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU\r\n'
      + 'END:VEVENT\r\nEND:VCALENDAR\r\n';
    const { run } = runTransform(async (url) => {
      const rel = relOf(url);
      if (rel === 'simpsons/school.ics') return okText(stale);
      const full = path.join(DEMO_DIR, rel);
      return fs.existsSync(full) ? okText(fs.readFileSync(full, 'utf-8')) : fail(404);
    }, NOW);
    const r = await run(demoInput(NOW));
    const titles = eventItems(r.metro).map((e) => e.title).join(' ');
    assert(!/Zwemles/.test(titles), 'a stale calendar leaked into the demo: ' + titles);
  });

  test('every demo calendar the config names actually exists in demo/', async () => {
    const seen = [];
    const { run } = runTransform(async (url) => {
      const rel = relOf(url);
      seen.push(rel);
      const full = path.join(DEMO_DIR, rel);
      assert(fs.existsSync(full), 'config points at demo/' + rel + ', which is not in the repo');
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
    const schoolDays = (r.metro.sidings || []).filter((s) => s.title === 'School Day').map((s) => s.owner).sort();
    assert(schoolDays.length === 2, 'expected a School Day siding for each child, got ' + schoolDays.length);
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

  test('a partly-resolved demo falls back rather than showing half a family', async () => {
    // the failure that actually happens: new files not yet on the CDN while
    // an older one still answers, so some calendars resolve and others 404
    const { run } = runTransform(serveDemoFiles(['simpsons/homer.ics', 'simpsons/marge.ics', 'simpsons/maggie.ics']), NOW);
    const r = await run(demoInput(NOW));
    const names = r.metro.legend.map((t) => t.name).sort();
    for (const who of ['Bart', 'Homer', 'Lisa', 'Maggie', 'Marge']) {
      assert(names.indexOf(who) >= 0,
        'expected the offline fallback (a whole family), got only ' + names.join(', '));
    }
  });

  test('an unreachable GitHub falls back to the built-in day rather than an empty board', async () => {
    const { run } = runTransform(async () => fail(500), NOW);
    const r = await run(demoInput(NOW));
    assert(r.metro.legend.length > 0, 'offline demo produced no tracks');
    assert(eventItems(r.metro).length > 0, 'offline demo produced no events');
  });

  // ------------------------------------------------------------ the other boards

  // Each demo set is a real config against real ICS files in this repo, so
  // a renamed track, a changed rule or a moved file breaks that board for
  // everyone who picks it and nothing else would notice.
  const SETS = {
    simpsons: { tracks: ['Bart', 'Homer', 'Lisa', 'Maggie', 'Marge'], dir: 'simpsons' },
    futurama: { tracks: ['Amy', 'Bender', 'Fry', 'Leela', 'Professor'], dir: 'futurama' },
    friends: { tracks: ['Monica', 'Rachel'], dir: 'friends' },
  };

  for (const set of Object.keys(SETS)) {
    test('the "' + set + '" demo resolves against the repo ICS files', async () => {
      const { run } = runTransform(serveDemoFiles(), NOW);
      const r = await run(baseInput(NOW, { use_demo_data: 'true', demo_set: set }));
      const names = r.metro.legend.map((t) => t.name).sort();
      assert(names.join(',') === SETS[set].tracks.join(','),
        set + ': expected ' + SETS[set].tracks.join(', ') + ', got ' + names.join(', '));
      // and it fetched only its own show's files
      assert(eventItems(r.metro).length > 0, set + ': resolved no events');
    });
  }

  test('an unknown demo board falls back to Springfield rather than an empty one', async () => {
    const { run } = runTransform(serveDemoFiles(), NOW);
    const r = await run(baseInput(NOW, { use_demo_data: 'true', demo_set: 'the-wire' }));
    const names = r.metro.legend.map((t) => t.name).sort();
    assert(names.join(',') === SETS.simpsons.tracks.join(','), 'got ' + names.join(', '));
  });

  test('the Planet Express delivery is one siding on three lines', async () => {
    // the shape two children at one school get, with a third line in the
    // corridor: one caption, three kinks, and the three of them adjacent
    const { run } = runTransform(serveDemoFiles(), NOW);
    const r = await run(baseInput(NOW, { use_demo_data: 'true', demo_set: 'futurama' }));
    const run3 = (r.metro.sidings || []).filter((s) => s.title === 'Delivery Run');
    assert(run3.length === 3, 'expected the delivery on three lines, got ' + run3.length);
    const groups = [...new Set(run3.map((s) => s.group))];
    assert(groups.length === 1 && groups[0], 'the three kinks should share one group id, got ' + JSON.stringify(groups));
    const key = {};
    r.metro.legend.forEach((t, i) => { key[t.key] = i; });
    const at = run3.map((s) => key[s.owner]).sort((a, b) => a - b);
    assert(at[2] - at[0] === 2, 'the three lines on one siding should end up adjacent, got positions ' + at.join(','));
  });

  test('every demo board names files that exist, and only its own', async () => {
    for (const set of Object.keys(SETS)) {
      const seen = [];
      const { run } = runTransform(async (url) => {
        const rel = relOf(url);
        seen.push(rel);
        const full = path.join(DEMO_DIR, rel);
        assert(fs.existsSync(full), set + ' points at demo/' + rel + ', which is not in the repo');
        return okText(fs.readFileSync(full, 'utf-8'));
      }, NOW);
      await run(baseInput(NOW, { use_demo_data: 'true', demo_set: set }));
      assert(seen.length > 0, set + ' fetched nothing');
      for (const rel of seen) {
        assert(rel.indexOf(SETS[set].dir + '/') === 0, set + ' reached for ' + rel);
      }
    }
  });

  test('demo/<show>/config.json matches the board the plugin actually runs', () => {
    // Those files are what the settings page tells people to copy. A board
    // changed in transform.js and not written back out is a worked example
    // that no longer works. Regenerate with: node tools/dump-demo-configs.js
    const SETS_LIVE = require(path.join(__dirname, '../../../plugin/src/transform.js')).DEMO_SETS;
    assert(SETS_LIVE, 'transform.js no longer exports its demo boards');
    for (const name of Object.keys(SETS_LIVE)) {
      const file = path.join(DEMO_DIR, name, 'config.json');
      assert(fs.existsSync(file), 'no demo/' + name + '/config.json — run node tools/dump-demo-configs.js');
      const onDisk = JSON.parse(fs.readFileSync(file, 'utf-8'));
      assert(JSON.stringify(onDisk) === JSON.stringify(SETS_LIVE[name]),
        'demo/' + name + '/config.json has drifted from transform.js — run node tools/dump-demo-configs.js');
    }
  });

  // ------------------------------------------------------------ the simple setup

  test('a plain list of ICS links needs no JSON and no editor', async () => {
    const { run } = runTransform(serveDemoFiles(), NOW);
    const r = await run(baseInput(NOW, {
      use_demo_data: 'false',
      calendar_urls: [
        'https://raw.githubusercontent.com/x/y/main/demo/friends/monica.ics',
        'https://raw.githubusercontent.com/x/y/main/demo/friends/rachel.ics',
      ].join('\n'),
    }));
    const names = r.metro.legend.map((t) => t.name).sort();
    // each calendar becomes its own line, named by the feed's own
    // X-WR-CALNAME (and, for a feed that carries none, by its URL)
    assert(names.join(',') === 'Demo - Monica,Demo - Rachel', 'got [' + names.join(', ') + ']');
    assert(eventItems(r.metro).length > 0, 'a bare URL list produced no events');
  });

  test('a link to a feed with no name of its own is named from the link', async () => {
    const nameless = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'
      + 'BEGIN:VEVENT\r\nUID:n@x\r\nDTSTAMP:20240101T000000Z\r\nSUMMARY:Standup\r\n'
      + 'DTSTART:20240101T090000\r\nDTEND:20240101T091500\r\n'
      + 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const { run } = runTransform(async () => okText(nameless), NOW);
    const r = await run(baseInput(NOW, {
      use_demo_data: 'false',
      calendar_urls: 'https://cloud.example.com/alex-work.ics',
    }));
    assert(r.metro.legend.map((t) => t.name).join(',') === 'Alex Work',
      'got ' + r.metro.legend.map((t) => t.name).join(', '));
  });

  test('the JSON config wins over the plain list when both are filled', async () => {
    const { run } = runTransform(serveDemoFiles(), NOW);
    const cfg = JSON.stringify({
      tracks: [{ name: 'Just Me' }],
      calendars: [{ name: 'Mine', url: 'https://raw.githubusercontent.com/x/y/main/demo/friends/monica.ics',
        rules: [{ match: { type: 'any' }, track: 'Just Me' }] }],
    });
    const r = await run(baseInput(NOW, {
      use_demo_data: 'false',
      calendar_urls: 'https://raw.githubusercontent.com/x/y/main/demo/friends/rachel.ics',
      config_json: cfg,
    }));
    const names = r.metro.legend.map((t) => t.name);
    assert(names.join(',') === 'Just Me', 'the JSON config should win, got ' + names.join(', '));
  });
};
