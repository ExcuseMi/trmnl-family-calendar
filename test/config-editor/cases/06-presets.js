'use strict';

// The preset dropdown in Start (issues.md E5). Someone with no ICS links at all should be
// able to see a board, so each preset is a COMPLETE configuration the plugin understands,
// not a sketch: it goes in through loadConfig like an import, and the JSON box has to hand
// back exactly what went in. These tests are the guard on that, on the four things the
// presets exist to teach, and on the two settings a preset must never put back (side and
// color are chosen by the plugin now, and their pickers were removed from this page).

module.exports = function (test, h) {
  const { loadEditor, fireInput, fireChange, jsonOut, assert, assertEqual } = h;

  const IDS = ['family4', 'worksplit', 'solo'];

  function presetIds(document) {
    return [...document.querySelectorAll('#presetPick option')]
      .map((o) => o.value).filter(Boolean);
  }
  // Loads a preset with the confirm answered `answer`, and reports whether it was asked.
  function pick(win, doc, id, answer) {
    const asked = { n: 0 };
    win.confirm = () => { asked.n++; return answer !== false; };
    fireChange(doc.getElementById('presetPick'), id);
    return asked;
  }
  // Every rule in a config, calendar rules and global ones alike.
  function allRules(cfg) {
    return (cfg.rules || []).concat(...(cfg.calendars || []).map((c) => c.rules || []));
  }

  test('Start offers the three presets the plugin ships, by name', () => {
    const { document } = loadEditor();
    const opts = [...document.querySelectorAll('#presetPick option')];
    assertEqual(opts.filter((o) => o.value).map((o) => [o.value, o.textContent]), [
      ['family4', 'Family of 4'],
      ['worksplit', 'Work vs Personal Split'],
      ['solo', 'Solo Freelancer Track'],
    ]);
    assert(!opts[0].value, 'the first option should be the prompt, not a preset');
  });

  test('every preset round-trips: what it loads is what the JSON box gives back', () => {
    const { window, document } = loadEditor();
    assertEqual(presetIds(document), IDS);
    IDS.forEach((id) => {
      const ed = loadEditor();
      pick(ed.window, ed.document, id, true);
      const loaded = JSON.parse(ed.document.getElementById('importIn').value);
      // the editor rebuilt this from its own state; if a field did not survive the trip
      // (allDay, an empty rewrite, a rule the editor drops) the two disagree here
      assert.deepStrictEqual(jsonOut(ed.document), loaded, id + ' does not round-trip through the editor');
      assert(loaded.calendars.length >= 2, id + ' should be a real board, not one feed');
    });
    void window;
  });

  test('the plugin\'s own parseConfig accepts every preset', () => {
    IDS.forEach((id) => {
      const { window, document } = loadEditor();
      pick(window, document, id, true);
      const src = JSON.parse(document.getElementById('jsonOut').value);
      const parsed = window.parseConfig(document.getElementById('jsonOut').value);
      assert(parsed.calendars.length === src.calendars.length, id + ': a calendar was dropped');
      assert(Object.keys(parsed.tracks).length === src.tracks.length, id + ': a track was dropped');
      assert(parsed.everyoneTrack === src.tracks[0].name, id + ': first track should be the fallback');
      // every rule the preset writes has to compile, or it is decoration
      const compiled = parsed.globalRules.length + parsed.calendars.reduce((n, c) => n + c.rules.length, 0);
      assert(compiled === allRules(src).length, id + ': ' + (allRules(src).length - compiled) + ' rule(s) did not compile');
      // and every track a rule routes to has to exist
      const names = src.tracks.map((t) => t.name);
      allRules(src).forEach((r) => {
        [].concat(r.track || []).forEach((n) => assert(names.indexOf(n) !== -1, id + ': rule routes to unknown track ' + n));
      });
    });
  });

  test('no preset sets side or color, or names a calendar after something that is not a track', () => {
    IDS.forEach((id) => {
      const { window, document } = loadEditor();
      pick(window, document, id, true);
      const cfg = jsonOut(document);
      cfg.tracks.forEach((t) => {
        assert.deepStrictEqual(Object.keys(t), ['name'], id + ': a track carries more than a name');
      });
      const names = cfg.tracks.map((t) => t.name.toLowerCase());
      cfg.calendars.forEach((c) => {
        if (c.name) assert(names.indexOf(c.name.toLowerCase()) !== -1, id + ': calendar named "' + c.name + '" is not a track');
      });
      // the page's own warning agrees: a shipped preset must not light it up
      [...document.querySelectorAll('#calendars .cal-name-warn')].forEach((w) => {
        assert.strictEqual(w.textContent, '', id + ': the calendar name warning fired on a preset');
      });
      // placeholder links, clearly not anyone's real feed
      cfg.calendars.forEach((c) => assert(/^https:\/\/calendar\.example\.com\//.test(c.url), id + ': ' + c.url + ' does not read as a placeholder'));
    });
  });

  test('the three presets teach three different things, not one shape three times', () => {
    const got = {};
    IDS.forEach((id) => {
      const { window, document } = loadEditor();
      pick(window, document, id, true);
      const cfg = jsonOut(document);
      const rules = allRules(cfg);
      got[id] = {
        shared: rules.some((r) => Array.isArray(r.track) && r.track.length > 1),
        station: rules.some((r) => r.station === true),
        strips: rules.some((r) => typeof r.rewrite === 'string' && r.rewrite && /^\^/.test(r.match.value || '')),
        hides: rules.some((r) => r.hide === true),
        global: (cfg.rules || []).length > 0,
        keepEmpty: cfg.calendars.some((c) => c.hideIfEmpty === false),
      };
    });
    assert(got.family4.shared, 'Family of 4 should draw one event across several tracks');
    assert(got.family4.hides, 'Family of 4 should hide the school feed\'s noise');
    assert(got.family4.keepEmpty, 'Family of 4 should keep the quiet line on the board');
    assert(got.worksplit.station, 'Work vs Personal should draw the office day as a station');
    assert(got.worksplit.global, 'Work vs Personal should show a rule applied to every calendar');
    assert(got.solo.strips, 'Solo Freelancer should route on a title prefix and then strip it');
    assert(!got.solo.shared && !got.solo.station, 'Solo Freelancer should not just repeat the other two');
  });

  test('a preset replaces the editor, and asks first when there is something to lose', () => {
    const { window, document } = loadEditor();
    // nothing typed yet: swapping presets is not worth a dialog
    let asked = pick(window, document, 'family4', true);
    assertEqual(asked.n, 0);
    assertEqual(jsonOut(document).tracks[0].name, 'Sam');
    asked = pick(window, document, 'solo', true);
    assert.strictEqual(asked.n, 0, 'an untouched preset should swap without asking');
    assertEqual(jsonOut(document).tracks[0].name, 'Studio');

    // now it is the user's config, not ours
    fireInput(document.querySelector('#tracks .card input.title-input'), 'Robin');
    const mine = document.getElementById('jsonOut').value;
    asked = pick(window, document, 'worksplit', false);
    assert.strictEqual(asked.n, 1, 'edited work should not be thrown away silently');
    assert.strictEqual(document.getElementById('jsonOut').value, mine, 'declining the confirm must change nothing');
    assert.strictEqual(document.getElementById('presetPick').value, '', 'a declined preset should not look loaded');

    asked = pick(window, document, 'worksplit', true);
    assertEqual(asked.n, 1);
    assertEqual(jsonOut(document).tracks.map((t) => t.name), ['Work', 'Personal']);
    assert(document.getElementById('jsonOut').value !== mine, 'accepting the confirm must replace everything');
  });

  test('a pasted config is never silently swapped for a preset', () => {
    const { window, document } = loadEditor();
    document.getElementById('importIn').value = '{"calendars":[{"url":"https://mine.example/a.ics"}]}';
    const asked = pick(window, document, 'family4', false);
    assert.strictEqual(asked.n, 1, 'text waiting in the paste box counts as work');
    assertEqual(document.getElementById('importIn').value, '{"calendars":[{"url":"https://mine.example/a.ics"}]}');
  });
};
