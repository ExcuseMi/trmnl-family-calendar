'use strict';

// Demo weather. A demo board has no location, so before this nothing on one
// ever drew a sky marker: the band along the top edge, the sunrise and
// sunset rules, the rain start/stop markers were all invisible until
// someone had set a real lat/lon and waited for the right hour of the right
// day. Every demo board now carries its own forecast (no network call, no
// setting), and between the three of them every marker icon is exercised.
//
// It applies to the demo ONLY: a real config with no location still shows
// an empty header rather than an invented forecast.

const fs = require('fs');
const path = require('path');

const DEMO_DIR = path.join(__dirname, '../../../demo');

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, fail, baseInput, assert } = h;

  const NOW = Date.parse('2026-09-09T09:00:00Z');
  const relOf = (url) => String(url).split('/main/demo/').pop();

  // demo/*.ics off disk, and nothing else answers: a demo board must not
  // need the weather API at all.
  function serveDemoOnly(seen) {
    return async (url) => {
      (seen || []).push(String(url));
      if (String(url).indexOf('/main/demo/') < 0) return fail(404);
      const full = path.join(DEMO_DIR, relOf(url));
      return fs.existsSync(full) ? okText(fs.readFileSync(full, 'utf-8')) : fail(404);
    };
  }

  const SETS = ['simpsons', 'futurama', 'friends'];

  for (const set of SETS) {
    test('the "' + set + '" demo board draws a full sky band with no network weather', async () => {
      const seen = [];
      const { run } = runTransform(serveDemoOnly(seen), NOW);
      const r = await run(baseInput(NOW, { use_demo_data: 'true', demo_set: set }));

      assert(seen.filter((u) => u.indexOf('api.open-meteo.com') >= 0).length === 0,
        set + ': the demo asked the weather API for a board that has no location');

      const sun = r.metro.items.filter((i) => i.type === 'sun').map((i) => i.kind).sort();
      assert(sun.join(',') === 'sunrise,sunset', set + ': expected a sunrise and a sunset, got ' + JSON.stringify(sun));

      const wx = r.metro.items.filter((i) => i.type === 'weather').map((i) => i.label);
      assert(wx.some((l) => /^Rain starts/.test(l)), set + ': no rain start marker, got ' + JSON.stringify(wx));
      assert(wx.some((l) => /^Rain stops/.test(l)), set + ': no rain stop marker, got ' + JSON.stringify(wx));
      // and one heavier condition, so the snow/storm/fog icons are seen too
      assert(wx.some((l) => /^(Snow|Storms|Foggy)/.test(l)),
        set + ': no snow/storm/fog marker, got ' + JSON.stringify(wx));

      assert(r.metro.header_weather.hi != null && r.metro.header_weather.condition,
        set + ': the header has no weather: ' + JSON.stringify(r.metro.header_weather));
      // every marker carries an icon, or it draws as a floating caption
      r.metro.items.filter((i) => i.type === 'weather' || i.type === 'sun')
        .forEach((i) => assert(/^https:\/\/trmnl\.com\/images\/plugins\/weather\/wi-[a-z-]+\.svg$/.test(i.icon),
          set + ': bad marker icon ' + i.icon));
    });
  }

  test('between them the demo boards exercise every heavy condition', async () => {
    // One board with three rain markers would satisfy every case above and
    // still leave the snow and fog icons unseen by anybody.
    const heavy = new Set();
    for (const set of SETS) {
      const { run } = runTransform(serveDemoOnly(), NOW);
      const r = await run(baseInput(NOW, { use_demo_data: 'true', demo_set: set }));
      r.metro.items.filter((i) => i.type === 'weather').forEach((i) => {
        const m = /^(Snow|Storms|Foggy)/.exec(i.label);
        if (m) heavy.add(m[1]);
      });
    }
    assert(heavy.size === 3, 'expected snow, storms and fog across the three boards, got ' + [...heavy].join(', '));
  });

  test('the offline demo fallback keeps its weather too', async () => {
    // GitHub unreachable: the board falls back to the built-in Springfield
    // day, which is exactly when an empty sky band would be noticed.
    const { run } = runTransform(async () => fail(500), NOW);
    const r = await run(baseInput(NOW, { use_demo_data: 'true' }));
    assert(r.metro.items.filter((i) => i.type === 'sun').length === 2, 'the offline demo lost its sun markers');
    assert(r.metro.items.filter((i) => i.type === 'weather').length >= 2, 'the offline demo lost its weather markers');
  });

  test('demo weather does not leak into a real board that has no location', async () => {
    // Inventing a forecast for somebody's actual calendar would be a lie on
    // the wall, not a demo.
    const { run } = runTransform(async () => okText(icsWithEvents([
      { start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Afternoon' },
    ])), NOW);
    const r = await run(baseInput(NOW, {
      use_demo_data: 'false',
      config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
    }));
    assert(r.metro.header_weather.hi == null, 'a real board invented a temperature: ' + JSON.stringify(r.metro.header_weather));
    assert(r.metro.items.filter((i) => i.type === 'weather' || i.type === 'sun').length === 0,
      'a real board with no location drew sky markers');
  });

  test('a demo board with a real location prefers the real forecast', async () => {
    const forecast = JSON.stringify({
      daily: {
        temperature_2m_max: [30], temperature_2m_min: [20], precipitation_probability_max: [5],
        weathercode: [0], sunrise: ['2026-09-09T06:30'], sunset: ['2026-09-09T20:30'],
      },
      hourly: { time: [], precipitation_probability: [] },
    });
    const { run } = runTransform(async (url) => {
      if (String(url).indexOf('api.open-meteo.com') >= 0) return okText(forecast);
      const full = path.join(DEMO_DIR, relOf(url));
      return fs.existsSync(full) ? okText(fs.readFileSync(full, 'utf-8')) : fail(404);
    }, NOW);
    const r = await run(baseInput(NOW, { use_demo_data: 'true', lat_lon: '51.05,3.72' }));
    // 30C asked for in Fahrenheit (the demo board pins en-US) comes back
    // already converted by the API, so the number is the one it sent
    assert(r.metro.header_weather.hi === 30,
      'the demo weather overrode a real forecast: ' + JSON.stringify(r.metro.header_weather));
    const sunrise = r.metro.items.filter((i) => i.type === 'sun' && i.kind === 'sunrise')[0];
    assert(sunrise && sunrise.at_min === 6 * 60 + 30, 'expected the real sunrise, got ' + JSON.stringify(sunrise));
  });
};
