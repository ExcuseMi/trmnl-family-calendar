// metro-plugin/src/transform.js — TRMNL Serverless entry point.
//
// Two data sources, chosen by the "Use Demo Data" boolean setting:
//   - demo (default): the same hardcoded dummy events this plugin has
//     always shown — no network, no config needed, safe fallback.
//   - config: a real calendar config pasted into the "Calendar Config"
//     setting, same JSON shape as this repo's calendar-config.json /
//     demo-config.json ({ calendars: [{url,name,rules}], people, timeZone,
//     rules }). Calendars are fetched as plain ICS and parsed with a small
//     hand-rolled parser (TRMNL Serverless only guarantees the built-in
//     HTTP client, not an ICS library — see topics/serverless.md).
//
// The config parser/rule engine (parseConfig/compileMatcher/
// applyCalendarRules below) is ported from plugin/src/transform.js's own
// — same config shape, same semantics, minus the pieces that plugin's
// flat agenda list needs but this metro map doesn't (multi-day windows,
// saved-state/calendar-down alerts, X-WR-CALNAME derived names). It
// supports: string-shorthand calendars (`"https://.../a.ics"` as well as
// `{url:...}`), non-JSON config text falling back to a newline-separated
// URL list, per-calendar `headers` (sent alongside the default
// User-Agent), match types any/all/exact/word/contains/regex/status/
// weekday/and/or, `rewrite`(+`rewriteFull`) and `rename` (defaults to
// true, EXCEPT on an any/all match where it defaults to false — a
// catch-all shouldn't silently rewrite every title unless asked), a
// top-level `rules` array applied before each calendar's own (a
// calendar's own rule wins when both assign a person to the same event),
// a `person` field that can be a list (multiple people on the same
// event become an interchange node, metro-plugin's own concept for a
// shared event), and an `everyonePerson` fallback (the first entry in
// `people[]`) for any event no rule assigns a person to.
//
// `people[].side` ("left"/"work" or "right"/"family") pins a person to a
// side of the map; without it the person a calendar named "Work" assigns
// goes left and everyone else right. `locale` in the config overrides the
// account locale for the string table and date names.
//
// Known, deliberate limitations of the config path (documented rather
// than silently wrong):
//   - RRULE support is a bounded subset, not full recurrence: only
//     FREQ=WEEKLY (with optional BYDAY/UNTIL) is evaluated against
//     today — the pattern real calendar exports actually use for
//     standing meetings/family routines, and what this repo's own
//     demo-config.json fixtures use throughout. DAILY/MONTHLY/YEARLY and
//     COUNT are not handled; an event using one of those only shows if
//     its DTSTART itself falls on today. A RECURRENCE-ID override IS
//     handled (it suppresses the master's occurrence on that date, so a
//     moved/cancelled single instance doesn't show up twice).
//   - No all-day lane — all-day events are skipped (this UI has no place
//     to put them yet).
//   - A rule's `desc` match only sees an event's DESCRIPTION when that
//     calendar opts in via `includeDescription: true` — off by default
//     since most calendars don't need it parsed/matched against.
//   - Weather needs a `lat_lon` setting; without one it stays a
//     placeholder in both modes.
//
// Both branches converge on the SAME buildMetro() — the rest of the
// pipeline (hour ticks, sub-spur detection, the "now" marker, people
// list) doesn't care whether events came from DUMMY_EVENTS or real ICS.

var DAY_START_MIN = 7 * 60;
var DAY_END_MIN = 21 * 60;
var SECONDARY_THRESHOLD_MIN = 30;
var TRACK_STEP = 10; // px between adjacent track offsets
var LINE_STYLES = ['solid', 'dashed', 'dotted', 'dashdot']; // per side, in track order — pattern (not just hue) tells lines apart on a 1-bit panel
// -40 steps: dark enough to read as a line on grayscale panels (the framework's scale runs 10 = darkest … 75 = lightest)
var HUE_CYCLE = ['blue-40', 'orange-40', 'purple-40', 'red-40', 'cyan-40', 'pink-40', 'lime-40', 'violet-40', 'yellow-40', 'green-40'];
var HUE_NAMES = ['blue', 'green', 'orange', 'purple', 'red', 'cyan', 'pink', 'lime', 'violet', 'yellow'];

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function timeLabel(min) {
  var h = Math.floor(min / 60) % 24;
  var m = min % 60;
  return pad2(h) + ':' + pad2(m);
}

// ---------------------------------------------------------------------
// i18n — every user-facing string the plugin renders, keyed by the first
// two letters of the TRMNL account locale (en, fr, es, de, nl; anything
// else falls back to English). Embedded here rather than in separate
// files because Serverless only ships this one file. Weekday and month
// names come from Intl with the full locale instead, so they cover any
// language Intl knows.
// ---------------------------------------------------------------------
var I18N = {
  en: { today: 'Today', more: '+{n} more', earlier: '+{n} earlier', rain_pct: '{n}% rain',
        clear: 'Clear', partly_cloudy: 'Partly cloudy', cloudy: 'Cloudy', foggy: 'Foggy', rain: 'Rain', snow: 'Snow', storms: 'Storms',
        rain_starts: 'Rain starts', rain_stops: 'Rain stops', sunrise: 'Sunrise', sunset: 'Sunset' },
  fr: { today: "Aujourd'hui", more: '+{n} de plus', earlier: '+{n} plus tôt', rain_pct: '{n} % de pluie',
        clear: 'Dégagé', partly_cloudy: 'Partiellement nuageux', cloudy: 'Nuageux', foggy: 'Brouillard', rain: 'Pluie', snow: 'Neige', storms: 'Orages',
        rain_starts: 'Début de la pluie', rain_stops: 'Fin de la pluie', sunrise: 'Lever du soleil', sunset: 'Coucher du soleil' },
  es: { today: 'Hoy', more: '+{n} más', earlier: '+{n} antes', rain_pct: '{n}% lluvia',
        clear: 'Despejado', partly_cloudy: 'Parcialmente nublado', cloudy: 'Nublado', foggy: 'Niebla', rain: 'Lluvia', snow: 'Nieve', storms: 'Tormentas',
        rain_starts: 'Empieza la lluvia', rain_stops: 'Para la lluvia', sunrise: 'Amanecer', sunset: 'Atardecer' },
  de: { today: 'Heute', more: '+{n} weitere', earlier: '+{n} früher', rain_pct: '{n} % Regen',
        clear: 'Klar', partly_cloudy: 'Teils bewölkt', cloudy: 'Bewölkt', foggy: 'Neblig', rain: 'Regen', snow: 'Schnee', storms: 'Gewitter',
        rain_starts: 'Regen beginnt', rain_stops: 'Regen endet', sunrise: 'Sonnenaufgang', sunset: 'Sonnenuntergang' },
  nl: { today: 'Vandaag', more: '+{n} meer', earlier: '+{n} eerder', rain_pct: '{n}% regen',
        clear: 'Helder', partly_cloudy: 'Half bewolkt', cloudy: 'Bewolkt', foggy: 'Mistig', rain: 'Regen', snow: 'Sneeuw', storms: 'Onweer',
        rain_starts: 'Regen begint', rain_stops: 'Regen stopt', sunrise: 'Zonsopgang', sunset: 'Zonsondergang' },
};

