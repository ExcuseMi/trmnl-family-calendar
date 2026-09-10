'use strict';

// The service alert banner: metro.service_alert, or null.
//
// The banner is one line along the bottom edge and the template only
// prints it, so everything that could be wrong about it has to be wrong
// HERE: which breach wins when a day trips several, what unit a threshold
// was read in, which language the line came out in, and whether the alert
// cost the render a second call to the forecast API.
//
// The shape is deliberately { text, kind } or NULL. Null is what lets the
// template collapse the band and hand the space back to the map, so "no
// alert" must never arrive as an empty string or an object with a blank
// text.

const fs = require('fs');
const path = require('path');

const I18N_DIR = path.join(__dirname, '../../../i18n');

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, fail, baseInput, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-09T09:00:00Z');
  const NOW_S = Math.floor(NOW / 1000);
  const ICS = icsWithEvents([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Afternoon' }]);

  // Hours across the visible day. The wettest one is 17:00, which is the
  // hour in the copy the alert lines were written against.
  const HOURS = [];
  const PROBS = [];
  for (let hh = 7; hh <= 21; hh++) {
    HOURS.push('2026-09-09T' + String(hh).padStart(2, '0') + ':00');
    PROBS.push(hh === 17 ? 80 : (hh === 16 ? 30 : 5));
  }

  // A forecast in the shape Open-Meteo answers with. `code` drives the
  // condition bucket (71 is snow, 61 rain, 0 clear); hi/lo are whatever the
  // API was asked for, which is always the board's own unit.
  function forecast(o) {
    o = o || {};
    return JSON.stringify({
      daily: {
        temperature_2m_max: [o.hi == null ? 18 : o.hi],
        temperature_2m_min: [o.lo == null ? 11 : o.lo],
        precipitation_probability_max: [o.max == null ? 80 : o.max],
        weathercode: [o.code == null ? 61 : o.code],
        sunrise: ['2026-09-09T06:30'], sunset: ['2026-09-09T20:30'],
      },
      hourly: { time: HOURS, precipitation_probability: o.probs || PROBS },
    });
  }

  // Every board here is a real one (not the demo): a location, one calendar,
  // and whatever alert settings the case is about.
  function net(body, i18nText) {
    const seen = [];
    const impl = async (url) => {
      seen.push(String(url));
      if (String(url).indexOf('api.open-meteo.com') >= 0) return body == null ? fail(500) : okText(body);
      if (String(url).indexOf('/i18n/') >= 0) return i18nText == null ? fail(404) : okText(i18nText);
      return okText(ICS);
    };
    impl.seen = seen;
    return impl;
  }

  function input(fields, locale, state) {
    const i = baseInput(NOW, Object.assign({
      use_demo_data: 'false',
      lat_lon: '51.05,3.72',
      config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
    }, fields));
    if (locale) i.trmnl.user.locale = locale;
    if (state !== undefined) i.trmnl.state = state;
    return i;
  }

  const ON = { alert_enabled: 'true', alert_rain_threshold: '70' };

  test('no alert settings, no banner: service_alert is null', async () => {
    // The field must exist and be null rather than be absent, so the
    // template has one thing to test rather than two.
    const { run } = runTransform(net(forecast()), NOW);
    const r = await run(input({}));
    assert('service_alert' in r.metro, 'the payload has no service_alert key at all');
    assertEqual(r.metro.service_alert, null, 'an unconfigured board raised an alert');
  });

  test('the banner is off until it is turned on, on a day that breaches everything', async () => {
    // Thresholds filled in but the switch left alone: an alert nobody asked
    // for is an alert nobody trusts.
    const { run } = runTransform(net(forecast({ code: 71, hi: -2, lo: -9 })), NOW);
    const r = await run(input({ alert_rain_threshold: '10', alert_temp_low: '0' }));
    assertEqual(r.metro.service_alert, null, 'a board with alert_enabled unset raised an alert');
  });

  test('the wettest hour above the threshold is the banner, in the copy it was written in', async () => {
    const { run } = runTransform(net(forecast()), NOW);
    const r = await run(input(ON));
    assertEqual(r.metro.service_alert,
      { kind: 'rain', text: 'SERVICE ALERT · Heavy Rain Expected at 17:00 (80%)' },
      'the English rain banner');
  });

  test('a day that stays under the threshold gets no banner', async () => {
    // 80% is the wettest hour; asked for 90 it is not an alert, and the
    // band has to disappear rather than say "Heavy Rain Expected (80%)".
    const { run } = runTransform(net(forecast()), NOW);
    const r = await run(input({ alert_enabled: 'true', alert_rain_threshold: '90' }));
    assertEqual(r.metro.service_alert, null, 'got ' + JSON.stringify(r.metro.service_alert));
  });

  test('a blank threshold is off, not zero', async () => {
    // Read as 0 an empty "rain chance" field would fire on every dry day,
    // and an empty "cold at or below" would fire on every frost in Celsius
    // and never once in Fahrenheit.
    const { run } = runTransform(net(forecast({ max: 0, probs: PROBS.map(() => 0) })), NOW);
    const r = await run(input({ alert_enabled: 'true', alert_rain_threshold: '', alert_temp_low: '' }));
    assertEqual(r.metro.service_alert, null, 'a blank number field alerted on a dry, mild day');
  });

  test('snow outranks rain: one banner, and it names the thing that stops the day', async () => {
    const { run } = runTransform(net(forecast({ code: 71, hi: 1, lo: -3 })), NOW);
    const r = await run(input(ON));
    assertEqual(r.metro.service_alert,
      { kind: 'snow', text: 'SERVICE ALERT · Heavy Snow Expected at 17:00 (80%)' },
      'a snowy day with rain over the threshold should read as snow');
  });

  test('the snow alert can be turned off on its own and the day falls through to rain', async () => {
    const { run } = runTransform(net(forecast({ code: 71 })), NOW);
    const r = await run(input(Object.assign({ alert_snow: 'false' }, ON)));
    assertEqual((r.metro.service_alert || {}).kind, 'rain', 'got ' + JSON.stringify(r.metro.service_alert));
  });

  test('cold and heat carry the temperature, and outrank rain', async () => {
    const cold = await runTransform(net(forecast({ hi: 1, lo: -6 })), NOW)
      .run(input(Object.assign({ alert_temp_low: '-5' }, ON)));
    assertEqual(cold.metro.service_alert,
      { kind: 'cold', text: 'SERVICE ALERT · Extreme Cold Expected (-6°)' }, 'the cold banner');

    const heat = await runTransform(net(forecast({ hi: 36, lo: 24 })), NOW)
      .run(input(Object.assign({ alert_temp_high: '35' }, ON)));
    assertEqual(heat.metro.service_alert,
      { kind: 'heat', text: 'SERVICE ALERT · Extreme Heat Expected (36°)' }, 'the heat banner');
  });

  test('a temperature threshold is read in the unit the board is showing', async () => {
    // ONE day (a low of 18C, which is 64F) and one threshold, "20". On a
    // Celsius board that is a cold morning; on a Fahrenheit board 20 is
    // -7C and nothing like it. The forecast is fetched in the board's own
    // unit (the API converts), so the way this goes wrong is comparing the
    // reader's number against the other scale.
    const sameDay = async (url) => {
      if (String(url).indexOf('api.open-meteo.com') >= 0) {
        const f = /temperature_unit=fahrenheit/.test(String(url));
        return okText(forecast(f ? { hi: 86, lo: 64 } : { hi: 30, lo: 18 }));
      }
      return okText(ICS);
    };
    const noRain = Object.assign({}, ON, { alert_rain_threshold: '', alert_temp_low: '20' });

    const c = await runTransform(sameDay, NOW).run(input(Object.assign({ temperature_unit: 'c' }, noRain)));
    assertEqual(c.metro.service_alert,
      { kind: 'cold', text: 'SERVICE ALERT · Extreme Cold Expected (18°)' },
      '18C is at or below a threshold of 20 on a Celsius board');

    const f = await runTransform(sameDay, NOW).run(input(Object.assign({ temperature_unit: 'f' }, noRain)));
    assertEqual(f.metro.service_alert, null,
      '64F is nowhere near a threshold of 20 on a Fahrenheit board: ' + JSON.stringify(f.metro.service_alert));
  });

  test('a snapshot saved in one unit is compared in the unit the board now shows', async () => {
    // Saved state outlives the temperature setting. A -6C snapshot replayed
    // on a board switched to Fahrenheit is a 21F day, and "cold at or below
    // 25" has to fire on it.
    const first = runTransform(net(forecast({ hi: 1, lo: -6 })), NOW);
    const good = await first.run(input(Object.assign({ temperature_unit: 'c' }, ON)));
    const saved = JSON.parse(JSON.stringify(good.trmnl_state));
    assertEqual(saved.weather.unit, 'C', 'the snapshot should record the unit it was fetched in');

    const later = await runTransform(net(null), NOW)
      .run(input(Object.assign({ temperature_unit: 'f', alert_temp_low: '25', alert_rain_threshold: '' }, ON), null, saved));
    assertEqual(later.metro.service_alert,
      { kind: 'cold', text: 'SERVICE ALERT · Extreme Cold Expected (21°)' },
      'got ' + JSON.stringify(later.metro.service_alert));
  });

  test('the alert costs the render no extra network call', async () => {
    // It reads the forecast that was already fetched. A second call would
    // come out of the same shared deadline the calendars are spending.
    const fetchImpl = net(forecast());
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(input(ON));
    assert(r.metro.service_alert, 'no alert to weigh');
    assertEqual(fetchImpl.seen.filter((u) => u.indexOf('api.open-meteo.com') >= 0).length, 1,
      'the forecast API was called more than once');
  });

  test('a board running on the last good forecast still raises its alert', async () => {
    // The API is down, the board is showing the snapshot out of saved
    // state, and that is exactly the day you want to be told it will rain.
    const first = runTransform(net(forecast()), NOW);
    const good = await first.run(input(ON));
    const saved = JSON.parse(JSON.stringify(good.trmnl_state));
    assert(saved.weather && saved.weather.peak, 'the wettest hour was not saved: ' + JSON.stringify(saved.weather));

    const later = await runTransform(net(null), NOW).run(input(ON, null, saved));
    assertEqual((later.metro.service_alert || {}).text, 'SERVICE ALERT · Heavy Rain Expected at 17:00 (80%)',
      'got ' + JSON.stringify(later.metro.service_alert));
  });

  test('a saved snapshot from a build that had no wettest hour does not invent one', async () => {
    // Older state carries no `peak`. An alert that made an hour up would be
    // a time on the wall nobody's forecast ever said.
    const saved = { weather: { hi: 18, lo: 11, condition: 'rain', icon: 'wi-day-rain.svg', rain_chance: 80, unit: 'C' },
      weatherFetchedAt: NOW_S - 600 };
    const r = await runTransform(net(null), NOW).run(input(ON, null, saved));
    assertEqual(r.metro.service_alert, null, 'got ' + JSON.stringify(r.metro.service_alert));
  });

  // The exact copy, per language, from the files this repo actually ships,
  // served through the actual fetch path. The rain line is the one the
  // wording was signed off in; a translator reordering the time and the
  // percentage is fine, losing one of them is not (see i18n-files.js).
  const RAIN_COPY = {
    fr: 'ALERTE SERVICE · Pluie Forte Prévu à 17:00 (80%)',
    de: 'BETRIEBSSTÖRUNG · Starkregen Erwartet um 17:00 (80%)',
    nl: 'DIENSTMEDEDELING · Zware Regen Verwacht om 17:00 (80%)',
    es: 'AVISO DE SERVICIO · Lluvia Intensa Previsto a las 17:00 (80%)',
  };

  for (const lang of Object.keys(RAIN_COPY)) {
    test('the ' + lang + ' banner reads as it was written', async () => {
      const table = fs.readFileSync(path.join(I18N_DIR, lang + '.json'), 'utf-8');
      const { run } = runTransform(net(forecast(), table), NOW);
      const r = await run(input(ON, lang + '-' + lang.toUpperCase()));
      assertEqual((r.metro.service_alert || {}).text, RAIN_COPY[lang],
        'got ' + JSON.stringify(r.metro.service_alert));
    });
  }

  test('an unreachable language file leaves an English banner, not a broken one', async () => {
    // Same rule the rest of the strings follow: a board in English is a
    // board, a board with "alert_rain" printed on it is not.
    const { run } = runTransform(net(forecast(), null), NOW);
    const r = await run(input(ON, 'fr-FR'));
    assertEqual((r.metro.service_alert || {}).text, 'SERVICE ALERT · Heavy Rain Expected at 17:00 (80%)',
      'got ' + JSON.stringify(r.metro.service_alert));
  });

  test('the banner follows the 12-hour setting like every other time on the board', async () => {
    const { run } = runTransform(net(forecast()), NOW);
    const r = await run(input(Object.assign({ time_format: '12h' }, ON)));
    assertEqual((r.metro.service_alert || {}).text, 'SERVICE ALERT · Heavy Rain Expected at 5pm (80%)',
      'got ' + JSON.stringify(r.metro.service_alert));
  });

  test('a board with no location cannot raise an alert', async () => {
    // Nothing to forecast against. Before service_alert was null-by-default
    // this is the case that would have shipped a banner with a blank in it.
    const { run } = runTransform(net(forecast()), NOW);
    const r = await run(input(Object.assign({ lat_lon: '' }, ON)));
    assertEqual(r.metro.service_alert, null, 'got ' + JSON.stringify(r.metro.service_alert));
  });

  test('a demo board can show the banner without waiting for real weather', async () => {
    // The demo carries its own forecast (see demo-weather.js) so every part
    // of the map can be seen before anyone has set a location. The banner
    // is part of the map.
    const { run } = runTransform(async () => fail(500), NOW);
    const r = await run(baseInput(NOW, { use_demo_data: 'true', demo_set: 'friends', alert_enabled: 'true', alert_temp_low: '0' }));
    assertEqual((r.metro.service_alert || {}).kind, 'snow',
      'the freezing demo board should demonstrate the banner: ' + JSON.stringify(r.metro.service_alert));
  });
};
