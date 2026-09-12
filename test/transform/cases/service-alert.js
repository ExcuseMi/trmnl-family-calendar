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
    assert('service_alert' in r.data, 'the payload has no service_alert key at all');
    assertEqual(r.data.service_alert, null, 'an unconfigured board raised an alert');
  });

  test('the banner is off until it is turned on, on a day that breaches everything', async () => {
    // Thresholds filled in but the switch left alone: an alert nobody asked
    // for is an alert nobody trusts.
    const { run } = runTransform(net(forecast({ code: 71, hi: -2, lo: -9 })), NOW);
    const r = await run(input({ alert_rain_threshold: '10', alert_temp_low: '0' }));
    assertEqual(r.data.service_alert, null, 'a board with alert_enabled unset raised an alert');
  });

  test('the wettest hour above the threshold is the banner, in the copy it was written in', async () => {
    const { run } = runTransform(net(forecast()), NOW);
    const r = await run(input(ON));
    assertEqual(r.data.service_alert,
      { kind: 'rain', text: 'SERVICE ALERT · Heavy Rain Expected at 17:00 (80%)' },
      'the English rain banner');
  });

  test('a day that stays under the threshold gets no banner', async () => {
    // 80% is the wettest hour; asked for 90 it is not an alert, and the
    // band has to disappear rather than say "Heavy Rain Expected (80%)".
    const { run } = runTransform(net(forecast()), NOW);
    const r = await run(input({ alert_enabled: 'true', alert_rain_threshold: '90' }));
    assertEqual(r.data.service_alert, null, 'got ' + JSON.stringify(r.data.service_alert));
  });

  test('a blank threshold is off, not zero', async () => {
    // Read as 0 an empty "rain chance" field would fire on every dry day,
    // and an empty "cold at or below" would fire on every frost in Celsius
    // and never once in Fahrenheit.
    const { run } = runTransform(net(forecast({ max: 0, probs: PROBS.map(() => 0) })), NOW);
    const r = await run(input({ alert_enabled: 'true', alert_rain_threshold: '', alert_temp_low: '' }));
    assertEqual(r.data.service_alert, null, 'a blank number field alerted on a dry, mild day');
  });

  test('snow outranks rain: one banner, and it names the thing that stops the day', async () => {
    const { run } = runTransform(net(forecast({ code: 71, hi: 1, lo: -3 })), NOW);
    const r = await run(input(ON));
    assertEqual(r.data.service_alert,
      { kind: 'snow', text: 'SERVICE ALERT · Heavy Snow Expected at 17:00 (80%)' },
      'a snowy day with rain over the threshold should read as snow');
  });

  test('the snow alert can be turned off on its own and the day falls through to rain', async () => {
    const { run } = runTransform(net(forecast({ code: 71 })), NOW);
    const r = await run(input(Object.assign({ alert_snow: 'false' }, ON)));
    assertEqual((r.data.service_alert || {}).kind, 'rain', 'got ' + JSON.stringify(r.data.service_alert));
  });

  test('cold and heat carry the temperature, and outrank rain', async () => {
    const cold = await runTransform(net(forecast({ hi: 1, lo: -6 })), NOW)
      .run(input(Object.assign({ alert_temp_low: '-5' }, ON)));
    assertEqual(cold.data.service_alert,
      { kind: 'cold', text: 'SERVICE ALERT · Extreme Cold Expected (-6°)' }, 'the cold banner');

    const heat = await runTransform(net(forecast({ hi: 36, lo: 24 })), NOW)
      .run(input(Object.assign({ alert_temp_high: '35' }, ON)));
    assertEqual(heat.data.service_alert,
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
    assertEqual(c.data.service_alert,
      { kind: 'cold', text: 'SERVICE ALERT · Extreme Cold Expected (18°)' },
      '18C is at or below a threshold of 20 on a Celsius board');

    const f = await runTransform(sameDay, NOW).run(input(Object.assign({ temperature_unit: 'f' }, noRain)));
    assertEqual(f.data.service_alert, null,
      '64F is nowhere near a threshold of 20 on a Fahrenheit board: ' + JSON.stringify(f.data.service_alert));
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
    assertEqual(later.data.service_alert,
      { kind: 'cold', text: 'SERVICE ALERT · Extreme Cold Expected (21°)' },
      'got ' + JSON.stringify(later.data.service_alert));
  });

  test('the alert costs the render no extra network call', async () => {
    // It reads the forecast that was already fetched. A second call would
    // come out of the same shared deadline the calendars are spending.
    const fetchImpl = net(forecast());
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(input(ON));
    assert(r.data.service_alert, 'no alert to weigh');
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
    assertEqual((later.data.service_alert || {}).text, 'SERVICE ALERT · Heavy Rain Expected at 17:00 (80%)',
      'got ' + JSON.stringify(later.data.service_alert));
  });

  test('a saved snapshot from a build that had no wettest hour does not invent one', async () => {
    // Older state carries no `peak`. An alert that made an hour up would be
    // a time on the wall nobody's forecast ever said.
    const saved = { weather: { hi: 18, lo: 11, condition: 'rain', icon: 'wi-day-rain.svg', rain_chance: 80, unit: 'C' },
      weatherFetchedAt: NOW_S - 600 };
    const r = await runTransform(net(null), NOW).run(input(ON, null, saved));
    assertEqual(r.data.service_alert, null, 'got ' + JSON.stringify(r.data.service_alert));
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
      assertEqual((r.data.service_alert || {}).text, RAIN_COPY[lang],
        'got ' + JSON.stringify(r.data.service_alert));
    });
  }

  test('an unreachable language file leaves an English banner, not a broken one', async () => {
    // Same rule the rest of the strings follow: a board in English is a
    // board, a board with "alert_rain" printed on it is not.
    const { run } = runTransform(net(forecast(), null), NOW);
    const r = await run(input(ON, 'fr-FR'));
    assertEqual((r.data.service_alert || {}).text, 'SERVICE ALERT · Heavy Rain Expected at 17:00 (80%)',
      'got ' + JSON.stringify(r.data.service_alert));
  });

  test('the banner follows the 12-hour setting like every other time on the board', async () => {
    const { run } = runTransform(net(forecast()), NOW);
    const r = await run(input(Object.assign({ time_format: '12h' }, ON)));
    assertEqual((r.data.service_alert || {}).text, 'SERVICE ALERT · Heavy Rain Expected at 5pm (80%)',
      'got ' + JSON.stringify(r.data.service_alert));
  });

  test('a board with no location cannot raise an alert', async () => {
    // Nothing to forecast against. Before service_alert was null-by-default
    // this is the case that would have shipped a banner with a blank in it.
    const { run } = runTransform(net(forecast()), NOW);
    const r = await run(input(Object.assign({ lat_lon: '' }, ON)));
    assertEqual(r.data.service_alert, null, 'got ' + JSON.stringify(r.data.service_alert));
  });

  test('a demo board can show the banner without waiting for real weather', async () => {
    // The demo carries its own forecast (see demo-weather.js) so every part
    // of the map can be seen before anyone has set a location. The banner
    // is part of the map.
    const { run } = runTransform(async () => fail(500), NOW);
    const r = await run(baseInput(NOW, { use_demo_data: 'true', demo_set: 'friends', alert_enabled: 'true', alert_temp_low: '0' }));
    assertEqual((r.data.service_alert || {}).kind, 'snow',
      'the freezing demo board should demonstrate the banner: ' + JSON.stringify(r.data.service_alert));
  });

  // -------------------------------------------------------------------
  // Nothing in the past.
  //
  // A service alert is a promise about what is COMING. "Heavy Rain
  // Expected at 09:00" read at seven in the evening is not a warning, it
  // is a wrong statement about a morning everyone already lived through,
  // and it is the easiest banner in the world to ship by accident: the
  // wettest hour of the day is a fact that stops changing at noon, while
  // the board keeps redrawing until midnight.
  //
  // Three ways it happens, all covered below. The forecast is fetched
  // once and read for hours (a board on saved state can be reading one
  // from this morning). The forecast covers the whole run of days, so the
  // wettest hour in the response may belong to a day that is not on the
  // board. And the board can be showing TOMORROW, where every hour is
  // still ahead and today's are all behind.
  // -------------------------------------------------------------------

  // Hours 07:00-21:00 of one date, `by` giving the probability of any
  // hour that is not the quiet 5%.
  function hoursFor(date, by) {
    const t = [], p = [];
    for (let hh = 7; hh <= 21; hh++) {
      t.push(date + 'T' + String(hh).padStart(2, '0') + ':00');
      p.push((by || {})[hh] == null ? 5 : by[hh]);
    }
    return { t: t, p: p };
  }

  // The shape a DAY_SPAN board asks for: daily arrays with one entry per
  // day of the run, one hourly array running across all of them.
  function forecastDays(days) {
    const t = [], p = [];
    days.forEach((d) => { const h = hoursFor(d.date, d.by); t.push(...h.t); p.push(...h.p); });
    return JSON.stringify({
      daily: {
        temperature_2m_max: days.map((d) => (d.hi == null ? 18 : d.hi)),
        temperature_2m_min: days.map((d) => (d.lo == null ? 11 : d.lo)),
        precipitation_probability_max: days.map((d) => (d.max == null ? 80 : d.max)),
        weathercode: days.map((d) => (d.code == null ? 61 : d.code)),
        sunrise: days.map((d) => d.date + 'T06:30'), sunset: days.map((d) => d.date + 'T20:30'),
      },
      hourly: { time: t, precipitation_probability: p },
    });
  }

  const D0 = '2026-09-09', D1 = '2026-09-10';
  const BOTH_DAYS = icsWithEvents([
    { start: '20260909T140000Z', end: '20260909T150000Z', summary: 'Afternoon' },
    { start: '20260910T140000Z', end: '20260910T150000Z', summary: 'Tomorrow afternoon' },
  ]);

  function netAt(body) {
    return async (url) => {
      if (String(url).indexOf('api.open-meteo.com') >= 0) return body == null ? fail(500) : okText(body);
      if (String(url).indexOf('/i18n/') >= 0) return fail(404);
      return okText(BOTH_DAYS);
    };
  }

  function at(hh, mm) { return Date.parse('2026-09-09T' + String(hh).padStart(2, '0') + ':' + String(mm == null ? '00' : mm) + ':00Z'); }

  function inputAt(now, fields) {
    return baseInput(now, Object.assign({
      use_demo_data: 'false',
      lat_lon: '51.05,3.72',
      config_json: JSON.stringify({ calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }] }),
    }, fields));
  }

  async function alertAt(now, body, fields) {
    const r = await runTransform(netAt(body), now).run(inputAt(now, Object.assign({}, ON, fields)));
    return r.data.service_alert;
  }

  test('the wettest hour of the day is not an alert once it has gone', async () => {
    // 09:00 was the wet hour, it is now 15:00, and nothing later comes
    // near the threshold. There is no alert to raise: the day the reader
    // is being warned about is over.
    const a = await alertAt(at(15), forecastDays([{ date: D0, by: { 9: 90 } }]));
    assertEqual(a, null, 'got ' + JSON.stringify(a));
  });

  test('when the wettest hour has gone, the banner names the wettest one still to come', async () => {
    // Not merely silence: 18:00 is over the threshold too, and it is the
    // hour worth moving something out of. Suppressing the banner outright
    // here would lose a real warning to a technicality about 09:00.
    const a = await alertAt(at(15), forecastDays([{ date: D0, by: { 9: 90, 18: 75 } }]));
    assertEqual(a, { kind: 'rain', text: 'SERVICE ALERT · Heavy Rain Expected at 18:00 (75%)' },
      'got ' + JSON.stringify(a));
  });

  test('the hour that is happening right now is still ahead enough to warn about', async () => {
    // The boundary. At 15:00 exactly, "expected at 15:00" is the rain
    // starting, not rain that has been and gone.
    const a = await alertAt(at(15), forecastDays([{ date: D0, by: { 15: 85 } }]));
    assertEqual((a || {}).text, 'SERVICE ALERT · Heavy Rain Expected at 15:00 (85%)', 'got ' + JSON.stringify(a));
  });

  test('a snowy morning read in the evening raises nothing', async () => {
    // Snow outranks every other kind, which is exactly why it must be
    // held to the same clock: the ranking would otherwise let the one
    // banner on the board be the most confidently wrong of them.
    const a = await alertAt(at(19), forecastDays([{ date: D0, code: 71, by: { 9: 90 } }]));
    assertEqual(a, null, 'got ' + JSON.stringify(a));

    // And it must not reach for a dry hour just to have one to name: the
    // evening it falls back to has to be an hour it is really snowing in.
    const dry = await alertAt(at(19), forecastDays([{ date: D0, code: 71, by: { 9: 90, 20: 30 } }]));
    assertEqual(dry, null, 'named a 30% hour as heavy snow: ' + JSON.stringify(dry));

    const late = await alertAt(at(19), forecastDays([{ date: D0, code: 71, by: { 9: 90, 20: 80 } }]));
    assertEqual((late || {}).text, 'SERVICE ALERT · Heavy Snow Expected at 20:00 (80%)',
      'snow still to come is still an alert: ' + JSON.stringify(late));
  });

  test('cold and heat are facts about the whole day and outlast the morning', async () => {
    // These name no hour, so there is no hour of theirs to be in the
    // past. A high of 36 is still the day you had at eight in the
    // evening, and the clock must not quietly take these away too.
    const a = await alertAt(at(20), forecastDays([{ date: D0, hi: 36, lo: 24, by: { 9: 90 } }]),
      { alert_temp_high: '35' });
    assertEqual(a, { kind: 'heat', text: 'SERVICE ALERT · Extreme Heat Expected (36°)' }, 'got ' + JSON.stringify(a));
  });

  test('the wettest hour of TOMORROW is not an alert about today', async () => {
    // The forecast covers the run of days, not the day on the board. Read
    // straight through, the 95% at 17:00 tomorrow becomes "expected at
    // 17:00" on a board whose own day never goes above 20%.
    const a = await alertAt(at(9), forecastDays([
      { date: D0, max: 20, by: {} },
      { date: D1, max: 95, by: { 17: 95 } },
    ]));
    assertEqual(a, null, 'got ' + JSON.stringify(a));
  });

  test('a board showing tomorrow is warned about tomorrow', async () => {
    const a = await alertAt(at(9), forecastDays([
      { date: D0, max: 20, by: {} },
      { date: D1, max: 95, by: { 17: 95 } },
    ]), { show_day: 'tomorrow' });
    assertEqual(a, { kind: 'rain', text: 'SERVICE ALERT · Heavy Rain Expected at 17:00 (95%)' },
      'got ' + JSON.stringify(a));
  });

  test('on a board showing tomorrow, an early hour is ahead of us, not behind', async () => {
    // The clock only bounds the day it belongs to. 08:00 tomorrow is
    // still to come at eight in the evening today, and dropping it as
    // "past" would silence every morning alert on a tomorrow board.
    const a = await alertAt(at(20), forecastDays([
      { date: D0, max: 20, by: {} },
      { date: D1, max: 90, by: { 8: 90 } },
    ]), { show_day: 'tomorrow' });
    assertEqual((a || {}).text, 'SERVICE ALERT · Heavy Rain Expected at 08:00 (90%)', 'got ' + JSON.stringify(a));
  });

  test('the banner is about the day the board is drawing', async () => {
    // An alert about a day that is not on the screen is an alert about
    // nothing. This used to be asked of the evening switch-over -- show_day
    // swapped the board to tomorrow at a set hour and the banner had to swap
    // with it. That setting is gone (rolling reaches tomorrow without giving
    // up today), so it is asked of the choice that still picks a day.
    const body = forecastDays([
      { date: D0, max: 88, by: { 9: 88 } },
      { date: D1, max: 92, by: { 16: 92 } },
    ]);
    const today = await alertAt(at(9), body, { show_day: 'today' });
    assertEqual((today || {}).text, 'SERVICE ALERT · Heavy Rain Expected at 09:00 (88%)',
      'a board about today: ' + JSON.stringify(today));

    const tomorrow = await alertAt(at(9), body, { show_day: 'tomorrow' });
    assertEqual((tomorrow || {}).text, 'SERVICE ALERT · Heavy Rain Expected at 16:00 (92%)',
      'a board about tomorrow: ' + JSON.stringify(tomorrow));
  });

  test('a board replaying this morning\'s snapshot does not replay this morning\'s alert', async () => {
    // The one that actually reaches a wall. The API answered at 08:00 and
    // has been down since; the device is still drawing, and at 19:00 the
    // saved snapshot's wettest hour is nine hours old.
    const morning = await runTransform(netAt(forecastDays([{ date: D0, by: { 9: 90 } }])), at(8))
      .run(inputAt(at(8), ON));
    assertEqual((morning.data.service_alert || {}).text, 'SERVICE ALERT · Heavy Rain Expected at 09:00 (90%)',
      'the morning board should warn about the morning');
    const saved = JSON.parse(JSON.stringify(morning.trmnl_state));

    const evening = await runTransform(netAt(null), at(19)).run(
      Object.assign(inputAt(at(19), ON), { trmnl: Object.assign({}, inputAt(at(19), ON).trmnl, { state: saved }) }));
    assertEqual(evening.data.service_alert, null,
      'the evening board replayed the morning: ' + JSON.stringify(evening.data.service_alert));
  });

  test('a snapshot with only a wettest hour behind it is still held to the clock', async () => {
    // A build older than the hourly detail saved one hour and one
    // probability. There is nothing to fall back to, so the banner has to
    // go rather than name the hour it has.
    const saved = { weather: { hi: 18, lo: 11, condition: 'rain', icon: 'wi-day-rain.svg', rain_chance: 90,
      unit: 'C', peak: { atMin: 9 * 60, pct: 90 } }, weatherFetchedAt: Math.floor(at(8) / 1000) };
    const i = inputAt(at(15), ON);
    i.trmnl.state = saved;
    const r = await runTransform(netAt(null), at(15)).run(i);
    assertEqual(r.data.service_alert, null, 'got ' + JSON.stringify(r.data.service_alert));

    const early = inputAt(at(8), ON);
    early.trmnl.state = saved;
    const still = await runTransform(netAt(null), at(8)).run(early);
    assertEqual((still.data.service_alert || {}).text, 'SERVICE ALERT · Heavy Rain Expected at 09:00 (90%)',
      'the same snapshot read before the hour is a real warning: ' + JSON.stringify(still.data.service_alert));
  });

  test('the demo board obeys the clock like a real one', async () => {
    // The demo carries a fixed forecast, so it is the one board where a
    // wettest hour is guaranteed to be in the past every single evening.
    const late = await runTransform(async () => fail(500), at(20)).run(
      baseInput(at(20), { use_demo_data: 'true', demo_set: 'simpsons', alert_enabled: 'true', alert_rain_threshold: '50' }));
    assertEqual(late.data.service_alert, null,
      'the demo raised an alert about an hour that has gone: ' + JSON.stringify(late.data.service_alert));
  });

  test('the hourly detail behind the alert is saved, per day', async () => {
    // The banner is composed at draw time, not at fetch time, which only
    // works if the snapshot carries enough to re-pick an hour later.
    const r = await runTransform(netAt(forecastDays([
      { date: D0, by: { 9: 90, 18: 75 } },
      { date: D1, by: { 17: 95 } },
    ])), at(8)).run(inputAt(at(8), ON));
    const w = r.trmnl_state.weather;
    assert(w && Array.isArray(w.perDay) && w.perDay.length === 2, 'expected two days: ' + JSON.stringify(w && w.perDay));
    assertEqual(w.perDay[0].peak, { atMin: 9 * 60, pct: 90 }, 'day 0 wettest hour');
    assertEqual(w.perDay[1].peak, { atMin: 17 * 60, pct: 95 }, 'day 1 wettest hour');
    assert(w.perDay[0].hours.length === 15, 'day 0 should carry 07:00-21:00: ' + JSON.stringify(w.perDay[0].hours));
    assertEqual(w.perDay[0].hours[11], { atMin: 18 * 60, pct: 75 }, 'the hours are the day\'s own');
  });

  test('a snapshot that outlived its own day is read as the day it describes', async () => {
    // Fetched at 23:30 and still being drawn at 04:00, which is under the
    // six hours that flags a forecast stale, so nothing else catches it.
    // The snapshot's first day is YESTERDAY by then. Indexed as though it
    // were today, its 09:00 rain becomes this morning's alert, an hour
    // that is both in the past and on the wrong day.
    const body = forecastDays([
      { date: D0, by: { 9: 90 } },
      { date: D1, by: { 16: 85 } },
    ]);
    const lateNight = Date.parse('2026-09-09T23:30:00Z');
    const first = await runTransform(netAt(body), lateNight).run(inputAt(lateNight, ON));
    const saved = JSON.parse(JSON.stringify(first.trmnl_state));
    assertEqual(saved.weather.date, D0, 'the snapshot should record which day it starts on');

    const smallHours = Date.parse('2026-09-10T04:00:00Z');
    const i = inputAt(smallHours, ON);
    i.trmnl.state = saved;
    const r = await runTransform(netAt(null), smallHours).run(i);
    assertEqual((r.data.service_alert || {}).text, 'SERVICE ALERT · Heavy Rain Expected at 16:00 (85%)',
      'the morning after should be warned about the morning after: ' + JSON.stringify(r.data.service_alert));
  });

  test('a snapshot older than the run it covers says nothing rather than something wrong', async () => {
    const body = forecastDays([{ date: D0, by: { 9: 90 } }, { date: D1, by: { 16: 85 } }]);
    const first = await runTransform(netAt(body), at(8)).run(inputAt(at(8), ON));
    const saved = JSON.parse(JSON.stringify(first.trmnl_state));

    const twoDaysOn = Date.parse('2026-09-11T08:00:00Z');
    const i = inputAt(twoDaysOn, ON);
    i.trmnl.state = saved;
    const r = await runTransform(netAt(null), twoDaysOn).run(i);
    assertEqual(r.data.service_alert, null,
      'a forecast that ran out raised an alert anyway: ' + JSON.stringify(r.data.service_alert));
  });
};