// The account locale ("nl", "fr-BE", "en-US", ...): the full tag drives
// Intl (dates, 12h/24h default); the two-letter language picks the string
// table.
function userLocale(input) {
  try {
    var l = input.trmnl.user.locale;
    return (typeof l === 'string' && l.trim()) ? l.trim().replace('_', '-') : 'en';
  } catch (e) {
    return 'en';
  }
}

function stringsFor(locale) {
  var lang = String(locale || 'en').slice(0, 2).toLowerCase();
  return I18N[lang] || I18N.en;
}

function tr(strings, key, n) {
  var v = strings[key] || I18N.en[key] || key;
  return n == null ? v : v.replace('{n}', String(n));
}

// "Tue 8 Sep" / "di 8 sep" / "mar. 8 sept." — header date, in the account's
// own language via Intl; falls back to English names if Intl rejects the tag.
function dateLabel(civil, locale) {
  if (!civil) return null;
  var d = new Date(Date.UTC(civil.y, civil.mo - 1, civil.d));
  try {
    return new Intl.DateTimeFormat(locale || 'en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
  } catch (e) {
    return new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
  }
}

// 12-hour clocks where the locale defaults to them (en-US, ...), unless the
// Time Format setting says otherwise.
function resolveHour12(timeFormatRaw, locale) {
  if (timeFormatRaw === '12h') return true;
  if (timeFormatRaw === '24h') return false;
  // only an explicit 12-hour region (en-US, en-CA, en-AU, ...) defaults to
  // 12h — a bare "en" account (the TRMNL default) keeps a 24-hour clock
  var region = /-([A-Za-z]{2})$/.exec(String(locale || ''));
  return !!region && ['US', 'CA', 'AU', 'NZ', 'PH', 'IN'].indexOf(region[1].toUpperCase()) !== -1;
}

// ---------------------------------------------------------------------
// Timezone helpers (Intl-based, no library) — same technique used by
// this project's other plugin (plugin/src/transform.js: fromEpoch /
// zonedTimeToUtc), ported compactly rather than re-derived.
// ---------------------------------------------------------------------

var _offsetFmtCache = {};
// Validates an IANA zone name before it's ever handed to
// getOffsetMinutes()/zonedTimeToUtc() — Intl throws on anything it
// doesn't recognize (notably Windows-style TZIDs like "Eastern Standard
// Time" that Outlook exports use instead of "America/New_York"), and an
// uncaught throw here would silently drop that entire calendar's events
// (swallowed by the per-calendar try/catch in buildFromConfig) with
// nothing pointing at why. Ported from plugin/src/transform.js's own
// safeZone — same fix, same reason.
var _safeZoneCache = {};
function safeZone(name) {
  if (!name) return null;
  if (name in _safeZoneCache) return _safeZoneCache[name];
  var ok;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    ok = name;
  } catch (e) {
    ok = null;
  }
  _safeZoneCache[name] = ok;
  return ok;
}

