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
  const { runTransform, okText, fail, baseInput, eventItems, assert, assertEqual } = h;

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
    const names = r.data.legend.map((t) => t.name).sort();
    // exactly these five: every school and family entry has to be routed to
    // a person by a rule, so a stray line means a rule stopped matching and
    // the calendar's own name leaked in as a track
    assert(names.join(',') === 'Bart,Homer,Lisa,Maggie,Marge',
      'expected exactly the five family lines, got: ' + names.join(', '));
  });

  test('a stale copy of one calendar shows through, because there is nothing to swap to', async () => {
    // raw.githubusercontent serves a changed file from cache for a few
    // minutes, so right after a push some calendars are current and one is
    // not. This used to fall back to a hand-written Springfield day rather
    // than render a board that is nobody's day.
    //
    // THAT REMEDY IS GONE with the offline board, and it was worse than the
    // thing it prevented: it replaced the demo with a DIFFERENT demo, in
    // different words, with no indication anything had happened. What a
    // stale feed produces here is exactly what a stale feed produces for a
    // real config, which is the thing the demo exists to show. So the case
    // now holds the two things still guaranteed -- the family is all there
    // and the board renders -- and records that the stale event is on it.
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
    const names = r.data.legend.map((t) => t.name).sort();
    for (const who of ['Bart', 'Homer', 'Lisa', 'Maggie', 'Marge']) {
      assert(names.indexOf(who) >= 0, 'a stale feed cost the demo a line: ' + names.join(', '));
    }
    assert(eventItems(r.data).length > 0, 'a stale feed emptied the whole board');
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
    eventItems(r.data).forEach((e) => { owners[e.title] = e.owner; });
    const bartKey = r.data.legend.filter((t) => t.name === 'Bart').map((t) => t.key)[0];
    const lisaKey = r.data.legend.filter((t) => t.name === 'Lisa').map((t) => t.key)[0];
    // the class code routes the entry and is then stripped from the title:
    // "L6 School Day" belongs to Bart and reads as "School Day"
    // day 0 only: the payload carries the whole run the board may draw, and
    // a weekly school day recurs on every one of them
    const schoolDays = eventItems(r.data)
      .filter((s) => s.title === 'School Day' && s.start_min < 1440);
    assert(schoolDays.length === 1, 'one school day, shared, not one per child: got ' + schoolDays.length);
    const atSchool = [schoolDays[0].owner].concat(schoolDays[0].co_owners).sort();
    assert(atSchool.length === 2, 'expected exactly the two schoolchildren on it, got ' + atSchool.join(','));
    assert(atSchool.indexOf(bartKey) >= 0, 'no School Day on Bart');
    assert(atSchool.indexOf(lisaKey) >= 0, 'no School Day on Lisa');
    assert(owners['Field Trip'] === bartKey, 'the L6 field trip should sit on Bart, got ' + owners['Field Trip']);
  });

  test('the family calendar produces an interchange across everyone', async () => {
    const { run } = runTransform(serveDemoFiles(), NOW);
    const r = await run(demoInput(NOW));
    const dinner = eventItems(r.data).filter((e) => /Family Dinner/.test(e.title))[0];
    assert(dinner, 'no Family Dinner in the demo');
    assert(dinner.co_owners.length >= 3,
      'Family Dinner should join the whole family, got ' + (dinner.co_owners.length + 1) + ' track(s)');
  });

  test('a partly-resolved demo still shows the whole family', async () => {
    // the failure that actually happens: new files not yet on the CDN while
    // an older one still answers, so some calendars resolve and others 404.
    // A line the config DECLARES is drawn on its quiet day rather than
    // dropped, so the family survives a feed being down without needing
    // anything to fall back to.
    const { run } = runTransform(serveDemoFiles(['simpsons/homer.ics', 'simpsons/marge.ics', 'simpsons/maggie.ics']), NOW);
    const r = await run(demoInput(NOW));
    const names = r.data.legend.map((t) => t.name).sort();
    for (const who of ['Bart', 'Homer', 'Lisa', 'Maggie', 'Marge']) {
      assert(names.indexOf(who) >= 0,
        'a feed being down cost the demo a line: ' + names.join(', '));
    }
  });

  test('an unreachable GitHub draws an empty board, not a made-up one', async () => {
    // THE OPPOSITE OF WHAT THIS USED TO ASSERT. It held that an unreachable
    // GitHub must fall back to the built-in Springfield day "rather than an
    // empty board", and that was the whole mistake: the built-in day was a
    // second, drifted copy of the demo that swapped itself in silently, and
    // a panel showing it was indistinguishable from a working one until you
    // noticed the appointments did not exist in this repo.
    //
    // A board that invents appointments to avoid looking empty is lying. An
    // empty one is honest and, unlike the fake, it is obviously wrong.
    // What it actually draws is better than empty and still honest: the
    // config DECLARES its five lines, and a declared line is drawn on its
    // quiet day, so the board comes out as the Springfield family with
    // nothing on any of them. That says who should be there and that
    // nothing came, which is the truth, and it is obviously not a working
    // day -- where the built-in board was indistinguishable from one.
    const { run } = runTransform(async () => fail(500), NOW);
    const r = await run(demoInput(NOW));
    assertEqual(eventItems(r.data).length, 0, 'something was invented for an offline board');
    const names = r.data.legend.map((t) => t.name).sort();
    assertEqual(names, ['Bart', 'Homer', 'Lisa', 'Maggie', 'Marge'],
      'an offline board should still say whose day is missing');
    assert(r.data.demo_partial === true, 'an offline demo is not flagged as partial');
    assert(r.data.header_weather, 'the board lost its header along with its events');
  });

  // ------------------------------------------------------------ the other boards

  // Each demo set is a real config against real ICS files in this repo, so
  // a renamed track, a changed rule or a moved file breaks that board for
  // everyone who picks it and nothing else would notice.
  const SETS = {
    simpsons: { lines: ['Bart', 'Homer', 'Lisa', 'Maggie', 'Marge'], dir: 'simpsons' },
    futurama: { lines: ['Amy', 'Bender', 'Fry', 'Leela', 'Professor'], dir: 'futurama' },
    friends: { lines: ['Monica', 'Rachel'], dir: 'friends' },
  };

  for (const set of Object.keys(SETS)) {
    test('the "' + set + '" demo resolves against the repo ICS files', async () => {
      const { run } = runTransform(serveDemoFiles(), NOW);
      const r = await run(baseInput(NOW, { use_demo_data: 'true', demo_set: set }));
      const names = r.data.legend.map((t) => t.name).sort();
      assert(names.join(',') === SETS[set].lines.join(','),
        set + ': expected ' + SETS[set].lines.join(', ') + ', got ' + names.join(', '));
      // and it fetched only its own show's files
      assert(eventItems(r.data).length > 0, set + ': resolved no events');
    });
  }

  test('an unknown demo board falls back to Springfield rather than an empty one', async () => {
    const { run } = runTransform(serveDemoFiles(), NOW);
    const r = await run(baseInput(NOW, { use_demo_data: 'true', demo_set: 'the-wire' }));
    const names = r.data.legend.map((t) => t.name).sort();
    assert(names.join(',') === SETS.simpsons.lines.join(','), 'got ' + names.join(', '));
  });

  test('the Planet Express delivery is one long event on three lines', async () => {
    // the shape two children at one school get, with a third line in the
    // corridor: one event, one caption, three lines, and the three of them
    // adjacent. It used to arrive as three separate siding entries tied
    // together by a shared group id, which is what made a single caption
    // something a test had to check for; one item cannot be captioned
    // twice, so what is left to protect is that it IS one item and that it
    // still names all three of the crew.
    const { run } = runTransform(serveDemoFiles(), NOW);
    const r = await run(baseInput(NOW, { use_demo_data: 'true', demo_set: 'futurama' }));
    const runs = eventItems(r.data).filter((s) => s.title === 'Delivery Run' && s.start_min < 1440);
    assert(runs.length === 1, 'expected one Delivery Run, got ' + runs.length);
    const crew = [runs[0].owner].concat(runs[0].co_owners);
    assert(crew.length === 3, 'expected the delivery on three lines, got ' + crew.length);
    const key = {};
    r.data.legend.forEach((t, i) => { key[t.key] = i; });
    const at = crew.map((k) => key[k]).sort((a, b) => a - b);
    assert(at[2] - at[0] === 2, 'the three lines on one delivery should end up adjacent, got positions ' + at.join(','));
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

  // THE EXAMPLE PEOPLE ACTUALLY COPY.
  //
  // demo-config.json is what CONFIG.md links to and what the editor's
  // "load the example" button fetches, and until now nothing ran it: the
  // rename to `lines`/`line:` could have left it describing a schema the
  // plugin no longer reads and every test would still have passed. Run it
  // through the real transform against the repo's own ICS files.
  test('demo-config.json, the example everyone copies, still draws a board', async () => {
    const cfg = fs.readFileSync(path.join(__dirname, '../../../demo-config.json'), 'utf-8');
    const parsed = JSON.parse(cfg);
    const { run } = runTransform(async (url) => {
      // The holiday feed is a real public URL, not a file in this repo.
      // It is not what this is testing, so answer it with nothing rather
      // than with a 404, which would put a service alert on the board.
      if (String(url).indexOf('/main/demo/') < 0) return okText('BEGIN:VCALENDAR\nEND:VCALENDAR\n');
      const full = path.join(DEMO_DIR, relOf(url));
      return fs.existsSync(full) ? okText(fs.readFileSync(full, 'utf-8')) : fail(404);
    }, NOW);
    const r = await run(baseInput(NOW, { use_demo_data: 'false', config_json: cfg }));
    const names = r.data.legend.map((t) => t.name).sort();
    assert(!r.data.service_alert, 'the example board came up with a service alert: '
      + JSON.stringify(r.data.service_alert));
    assertEqual(names, parsed.lines.map((l) => l.name).sort(),
      'the example declares lines the board does not draw');
    const titles = eventItems(r.data).map((e) => e.title);
    assert(titles.length > 0, 'the example board is empty');
    // Its two interesting rules: a class code routes a school entry and is
    // then stripped, and a family entry is shared by everyone named.
    assert(!titles.some((t) => /^(?:L6|K3)\s/.test(t)),
      'a class code survived into a title: ' + titles.join(', '));
    const dinner = eventItems(r.data).find((e) => /Family Dinner/.test(e.title));
    if (dinner) {
      assertEqual((dinner.co_owners || []).length, 4,
        'Family Dinner is no longer the whole household');
    }
  });

  // ------------------------------------------------------------ the simple setup

  test('a config that names no calendars rides the demo, weather and all', async () => {
    // The box is filled in and describes nothing: valid JSON with an empty
    // list. This used to drop to the built-in Springfield day with no
    // weather and no real feeds -- a visibly worse board than the one the
    // reader had a moment ago, which reads as a different fault than the
    // one they actually have.
    const r = await runTransform(serveDemoFiles(), NOW).run(baseInput(NOW, {
      use_demo_data: 'false',
      config_json: '{"lines": [], "calendars": []}',
    }));
    assert(r.data.legend.length > 0, 'an unusable config produced an empty board');
    assert(r.data.header_weather, 'it fell through to the board with no weather');
  });

  test('a plain list of ICS links needs no JSON and no editor', async () => {
    const { run } = runTransform(serveDemoFiles(), NOW);
    const r = await run(baseInput(NOW, {
      use_demo_data: 'false',
      calendar_urls: [
        'https://raw.githubusercontent.com/x/y/main/demo/friends/monica.ics',
        'https://raw.githubusercontent.com/x/y/main/demo/friends/rachel.ics',
      ].join('\n'),
    }));
    const names = r.data.legend.map((t) => t.name).sort();
    // each calendar becomes its own line, named by the feed's own
    // X-WR-CALNAME (and, for a feed that carries none, by its URL)
    assert(names.join(',') === 'Demo - Monica,Demo - Rachel', 'got [' + names.join(', ') + ']');
    assert(eventItems(r.data).length > 0, 'a bare URL list produced no events');
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
    assert(r.data.legend.map((t) => t.name).join(',') === 'Alex Work',
      'got ' + r.data.legend.map((t) => t.name).join(', '));
  });

  test('the JSON config wins over the plain list when both are filled', async () => {
    const { run } = runTransform(serveDemoFiles(), NOW);
    const cfg = JSON.stringify({
      lines: [{ name: 'Just Me' }],
      calendars: [{ name: 'Mine', url: 'https://raw.githubusercontent.com/x/y/main/demo/friends/monica.ics',
        rules: [{ match: { type: 'any' }, line: 'Just Me' }] }],
    });
    const r = await run(baseInput(NOW, {
      use_demo_data: 'false',
      calendar_urls: 'https://raw.githubusercontent.com/x/y/main/demo/friends/rachel.ics',
      config_json: cfg,
    }));
    const names = r.data.legend.map((t) => t.name);
    assert(names.join(',') === 'Just Me', 'the JSON config should win, got ' + names.join(', '));
  });
};
