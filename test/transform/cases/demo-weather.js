'use strict';

// Demo weather. A demo board has no location, so before this nothing on one
// ever drew a sky marker: the strip under the ruler and the rain start/stop
// markers were all invisible until someone had set a real lat/lon and
// waited for the right hour of the right day. Every demo board now carries
// its own forecast (no network call, no setting), and between the three of
// them every marker icon is exercised.
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

      // and NO sunrise or sunset: they were markers once and are not any
      // more, so a payload carrying one is the old path coming back.
      assert(r.data.weather.every((i) => i.type === 'weather'),
        set + ': the sky band carries something that is not a weather marker: '
        + JSON.stringify(r.data.weather.map((i) => i.type)));

      const wx = r.data.weather.filter((i) => i.type === 'weather').map((i) => i.label);
      assert(wx.some((l) => /^Rain starts/.test(l)), set + ': no rain start marker, got ' + JSON.stringify(wx));
      assert(wx.some((l) => /^Rain stops/.test(l)), set + ': no rain stop marker, got ' + JSON.stringify(wx));
      // and one heavier condition, so the snow/storm/fog icons are seen too
      assert(wx.some((l) => /^(Snow|Storms|Foggy)/.test(l)),
        set + ': no snow/storm/fog marker, got ' + JSON.stringify(wx));

      assert(r.data.header_weather.hi != null && r.data.header_weather.condition,
        set + ': the header has no weather: ' + JSON.stringify(r.data.header_weather));
      // every marker carries an icon, or it draws as a floating caption
      r.data.weather
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
      r.data.weather.filter((i) => i.type === 'weather').forEach((i) => {
        const m = /^(Snow|Storms|Foggy)/.exec(i.label);
        if (m) heavy.add(m[1]);
      });
    }
    assert(heavy.size === 3, 'expected snow, storms and fog across the three boards, got ' + [...heavy].join(', '));
  });

  test('the board asks the forecast for nothing it does not draw', async () => {
    // The sunrise and sunset markers are gone from the board, and the two
    // fields that fed them are gone from the query with them. Left in, they
    // would be the kind of thing that comes back by accident: the data is
    // there in the response, somebody adds a marker "while they are in
    // here", and the two marks nobody wanted are on the wall again.
    const urls = [];
    const { run } = runTransform(async (url) => {
      urls.push(String(url));
      if (String(url).indexOf('api.open-meteo.com') >= 0) {
        return okText(JSON.stringify({
          daily: {
            temperature_2m_max: [20], temperature_2m_min: [10],
            precipitation_probability_max: [10], weathercode: [0],
          },
          hourly: { time: [], precipitation_probability: [] },
        }));
      }
      return okText(icsWithEvents([{ start: '20260909T090000Z', end: '20260909T100000Z', summary: 'Standup' }]));
    }, NOW);
    await run(baseInput(NOW, { config_json: 'https://calendar.example.com/a.ics', lat_lon: '51.05,3.72' }));

    const wx = urls.filter((u) => u.indexOf('api.open-meteo.com') >= 0);
    assert(wx.length > 0, 'the board never asked for a forecast at all');
    for (const u of wx) {
      assert(u.indexOf('sunrise') < 0 && u.indexOf('sunset') < 0,
        'the forecast query still asks for sunrise and sunset: ' + u);
    }
  });

  test('the offline demo fallback keeps its weather too', async () => {
    // GitHub unreachable: the board falls back to the built-in Springfield
    // day, which is exactly when an empty sky band would be noticed.
    const { run } = runTransform(async () => fail(500), NOW);
    const r = await run(baseInput(NOW, { use_demo_data: 'true' }));
    assert(r.data.weather.filter((i) => i.type === 'weather').length >= 2, 'the offline demo lost its weather markers');
    assert(r.data.weather.every((i) => i.type === 'weather'), 'the offline demo grew a marker that is not weather');
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
    assert(r.data.header_weather.hi == null, 'a real board invented a temperature: ' + JSON.stringify(r.data.header_weather));
    assert(r.data.weather.length === 0,
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
    assert(r.data.header_weather.hi === 30,
      'the demo weather overrode a real forecast: ' + JSON.stringify(r.data.header_weather));
    // The API is still asked for the day's forecast and still answers with
    // a sunrise and a sunset in the body; the board simply no longer builds
    // a marker out of either.
    assert(r.data.weather.every((i) => i.type === 'weather'),
      'the real forecast put a sun marker back on the board: ' + JSON.stringify(r.data.weather));
  });
};