function offsetFormatter(tz) {
  if (!_offsetFmtCache[tz]) {
    _offsetFmtCache[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', timeZoneName: 'longOffset' });
  }
  return _offsetFmtCache[tz];
}

function getOffsetMinutes(epochMs, tz) {
  if (typeof tz === 'number') return tz; // already a raw UTC offset in minutes — the utc_offset fallback case
  if (!isFinite(epochMs)) return 0;
  var parts = offsetFormatter(tz).formatToParts(new Date(epochMs));
  var part = parts.filter(function (p) { return p.type === 'timeZoneName'; })[0];
  var v = part ? part.value : 'GMT';
  if (v === 'GMT' || v === 'UTC') return 0;
  var m = /GMT([+-])(\d{1,2}):(\d{2})/.exec(v);
  if (m) return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
  m = /GMT([+-])(\d{1,2})$/.exec(v);
  if (m) return (m[1] === '-' ? -1 : 1) * parseInt(m[2], 10) * 60;
  return 0;
}

var _civilFmtCache = {};
function civilFormatter(tz) {
  if (!_civilFmtCache[tz]) {
    _civilFmtCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }
  return _civilFmtCache[tz];
}

function fromEpoch(epochMs, tz) {
  if (typeof tz === 'number') {
    var dNum = new Date(epochMs + tz * 60000);
    return { y: dNum.getUTCFullYear(), mo: dNum.getUTCMonth() + 1, d: dNum.getUTCDate(), h: dNum.getUTCHours(), mi: dNum.getUTCMinutes(), s: dNum.getUTCSeconds() };
  }
  var parts = {};
  civilFormatter(tz).formatToParts(new Date(epochMs)).forEach(function (p) { parts[p.type] = p.value; });
  var h = +parts.hour;
  if (h === 24) h = 0;
  return { y: +parts.year, mo: +parts.month, d: +parts.day, h: h, mi: +parts.minute, s: +parts.second };
}

function zonedTimeToUtc(y, mo, d, h, mi, s, tz) {
  if (typeof tz === 'number') return Date.UTC(y, mo - 1, d, h, mi, s) - tz * 60000;
  var guess = Date.UTC(y, mo - 1, d, h, mi, s);
  var off1 = getOffsetMinutes(guess, tz);
  var t1 = guess - off1 * 60000;
  var off2 = getOffsetMinutes(t1, tz);
  return guess - off2 * 60000;
}

function cf(input, key) {
  try {
    var v = input.trmnl.plugin_settings.custom_fields_values[key];
    return v == null ? '' : String(v);
  } catch (e) {
    return '';
  }
}

// User's own TRMNL account timezone/offset — the fallback chain a config
// (or demo mode, which has no timeZone of its own at all) should use
// before ever defaulting to plain UTC, so "now" and any floating-time ICS
// events land on the viewer's actual local day instead of an arbitrary
// one. Ported from plugin/src/transform.js's userTz/userUtcOffsetMinutes/
// resolveTz — same fallback order: explicit override > account IANA zone
// > account UTC offset (seconds, per the merge-variable, hence /60) > UTC.
function userTz(input) {
  try {
    var tz = input.trmnl.user.time_zone_iana;
    return (typeof tz === 'string' && tz.trim()) ? tz.trim() : null;
  } catch (e) {
    return null;
  }
}

function userUtcOffsetMinutes(input) {
  try {
    var n = Number(input.trmnl.user.utc_offset);
    return isFinite(n) ? n / 60 : null;
  } catch (e) {
    return null;
  }
}

function resolveTz(explicitTzname, input) {
  var explicit = explicitTzname ? safeZone(explicitTzname) : null;
  if (explicit) return explicit;
  var accountTz = safeZone(userTz(input));
  if (accountTz) return accountTz;
  var offsetMin = userUtcOffsetMinutes(input);
  if (offsetMin !== null) return offsetMin; // numeric — getOffsetMinutes/fromEpoch/zonedTimeToUtc all handle this
  return 'UTC';
}

// ---------------------------------------------------------------------
// buildMetro: the shared pipeline. `events`: [{person, title, startMin,
// endMin, location, interchange_with}], startMin/endMin are minutes
// since midnight LOCAL time. `people`: [{key,name,side,hue,track_offset,
// line_width,line_style}].
//
// transform.js is a pure data normalizer — it does NOT decide where
// anything sits on the canvas, which events are "close enough" to become
// a sub-spur, or which same-event entries are duplicates across feeds.
// It can't: it has no idea what the real rendered canvas height is, how
// many pixels a wrapped multi-line title needs, or whether two calendars
// happened to both return the same event. Event items here are raw facts
// only (title/times/location/owner/side/track styling); shared.liquid's
// client-side script does the dedup pass, maps start_min/end_min to a
// real pixel Y against the canvas's own measured height, measures each
// label's ACTUAL rendered box before deciding the next one's position,
// and decides sub-spur grouping from the deduped, time-sorted list
// itself. See that file's own header comment for the full breakdown.
// ---------------------------------------------------------------------

function buildMetro(people, events, weatherMilestones, headerWeather, nowMin, windowLabel, allDayEvents, extra) {
  var peopleByKey = {};
  people.forEach(function (p) { peopleByKey[p.key] = p; });

  // A configured person with nothing on today's board gets no line and no
  // legend entry — otherwise every day carries every ever-configured
  // person's empty track, permanently eating spine width. Side/hue/style
  // stay whatever finalize() decided from the FULL registered set (so a
  // person's color/side identity doesn't shift day to day depending on
  // who else happens to be busy); only the per-side offset is repacked
  // against just today's active people, closing the gaps a filtered-out
  // person would otherwise leave.
  var activeKeys = {};
  events.forEach(function (ev) {
    if (!peopleByKey[ev.person]) return;
    activeKeys[ev.person] = true;
    (ev.interchange_with || []).forEach(function (key) { if (peopleByKey[key]) activeKeys[key] = true; });
  });
  (allDayEvents || []).forEach(function (ev) { if (peopleByKey[ev.person]) activeKeys[ev.person] = true; });
  people = people.filter(function (p) { return activeKeys[p.key]; });
  var sideIdx = { left: 0, right: 0 };
  people.forEach(function (p) { p.track_offset = TRACK_STEP * (++sideIdx[p.side]) * (p.side === 'left' ? -1 : 1); });
  peopleByKey = {};
  people.forEach(function (p) { peopleByKey[p.key] = p; });

  var items = [];

  events.forEach(function (ev) {
    var person = peopleByKey[ev.person];
    if (!person) return; // no resolved/known person for this event — drop it rather than guess
    var coOwners = (ev.interchange_with || []).filter(function (key) { return !!peopleByKey[key]; });
    items.push({
      type: 'event',
      _sortMin: ev.startMin,
      title: ev.title,
      start_min: ev.startMin,
      end_min: ev.endMin,
      location: ev.location || null,
      owner: person.key,
      co_owners: coOwners, // other person keys sharing this event (an interchange) — empty for a normal event
      side: person.side,
      hue: person.hue,
      track_width: person.line_width,
      track_style: person.line_style,
      track_offset: person.track_offset,
    });
  });

  var allDayOut = [];
  var seenAllDay = {};
  (allDayEvents || []).forEach(function (ev) {
    var person = peopleByKey[ev.person];
    if (!person) return;
    var key = ev.title + '|' + person.key;
    if (seenAllDay[key]) return;
    seenAllDay[key] = true;
    allDayOut.push({ title: ev.title, owner: person.key, hue: person.hue, track_style: person.line_style });
  });

  (weatherMilestones || []).forEach(function (w) {
    items.push({ type: 'weather', _sortMin: w.atMin, at_min: w.atMin, icon: w.icon, label: w.label });
  });

  ((extra && extra.sun) || []).forEach(function (m) {
    if (m.atMin == null) return;
    items.push({ type: 'sun', _sortMin: m.atMin, at_min: m.atMin, kind: m.kind, icon: WEATHER_ICON_BASE + (m.kind === 'sunrise' ? 'wi-sunrise.svg' : 'wi-sunset.svg'), label: tr((extra && extra.strings) || I18N.en, m.kind) });
  });

  items.sort(function (a, b) { return a._sortMin - b._sortMin; });
  items.forEach(function (item) { delete item._sortMin; });

  return {
    day_start_min: DAY_START_MIN,
    day_end_min: DAY_END_MIN,
    secondary_threshold_min: SECONDARY_THRESHOLD_MIN, // sub-spur grouping window — client decides sub-spurs, but this constant is config, not geometry
    window_label: windowLabel,
    date_label: (extra && extra.dateLabel) || null,
    now_min: nowMin != null ? nowMin : null, // minutes since local midnight; the client decides whether/where to draw it
    orientation: (extra && extra.orientation) || 'auto', // auto | horizontal | vertical — client picks for auto from the canvas aspect
    hour12: !!(extra && extra.hour12),
    i18n: (function (st) { return { today: tr(st, 'today'), more: tr(st, 'more'), earlier: tr(st, 'earlier'), rain_pct: tr(st, 'rain_pct') }; })((extra && extra.strings) || I18N.en),
    header_weather: headerWeather,
    legend: people,
    all_day: allDayOut,
    items: items,
  };
}

// ---------------------------------------------------------------------
// Demo path — unchanged hardcoded data.
// ---------------------------------------------------------------------

var DEMO_PEOPLE = [
  { key: 'work', name: 'Work', side: 'left', hue: 'black', track_offset: -10, line_width: 4, line_style: 'solid' },
  { key: 'alex', name: 'Alex', side: 'right', hue: 'orange-40', track_offset: 10, line_width: 3, line_style: 'solid' },
  { key: 'sam', name: 'Sam', side: 'right', hue: 'green-40', track_offset: 20, line_width: 3, line_style: 'dashed' },
  { key: 'kids', name: 'Kids', side: 'right', hue: 'purple-40', track_offset: 30, line_width: 3, line_style: 'dotted' },
];

// A deliberately busy day: back-to-back work meetings (lane stacking), a
// long workshop (a branch that rejoins the spine), two- and three-person
// interchanges, and an evening cluster on the family side.
var DEMO_EVENTS = [
  { person: 'alex', title: 'Yoga', startMin: 7 * 60 + 30, endMin: 8 * 60 + 30, location: 'Studio 9' },
  { person: 'work', title: 'Team Standup', startMin: 8 * 60, endMin: 8 * 60 + 15 },
  { person: 'kids', interchange_with: ['sam'], title: 'School Run', startMin: 8 * 60 + 15, endMin: 8 * 60 + 45 },
  { person: 'work', title: 'Quick Sync', startMin: 8 * 60 + 20, endMin: 8 * 60 + 35 },
  { person: 'work', title: 'Client Workshop', startMin: 9 * 60, endMin: 10 * 60 + 30, location: 'Room 4B' },
  { person: 'alex', title: 'Dentist', startMin: 10 * 60, endMin: 10 * 60 + 45 },
  { person: 'work', title: '1:1 with Priya', startMin: 11 * 60, endMin: 11 * 60 + 30 },
  { person: 'alex', interchange_with: ['work'], title: 'Lunch with Alex', startMin: 12 * 60, endMin: 13 * 60, location: 'The Garden Cafe' },
  { person: 'work', title: 'Design Review', startMin: 14 * 60, endMin: 15 * 60 },
  { person: 'work', title: 'Sprint Planning', startMin: 15 * 60 + 30, endMin: 17 * 60 },
  { person: 'kids', title: 'Pick Up Kids', startMin: 16 * 60, endMin: 16 * 60 + 20 },
  { person: 'sam', title: 'Swim Training', startMin: 16 * 60 + 30, endMin: 17 * 60 + 30, location: 'City Pool' },
  { person: 'kids', title: 'Piano Lesson', startMin: 17 * 60, endMin: 17 * 60 + 45 },
  { person: 'alex', title: 'Groceries', startMin: 17 * 60 + 30, endMin: 18 * 60 },
  { person: 'alex', interchange_with: ['sam', 'kids'], title: 'Family Dinner', startMin: 18 * 60 + 30, endMin: 19 * 60 + 30 },
  { person: 'sam', title: 'Book Club', startMin: 19 * 60 + 45, endMin: 21 * 60 },
];

var DEMO_ALLDAY = [
  { person: 'kids', title: 'School Holiday' },
];

var DEMO_WEATHER_MILESTONES = [
  { atMin: 15 * 60, icon: 'https://trmnl.com/images/plugins/weather/wi-rain.svg', label: 'Rain Starts 15:00' },
];

var DEMO_NOW_MIN = 11 * 60;
var DEMO_SUN = [{ kind: 'sunrise', atMin: 7 * 60 + 8 }, { kind: 'sunset', atMin: 19 * 60 + 58 }];

function demoWeather(strings) {
  return {
    header: { hi: 21, lo: 13, condition: tr(strings, 'rain'), rain_chance: 60, icon: WEATHER_ICON_BASE + 'wi-day-rain.svg' },
    milestones: [{ atMin: 15 * 60, icon: WEATHER_ICON_BASE + 'wi-rain.svg', label: tr(strings, 'rain_starts') + ' ' + timeLabel(15 * 60) }],
    sun: DEMO_SUN,
  };
}

function buildFromDemo(weather, nowMin, extra) {
  var strings = (extra && extra.strings) || I18N.en;
  var demo = demoWeather(strings);
  var w = weather || demo;
  return buildMetro(
    DEMO_PEOPLE, DEMO_EVENTS,
    w.milestones || [],
    w.header || demo.header,
    nowMin != null ? nowMin : DEMO_NOW_MIN,
    timeLabel(DAY_START_MIN) + ' ' + timeLabel(DAY_END_MIN),
    DEMO_ALLDAY,
    Object.assign({}, extra || {}, { sun: (w.sun && w.sun.length) ? w.sun : DEMO_SUN })
  );
}

// ---------------------------------------------------------------------
// Weather — Open-Meteo (no API key), same provider/icon convention as
// plugin/src/transform.js's own fetchSky(). Ported parseLatLon/weather
// code mapping rather than re-derived, for the same reason as the TZ
// helpers above: it's already correct, no need to risk a fresh bug.
// ---------------------------------------------------------------------

function parseLatLon(raw) {
  var parts = (raw || '').split(',');
  if (parts.length !== 2) return null;
  var lat = parseFloat(parts[0].trim()), lon = parseFloat(parts[1].trim());
  return (isFinite(lat) && isFinite(lon)) ? [lat, lon] : null;
}

var WEATHER_ICON_BASE = 'https://trmnl.com/images/plugins/weather/';
// code -> { label, icon } — condition text is intentionally coarse (a
// header summary, not a forecast detail); icons reuse the exact
// filenames confirmed present in plugin/src/transform.js's own ICON_FILE
// map, plus wi-day-sunny/wi-day-cloudy for the clear/cloudy default.
function weatherCodeInfo(code) {
  if (code === 0) return { key: 'clear', icon: 'wi-day-sunny.svg' };
  if (code === 1 || code === 2) return { key: 'partly_cloudy', icon: 'wi-day-cloudy.svg' };
  if (code === 3) return { key: 'cloudy', icon: 'wi-day-cloudy.svg' };
  if (code === 45 || code === 48) return { key: 'foggy', icon: 'wi-day-fog.svg' };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { key: 'rain', icon: 'wi-day-rain.svg' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { key: 'snow', icon: 'wi-day-snow.svg' };
  if (code >= 95) return { key: 'storms', icon: 'wi-day-thunderstorm.svg' };
  return { key: 'clear', icon: 'wi-day-sunny.svg' };
}

// "2026-09-08T07:05" (Open-Meteo local time) → minutes since midnight
function isoToMinutes(iso) {
  var m = /T(\d{2}):(\d{2})/.exec(iso || '');
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

var RAIN_THRESHOLD = 50; // %, precipitation_probability crossing this is what draws a "Rain Starts/Stops" milestone

async function fetchWeather(latLonRaw, tz, deadline, strings) {
  var latlon = parseLatLon(latLonRaw);
  if (!latlon) return null;
  strings = strings || I18N.en;
  try {
    var params = new URLSearchParams({
      latitude: String(latlon[0]), longitude: String(latlon[1]),
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode,sunrise,sunset',
      hourly: 'precipitation_probability',
      timezone: tz, forecast_days: '1',
    });
    var budget = deadline - Date.now();
    if (budget <= 0) return null;
    var resp = await fetchWithTimeout('https://api.open-meteo.com/v1/forecast?' + params.toString(), Math.min(budget, 3000));
    if (!resp.ok) return null;
    var body = await resp.json();
    var daily = body.daily || {};
    var info = weatherCodeInfo((daily.weathercode || [])[0]);

    var header = {
      hi: Math.round((daily.temperature_2m_max || [])[0]),
      lo: Math.round((daily.temperature_2m_min || [])[0]),
      condition: tr(strings, info.key),
      rain_chance: Math.round((daily.precipitation_probability_max || [])[0]),
      icon: WEATHER_ICON_BASE + info.icon,
    };
    var sun = [];
    var sr = isoToMinutes((daily.sunrise || [])[0]), ss = isoToMinutes((daily.sunset || [])[0]);
    if (sr != null) sun.push({ kind: 'sunrise', atMin: sr });
    if (ss != null) sun.push({ kind: 'sunset', atMin: ss });

    // Milestones: first threshold up-crossing -> "Rain Starts", the next
    // down-crossing after it -> "Rain Stops" — same idea as the dummy
    // data's illustrative example, just driven from real hourly
    // probabilities within the visible window.
    var hourly = body.hourly || {};
    var times = hourly.time || [];
    var probs = hourly.precipitation_probability || [];
    var milestones = [];
    var wasAbove = false;
    for (var i = 0; i < times.length && milestones.length < 2; i++) {
      var hourMatch = /T(\d{2}):/.exec(times[i]);
      if (!hourMatch) continue;
      var hour = +hourMatch[1];
      var atMin = hour * 60;
      if (atMin < DAY_START_MIN || atMin > DAY_END_MIN) continue;
      var above = (probs[i] || 0) >= RAIN_THRESHOLD;
      if (above && !wasAbove) {
        milestones.push({ atMin: atMin, icon: WEATHER_ICON_BASE + 'wi-rain.svg', label: tr(strings, 'rain_starts') + ' ' + pad2(hour) + ':00' });
      } else if (!above && wasAbove) {
        milestones.push({ atMin: atMin, icon: WEATHER_ICON_BASE + 'wi-day-sunny.svg', label: tr(strings, 'rain_stops') + ' ' + pad2(hour) + ':00' });
      }
      wasAbove = above;
    }

    return { header: header, milestones: milestones, sun: sun };
  } catch (e) {
    return null;
  }
}

async function fetchWithTimeout(url, ms, extraHeaders) {
  var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var headers = Object.assign({ 'User-Agent': 'TRMNL-Metro-Calendar' }, extraHeaders || {});
  var timer = controller ? setTimeout(function () { controller.abort(); }, ms) : null;
  try {
    var resp = await fetch(url, controller ? { signal: controller.signal, headers: headers } : { headers: headers });
    return resp;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Unfold RFC5545 continuation lines (a line starting with a space/tab
// continues the previous one) and split into logical lines.
function unfoldIcs(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeIcsText(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// Parses a raw DTSTART/DTEND value+params into {y,mo,d,h,mi,isAllDay},
// converted to civil LOCAL (fallbackTz) date/time — this is the "what
// date/time does this property mean, in our target zone" step, kept
// separate from "does that land on today" so the same parsed value can
// be reused for both a direct hit and the weekly-recurrence check below.
function parseIcsDateTime(paramsStr, value, fallbackTz) {
  if (/VALUE=DATE\b/i.test(paramsStr) || /^\d{8}$/.test(value)) {
    var dm = /^(\d{4})(\d{2})(\d{2})/.exec(value);
    return dm ? { isAllDay: true, y: +dm[1], mo: +dm[2], d: +dm[3] } : { isAllDay: true };
  }

  var m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!m) return null;
  var evY = +m[1], evMo = +m[2], evD = +m[3], evH = +m[4], evMi = +m[5], evS = +m[6], isUtc = !!m[7];

  var tzidMatch = /TZID=([^:;]+)/.exec(paramsStr);
  var epochMs;
  if (isUtc) {
    epochMs = Date.UTC(evY, evMo - 1, evD, evH, evMi, evS);
  } else {
    var eventTz = (tzidMatch && safeZone(tzidMatch[1])) || fallbackTz;
    epochMs = zonedTimeToUtc(evY, evMo, evD, evH, evMi, evS, eventTz);
  }
  var c = fromEpoch(epochMs, fallbackTz);
  c.isAllDay = false;
  return c;
}

// Bounded RRULE subset: FREQ=WEEKLY only (the pattern real calendar
// exports use constantly for standing meetings/family routines), with
// optional BYDAY and UNTIL. Anything else (DAILY/MONTHLY/YEARLY, COUNT,
// ...) is intentionally not handled — see the file header. RECURRENCE-ID
// overrides ARE handled, in parseIcs below. Returns true if `today`
// (y/mo/d, weekday 0=Mon..6=Sun) is an occurrence.
var WD_NAMES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
function weeklyRruleMatchesToday(rruleValue, dtstartCivil, todayY, todayMo, todayD, todayWeekday, tz) {
  var parts = {};
  rruleValue.split(';').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i > 0) parts[kv.slice(0, i)] = kv.slice(i + 1);
  });
  if ((parts.FREQ || '').toUpperCase() !== 'WEEKLY') return false;

  var todayOrdinal = Date.UTC(todayY, todayMo - 1, todayD);
  var startOrdinal = Date.UTC(dtstartCivil.y, dtstartCivil.mo - 1, dtstartCivil.d);
  if (todayOrdinal < startOrdinal) return false; // recurrence hasn't started yet

  if (parts.UNTIL) {
    var um = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL);
    if (um && todayOrdinal > Date.UTC(+um[1], +um[2] - 1, +um[3])) return false;
  }

  if (parts.BYDAY) {
    var days = parts.BYDAY.split(',');
    return days.indexOf(WD_NAMES[todayWeekday]) !== -1;
  }
  // No BYDAY: recurs weekly on DTSTART's own weekday.
  var startWeekday = (new Date(startOrdinal).getUTCDay() + 6) % 7; // 0=Mon
  return startWeekday === todayWeekday;
}

// `includeDescription` (a per-calendar config flag, off by default) is the
// only thing that makes parseIcs pay for DESCRIPTION at all — it's usually
// a large multi-line blob and most calendars' rules never need it.
//
// Returns { timed, allDay } — allDay entries carry no time-of-day (they're
// {title, desc, status} only): only whole-day coverage decides whether one
// applies today, matched to the day's own civil date, not a UTC one.
function parseIcs(text, tz, today, includeDescription) {
  var lines = unfoldIcs(text);
  var raw = [];
  var cur = null;
  lines.forEach(function (line) {
    if (line === 'BEGIN:VEVENT') { cur = {}; return; }
    if (line === 'END:VEVENT') { if (cur) raw.push(cur); cur = null; return; }
    if (!cur) return;
    var idx = line.indexOf(':');
    if (idx < 0) return;
    var keyPart = line.slice(0, idx);
    var value = line.slice(idx + 1);
    var key = keyPart.split(';')[0];
    var params = keyPart.slice(key.length);
    if (key === 'DTSTART') cur.dtstart = parseIcsDateTime(params, value, tz);
    else if (key === 'DTEND') cur.dtend = parseIcsDateTime(params, value, tz);
    else if (key === 'SUMMARY') cur.title = unescapeIcsText(value);
    else if (key === 'LOCATION') cur.location = unescapeIcsText(value);
    else if (key === 'DESCRIPTION' && includeDescription) cur.desc = unescapeIcsText(value);
    else if (key === 'STATUS') cur.status = value.trim().toUpperCase();
    else if (key === 'RRULE') cur.rrule = value;
    else if (key === 'UID') cur.uid = value.trim();
    else if (key === 'RECURRENCE-ID') cur.recurrenceId = parseIcsDateTime(params, value, tz);
  });

  var todayWeekday = (new Date(Date.UTC(today.y, today.mo - 1, today.d)).getUTCDay() + 6) % 7;
  var todayKey = today.y + '-' + today.mo + '-' + today.d;
  var todayOrdinal = Date.UTC(today.y, today.mo - 1, today.d);
  var DAY_MS = 24 * 60 * 60 * 1000;

  // A RECURRENCE-ID override (same UID, own DTSTART/SUMMARY) REPLACES the
  // master's occurrence on that specific date — without this, an edited
  // or moved single instance of a recurring event shows up twice: once
  // from the master's own weekly-RRULE match, once from the override's
  // own direct-hit DTSTART. Suppress the master on any date an override
  // for its UID targets, keyed by civil date (not exact minute) since
  // that's what RECURRENCE-ID identifies — "which occurrence", not "what
  // time it now is". Applies equally to timed and all-day masters.
  var overriddenDates = {};
  raw.forEach(function (ev) {
    if (!ev.uid || !ev.recurrenceId) return;
    overriddenDates[ev.uid + '|' + ev.recurrenceId.y + '-' + ev.recurrenceId.mo + '-' + ev.recurrenceId.d] = true;
  });

  var out = [], allDay = [];
  raw.forEach(function (ev) {
    if (!ev.title || !ev.dtstart) return;

    if (ev.dtstart.isAllDay) {
      // Whole-day coverage: DTEND is EXCLUSIVE per RFC5545 (a single-day
      // all-day event has DTEND the day AFTER DTSTART) — no DTEND means a
      // single day. A bounded weekly RRULE only applies to a single-day
      // all-day event; a genuine multi-day span (a real vacation/trip) has
      // no recurrence support here, same "bounded subset" limit as timed.
      var startOrd = Date.UTC(ev.dtstart.y, ev.dtstart.mo - 1, ev.dtstart.d);
      var endOrd = (ev.dtend && ev.dtend.isAllDay) ? Date.UTC(ev.dtend.y, ev.dtend.mo - 1, ev.dtend.d) : startOrd + DAY_MS;
      var isDirectSpan = todayOrdinal >= startOrd && todayOrdinal < endOrd;
      var isWeeklySpan = !isDirectSpan && ev.rrule && (endOrd - startOrd) <= DAY_MS
        && weeklyRruleMatchesToday(ev.rrule, ev.dtstart, today.y, today.mo, today.d, todayWeekday, tz);
      if (!isDirectSpan && !isWeeklySpan) return;
      if (!ev.recurrenceId && ev.uid && overriddenDates[ev.uid + '|' + todayKey]) return;
      allDay.push({ title: ev.title, desc: ev.desc || '', status: ev.status || '' });
      return;
    }

    var durationMin = null;
    if (ev.dtend && !ev.dtend.isAllDay) {
      durationMin = (ev.dtend.h * 60 + ev.dtend.mi) - (ev.dtstart.h * 60 + ev.dtstart.mi);
      if (durationMin < 0) durationMin += 24 * 60; // crossed midnight in local time — approximate
    }

    var isDirectHit = ev.dtstart.y === today.y && ev.dtstart.mo === today.mo && ev.dtstart.d === today.d;
    var isWeeklyHit = !isDirectHit && ev.rrule && weeklyRruleMatchesToday(ev.rrule, ev.dtstart, today.y, today.mo, today.d, todayWeekday, tz);
    if (!isDirectHit && !isWeeklyHit) return;

    if (!ev.recurrenceId && ev.uid && overriddenDates[ev.uid + '|' + todayKey]) return; // superseded by today's override

    var startMin = ev.dtstart.h * 60 + ev.dtstart.mi; // same time-of-day, whichever day it landed on
    out.push({
      title: ev.title,
      desc: ev.desc || '',
      status: ev.status || '',
      location: ev.location,
      startMin: startMin,
      endMin: durationMin != null ? startMin + durationMin : null,
    });
  });
  return { timed: out, allDay: allDay };
}

// ---------------------------------------------------------------------
// Rule engine — ported from plugin/src/transform.js's own compileMatcher/
// compileRule/compileRuleList/parseConfig/applyCalendarRules (same config
// shape, same semantics). See the file header for the feature summary.
// ---------------------------------------------------------------------

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A `person` field can be one name or a list — always normalized to a
// non-empty array (or null if nothing usable was given).
function normalizeNameList(raw) {
  var list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [raw] : []);
  var names = list.filter(function (n) { return typeof n === 'string' && n.trim(); }).map(function (n) { return n.trim(); });
  return names.length ? names : null;
}

function compileMatcher(spec) {
  if (!spec || typeof spec !== 'object') return null;
  if (spec.type === 'any' || spec.type === 'all') {
    return { rx: /[\s\S]*/i, test: function () { return true; } };
  }
  if (spec.type === 'and' || spec.type === 'or') {
    var subs = (Array.isArray(spec.matchers) ? spec.matchers : []).map(compileMatcher).filter(Boolean);
    if (!subs.length) return null;
    var isAnd = spec.type === 'and';
    return { rx: null, test: function (ctx) {
      return isAnd ? subs.every(function (m) { return m.test(ctx); }) : subs.some(function (m) { return m.test(ctx); });
    } };
  }
  // Negation — the only way to express "everything except X" without this
  // used to be a regex negative lookahead, which meant hand-writing
  // backslash-heavy JSON (\\b) that's easy to mis-escape when copying
  // through a browser field. {"type":"not","matcher":{...}} covers the
  // common case with zero backslashes.
  if (spec.type === 'not') {
    var negated = compileMatcher(spec.matcher);
    if (!negated) return null;
    return { rx: null, test: function (ctx) { return !negated.test(ctx); } };
  }
  if (spec.type === 'status') {
    var want = typeof spec.value === 'string' ? spec.value.trim().toUpperCase() : '';
    if (!want) return null;
    return { rx: null, test: function (ctx) { return ctx.status === want; } };
  }
  if (spec.type === 'weekday') {
    var rawDays = Array.isArray(spec.value) ? spec.value : [spec.value];
    var wanted = {};
    var any = false;
    rawDays.forEach(function (v) {
      if (typeof v !== 'string') return;
      var idx = WD_NAMES.indexOf(v.trim().toUpperCase().slice(0, 2));
      if (idx !== -1) { wanted[idx] = true; any = true; }
    });
    if (!any) return null;
    return { rx: null, test: function (ctx) { return ctx.weekday !== null && ctx.weekday !== undefined && !!wanted[ctx.weekday]; } };
  }
  if (typeof spec.value !== 'string') return null;
  var p = spec.value.trim();
  if (!p) return null;
  var rx;
  if (spec.type === 'regex') {
    try { rx = new RegExp(p, 'i'); } catch (e) { return null; }
  } else if (spec.type === 'contains') {
    rx = new RegExp(escapeRegExp(p), 'i');
  } else if (spec.type === 'exact') {
    rx = new RegExp('^' + escapeRegExp(p) + '$', 'i');
  } else {
    rx = new RegExp('\\b' + escapeRegExp(p) + '\\b', 'i');
  }
  return { rx: rx, test: function (ctx) { return rx.test(ctx.title) || (!!ctx.desc && rx.test(ctx.desc)); } };
}

function compileRule(spec) {
  if (!spec || typeof spec !== 'object') return null;
  var m = compileMatcher(spec.match);
  if (!m) return null;
  var person = normalizeNameList(spec.person);
  var allDay = spec.allDay === true;
  var hide = spec.hide === true;
  var rewrite = typeof spec.rewrite === 'string' ? spec.rewrite : null;
  var rewriteFull = spec.rewriteFull === true;
  if (!person && !allDay && !hide && rewrite === null) return null; // a no-op rule is dropped, not kept
  var isAnyMatch = spec.match && (spec.match.type === 'any' || spec.match.type === 'all');
  // rename defaults to true (a rule assigning a person also renames the
  // title to that person, historically the common case) EXCEPT on an
  // any/all match, where there's no specific text to rename and silently
  // overwriting every title would be surprising — there it defaults to
  // false and must be opted into.
  var rename = person ? (isAnyMatch ? spec.rename === true : spec.rename !== false) : false;
  return { match: m.test, rx: m.rx, person: person, allDay: allDay, hide: hide, rename: rename, rewrite: rewrite, rewriteFull: rewriteFull };
}

function compileRuleList(raw) {
  var rules = [];
  (Array.isArray(raw) ? raw : []).forEach(function (spec) {
    var compiled = compileRule(spec);
    if (compiled) rules.push(compiled);
  });
  return rules;
}

// Parses the "Calendar Config (JSON)" setting text into
// { calendars, people, timeZone, globalRules, everyonePerson }. Never
// throws: invalid JSON falls back to treating the text as a plain
// newline-separated list of calendar URLs (a low-friction path for
// someone who just wants to paste ICS links with no rules at all).
function parseConfig(raw) {
  var data = null;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      data = JSON.parse(raw);
    } catch (e) {
      data = { calendars: raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean) };
    }
  }
  if (!data || typeof data !== 'object') data = {};

  var timeZone = typeof data.timeZone === 'string' && data.timeZone.trim() ? data.timeZone.trim() : null;

  var people = {};
  var everyonePerson = null;
  (Array.isArray(data.people) ? data.people : []).forEach(function (item) {
    if (!item || typeof item !== 'object') return;
    var name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) return;
    var color = typeof item.color === 'string' ? item.color.trim().toLowerCase() : '';
    var badgeSrc = typeof item.badge === 'string' && item.badge.trim() ? item.badge.trim() : name;
    var badge = Array.from(badgeSrc)[0].toUpperCase(); // Array.from, not [0] — keeps a full surrogate pair (emoji) intact
    // optional explicit side of the map: "left"/"work" or "right"/"family"
    var sideRaw = typeof item.side === 'string' ? item.side.trim().toLowerCase() : '';
    var side = (sideRaw === 'left' || sideRaw === 'work') ? 'left' : (sideRaw === 'right' || sideRaw === 'family') ? 'right' : null;
    if (everyonePerson === null) everyonePerson = name;
    people[name.toLowerCase()] = { name: name, color: color, badge: badge, side: side };
  });

  var globalRules = compileRuleList(data.rules);

  var calendars = [];
  (Array.isArray(data.calendars) ? data.calendars : []).forEach(function (rawItem) {
    var item = typeof rawItem === 'string' ? { url: rawItem } : rawItem;
    if (!item || typeof item !== 'object' || typeof item.url !== 'string' || !item.url.trim()) return;
    var name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : null;
    var rules = compileRuleList(item.rules);
    var headers = {};
    if (item.headers && typeof item.headers === 'object') {
      Object.keys(item.headers).forEach(function (k) {
        if (typeof item.headers[k] === 'string') headers[k] = item.headers[k];
      });
    }
    var includeDescription = item.includeDescription === true;
    calendars.push({ name: name, url: item.url.trim(), rules: rules, headers: headers, includeDescription: includeDescription });
  });

  return { calendars: calendars, people: people, timeZone: timeZone, globalRules: globalRules, everyonePerson: everyonePerson };
}

// A replace that never double-matches an empty-string-capable pattern
// (like the regex "any"/"all" compile to, or a user's own ".*") — a plain
// global replace on such a pattern matches the real text once, then the
// empty string right after it, turning "Ward" into "WardWard".
function replaceMatch(text, rx, replacement) {
  if (rx.test('')) return text.replace(new RegExp(rx.source, rx.flags.replace('g', '')), replacement);
  return text.replace(new RegExp(rx.source, rx.flags.indexOf('g') !== -1 ? rx.flags : rx.flags + 'g'), replacement);
}

// Applies global rules then this calendar's own (cumulatively, in order —
// a later matching rule's person/rewrite overrides an earlier one's,
// and a calendar's own rule is listed after globals so it wins ties).
// Returns { title, personNames, allDay, hide }; personNames is an array
// (possibly with more than one name — a multi-person rule becomes an
// interchange event) or null if nothing assigned one.
function applyCalendarRules(title, desc, status, weekday, cal, globalRules, everyonePerson) {
  var originalTitle = title;
  var ctx = { title: originalTitle, desc: desc || '', status: status || '', weekday: (weekday === undefined || weekday === null) ? null : weekday };
  var personNames = null;
  var renameRule = null;
  var rewriteRule = null;
  var allDay = false;
  var hide = false;
  globalRules.concat(cal.rules).forEach(function (rule) {
    if (!rule.match(ctx)) return;
    if (rule.hide) hide = true;
    if (rule.allDay) allDay = true;
    if (rule.person) {
      personNames = rule.person;
      renameRule = rule.rename ? rule : null;
    }
    if (rule.rewrite !== null) rewriteRule = rule;
  });

  var finalTitle = originalTitle;
  if (rewriteRule) {
    finalTitle = rewriteRule.rewriteFull ? rewriteRule.rewrite
      : rewriteRule.rx ? replaceMatch(originalTitle, rewriteRule.rx, rewriteRule.rewrite)
      : originalTitle;
  } else if (renameRule && renameRule.rx) {
    finalTitle = replaceMatch(originalTitle, renameRule.rx, renameRule.person.join(' & '));
  }
  // NOTE: everyonePerson is deliberately NOT applied here — a calendar's
  // own name is meant to be the fallback for one that has no rule
  // assigning anyone (see buildFromConfig), and everyonePerson is the
  // last resort after THAT. Applying it here unconditionally used to make
  // the calendar-name fallback unreachable dead code: with people[] set,
  // EVERY unnamed-by-rule event (i.e. every event from any calendar with
  // no rules at all, or whose rules didn't match this one) landed on
  // everyonePerson instead of that calendar's own name — so calendars
  // literally named after a person (a common real setup: one calendar per
  // family member, no rules needed) never got their events attributed to
  // themselves at all.

  return { title: finalTitle, personNames: personNames, allDay: allDay, hide: hide };
}

// Converts a config person's `color` (a plain framework hue name like
// "blue", or "gray-NN"/"black"/"white") into the "hue-65"-style token
// this plugin's tracks/nodes use ("hue-40" style) — null (fall back to the auto HUE_CYCLE)
// if unset or not one of those.
function hueTokenForColor(color) {
  if (!color) return null;
  if (HUE_NAMES.indexOf(color) !== -1) return color + '-40';
  if (color === 'black' || color === 'white' || /^gray-\d+$/.test(color)) return color;
  return null;
}

// A small, growable people/track registry — seeded from parsed.people,
// but calendars with no person-assigning rule (e.g. a shared "Family"
// calendar) fall back to using the CALENDAR's own name as an implicit
// person, added here the first time it's encountered, so those events
// still get a track instead of silently vanishing.
//
// Which SIDE each person ends up on is decided once, in finalize() —
// called after every calendar has been fetched and every event tallied —
// not by any calendar's name. A person's `side` in config (if set) is
// honored; everyone else is balanced across the two sides by their own
// event count (heaviest first, each going to whichever side is currently
// lighter), so the split reflects the actual day's data instead of a
// fixed "Work calendar" convention.
function makePeopleRegistry(parsed) {
  var order = [];
  var byName = {};
  var counts = {};
  var keyIdx = 0;

  function add(name, weight) {
    if (!byName[name]) {
      byName[name] = { key: 'p' + (keyIdx++), name: name, side: null, hue: null, track_offset: null, line_width: null, line_style: null, initial: null };
      order.push(name);
      counts[name] = 0;
    }
    counts[name] += (weight == null ? 1 : weight);
    return byName[name];
  }

  function explicitSide(name) {
    var c = parsed.people[name.toLowerCase()];
    return (c && (c.side === 'left' || c.side === 'right')) ? c.side : null;
  }

  function finalize() {
    var loadLeft = 0, loadRight = 0;
    var decided = {};
    order.forEach(function (name) {
      var s = explicitSide(name);
      if (s) { decided[name] = s; if (s === 'left') loadLeft += counts[name]; else loadRight += counts[name]; }
    });
    order.filter(function (name) { return !decided[name]; })
      .sort(function (a, b) { return counts[b] - counts[a]; }) // heaviest first — best balance from a greedy assignment
      .forEach(function (name) {
        var s = loadLeft <= loadRight ? 'left' : 'right';
        decided[name] = s;
        if (s === 'left') loadLeft += counts[name]; else loadRight += counts[name];
      });

    var sideIdx = { left: 0, right: 0 };
    order.forEach(function (name, i) {
      var p = byName[name], side = decided[name], idx = sideIdx[side]++;
      var configured = parsed.people[name.toLowerCase()];
      p.side = side;
      p.track_offset = TRACK_STEP * (idx + 1) * (side === 'left' ? -1 : 1);
      // the side's anchor line (first-placed, whichever side that ends up
      // being) is black/bold; everyone else cycles hues in registration order
      p.hue = (configured && hueTokenForColor(configured.color)) || (side === 'left' && idx === 0 ? 'black' : HUE_CYCLE[i % HUE_CYCLE.length]);
      p.line_width = (side === 'left' && idx === 0) ? 4 : 3;
      p.line_style = LINE_STYLES[idx % LINE_STYLES.length];
      p.initial = (configured && configured.badge) || Array.from(name)[0].toUpperCase();
    });
  }

  return {
    add: add,
    byName: byName,
    finalize: finalize,
    all: function () {
      var arr = order.map(function (n) { return byName[n]; });
      return arr.filter(function (p) { return p.side === 'left'; }).concat(arr.filter(function (p) { return p.side === 'right'; }));
    },
  };
}

async function buildFromConfig(input, parsed, weather, extra) {
  var tz = resolveTz(parsed.timeZone, input); // config.timeZone > account time_zone_iana > account utc_offset > UTC
  var nowTs = (input.trmnl && input.trmnl.system && input.trmnl.system.timestamp_utc) || Math.floor(Date.now() / 1000);
  var today = fromEpoch(nowTs * 1000, tz);
  var nowMin = today.h * 60 + today.mi;
  var todayWeekday = (new Date(Date.UTC(today.y, today.mo - 1, today.d)).getUTCDay() + 6) % 7;

  var registry = makePeopleRegistry(parsed);
  // Every explicitly-configured person is registered up front, even with
  // zero events today, so they still get a line and (if they set an
  // explicit side) it's honored regardless of load.
  Object.keys(parsed.people).forEach(function (key) { registry.add(parsed.people[key].name, 0); });

  var DEADLINE_MS = 4200;
  var deadline = Date.now() + DEADLINE_MS;
  var events = [];
  var allDayEvents = [];

  await Promise.all((parsed.calendars || []).map(async function (cal) {
    var url = cal.url;
    if (url.indexOf('webcal://') === 0) url = 'https://' + url.slice('webcal://'.length);
    try {
      var budget = deadline - Date.now();
      if (budget <= 0) return;
      var resp = await fetchWithTimeout(url, Math.min(budget, 4000), cal.headers);
      if (!resp.ok) return;
      var text = await resp.text();
      var parsedIcs = parseIcs(text, tz, today, cal.includeDescription);
      parsedIcs.timed.forEach(function (ev) {
        var resolved = applyCalendarRules(ev.title, ev.desc, ev.status, todayWeekday, cal, parsed.globalRules, parsed.everyonePerson);
        if (resolved.hide) return;
        var personNames = resolved.personNames || (cal.name ? [cal.name] : null) || (parsed.everyonePerson ? [parsed.everyonePerson] : null);
        if (!personNames || !personNames.length) return;
        // A rule can mark an otherwise-timed event allDay (e.g. a calendar
        // that lists "Public Holiday" as a timed 00:00 entry) — that now
        // routes into the all-day strip instead of the timeline, same as a
        // genuine ICS all-day entry, rather than being silently dropped.
        if (resolved.allDay) { allDayEvents.push({ person: registry.add(personNames[0], 0.25).key, title: resolved.title }); return; }
        var primary = registry.add(personNames[0], 1);
        // a co-owner on a shared/interchange event gets a smaller weight
        // toward side balancing — they have a ring there too, but it's not
        // "their" event the way the primary owner's is
        var interchangeWith = personNames.slice(1).map(function (n) { return registry.add(n, 0.5).key; });
        events.push({
          person: primary.key,
          interchange_with: interchangeWith.length ? interchangeWith : undefined,
          title: resolved.title,
          startMin: ev.startMin,
          endMin: ev.endMin != null ? ev.endMin : ev.startMin + 30,
          location: ev.location || null,
        });
      });
      parsedIcs.allDay.forEach(function (ev) {
        var resolved = applyCalendarRules(ev.title, ev.desc, ev.status, todayWeekday, cal, parsed.globalRules, parsed.everyonePerson);
        if (resolved.hide) return;
        var personNames = resolved.personNames || (cal.name ? [cal.name] : null) || (parsed.everyonePerson ? [parsed.everyonePerson] : null);
        if (!personNames || !personNames.length) return;
        allDayEvents.push({ person: registry.add(personNames[0], 0.25).key, title: resolved.title });
      });
    } catch (e) {
      // one calendar failing shouldn't blank the whole render — skip it
    }
  }));

  events.sort(function (a, b) { return a.startMin - b.startMin; });
  registry.finalize(); // every calendar is in and every event tallied — decide sides now

  return buildMetro(
    registry.all(), events,
    (weather && weather.milestones) || [],
    (weather && weather.header) || { hi: null, lo: null, condition: null, rain_chance: null },
    nowMin,
    timeLabel(DAY_START_MIN) + ' ' + timeLabel(DAY_END_MIN),
    allDayEvents,
    Object.assign({}, extra, { dateLabel: dateLabel(today, extra.locale), sun: (weather && weather.sun) || [] })
  );
}

// ---------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------

async function run(input) {
  var useDemoRaw = cf(input, 'use_demo_data').trim().toLowerCase();
  var useDemo = useDemoRaw !== 'false'; // default true (demo) unless explicitly turned off
  var configRaw = cf(input, 'config_json').trim();
  var latLonRaw = cf(input, 'lat_lon').trim();
  var orientationRaw = cf(input, 'orientation').trim().toLowerCase();
  var orientation = (orientationRaw === 'horizontal' || orientationRaw === 'vertical') ? orientationRaw : 'auto';
  var locale = (function () {
    // a config timeZone/locale is only known after parsing; the account locale is the default
    try { var d = JSON.parse(configRaw); if (d && typeof d.locale === 'string' && d.locale.trim()) return d.locale.trim(); } catch (e) {}
    return userLocale(input);
  })();
  var strings = stringsFor(locale);
  var hour12 = resolveHour12(cf(input, 'time_format').trim().toLowerCase(), locale);
  var extra = { orientation: orientation, locale: locale, strings: strings, hour12: hour12 };

  var deadline = Date.now() + 4200;

  if (useDemo || !configRaw) {
    // Demo mode has no config.timeZone of its own — resolve straight to
    // the account's own zone/offset (still falling back to UTC) so the
    // "now" marker and any real weather fetch land on the viewer's
    // actual local day, not an arbitrary fixed one.
    var demoTz = resolveTz(null, input);
    var demoNowMin = null;
    var demoDate = null;
    try {
      var nowTsDemo = (input.trmnl && input.trmnl.system && input.trmnl.system.timestamp_utc) || Math.floor(Date.now() / 1000);
      var demoToday = fromEpoch(nowTsDemo * 1000, demoTz);
      demoNowMin = demoToday.h * 60 + demoToday.mi;
      demoDate = dateLabel(demoToday, locale);
    } catch (e) { /* keep the illustrative fixed DEMO_NOW_MIN on failure */ }
    var liveWeather = latLonRaw ? await fetchWeather(latLonRaw, typeof demoTz === 'string' ? demoTz : 'GMT', deadline, strings) : null;
    return { metro: buildFromDemo(liveWeather, demoNowMin, Object.assign({ dateLabel: demoDate }, extra)) };
  }

  var parsed = parseConfig(configRaw); // never throws — falls back to a bare URL list on invalid JSON
  if (!parsed.calendars.length) {
    return { metro: buildFromDemo(null, null, extra) }; // nothing usable in the config — degrade to demo rather than error the render
  }

  try {
    var configTz = resolveTz(parsed.timeZone, input);
    var weather = latLonRaw ? await fetchWeather(latLonRaw, typeof configTz === 'string' ? configTz : 'GMT', deadline, strings) : null;
    return { metro: await buildFromConfig(input, parsed, weather, extra) };
  } catch (e) {
    return { metro: buildFromDemo(null, null, extra) };
  }
}

if (typeof module !== 'undefined') module.exports = run;
