// metro-plugin/src/transform.js — TRMNL Serverless entry point.
//
// Two data sources, chosen by the "Use Demo Data" boolean setting:
//   - demo (default): the same hardcoded dummy events this plugin has
//     always shown — no network, no config needed, safe fallback.
//   - config: a real calendar config pasted into the "Calendar Config"
//     setting, same JSON shape as this repo's calendar-config.json /
//     demo-config.json ({ calendars: [{url,name,rules}], lines, timeZone,
//     rules }). Calendars are fetched as plain ICS and parsed with a small
//     hand-rolled parser (TRMNL Serverless only guarantees the built-in
//     HTTP client, not an ICS library — see topics/serverless.md).
//
// The config parser/rule engine (parseConfig/compileMatcher/
// applyCalendarRules below) is ported from plugin/src/transform.js's own
// — same config shape, same semantics, minus the multi-day windows that
// plugin's flat agenda list needs and this single-day map doesn't. The
// saved-state pieces (last good weather, calendar-down alerts, remembered
// X-WR-CALNAME) came across too and live under "Deadline and saved
// state" below. It
// supports: string-shorthand calendars (`"https://.../a.ics"` as well as
// `{url:...}`), non-JSON config text falling back to a newline-separated
// URL list, per-calendar `headers` (sent alongside the default
// User-Agent), match types any/all/exact/word/contains/regex/status/
// weekday/and/or, `rewrite`(+`rewriteFull`) and `rename` (defaults to
// true, EXCEPT on an any/all match where it defaults to false — a
// catch-all shouldn't silently rewrite every title unless asked), a
// top-level `rules` array applied before each calendar's own (a
// calendar's own rule wins when both assign a line to the same event),
// a `line` field that can be a list (multiple lines on the same
// event become an interchange node, metro-plugin's own concept for a
// shared event), and an `everyoneLine` fallback (the first entry in
// `lines[]`) for any event no rule assigns a line to.
//
// `lines[].side` ("left"/"work" or "right"/"family") pins a line to a
// side of the map; without it the line a calendar named "Work" assigns
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
//   - Weather needs a `lat_lon` setting; without one a real board shows
//     no forecast at all rather than a made-up one. The DEMO boards are
//     the exception: they carry built-in weather (DEMO_WEATHER) so the
//     sky band can be seen without a location.
//   - Translations are downloaded (i18n/<code>.json in this repo);
//     English is inline and is what a device that cannot reach GitHub
//     reads.
//
// Both branches converge on the SAME buildMetro() — the rest of the
// pipeline (hour ticks, sub-spur detection, the "now" marker, lines
// list) doesn't care whether events came from DUMMY_EVENTS or real ICS.

var DAY_START_MIN = 7 * 60;
var DAY_END_MIN = 21 * 60;
var SECONDARY_THRESHOLD_MIN = 30;
var LINE_STEP = 10; // px between adjacent line offsets
// Line styles and stroke weights used to be handed out here. They are
// drawing decisions, so they live in shared.liquid now (`TRACK_STYLES`);
// this file says only which line is the anchor.
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
// i18n. Every user-facing string the plugin renders. ENGLISH IS INLINE
// and is the only table shipped in this file: it is the fallback for a
// device that cannot reach GitHub, and it is the key set every other
// language is checked against. Every other language lives in this repo's
// i18n/<code>.json and is fetched at render time (loadStrings below), so
// a new language is a pull request against a JSON file rather than an
// edit to the serverless entry point nobody outside this repo can make.
// Weekday and month names still come from Intl with the full locale, so
// they cover any language Intl knows whether or not it has a file here.
// ---------------------------------------------------------------------
var I18N = {
  en: { today: 'Today', more: '+{n} more', earlier: '+{n} earlier', rain_pct: '{n}% rain',
        clear: 'Clear', partly_cloudy: 'Partly cloudy', cloudy: 'Cloudy', foggy: 'Foggy', rain: 'Rain', snow: 'Snow', storms: 'Storms',
        rain_starts: 'Rain starts', rain_stops: 'Rain stops', sunrise: 'Sunrise', sunset: 'Sunset',
        feed_down: '{n} unavailable', weather_stale: 'Forecast may be out of date',
        // "Day 3 of 5". A week-long half term is a different fact on the
        // Monday than on the Thursday, and the one day the board draws is
        // somewhere inside it. Both numbers are named, because a language
        // may want them in the other order.
        holiday_day: 'Day {n} of {m}',
        // The service alert banner. One key per kind rather than a
        // condition plus a shared "at {t}" frame, because the preposition
        // is not shared: it is "um" in German, "a las" in Spanish, "à" in
        // French, and in a language that puts the time first there is no
        // frame to put it in. The label and the separator are, so those
        // are assembled in serviceAlert().
        alert_label: 'SERVICE ALERT',
        alert_rain: 'Heavy Rain Expected at {t} ({p}%)',
        alert_snow: 'Heavy Snow Expected at {t} ({p}%)',
        alert_cold: 'Extreme Cold Expected ({v}°)',
        alert_heat: 'Extreme Heat Expected ({v}°)' },
};

// Where the translated tables live, and how long a fetched one is trusted
// before it is asked for again. Re-fetching every render would spend a
// slice of the same deadline the calendars need on a file that changes a
// few times a year; a cached table is reused until it is this old, and a
// failed fetch falls back to the cache whatever its age.
var I18N_BASE = 'https://raw.githubusercontent.com/ExcuseMi/trmnl-metro-calendar-plugin/main/i18n/';
var I18N_TTL_S = 6 * 3600;
var I18N_FETCH_MS = 1500;

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

function langOf(locale) {
  return String(locale || 'en').slice(0, 2).toLowerCase();
}

// A downloaded table is data from the open internet, not code: only the
// keys English already has are taken, only strings, and only short ones.
// Anything else would be carried into trmnl_state and replayed on every
// later render, including whatever a malformed pull request put there.
function sanitizeStrings(raw) {
  var out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.keys(I18N.en).forEach(function (k) {
    var v = raw[k];
    if (typeof v === 'string' && v.trim() && v.length <= 120) out[k] = v.trim();
  });
  return out;
}

// A partially translated file is still worth having: the keys it does
// carry are used and the rest read in English, rather than the whole
// language falling back because someone added a string last week.
function mergeStrings(fetched) {
  return Object.assign({}, I18N.en, sanitizeStrings(fetched));
}

// Fetching a language must never delay or break a render: it is budgeted
// against the same deadline the calendars are, a failure falls back to
// the last table this device saw (kept in trmnl_state) and then to
// English, and nothing about it is surfaced to the reader: a board in
// English is a board.
async function loadStrings(locale, state, deadline) {
  var lang = langOf(locale);
  if (lang === 'en') return I18N.en;
  var cached = (state && state.i18n && state.i18n.lang === lang && state.i18n.strings) ? state.i18n : null;
  var nowS = Math.floor(Date.now() / 1000);
  if (cached && (nowS - (cached.fetchedAt || 0)) < I18N_TTL_S) return mergeStrings(cached.strings);
  var budget = Math.min(msUntil(deadline), I18N_FETCH_MS);
  if (budget > 0) {
    try {
      var resp = await fetchWithTimeout(I18N_BASE + lang + '.json', budget);
      if (resp && resp.ok) {
        var body = await resp.json();
        var clean = sanitizeStrings(body);
        if (Object.keys(clean).length) {
          if (state) state.i18n = { lang: lang, strings: clean, fetchedAt: nowS };
          return mergeStrings(clean);
        }
      }
    } catch (e) {
      // offline, GitHub down, or a language nobody has translated yet
    }
  }
  return cached ? mergeStrings(cached.strings) : I18N.en;
}

function tr(strings, key, n) {
  var v = strings[key] || I18N.en[key] || key;
  return n == null ? v : v.replace('{n}', String(n));
}

// tr() substitutes the single count every other string carries. An alert
// line carries a time, a percentage or a temperature, and each language
// puts them in its own order, so those are named and the translated
// string decides where they land. An unknown placeholder is left standing
// rather than blanked: "at {t}" on the board says a translation is wrong,
// where "at " says nothing at all.
function fmt(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, function (m, k) {
    return (vars && Object.prototype.hasOwnProperty.call(vars, k)) ? String(vars[k]) : m;
  });
}

// ---------------------------------------------------------------------
// Deadline and saved state.
//
// The serverless runtime kills a render that runs long, so every fetch in
// this file is given what is LEFT of one shared deadline rather than a
// timeout of its own: three feeds each allowed four seconds is twelve
// seconds of rope on a budget that never had it. msUntil is that "what is
// left", and it is allowed to go negative so a caller can see there is no
// time and skip the call entirely.
//
// Saved state (https://help.trmnl.com/en/articles/16777795): whatever
// run() returns as `trmnl_state` comes back as `input.trmnl.state` on the
// next render. It carries the things a single render cannot work out on
// its own: what the weather was the last time the API answered, how long
// each feed has been failing, what a feed that is failing right now is
// called, and the last language table this device managed to download.
// It is UNTRUSTED input: it may be absent, a string, a shape from an
// older build, or truncated, so every field is validated on the way in
// and a bad one is dropped rather than trusted.
// ---------------------------------------------------------------------

function msUntil(deadline) {
  return deadline - Date.now();
}

// The whole render's network budget. Everything that fetches gets a slice
// of what is left of it, never a fresh one of its own.
var RENDER_BUDGET_MS = 4200;

var WEATHER_STALE_AFTER_S = 6 * 3600;  // older than this and the board says so rather than presenting it as today's forecast
var CALENDAR_DOWN_AFTER_S = 2 * 3600;  // a feed that has been failing this long is named on the board instead of quietly missing
var STATE_MAX_URLS = 40;               // state travels with every render; a config that once had 200 feeds must not grow it forever

function readState(input) {
  var raw = null;
  try { raw = input.trmnl.state; } catch (e) { raw = null; }
  // Some runtimes hand the state back as the JSON string that was stored
  // rather than as an object.
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (e) { raw = null; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};

  var out = { weather: null, weatherFetchedAt: 0, calendarDown: {}, calendarNames: {}, i18n: null };

  if (raw.weather && typeof raw.weather === 'object' && !Array.isArray(raw.weather)) {
    out.weather = raw.weather;
    out.weatherFetchedAt = typeof raw.weatherFetchedAt === 'number' && isFinite(raw.weatherFetchedAt) ? raw.weatherFetchedAt : 0;
  }
  if (raw.calendarDown && typeof raw.calendarDown === 'object') {
    Object.keys(raw.calendarDown).slice(0, STATE_MAX_URLS).forEach(function (url) {
      var t = raw.calendarDown[url];
      if (typeof t === 'number' && isFinite(t) && t > 0) out.calendarDown[url] = t;
    });
  }
  if (raw.calendarNames && typeof raw.calendarNames === 'object') {
    Object.keys(raw.calendarNames).slice(0, STATE_MAX_URLS).forEach(function (url) {
      var n = raw.calendarNames[url];
      if (typeof n === 'string' && n.trim()) out.calendarNames[url] = n.trim().slice(0, 80);
    });
  }
  if (raw.i18n && typeof raw.i18n === 'object' && typeof raw.i18n.lang === 'string') {
    var clean = sanitizeStrings(raw.i18n.strings);
    if (Object.keys(clean).length) {
      out.i18n = { lang: raw.i18n.lang.slice(0, 8), strings: clean,
        fetchedAt: typeof raw.i18n.fetchedAt === 'number' && isFinite(raw.i18n.fetchedAt) ? raw.i18n.fetchedAt : 0 };
    }
  }
  return out;
}

// Feeds come and go from a config. Anything the config no longer names is
// dropped, so a URL that was removed a year ago is not still being carried
// (and counted as "down") on every render.
function pruneState(state, urls) {
  if (!state) return;
  var keep = {};
  (urls || []).forEach(function (u) { keep[u] = true; });
  [state.calendarDown, state.calendarNames].forEach(function (map) {
    Object.keys(map).forEach(function (u) { if (!keep[u]) delete map[u]; });
  });
}

// Weekday and month names come from Intl, one part at a time and cached.
// Formatters are not cheap to build and the same handful get asked for over
// and over, and taking the parts separately means the label can be composed
// per locale rather than accepting whatever order a full format string
// produces. Some locales return a trailing dot or a lowercase name; both are
// tidied here so the header reads consistently.
var _weekdayFmtCache = {}, _monthFmtCache = {};
function localeDatePart(locale, width, kind, y, mo, d) {
  var key = locale + '|' + width;
  var cache = kind === 'weekday' ? _weekdayFmtCache : _monthFmtCache;
  var fmt = cache[key];
  if (!fmt) {
    var opts = { timeZone: 'UTC' };
    opts[kind] = width;
    try {
      fmt = new Intl.DateTimeFormat(locale, opts);
    } catch (e) {
      fmt = new Intl.DateTimeFormat('en', opts);
    }
    cache[key] = fmt;
  }
  var raw = fmt.format(new Date(Date.UTC(y, mo - 1, d))).replace(/\.$/, '');
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// "Tue 8 Sep" / "Di 8 sep" / "Mar 8 sept" — header date, in the board's own
// language.
// The day as a machine reads it: "2026-09-08", no locale in it anywhere.
//
// `date_label` is for a person and is therefore useless as an identity --
// it has no year in it and it changes with the language. This is what the
// drawing seeds its generator from, so that whatever the board decides by
// chance it decides the same way every time it redraws the same day, on
// every device, in every language.
function isoDate(civil) {
  if (!civil) return null;
  return civil.y + '-' + pad2(civil.mo) + '-' + pad2(civil.d);
}
function dateLabel(civil, locale) {
  if (!civil) return null;
  var loc = locale || 'en';
  var wd = localeDatePart(loc, 'short', 'weekday', civil.y, civil.mo, civil.d);
  var month = localeDatePart(loc, 'short', 'month', civil.y, civil.mo, civil.d);
  return wd + ' ' + civil.d + ' ' + month;
}

// 12-hour clocks where the locale itself uses them, unless the setting says
// otherwise. Ask Intl rather than keeping a list of regions: the runtime
// already knows every locale's clock convention, a hand-kept list is wrong
// the moment it meets a locale nobody thought of, and "does en-IE use a
// 12-hour clock" is not a question this file should be answering from
// memory.
var _hourCycleCache = {};
function localeUses12h(locale) {
  var key = String(locale || 'en');
  if (key in _hourCycleCache) return _hourCycleCache[key];
  var out = false;
  try {
    var ro = new Intl.DateTimeFormat(key, { hour: 'numeric' }).resolvedOptions();
    // hourCycle is the modern answer (h11/h12 are the 12-hour ones); hour12
    // is the older one. A bare "en" resolves to a 12-hour clock, which is
    // not what a TRMNL account defaulting to "en" wants, so that one case
    // stays explicit.
    out = ro.hourCycle ? (ro.hourCycle === 'h11' || ro.hourCycle === 'h12') : !!ro.hour12;
    if (key.toLowerCase() === 'en') out = false;
  } catch (e) { out = false; }
  _hourCycleCache[key] = out;
  return out;
}

function resolveHour12(timeFormatRaw, locale) {
  if (timeFormatRaw === '12h') return true;
  if (timeFormatRaw === '24h') return false;
  return localeUses12h(locale);
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
// buildMetro: the shared pipeline. `events`: [{track, title, startMin,
// endMin, location, interchange_with}], startMin/endMin are minutes
// since midnight LOCAL time. `lines`: [{key,name,side,hue,line_offset,
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

function timeLabel12(min, extra) {
  var h = Math.floor(min / 60) % 24, m = min % 60;
  if (!(extra && extra.hour12)) return pad2(h) + ':' + pad2(m);
  return (h % 12 || 12) + (m ? ':' + pad2(m) : '') + (h < 12 ? 'am' : 'pm');
}
function buildMetro(lines, events, weatherMilestones, headerWeather, nowMin, windowLabel, allDayEvents, extra) {
  var lineByKey = {};
  lines.forEach(function (t) { lineByKey[t.key] = t; });

  // ---- how much of the day is on the board -----------------------------
  //
  // A fixed 7am-to-9pm day cut the ends off: an early shift or a late
  // dinner fell outside it and became a "+1 later" note. It also left a
  // late event's label nothing to run into — the last thing on the map
  // ended AT the edge, so its caption had to be ellipsised or turned back
  // on itself.
  //
  // The day now stretches to fit what is actually on it, an hour before the
  // first thing and an hour and a half after the last, clamped to real
  // midnight either way. That tail is the room a label needs. The quiet
  // ends cost almost nothing to show because the client runs them as
  // express sections rather than at full scale, so a wider day is mostly a
  // wider view of the same busy hours.
  var dayLo = DAY_START_MIN, dayHi = DAY_END_MIN;
  (events || []).forEach(function (e) {
    if (e.startMin != null) dayLo = Math.min(dayLo, e.startMin);
    if (e.endMin != null) dayHi = Math.max(dayHi, e.endMin);
  });
  if (nowMin != null) { dayLo = Math.min(dayLo, nowMin); dayHi = Math.max(dayHi, nowMin); }
  // Clamped to the run of days the board covers, not to one midnight. On a
  // single-day board that is the same number it always was; on a run of
  // three it lets the window reach into day two and day three, which is
  // the whole point of sending them.
  var days = (extra && extra.days) || [];
  var runEnd = Math.max(24 * 60, days.length * 24 * 60);
  var DAY_LO = Math.max(0, Math.floor((dayLo - 60) / 60) * 60);
  var DAY_HI = Math.min(runEnd, Math.ceil((dayHi + 90) / 60) * 60);
  if (DAY_HI - DAY_LO < 8 * 60) DAY_HI = Math.min(runEnd, DAY_LO + 8 * 60);
  // A ROLLING WINDOW IS STATED, NOT DERIVED. Where the caller has decided
  // the board runs past midnight it has already worked out both ends
  // against the run, and fitting them to the content again here would give
  // a quiet day back the narrow window the rolling view exists to widen.
  var roll = (extra && extra.window) || null;
  if (roll) { DAY_LO = roll.from; DAY_HI = roll.to; }

  // A configured track with nothing on today's board gets no line and no
  // legend entry — otherwise every day carries every ever-configured
  // track's empty line, permanently eating spine width. Side/hue/style
  // stay whatever finalize() decided from the FULL registered set (so a
  // track's color/side identity doesn't shift day to day depending on
  // who else happens to be busy); only the per-side offset is repacked
  // against just today's active lines, closing the gaps a filtered-out
  // track would otherwise leave.
  var activeKeys = {};
  events.forEach(function (ev) {
    if (!lineByKey[ev.line]) return;
    activeKeys[ev.line] = true;
    (ev.interchange_with || []).forEach(function (key) { if (lineByKey[key]) activeKeys[key] = true; });
  });
  (allDayEvents || []).forEach(function (ev) { if (lineByKey[ev.line]) activeKeys[ev.line] = true; });
  lines.forEach(function (t) { if (t.keep_empty) activeKeys[t.key] = true; });
  lines = lines.filter(function (t) { return activeKeys[t.key]; });
  lines.forEach(function (t) { delete t.keep_empty; }); // bookkeeping, not payload
  // Renumbering closes the gaps left by the lines just dropped, and it has
  // to keep the ORDER `finalize` chose. Done in whatever sequence the array
  // happened to be in, it did not: the chain built to keep the people who
  // share a day beside each other was handed out again by registration
  // order, so the Simpsons came out Maggie-Homer-Marge-Bart-Lisa when the
  // chain said Maggie-Lisa-Bart-Homer-Marge. Every ordering decision this
  // file makes was being thrown away one function later.
  //
  // Sorted by the offset finalize gave them, innermost first on each side,
  // the renumbering closes the gaps and changes nothing else.
  var sideIdx = { left: 0, right: 0 };
  lines.sort(function (a, b) {
    if (a.side !== b.side) return a.side === 'left' ? -1 : 1;
    return Math.abs(a.line_offset) - Math.abs(b.line_offset);
  });
  lines.forEach(function (t) { t.line_offset = LINE_STEP * (++sideIdx[t.side]) * (t.side === 'left' ? -1 : 1); });
  lineByKey = {};
  lines.forEach(function (t) { lineByKey[t.key] = t; });

  var items = [];

  events.forEach(function (ev) {
    var line = lineByKey[ev.line];
    if (!line) return; // no resolved/known line for this event — drop it rather than guess
    var coOwners = (ev.interchange_with || []).filter(function (key) { return !!lineByKey[key]; });
    items.push({
      type: 'event',
      _sortMin: ev.startMin,
      title: ev.title,
      start_min: ev.startMin,
      end_min: ev.endMin,
      location: ev.location || null,
      owner: line.key,
      co_owners: coOwners, // other line keys sharing this event (an interchange) — empty for a normal event
      // NO PRESENTATION HERE. Which side an event's line runs on, its
      // colour, its weight and its dash pattern all belong to the LINE, and
      // the board looks them up on the legend entry the owner names. Copied
      // onto every event they were five dead fields per item that nothing
      // read -- on a busy day, eighty-five of them, in a payload with a
      // hundred kilobyte ceiling.
    });
  });

  // AN ALL-DAY EVENT HAS NO HOUR, SO IT GETS NO PLACE ON THE AXIS.
  //
  // It was drawn as an event spanning the whole visible window, which meant
  // the board printed its OWN window back as the event's hours: every render
  // carried "6am - 11pm / Spring Break", which is not when the holiday is,
  // it is when the board decided to start and stop looking. On a multi-day
  // board it was worse, because the window covers the run and a Tuesday
  // holiday got stamped across Wednesday and Thursday too.
  //
  // It is a STATE a line is in, not a place it goes at a time, so it is
  // declared once at the line's head, where the board already says who a
  // line is. Several lines sharing one title are ONE origin named once, so
  // the grouping happens here rather than being rediscovered per line.
  var allDayByTitle = {};
  (allDayEvents || []).forEach(function (ev) {
    var line = lineByKey[ev.line];
    if (!line) return;
    var row = allDayByTitle[ev.title];
    if (!row) {
      // No hue, no style: presentation is the frontend's, and `owners`
      // already says which lines' styles to draw the badge in.
      row = allDayByTitle[ev.title] = { title: ev.title, owners: [] };
    }
    if (row.owners.indexOf(line.key) < 0) row.owners.push(line.key);
  });
  var allDay = Object.keys(allDayByTitle).map(function (t) { return allDayByTitle[t]; });

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
    day_start_min: DAY_LO,
    day_end_min: DAY_HI,
    // The run of days, in the same absolute minutes everything else uses:
    // day 0 is [0, 1440), day 1 is [1440, 2880), and so on. The client
    // draws as many of them as the canvas can give a day's worth of axis
    // to, so this is what it has to choose FROM, not what it will show.
    // Each carries its own date and its own forecast, because a two-day
    // board that says one temperature is lying about one of the days.
    days: (days || []).map(function (d, i) {
      return {
        index: i,
        start_min: i * 24 * 60,
        end_min: (i + 1) * 24 * 60,
        date_label: d.label || null,
        weekday_label: d.weekday || null,
        // The same weekday in as few letters as the locale writes it: what
        // a date marker falls back to where the strip is an hour label wide.
        weekday_short: d.weekdayShort || null,
        weather: d.weather || null,
      };
    }),
    // THE WINDOW INTO THE RUN, on the days a quiet one borrowed the next.
    //
    // Null on every ordinary board, and that is load bearing: the client
    // draws a whole day per day in the run and compresses the quiet parts,
    // so a board with no window is byte for byte the board it always was.
    // With one it draws exactly these minutes of the run instead -- six in
    // the morning to six the following evening -- and everything else about
    // the drawing is unchanged.
    rolling: roll ? { start_min: roll.from, end_min: roll.to } : null,
    secondary_threshold_min: SECONDARY_THRESHOLD_MIN, // sub-spur grouping window — client decides sub-spurs, but this constant is config, not geometry
    // the day the board actually shows, computed here rather than by the
    // caller, which cannot know it until the events are in
    window_label: timeLabel12(DAY_LO, extra) + ' ' + timeLabel12(DAY_HI, extra),
    date_label: (extra && extra.dateLabel) || null,
    // the seed for anything the drawing decides by chance; see `isoDate`
    date_iso: (extra && extra.dateIso) || null,
    // What the header calls the day. "Today" only when it is: a board set
    // to tomorrow that says Today is naming the wrong day, and the day's
    // own name is more use than the word "Tomorrow" anyway, because it is
    // what everyone else in the house will call it.
    title_word: (extra && extra.todayWord === false && extra.days && extra.days[0] && extra.days[0].weekday) || null,
    now_min: nowMin != null ? nowMin : null, // minutes since local midnight; the client decides whether/where to draw it
    orientation: (extra && extra.orientation) || 'auto', // auto | horizontal | vertical — client picks for auto from the canvas aspect
    hour12: !!(extra && extra.hour12),
    i18n: (function (st) { return { today: tr(st, 'today'), more: tr(st, 'more'), earlier: tr(st, 'earlier'), rain_pct: tr(st, 'rain_pct'), feed_down: tr(st, 'feed_down'), weather_stale: tr(st, 'weather_stale') }; })((extra && extra.strings) || I18N.en),
    header_weather: headerWeather,
    // The forecast is the last one the API answered with rather than
    // today's, and it is old enough to say so. A board that quietly shows
    // yesterday's weather as today's is worse than one that admits it.
    weather_stale: !!(extra && extra.weatherStale),
    // The banner along the bottom edge: { text, kind } or null. The text is
    // already composed and already translated (see serviceAlert): the
    // template prints it and picks a treatment from `kind`
    // (rain|snow|cold|heat), and nothing about it is assembled on the
    // client. NULL, not an empty string, when nothing is breached: the
    // banner has to disappear completely and give its space back to the
    // map, and "" would still be a thing the template had to decide about.
    service_alert: (extra && extra.serviceAlert) || null,
    // Feeds that have been failing for hours, by name (see
    // CALENDAR_DOWN_AFTER_S). A calendar that stops answering takes its
    // events off the board with it, and a board that is missing half a
    // family without saying so reads as a quiet day.
    calendars_down: (extra && extra.calendarsDown) || [],
    legend: lines,
    all_day: allDay, // declared at the line's head, never on the axis: see above
    // WHAT THE DAY IS, next to the date that says which day it is.
    //
    // A holiday is not one person's state, so it is not a line's anything:
    // it has no hour to be drawn at, no owner to be declared under, and
    // nothing about it says a line's day is a slice of something longer.
    // It is a property of THE DAY, and the board already has one place
    // that says what the day is, which is the header.
    //
    // ONE NAME. Two people in a house may both subscribe to the same
    // national calendar, so the same day arrives twice and is deduplicated
    // here; and a day can genuinely carry two different ones, a public
    // holiday and a school one. The header is a single row that already
    // holds a date and a forecast, and two names on it came out as
    // "Christmas D" and "School Holid", each cut mid word, with the
    // ordinal wrapped underneath. Naming the day is the header's job and
    // enumerating it is not, so the first wins: the first feed listed,
    // which is the one order the config author controls.
    holidays: (function (list, st) {
      // ONE NAME PER DAY, not one name per board. The cap used to be one
      // outright, from when a board drew one day; a rolling board draws two
      // and each of them gets to say what it is. Two names on ONE day is
      // still refused -- that came out as "Christmas D" and "School Holid",
      // each cut mid word -- so the seen-set is keyed on the day as well as
      // the title, and a day that carries two keeps the first feed listed.
      var seen = {}, perDay = {}, out = [];
      (list || []).forEach(function (h) {
        var day = Math.max(0, h.day || 0);
        var key = day + '\u0000' + String(h.title == null ? '' : h.title).trim().toLowerCase();
        if (key.length <= 2 || seen[key]) return;
        seen[key] = true;
        if (perDay[day]) return;
        perDay[day] = true;
        var span = Math.max(1, h.span || 1);
        var ix = Math.min(span - 1, Math.max(0, h.index || 0));
        out.push({
          title: h.title,
          // which day of the board it is about: 0 is the day the board opens
          // on, 1 the day a rolling board reached into
          day: day,
          day_index: ix,
          day_span: span,
          // Composed and translated HERE, the way the service alert's text
          // is: a braced placeholder inside a Liquid output tag ends the
          // tag and takes the whole template down with it, and a day that
          // is not inside a range has no ordinal to state at all.
          day_label: span > 1 ? fmt(tr(st, 'holiday_day'), { n: ix + 1, m: span }) : null,
        });
      });
      return out.slice(0, 2);
    })((extra && extra.holidays) || [], (extra && extra.strings) || I18N.en),
    // TWO LISTS, NOT ONE MIXED ONE.
    //
    // This was `items`, one list of three kinds sorted by minute, and every
    // consumer's first move was to filter it: the axis window wanted events,
    // the fit pass wanted events, the sky band wanted `weather || sun`.
    // Nothing ever wanted the mixed list, so the mixing was work done here
    // and undone four times downstream.
    //
    // Sunrise and sunset ride with the weather because that is what they
    // are on the board -- one band of sky markers along the top edge, drawn
    // by one pass. They keep their own `type`, so the two are still told
    // apart where it matters, and `header_weather` is separately the
    // header's business.
    events: items.filter(function (i) { return i.type === 'event'; }),
    weather: items.filter(function (i) { return i.type === 'weather' || i.type === 'sun'; }),
  };
}

// ---------------------------------------------------------------------
// Demo path — unchanged hardcoded data.
// ---------------------------------------------------------------------

// The offline fallback, for when GitHub is unreachable. It says who is on
// the board, which side each of them is on and which one is the anchor --
// and nothing about how any of them is DRAWN, because that is decided in
// shared.liquid from this same ordering. No colour is pinned either, so a
// theme still gets to repaint them.
var DEMO_TRACKS = [
  { key: 'homer', name: 'Homer', side: 'left', line_offset: -10, anchor: true },
  { key: 'lisa', name: 'Lisa', side: 'left', line_offset: -20 },
  { key: 'marge', name: 'Marge', side: 'right', line_offset: 10 },
  { key: 'bart', name: 'Bart', side: 'right', line_offset: 20 },
  { key: 'maggie', name: 'Maggie', side: 'right', line_offset: 30 },
];

// A deliberately busy day in Springfield: two meetings starting minutes
// apart on one line (lane stacking), two- and four-track interchanges, a
// long day at school and a shift at the plant as sidings, and an
// evening cluster once everyone is home.
var DEMO_EVENTS = [
  { line: 'marge', interchange_with: ['bart', 'lisa'], title: 'School Run', startMin: 7 * 60 + 45, endMin: 8 * 60 + 15 },
  { line: 'homer', title: 'Shift Briefing', startMin: 8 * 60, endMin: 8 * 60 + 15 },
  { line: 'homer', title: 'Donut Run', startMin: 8 * 60 + 20, endMin: 8 * 60 + 35 },
  { line: 'marge', title: 'Dr. Hibbert', startMin: 10 * 60, endMin: 10 * 60 + 45 },
  { line: 'homer', title: '1:1 with Mr. Burns', startMin: 11 * 60, endMin: 11 * 60 + 30, location: 'The Office' },
  { line: 'marge', interchange_with: ['homer'], title: 'Lunch at Krusty Burger', startMin: 12 * 60, endMin: 13 * 60 },
  { line: 'homer', title: 'Safety Inspection', startMin: 14 * 60, endMin: 15 * 60 },
  { line: 'lisa', title: 'Sax Practice', startMin: 15 * 60 + 30, endMin: 16 * 60 + 15, location: 'Band Room' },
  { line: 'marge', interchange_with: ['bart', 'lisa'], title: 'Pick Up', startMin: 16 * 60, endMin: 16 * 60 + 20 },
  { line: 'bart', title: 'Skate Park', startMin: 16 * 60 + 30, endMin: 17 * 60 + 30 },
  { line: 'marge', title: 'Groceries', startMin: 17 * 60 + 30, endMin: 18 * 60, location: 'Kwik-E-Mart' },
  { line: 'marge', interchange_with: ['homer', 'bart', 'lisa', 'maggie'], title: 'Family Dinner', startMin: 18 * 60 + 30, endMin: 19 * 60 + 30 },
  { line: 'homer', title: "Moe's Tavern", startMin: 19 * 60 + 45, endMin: 21 * 60 },
  { line: 'bart', interchange_with: ['lisa'], title: 'Itchy & Scratchy', startMin: 20 * 60, endMin: 20 * 60 + 30 },
];

// Sidings: the line kinks out to siding level for the span
// rather than branching, for a place you simply ARE for a while.
var DEMO_STATIONS = [
  { line: 'homer', title: 'Sector 7-G', location: 'Springfield Nuclear', startMin: 9 * 60, endMin: 17 * 60 },
  { line: 'bart', title: 'Springfield Elementary', location: 'Room 12', startMin: 8 * 60 + 30, endMin: 15 * 60 },
  { line: 'lisa', title: 'Springfield Elementary', location: 'Room 4', startMin: 8 * 60 + 30, endMin: 15 * 60 },
];

var DEMO_ALLDAY = [
  { line: 'maggie', title: 'With Grampa' },
];

var DEMO_NOW_MIN = 11 * 60;
var DEMO_SUN = [{ kind: 'sunrise', atMin: 7 * 60 + 8 }, { kind: 'sunset', atMin: 19 * 60 + 58 }];

// Demo weather, one snapshot per board. The demo has no location and must
// not make a network call, so without this nothing on a demo board ever
// draws a sky marker and nobody can see what the band looks like until
// they have set a real lat/lon and waited for the right hour of the right
// day. Every board carries a sunrise, a sunset, a rain start, a rain stop
// and one heavier condition, so all five marker shapes are on the screen
// at once; the three boards use a different heavy condition each
// (storms/fog/snow) so every icon in MILESTONE_ICON is exercised by the
// demo somewhere.
//
// Each carries the wettest hour of its day too (`peak`), so the service
// alert can be seen on a demo board without waiting for real weather to
// breach a threshold somewhere: Springfield trips a rain alert and the
// flatmates' freezing day trips snow.
//
// These are SNAPSHOTS in the same shape fetchWeather returns, in Celsius,
// so they go through the same materializeWeather (and the same unit
// conversion) the real forecast does rather than a second rendering path
// that could drift from it. Demo only: a real config with no lat_lon
// still shows an empty header rather than an invented forecast.
var DEMO_WEATHER = {
  simpsons: {
    hi: 21, lo: 13, condition: 'rain', icon: 'wi-day-rain.svg', rain_chance: 60, unit: 'C',
    peak: { atMin: 14 * 60, pct: 60 },
    milestones: [
      { atMin: 13 * 60, kind: 'rain_starts' },
      { atMin: 16 * 60, kind: 'rain_stops' },
      { atMin: 20 * 60, kind: 'storms' },
    ],
    sun: DEMO_SUN,
  },
  futurama: {
    hi: 24, lo: 15, condition: 'foggy', icon: 'wi-day-fog.svg', rain_chance: 35, unit: 'C',
    peak: { atMin: 13 * 60, pct: 35 },
    milestones: [
      { atMin: 8 * 60, kind: 'foggy' },
      { atMin: 12 * 60, kind: 'rain_starts' },
      { atMin: 14 * 60 + 30, kind: 'rain_stops' },
    ],
    sun: DEMO_SUN,
  },
  friends: {
    hi: 1, lo: -4, condition: 'snow', icon: 'wi-day-snow.svg', rain_chance: 80, unit: 'C',
    peak: { atMin: 17 * 60, pct: 80 },
    milestones: [
      { atMin: 9 * 60, kind: 'snow' },
      { atMin: 15 * 60, kind: 'rain_starts' },
      { atMin: 17 * 60, kind: 'rain_stops' },
    ],
    sun: DEMO_SUN,
  },
};

function demoWeatherSnapshot(name) {
  return DEMO_WEATHER[String(name || '').trim().toLowerCase()] || DEMO_WEATHER.simpsons;
}

function demoWeather(strings, unit) {
  return materializeWeather(demoWeatherSnapshot(null), strings, unit);
}

// The demo can also be driven the way a real setup is: this exact config,
// against ICS files living in this repo's demo/ folder. That keeps the demo
// honest — it exercises fetching, parsing, the rule engine and track
// resolution rather than a hand-built shortcut — and doubles as a worked
// example of the config format. It needs the network, so the hardcoded
// Springfield data above stays as the offline fallback.
var DEMO_ICS_BASE = 'https://raw.githubusercontent.com/ExcuseMi/trmnl-metro-calendar-plugin/main/demo/';
function demoCalendar(name, file, rules) {
  return { name: name, url: DEMO_ICS_BASE + file, rules: rules };
}
function demoOwnLine(name, file) {
  return demoCalendar(name, file, [{ match: { type: 'any' }, line: name }]);
}
var SIMPSONS_CONFIG = {
  // Springfield is American, so the demo reads American: US date order and a
  // 12-hour clock, both set here rather than inherited from the account, so
  // the demo looks the same on every device.
  //
  // NOT the zone. A demo board still has to be honest about what time it is
  // where it is hanging: pinned to one, the "now" marker and every car sat
  // hours off the viewer's own clock, which reads as a broken plugin rather
  // than as a demo. The zone comes from the account.
  locale: 'en-US',
  timeFormat: '12h',
  // No pinned colours. A track's hue and dash pattern are assigned
  // automatically from the framework's own hue cycle, which is what a THEME
  // remaps — pin "gray-40" and the line stays that grey whatever theme the
  // device is set to. Pinning is still available per track for anyone who
  // wants it; the shipped configs just don't use it.
  lines: [
    { name: 'Homer', side: 'left' },
    { name: 'Marge' },
    { name: 'Bart' },
    { name: 'Lisa' },
    { name: 'Maggie' },
  ],
  calendars: [
    demoOwnLine('Homer', 'simpsons/homer.ics'),
    demoOwnLine('Marge', 'simpsons/marge.ics'),
    demoOwnLine('Bart', 'simpsons/bart.ics'),
    demoOwnLine('Lisa', 'simpsons/lisa.ics'),
    demoOwnLine('Maggie', 'simpsons/maggie.ics'),
    // One school calendar split by class code, the way a real school feed
    // is. rename:false throughout — a track assignment rewrites the matched
    // text into the track's name by default, which would turn "Family
    // Dinner" into the entire guest list.
    demoCalendar('School', 'simpsons/school.ics', [
      { match: { type: 'word', value: 'L6' }, line: 'Bart', rename: false },
      { match: { type: 'word', value: 'K3' }, line: 'Lisa', rename: false },
      { match: { type: 'regex', value: '^(?:L6|K3)\\s+' }, rewrite: '' },
    ]),
    demoCalendar('Family', 'simpsons/family.ics', [
      { match: { type: 'contains', value: 'Family Dinner' }, line: ['Marge', 'Homer', 'Bart', 'Lisa', 'Maggie'], rename: false },
      { match: { type: 'contains', value: 'School Run' }, line: ['Marge', 'Bart', 'Lisa'], rename: false },
      { match: { type: 'contains', value: 'Spring Break' }, line: 'Bart', allDay: true, rename: false },
    ]),
  ],
};

// A crew rather than a family, and one shared team calendar rather than a
// calendar each: everything comes in on crew.ics with a "Name:" prefix and
// the rules split it. The delivery is one siding on THREE lines at once —
// the three of them really are on the same ship all day — which is the
// shape two children at one school get, with a third line in the corridor.
var FUTURAMA_CONFIG = {
  locale: 'en-US',
  timeFormat: '12h',
  lines: [
    { name: 'Professor', side: 'left' },
    { name: 'Amy', side: 'left' },
    { name: 'Fry' },
    { name: 'Leela' },
    { name: 'Bender' },
  ],
  calendars: [
    demoCalendar('Planet Express', 'futurama/crew.ics', [
      // route by the name the entry is filed under, then take the prefix
      // back off so the board reads "Coffee (100 cups)", not "Fry: Coffee"
      { match: { type: 'regex', value: '^Fry:' }, line: 'Fry', rename: false },
      { match: { type: 'regex', value: '^Leela:' }, line: 'Leela', rename: false },
      { match: { type: 'regex', value: '^Bender:' }, line: 'Bender', rename: false },
      { match: { type: 'regex', value: '^Amy:' }, line: 'Amy', rename: false },
      { match: { type: 'regex', value: '^Professor:' }, line: 'Professor', rename: false },
      { match: { type: 'regex', value: '^[A-Za-z]+:\\s*' }, rewrite: '' },
    ]),
    demoCalendar('Deliveries', 'futurama/deliveries.ics', [
      { match: { type: 'contains', value: 'Delivery Run' }, line: ['Fry', 'Leela', 'Bender'], rename: false },
      { match: { type: 'contains', value: 'Good News' }, line: ['Professor', 'Fry', 'Leela', 'Bender', 'Amy'], rename: false },
      { match: { type: 'contains', value: 'Crew Debrief' }, line: ['Fry', 'Leela', 'Bender'], rename: false },
      { match: { type: 'contains', value: 'Ship Inspection' }, line: 'Leela', allDay: true, rename: false },
    ]),
  ],
};

// The smallest board worth drawing: two people who share a flat. One long
// solo siding (a day at a desk) and one evening they are both at.
var FRIENDS_CONFIG = {
  locale: 'en-US',
  timeFormat: '12h',
  lines: [
    { name: 'Monica', side: 'left' },
    { name: 'Rachel' },
  ],
  calendars: [
    // a long block someone spends in one place is a STATION, not a meeting:
    // the line runs straight on and the block is a siding beside it
    demoCalendar('Monica', 'friends/monica.ics', [
      { match: { type: 'contains', value: 'Head Chef Shift' }, rename: false },
      { match: { type: 'any' }, line: 'Monica' },
    ]),
    demoCalendar('Rachel', 'friends/rachel.ics', [
      { match: { type: 'contains', value: 'Desk booking' }, rename: false },
      { match: { type: 'any' }, line: 'Rachel' },
    ]),
    demoCalendar('Apartment 20', 'friends/apartment.ics', [
      { match: { type: 'contains', value: 'Central Perk' }, line: ['Monica', 'Rachel'], rename: false },
      { match: { type: 'contains', value: 'Laundry' }, line: ['Monica', 'Rachel'], rename: false },
    ]),
  ],
};

// Which board "Use Demo Data" shows. The Simpsons stays the default: it is
// the busiest of the three and the one the offline fallback mirrors.
var DEMO_SETS = { simpsons: SIMPSONS_CONFIG, futurama: FUTURAMA_CONFIG, friends: FRIENDS_CONFIG };
function demoConfigFor(name) {
  return DEMO_SETS[String(name || '').trim().toLowerCase()] || SIMPSONS_CONFIG;
}

function buildFromDemo(weather, nowMin, extra) {
  var strings = (extra && extra.strings) || I18N.en;
  var demo = demoWeather(strings, (extra && extra.tempUnit) || 'C');
  var w = weather || demo;
  return buildMetro(
    DEMO_TRACKS, DEMO_EVENTS,
    w.milestones || [],
    w.header || demo.header,
    nowMin != null ? nowMin : DEMO_NOW_MIN,
    timeLabel(DAY_START_MIN) + ' ' + timeLabel(DAY_END_MIN),
    DEMO_ALLDAY,
    // The offline fallback is one day, and says so: a run of one is still
    // a run, so the client takes the same path for it as for three.
    Object.assign({}, extra || {}, {
      days: (extra && extra.days) || [{ label: (extra && extra.dateLabel) || null, weekday: null, weather: null }],
      // The offline fallback is always today, and it is always subject to
      // the clock: the demo forecast is fixed, so its wettest hour is in
      // the past every single evening.
      serviceAlert: alertFor(extra, 0, nowMin != null ? nowMin : DEMO_NOW_MIN),
      sun: (w.sun && w.sun.length) ? w.sun : DEMO_SUN }),
    DEMO_STATIONS.map(function (st) {
      return { line: st.line, title: st.title, location: st.location || null, startMin: st.startMin, endMin: st.endMin };
    })
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

// A weather SNAPSHOT is language-free and unit-tagged: the condition and
// every milestone are i18n KEYS, the icon is a filename, and the
// temperatures carry the unit they were fetched in. It has to be, because
// this is what goes into trmnl_state and is replayed on a later render,
// which may be in a different language, or after the temperature unit
// setting changed, and a cached "Rain starts 15:00" in French on a board
// that is now English is worse than no weather at all.
var MILESTONE_ICON = {
  rain_starts: 'wi-rain.svg',
  rain_stops: 'wi-day-sunny.svg',
  snow: 'wi-day-snow.svg',
  storms: 'wi-day-thunderstorm.svg',
  foggy: 'wi-day-fog.svg',
};

function convertTemp(v, from, to) {
  if (v == null || typeof v !== 'number' || !isFinite(v)) return null;
  if (!from || !to || from === to) return v;
  return Math.round(from === 'C' ? v * 9 / 5 + 32 : (v - 32) * 5 / 9);
}

function materializeMilestones(list, strings) {
  return (Array.isArray(list) ? list : [])
    .filter(function (m) { return m && typeof m.atMin === 'number' && isFinite(m.atMin) && MILESTONE_ICON[m.kind]; })
    .map(function (m) {
      return { atMin: m.atMin, icon: WEATHER_ICON_BASE + MILESTONE_ICON[m.kind], label: tr(strings, m.kind) + ' ' + timeLabel(m.atMin) };
    });
}

function materializeSun(list) {
  return (Array.isArray(list) ? list : [])
    .filter(function (m) { return m && typeof m.atMin === 'number' && isFinite(m.atMin) && (m.kind === 'sunrise' || m.kind === 'sunset'); });
}

// snapshot -> the { header, milestones, sun } shape buildMetro takes.
function materializeWeather(snap, strings, unit) {
  if (!snap || typeof snap !== 'object') return null;
  strings = strings || I18N.en;
  unit = unit || 'C';
  var icon = typeof snap.icon === 'string' && snap.icon ? snap.icon : 'wi-day-sunny.svg';
  return {
    date: typeof snap.date === 'string' ? snap.date : null,
    header: {
      hi: convertTemp(snap.hi, snap.unit, unit),
      lo: convertTemp(snap.lo, snap.unit, unit),
      condition: tr(strings, snap.condition || 'clear'),
      rain_chance: typeof snap.rain_chance === 'number' && isFinite(snap.rain_chance) ? snap.rain_chance : null,
      icon: icon.indexOf('http') === 0 ? icon : WEATHER_ICON_BASE + icon,
      // The board draws a bare degree sign, but which unit produced the
      // number is a fact about the payload, so it travels with it.
      unit: unit,
    },
    milestones: materializeMilestones(snap.milestones, strings),
    sun: materializeSun(snap.sun),
    // One forecast per day of the run, converted the same way the header
    // is: saved state outlives the temperature setting, so a snapshot
    // taken in Celsius has to come back out in whatever the board is
    // showing now, per day as well as in the header.
    perDay: (Array.isArray(snap.perDay) ? snap.perDay : []).map(function (d) {
      var di = typeof d.icon === 'string' && d.icon ? d.icon : icon;
      return {
        hi: convertTemp(d.hi, snap.unit, unit),
        lo: convertTemp(d.lo, snap.unit, unit),
        condition: tr(strings, d.condition || 'clear'),
        rain_chance: typeof d.rain_chance === 'number' && isFinite(d.rain_chance) ? d.rain_chance : null,
        icon: di.indexOf('http') === 0 ? di : WEATHER_ICON_BASE + di,
        unit: unit,
        // A day's own sky band. The board draws one day of the run, and
        // its rain markers and its sunset have to be that day's.
        milestones: materializeMilestones(d.milestones, strings),
        sun: materializeSun(d.sun),
      };
    }),
  };
}

// Which unit the temperatures are in. The config wins over the account
// setting, exactly as timeFormat and locale do: the board is configured
// by whoever wrote the config, not by whose account it hangs on. Auto
// reads the LOCALE's region rather than a country list, so en-US is
// Fahrenheit and everywhere else, including the rest of the
// English-speaking world, is Celsius.
function resolveTempUnit(configUnit, settingRaw, locale) {
  var v = String(configUnit || settingRaw || 'auto').trim().toLowerCase();
  if (v === 'c' || v === 'celsius') return 'C';
  if (v === 'f' || v === 'fahrenheit') return 'F';
  return localeRegion(locale) === 'US' ? 'F' : 'C';
}

function localeRegion(locale) {
  var parts = String(locale || '').replace('_', '-').split('-');
  for (var i = 1; i < parts.length; i++) {
    if (/^[A-Za-z]{2}$/.test(parts[i])) return parts[i].toUpperCase();
  }
  return null;
}

// Returns a SNAPSHOT (see above), not rendered strings, so the caller can
// put it straight into trmnl_state.
async function fetchWeather(latLonRaw, tz, deadline, unit) {
  var latlon = parseLatLon(latLonRaw);
  if (!latlon) return null;
  try {
    var params = new URLSearchParams({
      latitude: String(latlon[0]), longitude: String(latlon[1]),
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode,sunrise,sunset',
      hourly: 'precipitation_probability',
      temperature_unit: unit === 'F' ? 'fahrenheit' : 'celsius',
      timezone: tz, forecast_days: String(DAY_SPAN),
    });
    var budget = msUntil(deadline);
    if (budget <= 0) return null;
    var resp = await fetchWithTimeout('https://api.open-meteo.com/v1/forecast?' + params.toString(), Math.min(budget, 3000));
    if (!resp.ok) return null;
    var body = await resp.json();
    var daily = body.daily || {};
    var info = weatherCodeInfo((daily.weathercode || [])[0]);

    // Sunrise and sunset of a given day of the run. Read at a fixed [0]
    // this drew TODAY's sunset on a board showing tomorrow: a small error
    // in minutes, but the sky band is meant to be the day's own shape.
    function sunFor(ix) {
      var out = [];
      var sr = isoToMinutes((daily.sunrise || [])[ix]), ss = isoToMinutes((daily.sunset || [])[ix]);
      if (sr != null) out.push({ kind: 'sunrise', atMin: sr });
      if (ss != null) out.push({ kind: 'sunset', atMin: ss });
      return out;
    }
    var sun = sunFor(0);

    var hourly = body.hourly || {};
    var times = hourly.time || [];
    var probs = hourly.precipitation_probability || [];

    // Every in-window hour of every day of the run, kept apart BY DAY, out
    // of the SAME hourly array the milestones came from. The service alert
    // has to name an hour and a probability, and this is the only place
    // both are known; deriving them later would mean a second call to the
    // forecast API for numbers this response already carried.
    //
    // Two reasons it is the whole day's hours and not just the wettest one
    // of them. The response covers the RUN of days and the board draws one
    // of them, so the wettest hour in the response may belong to a day
    // nobody is looking at. And the snapshot outlives the fetch by hours
    // (see resolveWeather), so the hour that was worth warning about when
    // it went out can be over by the time it is read; the banner picks its
    // hour at draw time, against the clock, and needs the day behind it to
    // pick a different one.
    var dayKeys = [];
    var dayHours = [];
    for (var j = 0; j < times.length; j++) {
      var pm = /^(\d{4}-\d{2}-\d{2})T(\d{2}):/.exec(times[j]);
      if (!pm) continue;
      var pMin = (+pm[2]) * 60;
      if (pMin < DAY_START_MIN || pMin > DAY_END_MIN) continue;
      var p = probs[j];
      if (typeof p !== 'number' || !isFinite(p)) continue;
      var dk = dayKeys.indexOf(pm[1]);
      if (dk < 0) { dk = dayKeys.length; dayKeys.push(pm[1]); dayHours.push([]); }
      dayHours[dk].push({ atMin: pMin, pct: p });
    }
    var peak = wettestHour(dayHours[0], null);

    // Milestones: first threshold up-crossing -> "Rain Starts", the next
    // down-crossing after it -> "Rain Stops", within ONE day. Reading
    // straight down the response instead put tomorrow's crossings on
    // today's board as soon as today had fewer than two of its own, and
    // carried "it is raining" across the midnight gap, so a dry 07:00
    // tomorrow became a "Rain Stops 07:00" drawn six hours BEFORE the
    // "Rain Starts 13:00" it belonged to. A day's rain starts and stops
    // within that day or not at all.
    function milestonesFor(hours) {
      var out = [];
      var wasAbove = false;
      (hours || []).forEach(function (h) {
        if (out.length >= 2) return;
        var above = h.pct >= RAIN_THRESHOLD;
        if (above && !wasAbove) out.push({ atMin: h.atMin, kind: 'rain_starts' });
        else if (!above && wasAbove) out.push({ atMin: h.atMin, kind: 'rain_stops' });
        wasAbove = above;
      });
      return out;
    }
    var milestones = milestonesFor(dayHours[0]);

    var rain = Math.round((daily.precipitation_probability_max || [])[0]);
    var hi = Math.round((daily.temperature_2m_max || [])[0]);
    var lo = Math.round((daily.temperature_2m_min || [])[0]);
    // One entry per day the board may draw. The header of a two-day board
    // that shows a single high and low is telling the truth about one of
    // the days and inventing it for the other.
    var perDay = [];
    for (var pd = 0; pd < DAY_SPAN; pd++) {
      var pdHi = (daily.temperature_2m_max || [])[pd];
      if (pdHi == null) break;
      var pdInfo = weatherCodeInfo((daily.weathercode || [])[pd]);
      perDay.push({
        hi: Math.round(pdHi),
        lo: Math.round((daily.temperature_2m_min || [])[pd]),
        rain_chance: Math.round((daily.precipitation_probability_max || [])[pd]),
        // the KEY, not a label: this is a snapshot, and the string it
        // becomes depends on a language that can change between the fetch
        // and the render
        condition: pdInfo.key, icon: pdInfo.icon,
        hours: dayHours[pd] || [],
        peak: wettestHour(dayHours[pd], null),
        milestones: milestonesFor(dayHours[pd]),
        sun: sunFor(pd),
      });
    }
    return {
      hi: isFinite(hi) ? hi : null,
      lo: isFinite(lo) ? lo : null,
      condition: info.key,
      icon: info.icon,
      // an absent probability stays absent: rendered as "0% rain" it reads
      // as a forecast of a dry day rather than as a missing number
      rain_chance: isFinite(rain) ? rain : null,
      unit: unit === 'F' ? 'F' : 'C',
      // Which civil day this snapshot's day 0 IS. A snapshot outlives its
      // fetch by hours and can outlive the day: without this, a forecast
      // taken at 23:30 is read at 04:00 as if its first day were the day
      // the reader is standing in, which is how yesterday's rain becomes
      // this morning's alert.
      date: (daily.time || [])[0] || dayKeys[0] || null,
      peak: peak,
      perDay: perDay,
      milestones: milestones,
      sun: sun,
    };
  } catch (e) {
    return null;
  }
}

// One place decides what weather the board shows: today's forecast if the
// API answers, otherwise the last snapshot that DID answer, out of saved
// state, flagged stale once it is old enough to be a different day's
// weather. Before this a single failed call blanked the header and every
// sky marker until the next refresh, which is the one thing an outage
// should not do to a board that had the answer fifteen minutes ago.
//
// The raw SNAPSHOT travels back out alongside the materialized weather:
// the service alert needs the unrendered facts (which hour is wettest, the
// condition key, the temperatures in the unit they were fetched in), and
// materializeWeather has already turned those into header strings by the
// time the caller sees them. Reading it back off the header would mean
// parsing "60" out of a localized string.
async function resolveWeather(latLonRaw, tz, deadline, state, unit, strings) {
  if (!latLonRaw) return { weather: null, stale: false, snapshot: null };
  var snap = await fetchWeather(latLonRaw, typeof tz === 'string' ? tz : 'GMT', deadline, unit);
  var nowS = Math.floor(Date.now() / 1000);
  if (snap) {
    if (state) { state.weather = snap; state.weatherFetchedAt = nowS; }
    return { weather: materializeWeather(snap, strings, unit), stale: false, snapshot: snap };
  }
  var saved = state && state.weather;
  if (!saved) return { weather: null, stale: false, snapshot: null };
  return {
    weather: materializeWeather(saved, strings, unit),
    stale: (nowS - ((state && state.weatherFetchedAt) || 0)) > WEATHER_STALE_AFTER_S,
    snapshot: saved,
  };
}

// ---------------------------------------------------------------------
// Service alert.
//
// One line along the bottom edge when the forecast breaches something the
// reader asked to be told about: "SERVICE ALERT · Heavy Rain Expected at
// 17:00 (80%)". It is composed and translated HERE, in full, because the
// template can print a string but cannot pick a preposition or an
// adjective ending, and every part after the label moves around between
// languages.
//
// It reads the snapshot resolveWeather already resolved, so it costs the
// render nothing: no second forecast call, no slice of the shared
// deadline, and a device running on the last good snapshot out of saved
// state still gets its alert. A snapshot written by an older build has no
// `peak`, so its rain and snow alerts wait for the next successful fetch
// rather than inventing an hour.
// ---------------------------------------------------------------------

// A blank number field is OFF, not zero. Read as zero, an unset "cold at or
// below" would fire on every frost in Celsius and never once in Fahrenheit,
// which is the same setting behaving differently depending on a field the
// reader did not touch either.
function numSetting(input, key) {
  var raw = cf(input, key).trim();
  if (!raw) return null;
  var n = Number(raw);
  return isFinite(n) ? n : null;
}

function alertSettings(input, unit, strings, hour12) {
  return {
    enabled: cf(input, 'alert_enabled').trim().toLowerCase() === 'true', // default OFF: an alert nobody asked for is an alert nobody trusts
    rainThreshold: numSetting(input, 'alert_rain_threshold'),
    snow: cf(input, 'alert_snow').trim().toLowerCase() !== 'false',
    tempLow: numSetting(input, 'alert_temp_low'),
    tempHigh: numSetting(input, 'alert_temp_high'),
    unit: unit, strings: strings, hour12: hour12,
  };
}

// The wettest hour at or after `from` minutes past midnight, out of one
// day's hourly probabilities. `from` is the whole point: an alert is a
// promise about what is COMING, and a banner reading "Heavy Rain Expected
// at 09:00" at seven in the evening is not a warning but a wrong statement
// about a morning everyone already lived through. An hour that is
// happening RIGHT NOW is still ahead of us (>=, not >): that is the rain
// starting, which is exactly what there is to say.
//
// Ties go to the earlier hour, which is the one you would move something
// out of. Anything malformed is dropped rather than defaulted: a snapshot
// is saved state, and an older build wrote a different shape.
function wettestHour(hours, from) {
  var best = null;
  (Array.isArray(hours) ? hours : []).forEach(function (h) {
    if (!h || typeof h.atMin !== 'number' || !isFinite(h.atMin)) return;
    if (typeof h.pct !== 'number' || !isFinite(h.pct)) return;
    if (from != null && h.atMin < from) return;
    if (!best || h.pct > best.pct) best = { atMin: h.atMin, pct: h.pct };
  });
  return best;
}

// `opts.dayIx` is which day of the run the board is drawing and
// `opts.nowMin` what time it is, both of which only the build knows (see
// alertFor). Without them this reads the whole forecast and can warn about
// tomorrow's rain on today's board, or about an hour that has gone.
function serviceAlert(snap, opts) {
  if (!opts || !opts.enabled || !snap || typeof snap !== 'object') return null;
  var strings = opts.strings || I18N.en;
  function banner(kind, vars) {
    return { kind: kind, text: tr(strings, 'alert_label') + ' · ' + fmt(tr(strings, 'alert_' + kind), vars) };
  }

  var dayIx = (typeof opts.dayIx === 'number' && opts.dayIx > 0) ? opts.dayIx : 0;
  var day = (Array.isArray(snap.perDay) && snap.perDay[dayIx]) || null;
  // The caller hands over a clock only when the day on the board is the
  // day we are standing in. Every hour of a later day is still ahead,
  // including its early ones: bounding those too would silence every
  // morning alert on a board set to tomorrow, which is the setting whose
  // whole job is warning you in advance.
  var from = (typeof opts.nowMin === 'number' && isFinite(opts.nowMin)) ? opts.nowMin : null;

  var peak;
  if (day && Array.isArray(day.hours)) peak = wettestHour(day.hours, from);
  // A snapshot from a build that saved one wettest hour and no day behind
  // it. There is nothing to re-pick from, so it is that hour or nothing,
  // and it is still held to the clock. It can only ever have been today's.
  else if (dayIx === 0) peak = wettestHour(snap.peak ? [snap.peak] : [], from);
  else peak = null;
  var when = peak ? { t: timeLabel12(peak.atMin, { hour12: opts.hour12 }), p: Math.round(peak.pct) } : null;

  // One banner, so the kinds are ranked by how much of the day has to
  // change because of them: snow stops travel outright, a temperature
  // extreme is an all-day fact you dress for, rain is an hour you move
  // something out of. Rain last also keeps the commonest breach from
  // burying the two rarer ones on a day that trips several.
  //
  // Snow is the forecast's own condition bucket (weatherCodeInfo), not a
  // temperature guess: sleet and freezing rain are 'rain' there and this is
  // not the place to re-derive that mapping.
  // The hour it names has to be one it is actually going to snow in.
  // While the banner was picked at fetch time this was implicit: the
  // wettest hour of a snowy day is a snowy hour. The wettest hour STILL TO
  // COME on a snowy morning can be a dry evening, and "Heavy Snow Expected
  // at 19:00 (5%)" is a worse banner than no banner. RAIN_THRESHOLD is
  // this file's own line between weather and precipitation (it is what
  // draws a rain_starts marker); the reader's rain threshold is not used,
  // because snow is a switch and not a number here.
  if (opts.snow && (day ? day.condition : snap.condition) === 'snow'
    && when && when.p >= RAIN_THRESHOLD) return banner('snow', when);

  // The day on the board, falling back to the top-level forecast for a
  // snapshot that has no run of days in it. Cold and heat name no hour, so
  // there is no hour of theirs to be in the past: a high of 36 is still
  // the day you had at eight in the evening.
  var lo = convertTemp(day ? day.lo : snap.lo, snap.unit, opts.unit);
  var hi = convertTemp(day ? day.hi : snap.hi, snap.unit, opts.unit);
  if (opts.tempLow != null && lo != null && lo <= opts.tempLow) return banner('cold', { v: Math.round(lo) });
  if (opts.tempHigh != null && hi != null && hi >= opts.tempHigh) return banner('heat', { v: Math.round(hi) });

  if (opts.rainThreshold != null && when && when.p >= opts.rainThreshold) return banner('rain', when);
  return null;
}

// How many civil days have passed since `iso` (a "YYYY-MM-DD" out of a
// snapshot), from the point of view of the civil day `today`. 0 when there
// is nothing to compare, so a snapshot that never recorded its day is read
// exactly as it was before.
function civilDaysSince(iso, today) {
  if (typeof iso !== 'string' || !today) return 0;
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return 0;
  var was = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  var now = Date.UTC(today.y, today.mo - 1, today.d);
  var d = Math.round((now - was) / 86400000);
  return isFinite(d) ? d : 0;
}

// The banner belongs to the day on the board, at the time it is being
// read, and neither of those is known where the forecast is resolved: the
// day is chosen from `show_day` deep inside the build, and the clock is
// the build's own `nowMin`. So the snapshot and the reader's thresholds
// travel in `extra` and the banner is composed here, once, by whichever
// build path ends up drawing.
function alertFor(extra, dayIx, nowMin) {
  if (!extra || !extra.alertOpts) return null;
  return serviceAlert(extra.wxSnapshot, Object.assign({}, extra.alertOpts,
    { dayIx: dayIx, nowMin: nowMin }));
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

// A comma-separated ICS list value, split on the separators only: a comma
// the writer escaped belongs to the value it sits in.
function icsList(value) {
  var out = [], cur = '';
  for (var i = 0; i < value.length; i++) {
    var c = value.charAt(i);
    if (c === '\\' && i + 1 < value.length) { cur += c + value.charAt(i + 1); i++; continue; }
    if (c === ',') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(function (v) { return unescapeIcsText(v).trim(); }).filter(Boolean);
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

// How many days of data transform gathers: today and tomorrow. The board
// draws ONE of them, chosen by the Show setting.
//
// A run of days on one axis was built and thrown away. On a panel this
// size it does not earn its place: three days of a family's week is three
// columns of an hour each, and what a wall calendar is for is the day you
// are in. The day model it needed stays, because it is right for its own
// reasons: absolute minutes across the run are what let a recurrence be
// evaluated per day and an event crossing midnight stay one event.
var DAY_SPAN = 2;

// A QUIET DAY BORROWS THE NEXT ONE.
//
// Two appointments on a day leave a board that is mostly empty paper, and
// the hours it is spending that paper on are hours nobody has anything in.
// Past this many events on the day being shown the board is the day itself;
// at or below it the window runs on past midnight into the next morning and
// afternoon, which is the part of "what is coming" a quiet day has to say.
//
// Counted on the day being SHOWN, over the whole of it rather than from the
// clock forwards. From the clock forwards the count falls as the day goes
// by, so a board with four meetings on it would flip into the rolling view
// somewhere in the afternoon and flip back at midnight: the panel refreshes
// every fifteen minutes and the shape of the board may not change under a
// reader between two of them. One decision per civil day, taken the same
// way at breakfast and at bedtime.
var QUIET_DAY_MAX_EVENTS = 2;
// The rolling window, in minutes from the shown day's own midnight: six in
// the morning to six in the evening of the day after it, which is the
// 36 hours the spec asks for. Anchored to the day and not to the clock,
// for the same reason the count is.
var ROLL_START_MIN = 6 * 60;
var ROLL_END_MIN = 1440 + 18 * 60;
// ...AND FURTHER WHEN TODAY IS ALREADY SPENT.
//
// Six in the evening of the following day is the right end for a board that
// opens this morning: past that it is asking a reader at breakfast to care
// about the night after next. It is the wrong end for a board read at ten at
// night, which has almost no today left in it -- nearly the whole axis is
// tomorrow already, and cutting tomorrow at six wall the one evening the
// reader is actually planning for.
//
// This is what the "Show: today, then tomorrow from the evening" setting used
// to be for, and it bought the same thing by DELETING today: at nine it threw
// away the rest of the evening while people were standing in front of the
// board. Stretching the end instead keeps both.
var ROLL_END_LATE_MIN = 1440 + 23 * 60;
// WHAT IS LEFT OF TODAY, NOT WHAT TODAY HAD, AND ONLY IN TWO STEPS.
//
// Counting the whole day answers "was this a quiet day", and nobody asks
// that. The question a board on a wall is standing there to answer is
// "what is coming", and it is asked in the evening, when a busy Tuesday
// has one thing left on it and eleven that already happened: a board that
// still calls that day busy spends itself on a morning nobody can attend
// any more.
//
// So the day is counted from a boundary that moves, and it moves exactly
// once, because a window keyed to the clock rescales under the reader
// every time the panel refreshes -- everything sliding left by a few
// pixels every fifteen minutes. Two shapes a day, at an hour anybody can
// predict, is the same contract the evening switch-over already has and
// gentler in what it does.
//
// FOUR IN THE AFTERNOON, and it was noon first. Noon is not the middle of
// a family's day, it is the middle of its working one: at 12:01 most of
// what a household does is still ahead of it, and a board that drops the
// morning then has thrown away half a day nobody had finished. Four is
// after school and before anybody is home, which is the same reasoning
// that put the switch-over at nine rather than six.
//
// The morning is not thrown away in any case: what falls before the
// window is counted at the leading edge as "+N earlier", which is an
// affordance the board already draws.
var ROLL_SPLIT_MIN = 16 * 60;
// A SECOND FIXED HOUR WAS TRIED HERE AND WAS THE WRONG SHAPE OF ANSWER.
//
// Counting from four and never re-counting meant a day with three or more
// things after four never reached tomorrow at all, so an unconditional
// boundary at nine was added to force it. That is guessing at what the count
// could simply be asked: at a quarter past eight the same board still drew
// only Saturday, because nine had not come round yet. The count is taken on
// the hour now (see countFrom) and the guess is gone.

// Civil date arithmetic, deliberately not epoch arithmetic: "the day after
// the 30th" is a calendar question, and answering it by adding 86400
// seconds gets it wrong on the two days a year a zone changes offset.
function addCivilDays(d, n) {
  var t = new Date(Date.UTC(d.y, d.mo - 1, d.d + n));
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
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

  // INTERVAL. A fortnightly meeting is FREQ=WEEKLY;INTERVAL=2, and read as
  // plain weekly it fires on the off weeks too. That is how a sprint review
  // nobody had scheduled turned up on the board: the ceremonies most likely
  // to carry an INTERVAL are exactly the ones a work calendar is full of.
  // Weeks are counted from Monday (WKST defaults to MO) so that a Friday
  // occurrence is in the same week as the Monday its series started on.
  var interval = Math.max(1, parseInt(parts.INTERVAL, 10) || 1);
  if (interval > 1) {
    var DAY_MS_R = 24 * 60 * 60 * 1000;
    var startWd = (new Date(startOrdinal).getUTCDay() + 6) % 7;
    var startMonday = startOrdinal - startWd * DAY_MS_R;
    var todayMonday = todayOrdinal - todayWeekday * DAY_MS_R;
    var weeksApart = Math.round((todayMonday - startMonday) / (7 * DAY_MS_R));
    if (weeksApart % interval !== 0) return false;
  }

  if (parts.BYDAY) {
    var days = parts.BYDAY.split(',');
    return days.indexOf(WD_NAMES[todayWeekday]) !== -1;
  }
  // No BYDAY: recurs weekly on DTSTART's own weekday.
  var startWeekday2 = (new Date(startOrdinal).getUTCDay() + 6) % 7; // 0=Mon
  return startWeekday2 === todayWeekday;
}

// FREQ=YEARLY, for whole-day entries only, which is what a public-holiday
// subscription is made of. Google writes one dated VEVENT per year and
// needs nothing here; Apple's holiday calendars and most school-holiday
// exports write Christmas Day once with a yearly rule. Read as an
// unsupported pattern, the second kind drew an empty board every year
// after the one it was written in and said nothing about why.
//
// Deliberately not general, the same bounded-subset reasoning the weekly
// rule is written to. The anniversary of DTSTART is the answer, with
// UNTIL and INTERVAL honoured; an ORDINAL BYDAY ("the fourth Thursday in
// November") moves the date every year, so it is refused outright rather
// than answered approximately. A feed that needs one is exactly why the
// per-year form exists, and that form still works.
function yearlyRruleMatchesToday(rruleValue, dtstartCivil, todayY, todayMo, todayD) {
  var parts = {};
  rruleValue.split(';').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i > 0) parts[kv.slice(0, i)] = kv.slice(i + 1);
  });
  if ((parts.FREQ || '').toUpperCase() !== 'YEARLY') return false;
  if (parts.BYDAY && /\d/.test(parts.BYDAY)) return false;
  if (todayMo !== dtstartCivil.mo || todayD !== dtstartCivil.d) return false;
  if (todayY < dtstartCivil.y) return false;
  if (parts.UNTIL) {
    var um = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL);
    if (um && Date.UTC(todayY, todayMo - 1, todayD) > Date.UTC(+um[1], +um[2] - 1, +um[3])) return false;
  }
  var interval = Math.max(1, parseInt(parts.INTERVAL, 10) || 1);
  return (todayY - dtstartCivil.y) % interval === 0;
}

// `includeDescription` (a per-calendar config flag, off by default) is the
// only thing that makes parseIcs pay for DESCRIPTION at all — it's usually
// a large multi-line blob and most calendars' rules never need it.
//
// Returns { timed, allDay } — allDay entries carry no time-of-day (they're
// {title, desc, status} only): only whole-day coverage decides whether one
// applies today, matched to the day's own civil date, not a UTC one.
// `days` is the run of civil dates the board covers, day 0 first. Every
// minute this returns is ABSOLUTE on that run: 09:00 on day 1 is 1980, not
// 540. One number line for the whole board is what lets a night be a
// stretch of axis like any other, an event that crosses midnight be one
// event, and every downstream comparison stay a plain comparison. A single
// day is the same code with a list of one.
function parseIcs(text, tz, days, includeDescription) {
  var today = days[0];
  var rows = unfoldIcs(text);
  var raw = [];
  var cur = null;
  // The feed's own name. A config that names its calendars never needs it,
  // but the simplest setup there is — a list of ICS links and nothing else
  // — has no other way to know whose row this is.
  var calName = null;
  rows.forEach(function (row) {
    if (row === 'BEGIN:VEVENT') { cur = {}; return; }
    if (row === 'END:VEVENT') { if (cur) raw.push(cur); cur = null; return; }
    if (!cur) {
      if (row.indexOf('X-WR-CALNAME:') === 0) calName = unescapeIcsText(row.slice('X-WR-CALNAME:'.length)).trim() || null;
      return;
    }
    var idx = row.indexOf(':');
    if (idx < 0) return;
    var keyPart = row.slice(0, idx);
    var value = row.slice(idx + 1);
    var key = keyPart.split(';')[0];
    var params = keyPart.slice(key.length);
    if (key === 'DTSTART') cur.dtstart = parseIcsDateTime(params, value, tz);
    else if (key === 'DTEND') cur.dtend = parseIcsDateTime(params, value, tz);
    else if (key === 'SUMMARY') cur.title = unescapeIcsText(value);
    else if (key === 'LOCATION') cur.location = unescapeIcsText(value);
    // CATEGORIES is a LIST, and the property may appear more than once.
    // Split before unescaping, or an escaped comma inside one category
    // ("Kids\, school") becomes a separator and one category becomes two.
    else if (key === 'CATEGORIES') cur.categories = (cur.categories || []).concat(icsList(value));
    else if (key === 'DESCRIPTION' && includeDescription) cur.desc = unescapeIcsText(value);
    else if (key === 'STATUS') cur.status = value.trim().toUpperCase();
    else if (key === 'RRULE') cur.rrule = value;
    else if (key === 'UID') cur.uid = value.trim();
    else if (key === 'RECURRENCE-ID') cur.recurrenceId = parseIcsDateTime(params, value, tz);
    // EXDATE: the occurrences of a series that were taken OUT of it. A
    // standup you deleted for one day is still in the file, as a rule that
    // fires and a date that says not this time; without this the board
    // shows a meeting the calendar says is not happening. Comma-separated
    // and repeatable, so both forms are collected.
    else if (key === 'EXDATE') {
      value.split(',').forEach(function (v) {
        var ex = parseIcsDateTime(params, v.trim(), tz);
        if (!ex) return;
        (cur.exdates = cur.exdates || {})[ex.y + '-' + ex.mo + '-' + ex.d] = true;
      });
    }
  });

  var DAY_MS = 24 * 60 * 60 * 1000;
  var dayInfo = days.map(function (d) {
    return {
      d: d,
      weekday: (new Date(Date.UTC(d.y, d.mo - 1, d.d)).getUTCDay() + 6) % 7,
      key: d.y + '-' + d.mo + '-' + d.d,
      ordinal: Date.UTC(d.y, d.mo - 1, d.d),
    };
  });

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
      dayInfo.forEach(function (di, dayIx) {
        var isDirectSpan = di.ordinal >= startOrd && di.ordinal < endOrd;
        var isRepeatSpan = !isDirectSpan && ev.rrule && (endOrd - startOrd) <= DAY_MS
          && (weeklyRruleMatchesToday(ev.rrule, ev.dtstart, di.d.y, di.d.mo, di.d.d, di.weekday, tz)
            || yearlyRruleMatchesToday(ev.rrule, ev.dtstart, di.d.y, di.d.mo, di.d.d));
        if (!isDirectSpan && !isRepeatSpan) return;
        if (!ev.recurrenceId && ev.uid && overriddenDates[ev.uid + '|' + di.key]) return;
        if (ev.exdates && ev.exdates[di.key]) return;   // taken out of the series
        // HOW LONG IT RUNS, AND HOW FAR INTO IT THIS DAY IS. A board that
        // draws one day out of a week of half term can say which day of it
        // that is, and that ordinal is the only thing distinguishing the
        // Monday of Spring Break from the Thursday. Counted off DTSTART and
        // the exclusive DTEND rather than off the run of days the board
        // gathered, so a range that began last week still says "day 5 of 9".
        var spanDays = Math.max(1, Math.round((endOrd - startOrd) / DAY_MS));
        allDay.push({ title: ev.title, desc: ev.desc || '', status: ev.status || '',
          location: ev.location || '', categories: ev.categories || [], day: dayIx,
          // Each firing of a recurrence is one day of its own, whatever
          // span the master's own dates describe.
          span: isRepeatSpan ? 1 : spanDays,
          index: isRepeatSpan ? 0 : Math.max(0, Math.round((di.ordinal - startOrd) / DAY_MS)) });
      });
      return;
    }

    var durationMin = null;
    if (ev.dtend && !ev.dtend.isAllDay) {
      durationMin = (ev.dtend.h * 60 + ev.dtend.mi) - (ev.dtstart.h * 60 + ev.dtstart.mi);
      if (durationMin < 0) durationMin += 24 * 60; // crossed midnight in local time — approximate
    }

    dayInfo.forEach(function (di, dayIx) {
      var isDirectHit = ev.dtstart.y === di.d.y && ev.dtstart.mo === di.d.mo && ev.dtstart.d === di.d.d;
      var isWeeklyHit = !isDirectHit && ev.rrule
        && weeklyRruleMatchesToday(ev.rrule, ev.dtstart, di.d.y, di.d.mo, di.d.d, di.weekday, tz);
      if (!isDirectHit && !isWeeklyHit) return;
      // superseded by an override on THAT day
      if (!ev.recurrenceId && ev.uid && overriddenDates[ev.uid + '|' + di.key]) return;
      if (ev.exdates && ev.exdates[di.key]) return;   // taken out of the series
      // absolute on the run of days: the time of day it lands at, plus the
      // whole days before it
      var startMin = dayIx * 1440 + ev.dtstart.h * 60 + ev.dtstart.mi;
      out.push({
        title: ev.title,
        desc: ev.desc || '',
        status: ev.status || '',
        location: ev.location,
        categories: ev.categories || [],
        day: dayIx,
        startMin: startMin,
        endMin: durationMin != null ? startMin + durationMin : null,
      });
    });
  });
  return { timed: out, allDay: allDay, calName: calName };
}

// ---------------------------------------------------------------------
// Rule engine — ported from plugin/src/transform.js's own compileMatcher/
// compileRule/compileRuleList/parseConfig/applyCalendarRules (same config
// shape, same semantics). See the file header for the feature summary.
// ---------------------------------------------------------------------

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A `track` field can be one name or a list — always normalized to a
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
    return { rx: null, usesDesc: subs.some(function (m) { return m.usesDesc; }), test: function (ctx) {
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
    return { rx: null, usesDesc: negated.usesDesc, test: function (ctx) { return !negated.test(ctx); } };
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
  // How long the event runs, in minutes. What it is FOR is the shape of a
  // day rather than its words: a block that lasts all morning is a
  // different kind of thing from a half-hour meeting, whatever either is
  // called, and "anything over four hours is a siding" says that once
  // instead of listing every status block a household can invent.
  if (spec.type === 'duration') {
    var dMin = finiteOr(spec.min, null), dMax = finiteOr(spec.max, null);
    if (dMin == null && dMax == null) return null;
    return { rx: null, test: function (ctx) {
      if (ctx.durationMin == null) return false;
      if (dMin != null && ctx.durationMin < dMin) return false;
      if (dMax != null && ctx.durationMin > dMax) return false;
      return true;
    } };
  }
  // When it starts, as minutes past the event's own midnight. `from` is
  // inclusive and `to` exclusive, so 07:00-09:00 and 09:00-12:00 tile
  // without either claiming nine o'clock twice.
  if (spec.type === 'time') {
    var tFrom = hhmmToMin(spec.from), tTo = hhmmToMin(spec.to);
    if (tFrom == null && tTo == null) return null;
    return { rx: null, test: function (ctx) {
      if (ctx.startOfDayMin == null) return false;
      if (tFrom != null && ctx.startOfDayMin < tFrom) return false;
      if (tTo != null && ctx.startOfDayMin >= tTo) return false;
      return true;
    } };
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
  var field = MATCH_FIELDS[String(spec.field || '').trim().toLowerCase()] ? String(spec.field).trim().toLowerCase() : null;
  return {
    rx: rx,
    // Only an EXPLICIT request for the description makes a calendar fetch
    // it (see parseConfig): the default field already reads it when the
    // calendar opted in, and asking for it by name is opting in.
    usesDesc: field === 'description' || field === 'any',
    test: function (ctx) {
      var parts = fieldTexts(ctx, field);
      for (var i = 0; i < parts.length; i++) if (parts[i] && rx.test(parts[i])) return true;
      return false;
    },
  };
}

// Which property a text matcher reads. Absent, it reads the event's own
// text: the title, plus the description when the calendar opted into one.
// That is what a matcher with no field has always done and what every
// existing config is written against, so it stays the default rather than
// becoming "title" with a rename of the behaviour.
var MATCH_FIELDS = { title: 1, description: 1, location: 1, categories: 1, any: 1 };

// The strings one matcher tests, each on its own. Kept as a LIST rather
// than joined: `exact` anchors to the ends of what it is given, so a join
// would quietly stop it ever matching, and one event can carry several
// categories, each of which is its own whole value.
function fieldTexts(ctx, field) {
  if (field === 'title') return [ctx.title];
  if (field === 'description') return [ctx.desc];
  if (field === 'location') return [ctx.location];
  if (field === 'categories') return ctx.categories;
  if (field === 'any') return [ctx.title, ctx.desc, ctx.location].concat(ctx.categories);
  return [ctx.title, ctx.desc];
}

function finiteOr(v, dflt) {
  var n = typeof v === 'string' ? Number(v.trim()) : v;
  return typeof n === 'number' && isFinite(n) ? n : dflt;
}

// "HH:MM" (or "H:MM", or a bare hour) to minutes past midnight.
function hhmmToMin(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  var m = /^\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(v);
  if (!m) return null;
  var h = +m[1], mi = m[2] ? +m[2] : 0;
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}

function compileRule(spec) {
  if (!spec || typeof spec !== 'object') return null;
  var m = compileMatcher(spec.match);
  if (!m) return null;
  var line = normalizeNameList(spec.line);
  var allDay = spec.allDay === true;
  // A HOLIDAY IS A PROPERTY OF THE DAY, NOT A STATE OF A LINE. `allDay`
  // declares an event at ONE line's head, which is right for one person's
  // leave and wrong for Christmas Day: routed by whichever rule happened
  // to match, a national holiday landed on the first configured line and
  // said that person alone was off. This takes the event off the line
  // model altogether, so it resolves no owner and can create no line.
  var holiday = spec.holiday === true;
  var hide = spec.hide === true;
  // `siding` (and the `station` it shipped as) used to live here: a rule
  // could declare that an event's own line leaves the running line for its
  // span instead of branching into a lane. Both keys are gone, and a config
  // that still carries either is read the same as one that does not — the
  // key is simply ignored, which is what happens to any key this does not
  // recognise. The layout decides it now, from how long the block is; see
  // SIDING_MIN_MIN in buildFromConfig.

  var rewrite = typeof spec.rewrite === 'string' ? spec.rewrite : null;
  var rewriteFull = spec.rewriteFull === true;
  if (!line && !allDay && !holiday && !hide && rewrite === null) return null; // a no-op rule is dropped, not kept
  var isAnyMatch = spec.match && (spec.match.type === 'any' || spec.match.type === 'all');
  // rename defaults to true (a rule assigning a track also renames the
  // title to that track, historically the common case) EXCEPT on an
  // any/all match, where there's no specific text to rename and silently
  // overwriting every title would be surprising — there it defaults to
  // false and must be opted into.
  var rename = line ? (isAnyMatch ? spec.rename === true : spec.rename !== false) : false;
  return { match: m.test, rx: m.rx, usesDesc: !!m.usesDesc, line: line, allDay: allDay, holiday: holiday, hide: hide, rename: rename, rewrite: rewrite, rewriteFull: rewriteFull };
}

function usesDesc(rule) { return !!(rule && rule.usesDesc); }

function compileRuleList(raw) {
  var rules = [];
  (Array.isArray(raw) ? raw : []).forEach(function (spec) {
    var compiled = compileRule(spec);
    if (compiled) rules.push(compiled);
  });
  return rules;
}

// A backslash means something in JSON and something else in markdown, and a
// chat window that escapes its answer for markdown hands back an escaped
// bracket around every array and a stray one at the end of every line. JSON
// allows a backslash only before one of nine characters, so any other one
// was put there by markdown and comes back out. Runs left to right, so a real
// escaped backslash is consumed as itself and cannot eat the character
// after it.
function unescapeMarkdown(whole, ch) {
  return '"\\/bfnrtu'.indexOf(ch) >= 0 ? whole : ch;
}

// Whatever an assistant or a chat client did to the JSON on its way here.
// Every substitution below is one that has actually come back from a chat
// window: the answer fenced as markdown, quotes turned typographic, spaces
// turned non-breaking, a trailing comma. This runs only after strict
// JSON.parse has already refused the text, so it can afford to be blunt.
function tidyConfigText(raw) {
  var t = String(raw == null ? '' : raw).replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\u2060]/g, '')
    .trim();
  var fence = /```[a-zA-Z0-9]*[ \t]*\r?\n([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1].trim();
  t = t.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/\u00A0/g, ' ')
    .replace(/\\(\r?\n)/g, '$1')
    .replace(/\\(.)/g, unescapeMarkdown)
    .replace(/,(\s*[}\]])/g, '$1');
  return t.trim();
}

// Did this text mean to be a configuration? A link list never opens with a
// brace or a code fence, so anything that does is a config, working or not.
function looksLikeConfigJson(raw) {
  var t = String(raw == null ? '' : raw).replace(/^\uFEFF/, '').trim();
  return t.charAt(0) === '{' || t.charAt(0) === '[' || t.indexOf('```') === 0;
}

// ONE LINK PER LINE, AND ONE WORD IF IT IS A HOLIDAY FEED.
//
// The plain list is the low-friction path: paste links, get a line each.
// That is exactly wrong for a subscribed holiday calendar, which is not a
// person -- pasted into the list it became a rail named "Holidays in
// Belgium" with chevrons at both ends, and there was no JSON in which to
// say otherwise. The whole point of the plain list is not having to write
// JSON, so "go and write JSON" is not an answer.
//
// A trailing word. A URL cannot contain a bare space, so a space and a word
// after one is unambiguous, needs no punctuation anybody has to look up,
// and reads as what it is:
//
//   https://example.com/work.ics
//   https://calendar.google.com/.../holidays.ics holiday
//
// Only this one word, and only at the end: the list is meant to stay a
// list, and a second syntax with options in it is the JSON config wearing
// a disguise.
function plainListEntry(raw) {
  var line = String(raw == null ? '' : raw).trim();
  if (!line) return null;
  var m = /^(\S+)\s+holiday$/i.exec(line);
  if (m) return { url: m[1], holiday: true };
  return line;
}

// Parses the "Calendar Config (JSON)" setting text into
// { calendars, lines, timeZone, globalRules, everyoneLine }. Never
// throws: invalid JSON falls back to treating the text as a plain
// newline-separated list of calendar URLs (a low-friction path for
// someone who just wants to paste ICS links with no rules at all).
function parseConfig(raw) {
  var data = null;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      data = JSON.parse(raw);
    } catch (e) {
      // Strict JSON said no. A config that came out of a chat window is
      // usually still a config: it arrives wrapped in a ```json fence, with
      // typographic quotes the chat client substituted, or with a trailing
      // comma. Tidy it and try once more before deciding this is a list of
      // links.
      var tidy = tidyConfigText(raw);
      try {
        data = JSON.parse(tidy);
      } catch (e2) {
        // Only text that never claimed to be JSON becomes a link list. Text
        // that opens with a brace is a broken config, and reading its lines
        // as URLs would draw a board of nonsense rather than fall back to
        // the demo.
        data = looksLikeConfigJson(raw)
          ? {}
          : { calendars: raw.split(/\r?\n/).map(function (l) { return plainListEntry(l); }).filter(Boolean) };
      }
    }
  }
  if (!data || typeof data !== 'object') data = {};

  function str(v) { return typeof v === 'string' && v.trim() ? v.trim() : null; }
  // A config can set its own locale, zone and clock. All three are about how
  // this board should read rather than whose account it is on, so they beat
  // the account settings — a family board hanging in a Belgian kitchen may
  // still want a US-format demo, and the person configuring it is the one
  // who knows.
  var timeZone = str(data.timeZone);
  var locale = str(data.locale);
  var timeFormat = (function () {
    var v = str(data.timeFormat);
    if (!v) return null;
    v = v.toLowerCase();
    return v === '12h' || v === '24h' || v === 'auto' ? v : null;
  })();
  // Same reasoning as timeFormat, and the same shape: a value the config
  // sets beats the account setting, anything unrecognised is ignored
  // rather than guessed at. Deliberately not surfaced in the editor or the
  // AI prompt: it is for a board whose reader does not use the unit their
  // account language implies.
  var temperatureUnit = (function () {
    var v = str(data.temperatureUnit);
    if (!v) return null;
    v = v.toLowerCase();
    if (v === 'c' || v === 'celsius') return 'c';
    if (v === 'f' || v === 'fahrenheit') return 'f';
    return v === 'auto' ? 'auto' : null;
  })();

  var lines = {};
  var everyoneLine = null;
  // One name for the field, everywhere: `lines`. Nothing was released
  // under the old one, so there is nothing to keep reading it for.
  (Array.isArray(data.lines) ? data.lines : []).forEach(function (item) {
    if (!item || typeof item !== 'object') return;
    var name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) return;
    var color = typeof item.color === 'string' ? item.color.trim().toLowerCase() : '';
    var badgeSrc = typeof item.badge === 'string' && item.badge.trim() ? item.badge.trim() : name;
    var badge = Array.from(badgeSrc)[0].toUpperCase(); // Array.from, not [0] — keeps a full surrogate pair (emoji) intact
    // optional explicit side of the map: "left"/"work" or "right"/"family"
    var sideRaw = typeof item.side === 'string' ? item.side.trim().toLowerCase() : '';
    var side = (sideRaw === 'left' || sideRaw === 'work') ? 'left' : (sideRaw === 'right' || sideRaw === 'family') ? 'right' : null;
    if (everyoneLine === null) everyoneLine = name;
    // A DECLARED LINE IS DRAWN, QUIET DAY OR NOT.
    //
    // It used to be the other way round: a line with nothing on today was
    // dropped unless it said `hideIfEmpty: false`. That made the board a
    // different shape every day and quietly deleted whoever had nothing on
    // -- which is exactly the day you look at a family board to check. A
    // name in `lines[]` is somebody saying "this person is on this board",
    // and an empty rail with their name on it is an answer, not noise.
    // `hideIfEmpty: true` still drops it, for a line that only matters on
    // the days it is used. (A CALENDAR's line is not the same thing and
    // keeps the old default: a feed named "School" whose events are all
    // routed to the children is a router, not a person, and drawing it
    // would put an empty School rail on the board.)
    lines[name.toLowerCase()] = { name: name, color: color, badge: badge, side: side, keepEmpty: item.hideIfEmpty !== true };
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
    // Asking for the description by name IS opting in. Before this, a rule
    // reading it silently matched nothing until you also found the
    // includeDescription switch, which is a rule that looks broken.
    var includeDescription = item.includeDescription === true
      || globalRules.some(usesDesc) || rules.some(usesDesc);
    // The same switch on the calendar rather than the track: for the common
    // setup where one calendar IS one line, this is where the line is
    // declared, and there may be no lines[] entry to hang it off at all.
    // ONE WORD FOR A HOLIDAY SUBSCRIPTION. "Holidays in Belgium" is not a
    // person and has no line: everything in that feed belongs to the day.
    // Set here it applies to the whole calendar, which is the setup almost
    // everyone has, and it stops the feed both from leaking a ghost line
    // named after itself and from stamping the whole country's Christmas
    // on whoever happens to be first in `lines`. A rule can say the same
    // thing per event, for a feed that carries both kinds.
    calendars.push({ name: name, url: item.url.trim(), rules: rules, headers: headers,
      includeDescription: includeDescription, keepEmpty: item.hideIfEmpty === false,
      holiday: item.holiday === true });
  });

  return { calendars: calendars, lines: lines, timeZone: timeZone, locale: locale, timeFormat: timeFormat, temperatureUnit: temperatureUnit, globalRules: globalRules, everyoneLine: everyoneLine };
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
// a later matching rule's track/rewrite overrides an earlier one's,
// and a calendar's own rule is listed after globals so it wins ties).
// Returns { title, lineNames, allDay, hide }; lineNames is an array
// (possibly with more than one name — a multi-track rule becomes an
// interchange event) or null if nothing assigned one.
function applyCalendarRules(ev, weekday, cal, globalRules, everyoneLine) {
  var originalTitle = ev.title;
  // Everything a matcher may ask about, in one shape, so a rule reads the
  // event rather than the four arguments somebody happened to pass down.
  // The clock fields are minutes past the event's OWN midnight: startMin
  // is absolute across the run of days, and "starts before nine" is a
  // question about a morning, not about an offset from the first one.
  var ctx = {
    title: originalTitle,
    desc: ev.desc || '',
    location: ev.location || '',
    categories: Array.isArray(ev.categories) ? ev.categories : [],
    status: ev.status || '',
    weekday: (weekday === undefined || weekday === null) ? null : weekday,
    startOfDayMin: typeof ev.startMin === 'number' ? ((ev.startMin % 1440) + 1440) % 1440 : null,
    durationMin: (typeof ev.startMin === 'number' && typeof ev.endMin === 'number') ? ev.endMin - ev.startMin : null,
  };
  var lineNames = null;
  var renameRule = null;
  var rewriteRule = null;
  var allDay = false;
  var holiday = false;
  var hide = false;

  globalRules.concat(cal.rules).forEach(function (rule) {
    if (!rule.match(ctx)) return;
    if (rule.hide) hide = true;
    if (rule.allDay) allDay = true;
    if (rule.holiday) holiday = true;

    if (rule.line) {
      lineNames = rule.line;
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
    finalTitle = replaceMatch(originalTitle, renameRule.rx, renameRule.line.join(' & '));
  }
  // MIND THE HOLE THE RULE LEFT.
  //
  // Cutting a class code out of "L2 Zwemmen" leaves " Zwemmen", and cutting
  // one out of the middle leaves two spaces where it was. The board prints
  // the title as it is given, so that reached the panel as a caption
  // indented by a space nobody could explain. A rewrite is a cut, and
  // whatever it takes out it takes the gap out with it.
  if (finalTitle !== originalTitle) finalTitle = finalTitle.replace(/\s+/g, ' ').trim();
  // NOTE: everyoneLine is deliberately NOT applied here — a calendar's
  // own name is meant to be the fallback for one that has no rule
  // assigning anyone (see buildFromConfig), and everyoneLine is the
  // last resort after THAT. Applying it here unconditionally used to make
  // the calendar-name fallback unreachable dead code: with lines[] set,
  // EVERY unnamed-by-rule event (i.e. every event from any calendar with
  // no rules at all, or whose rules didn't match this one) landed on
  // everyoneLine instead of that calendar's own name — so calendars
  // literally named after a track (a common real setup: one calendar per
  // family member, no rules needed) never got their events attributed to
  // themselves at all.

  return { title: finalTitle, lineNames: lineNames, allDay: allDay, holiday: holiday, hide: hide };
}

// Converts a config track's `color` (a plain framework hue name like
// "blue", or "gray-NN"/"black"/"white") into the "hue-65"-style token
// this plugin's lines/nodes use ("hue-40" style) — null (fall back to the auto HUE_CYCLE)
// if unset or not one of those.
function hueTokenForColor(color) {
  if (!color) return null;
  if (HUE_NAMES.indexOf(color) !== -1) return color + '-40';
  if (color === 'black' || color === 'white' || /^gray-\d+$/.test(color)) return color;
  return null;
}

// A small, growable track registry — seeded from parsed.lines, but
// calendars with no track-assigning rule (e.g. a shared "Family"
// calendar) fall back to using the CALENDAR's own name as an implicit
// track, added here the first time it's encountered, so those events
// still get a track instead of silently vanishing.
//
// Which SIDE each track ends up on is decided once, in finalize() —
// called after every calendar has been fetched and every event tallied —
// not by any calendar's name. A track's `side` in config (if set) is
// honored; everyone else is balanced across the two sides by their own
// event count (heaviest first, each going to whichever side is currently
// lighter), so the split reflects the actual day's data instead of a
// fixed "Work calendar" convention.
function makeLineRegistry(parsed) {
  var order = [];
  var byName = {};
  var counts = {};
  var keyIdx = 0;

  function add(name, weight) {
    if (!byName[name]) {
      byName[name] = { key: 'p' + (keyIdx++), name: name, side: null, hue: null, line_offset: null, line_width: null, line_style: null, initial: null };
      order.push(name);
      counts[name] = 0;
    }
    counts[name] += (weight == null ? 1 : weight);
    return byName[name];
  }

  // Registered, weightless, and kept even with nothing on it today. Used by
  // `hideIfEmpty: false` on a track or a calendar.
  function keep(name) {
    if (!name) return null;
    var t = add(name, 0);
    t.keep_empty = true;
    return t;
  }

  function explicitSide(name) {
    var c = parsed.lines[name.toLowerCase()];
    return (c && (c.side === 'left' || c.side === 'right')) ? c.side : null;
  }

  // How often two lines are in the same place at the same time. Every
  // shared event links each pair it joins, and those links decide the ORDER
  // the lines are laid out in: a family that eats dinner together should not
  // have to read across two other people's days to see that they did.
  var affinity = {};
  // ...and the GROUPS themselves, with the minute each happened. Pair counts
  // say who belongs together; only the groups say who is stranded in the
  // middle of somebody else's, and only the minute says whether two lines
  // could exchange places between one and the next instead of crossing.
  var groups = [];
  // who takes part in a shared event at all, which is who has anywhere to
  // lean to and therefore anything to cross on the way
  var sharer = {};
  function pairKey(a, b) { return a < b ? a + '\u0000' + b : b + '\u0000' + a; }
  function link(names, weight, atMin) {
    if (names.length > 1) {
      groups.push({ names: names.slice(), at: atMin == null ? 0 : atMin });
      for (var m = 0; m < names.length; m++) sharer[names[m]] = true;
    }
    for (var i = 0; i < names.length; i++) {
      for (var j = i + 1; j < names.length; j++) {
        var k = pairKey(names[i], names[j]);
        affinity[k] = (affinity[k] || 0) + (weight == null ? 1 : weight);
      }
    }
  }
  function affinityOf(a, b) { return affinity[pairKey(a, b)] || 0; }

  // Lay the lines out as ONE chain, strongest link first, then extended at
  // whichever end offers the strongest next link. The board is a chain too —
  // outermost left ... innermost left, spine, innermost right ... outermost
  // right — so a chain laid along it keeps every consecutive pair adjacent,
  // including the pair either side of the spine. Cutting it anywhere gives a
  // valid two-sided layout, which is what lets the split be chosen for
  // balance without disturbing the order.
  function affinityChain() {
    var left = order.slice();
    if (left.length < 3) return left;
    var best = null;
    for (var i = 0; i < left.length; i++) {
      for (var j = i + 1; j < left.length; j++) {
        var w = affinityOf(left[i], left[j]);
        if (!best || w > best.w || (w === best.w && counts[left[i]] + counts[left[j]] > best.c)) {
          best = { a: left[i], b: left[j], w: w, c: counts[left[i]] + counts[left[j]] };
        }
      }
    }
    var chain = [best.a, best.b];
    left = left.filter(function (n) { return n !== best.a && n !== best.b; });
    while (left.length) {
      var pick = null;
      left.forEach(function (n) {
        [['head', chain[0]], ['tail', chain[chain.length - 1]]].forEach(function (endp) {
          var w = affinityOf(n, endp[1]);
          if (!pick || w > pick.w || (w === pick.w && counts[n] > counts[pick.n])) {
            pick = { n: n, end: endp[0], w: w };
          }
        });
      });
      if (pick.end === 'head') chain.unshift(pick.n); else chain.push(pick.n);
      left = left.filter(function (n) { return n !== pick.n; });
    }
    return chain;
  }

  // FEWEST CROSSINGS, NOT MOST AFFINITY.
  //
  // A chain built strongest-link-first keeps the strongest pairs together
  // and can still leave somebody stranded in the middle of a group they are
  // not in. Every line sitting between two people who share an event is a
  // line their lines have to cross to reach each other, and now that a
  // shared event MOVES the trunks rather than dropping a rail from each,
  // that crossing is real ink on the board.
  //
  // It can also be counted -- for each shared event, how many non-members
  // sit between its outermost members -- and a household is small enough
  // that counting it for every possible order is cheaper than being clever
  // about it. Eight lines is 40320 orders and the board caps at seven.
  function interference(seq, from, to) {
    var pos = {}, cost = 0;
    for (var i = 0; i < seq.length; i++) pos[seq[i]] = i;
    for (var g = 0; g < groups.length; g++) {
      if (from != null && g < from) continue;
      if (to != null && g >= to) continue;
      var names = groups[g].names, lo = Infinity, hi = -1, inside = {};
      for (var n = 0; n < names.length; n++) {
        var ix = pos[names[n]];
        if (ix == null) continue;
        if (ix < lo) lo = ix;
        if (ix > hi) hi = ix;
        inside[ix] = true;
      }
      if (hi < 0) continue;
      for (var k = lo + 1; k < hi; k++) if (!inside[k]) cost++;
    }
    return cost;
  }
  // WHAT A TRUNK HAS TO CROSS TO REACH THE MIDDLE.
  //
  // Every line in a shared event leans in towards the others, and the
  // middle of the board is where they meet. On the way it crosses every
  // band between it and there, and a band is not empty space: it is that
  // line's own branches, their rails and their names. Maggie's descent to
  // Family Dinner is drawn straight through "Moe's Tavern", because Homer
  // sits between her and the middle with five events in his band.
  //
  // Nothing in the score could see it. `interference` counts a line caught
  // INSIDE a group it is not part of, and neither of them is: the only
  // event spanning the two of them is the dinner, and it contains
  // everybody. So their order fell through to the affinity tie-break,
  // which knows only how often two people share a day, and that is equal
  // for the pair.
  //
  // So a line pays for the branches it makes somebody else cross. The
  // chain is the board laid flat -- outermost, inward, the middle, outward,
  // outermost -- so the cut `finalize` makes is near the centre of it, and
  // "between this line and the middle" is the run of chain positions
  // between it and there. The busy lines end up at the ends and the quiet
  // ones near the middle, which is where the convergences are.
  function crossLoad(seq) {
    var mid = (seq.length - 1) / 2, cost = 0;
    for (var i = 0; i < seq.length; i++) {
      if (!sharer[seq[i]]) continue;
      var lo = Math.min(i, mid), hi = Math.max(i, mid);
      for (var j = 0; j < seq.length; j++) {
        if (j > lo && j < hi) cost += counts[seq[j]] || 0;
      }
    }
    return Math.round(cost * 2);
  }
  // The old objective, kept as the last tie-break: among orders that cross
  // the same number of times and make each other's trunks cross the same
  // amount of ink, the one that puts the closest pairs next to each other
  // is the one worth drawing.
  function adjAffinity(seq) {
    var sum = 0;
    for (var i = 1; i < seq.length; i++) sum += affinityOf(seq[i - 1], seq[i]);
    return sum;
  }
  // A WEAVE IS WORTH ONE CROSSING AND CAN SAVE SEVERAL.
  //
  // Two lines that need different neighbours in the morning and the evening
  // cannot both be had from one fixed order: somebody reads across somebody
  // else all day. Letting the pair exchange places once, between two events,
  // costs the single crossing where they change over and buys back every
  // crossing after it. Only adjacent pairs, because that is the only
  // exchange the drawing knows how to make.
  var WEAVE_COST = 1;
  function weaveCost(seq) {
    var base = interference(seq);
    var best = { cost: base, weave: null };
    if (seq.length < 3 || groups.length < 2) return best;
    var ordered = groups.map(function (g, i) { return i; })
      .sort(function (a, b) { return groups[a].at - groups[b].at; });
    var byTime = ordered.map(function (i) { return groups[i]; });
    var saved = groups;
    groups = byTime;
    for (var k = 0; k + 1 < seq.length; k++) {
      var swapped = seq.slice();
      var t = swapped[k]; swapped[k] = swapped[k + 1]; swapped[k + 1] = t;
      for (var m = 1; m < byTime.length; m++) {
        var c = interference(seq, 0, m) + interference(swapped, m, null) + WEAVE_COST;
        if (c < best.cost) best = { cost: c, weave: { pair: k, after: m } };
      }
    }
    groups = saved;
    return best;
  }
  function bestOrder() {
    var names = order.slice();
    var chain = affinityChain();
    if (names.length < 3 || names.length > 8 || !groups.length) return chain;
    // Scored on what the board will actually DRAW, which is the order as
    // it stands. A weave is worked out by the client, from the positions it
    // ends up with, and nothing here can promise one -- so an order that is
    // only good once somebody weaves it is not good, and letting the weave
    // into the main score picked those orders and left the board crossing
    // twice where once was available.
    //
    // It earns its place as a TIE-BREAK: among orders that cross the same
    // number of times, the one a weave could still improve is the better
    // bet, because the client may well take it.
    // The weave is NOT in the inner loop. Working it out means trying every
    // adjacent pair against every point in the day, and doing that for all
    // forty thousand orders is a billion operations on a server with a
    // four-second budget for the whole board. The orders that tie on
    // crossings are few, so they are collected as they are found and the
    // weave decides between those at the end.
    var TIED_CAP = 24;
    var best = { cost: interference(chain), load: crossLoad(chain), aff: adjAffinity(chain) };
    var tied = [chain.slice()];
    // Heap's algorithm: every order, once, with no allocation per order.
    var work = names.slice(), c = new Array(work.length).fill(0), i = 0;
    function consider(cand) {
      var cost = interference(cand);
      if (cost > best.cost) return;
      var load = crossLoad(cand), aff = adjAffinity(cand);
      var better = cost < best.cost
        || load < best.load
        || (load === best.load && aff > best.aff);
      if (better) {
        best = { cost: cost, load: load, aff: aff };
        tied = [cand.slice()];
      } else if (load === best.load && aff === best.aff && tied.length < TIED_CAP) {
        tied.push(cand.slice());
      }
    }
    consider(work);
    while (i < work.length) {
      if (c[i] < i) {
        var j = i % 2 ? c[i] : 0;
        var tmp = work[j]; work[j] = work[i]; work[i] = tmp;
        consider(work);
        c[i]++; i = 0;
      } else { c[i] = 0; i++; }
    }
    // Among the orders that cross least and keep the closest pairs
    // together, take the one a weave could still improve: the client works
    // weaves out for itself from the positions it is given, and an order it
    // can repair is a better bet than one it cannot.
    var pick = tied[0], pickWoven = weaveCost(pick).cost;
    for (var t = 1; t < tied.length; t++) {
      var w = weaveCost(tied[t]).cost;
      if (w < pickWoven) { pick = tied[t]; pickWoven = w; }
    }
    return pick;
  }

  function finalize() {
    var chain = bestOrder();
    var total = chain.reduce(function (a, n) { return a + counts[n]; }, 0);

    // Cut the chain once. Everything before the cut goes left, everything
    // after goes right, and the chain's order is preserved on the board. The
    // cut is chosen to balance the two sides AND to fall on a weak link, so
    // the people who are together most stay on one side of the spine; an
    // explicit `side` in the config rules out any cut that would contradict
    // it, and if nothing satisfies every pin the balance alone decides.
    // k runs from -1 (everything right) to length-1 (everything left), so a
    // board where every track is pinned to one side still has a cut that
    // honours the pins. The balance term makes those ends expensive, so they
    // only win when nothing else satisfies the pins.
    var bestCut = null;
    for (var k = -1; k < chain.length; k++) {
      var leftNames = chain.slice(0, k + 1), rightNames = chain.slice(k + 1);
      var pinOk = leftNames.every(function (n) { return explicitSide(n) !== 'right'; })
               && rightNames.every(function (n) { return explicitSide(n) !== 'left'; });
      var lw = leftNames.reduce(function (a, n) { return a + counts[n]; }, 0);
      var edge = (k < 0 || k >= chain.length - 1);
      // What an unbalanced cut actually costs is DEPTH: the deeper side
      // decides how squashed the whole map is, and a line costs a band
      // whether or not it carries any events. Scoring the balance on event
      // counts alone missed that, so a crew who share everything (every
      // interior cut charged for breaking a strong link, every edge cut
      // free) piled all seven lines onto one side and drew them at the
      // minimum pitch in half the canvas. LINE_DEPTH is what one more line
      // on a side is worth in label lanes; affinity stays a tie-breaker
      // between cuts of comparable depth.
      var LINE_DEPTH = 3;
      var cost = Math.max(leftNames.length * LINE_DEPTH + lw,
                          rightNames.length * LINE_DEPTH + (total - lw))
               + (edge ? 0 : affinityOf(chain[k], chain[k + 1]) * 3);
      if (!bestCut || (pinOk && !bestCut.pinOk) || (pinOk === bestCut.pinOk && cost < bestCut.cost)) {
        bestCut = { k: k, cost: cost, pinOk: pinOk };
      }
    }
    var cut = bestCut ? bestCut.k : Math.floor((chain.length - 1) / 2);

    // The map's anchor line: black and boldest. The first track the config
    // names, which is also the one any unassigned event falls back to — the
    // household's main line. Failing that (a config that names no lines at
    // all, or lists none that survived), the busiest line. It used to be
    // whichever line happened to sit innermost-left, which the chain no
    // longer decides by load.
    var configured0 = order.filter(function (n) { return parsed.lines[n.toLowerCase()]; })[0];
    var anchor = configured0 || chain.slice().sort(function (a, b) { return counts[b] - counts[a]; })[0];

    var boardOrder = chain.slice();
    boardOrder.forEach(function (name, pos) {
      var t = byName[name];
      var side = pos <= cut ? 'left' : 'right';
      // the chain runs outward-left to outward-right, so the slot nearest
      // the spine is the LAST left entry and the FIRST right one
      var idx = side === 'left' ? cut - pos : pos - cut - 1;
      var configured = parsed.lines[name.toLowerCase()];
      t.side = side;
      t.line_offset = LINE_STEP * (idx + 1) * (side === 'left' ? -1 : 1);
      // A PINNED COLOUR AND NOTHING ELSE.
      //
      // A colour somebody chose is a preference, and preferences are data.
      // A stroke weight and a dash pattern are not: they are how a metro
      // line is DRAWN, and this file knows about calendars, events and
      // weather. It has no business having an opinion on either, any more
      // than it has any business knowing the word "siding".
      //
      // So a track carries whether it is the anchor, and shared.liquid
      // reads that and decides what everybody looks like.
      t.hue = (configured && hueTokenForColor(configured.color)) || null;
      t.anchor = name === anchor;
      t.initial = (configured && configured.badge) || Array.from(name)[0].toUpperCase();
    });
  }

  return {
    add: add,
    keep: keep,
    link: link,
    byName: byName,
    finalize: finalize,
    all: function () {
      var arr = order.map(function (n) { return byName[n]; });
      return arr.filter(function (p) { return p.side === 'left'; }).concat(arr.filter(function (p) { return p.side === 'right'; }));
    },
  };
}

// A readable name from a calendar URL, for a feed that carries no name of
// its own: "https://cloud.example.com/alex-work.ics" -> "Alex Work".
function urlLabel(url) {
  var last = String(url || '').split(/[?#]/)[0].split('/').filter(Boolean).pop() || '';
  last = last.replace(/\.ics$/i, '').replace(/[._+-]+/g, ' ').trim();
  if (!last) return null;
  return last.split(/\s+/).map(function (w) {
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

async function buildFromConfig(input, parsed, weather, extra, state) {
  var tz = resolveTz(parsed.timeZone, input); // config.timeZone > account time_zone_iana > account utc_offset > UTC
  var nowTs = (input.trmnl && input.trmnl.system && input.trmnl.system.timestamp_utc) || Math.floor(Date.now() / 1000);
  var today = fromEpoch(nowTs * 1000, tz);
  var nowMin = today.h * 60 + today.mi;
  var todayWeekday = (new Date(Date.UTC(today.y, today.mo - 1, today.d)).getUTCDay() + 6) % 7;
  // ---- which day the board is about
  //
  // Resolved HERE, before a single feed is read, because it decides how
  // long a run of days has to be gathered: a board about tomorrow that may
  // roll on into the morning after needs the day after tomorrow fetched,
  // and a fetch cannot be gone back for once the parsing is done.
  //
  // Today, tomorrow, or "tomorrow once today is mostly over". The last is
  // what a screen on a wall actually wants: in the evening, what you need
  // to see is what you are getting up to, and by then today has already
  // happened.
  // "TODAY, THEN TOMORROW FROM THE EVENING" IS WHAT THE ROLLING WINDOW DOES,
  // and it does it better, so the setting that used to say so is gone.
  //
  // That setting swapped one day for the other at a fixed hour -- nine by
  // default, late on purpose, because the evening is when a board on a wall is
  // read most and an earlier switch threw away dinner while people were
  // standing in front of it. Nine still threw away whatever was left of the
  // evening, and it did it as a cliff: the board a reader looked at before
  // brushing their teeth was a different board from the one an hour earlier.
  //
  // The rolling window reaches tomorrow from four in the afternoon, keeps the
  // rest of tonight while it does, and stretches its far end to the end of
  // tomorrow once today is spent (see ROLL_END_LATE_MIN). Measured on a busy
  // Wednesday: from 17:00 a rolling board already carried tomorrow's first
  // event with all of tonight still on it, while the switch at 21:00 deleted
  // four events to show two.
  //
  // A board somebody already set to "auto" is read as "today" rather than
  // refused: the rolling view is what they were asking for.
  // THE BOARD IS ABOUT TODAY, AND IT ROLLS. There is nothing left to ask.
  //
  // There were three settings here and each of them was a way of asking for
  // something the rolling window now does by itself.
  //
  //   "Today, then tomorrow from the evening on", with an hour beside it,
  //   swapped one day for the other at nine. Rolling reaches tomorrow from
  //   four and keeps what is left of tonight, so the switch was strictly
  //   worse and it is gone.
  //
  //   "Tomorrow" drew tomorrow instead of today, all day long. On a screen on
  //   a wall that is a board which is wrong every morning: it cannot say what
  //   time it is, because now is not on it, and it cannot mark the day,
  //   because the day it is about has not started. Everything it was for, a
  //   reader gets from this afternoon onward anyway.
  //
  //   "Quiet Days: always one day" turned the rolling off. It existed because
  //   a board that changes shape on its own needs a way to be told not to --
  //   and what actually made that alarming was the shape changing WHILE
  //   somebody read it, which the four o'clock boundary fixed. A board that
  //   quietly shows more of what is coming needs no opt-out.
  //
  // So: the day is today, always, and a quiet day always borrows the next
  // one. Every branch that existed to serve the other answers has gone with
  // them, which is most of what this change is.

  // The run of days the board may draw. Three is the ceiling: past that a
  // day gets less axis than its own events need and the board stops being
  // a timeline. How many of them are actually DRAWN is the client's call,
  // made against the real canvas; this only has to make sure the data is
  // there for it to choose from.
  //
  // The day being shown plus the one after it, which is what the rolling
  // view reaches into, and never fewer than the two days this has always
  // gathered.
  var days = [];
  var runDays = Math.max(DAY_SPAN, 2);
  for (var di = 0; di < runDays; di++) days.push(addCivilDays(today, di));

  var registry = makeLineRegistry(parsed);
  // Every explicitly-configured track is registered up front, even with
  // zero events today, so they still get a line and (if they set an
  // explicit side) it's honored regardless of load.
  Object.keys(parsed.lines).forEach(function (key) {
    var t = parsed.lines[key];
    if (t.keepEmpty) registry.keep(t.name); else registry.add(t.name, 0);
  });

  // ONE deadline for the whole render, handed down from run() rather than
  // started here. Started here it began AFTER the weather call had already
  // spent up to three seconds, so a slow forecast plus slow feeds added up
  // to more than seven seconds against a budget that never had it. The
  // fallback is for a direct caller (the config editor's preview) that has
  // no deadline of its own.
  var deadline = (extra && extra.deadline) || (Date.now() + RENDER_BUDGET_MS);
  var events = [];
  var allDayEvents = [];
  // Timed events on a day past the run this has always gathered: kept aside
  // until the rolling view is decided, and thrown away if it is not (see
  // the push site below).
  var late = [];
  // THE DAY'S OWN, BELONGING TO NOBODY. A holiday never touches the line
  // registry: no line is added for it, no weight is tallied, no empty line
  // is kept alive by it. That is the whole of the fix, because everything
  // that went wrong downstream followed from a holiday having had an owner
  // at all -- a ghost line named after the feed, a whole country's holiday
  // declared at one person's head, and a line kept on a cramped panel
  // ahead of somebody with a real day because a holiday made it look busy.
  var holidays = [];
  function addHoliday(title, dayIx, span, index) {
    if (!title) return;
    holidays.push({ title: title, day: dayIx || 0,
      span: Math.max(1, span || 1), index: Math.max(0, index || 0) });
  }
  // WHOSE DAY DOES IT CHANGE? That is the question, and the config already
  // answers it: a rule that names lines has said whose, and one that names
  // none has said nobody's.
  //
  // Christmas Day is nobody's -- it is a fact about the day, and the header
  // states it. Half term is precisely Bart's and Lisa's and precisely NOT
  // Homer's, who still goes to work, and that is what a line's head row is
  // for. Both arrive through the same subscription and the same word, so
  // `holiday` cannot mean "goes in the header": it means this is a STATE
  // rather than an appointment, which is the distinction E12 already drew.
  // Where it is drawn falls out of whether anybody owns it.
  //
  // Only an explicit `line` counts. The fallback chain is deliberately not
  // consulted: falling back is what put a whole country's Christmas on
  // whoever happened to be first in `lines[]`, and a holiday feed with no
  // name has not told us whose it is -- it has told us it is nobody's.
  // AN ALL-DAY ENTRY GOES ON EVERY LINE IT NAMES.
  //
  // Same reason as the holiday below, and the same bug: pushed as
  // `lineNames[0]`, a rule that put a school holiday on all four children
  // landed it on whichever of them happened to be first and left the other
  // three with an ordinary day. A timed event routed to several lines has
  // been an interchange all along; this is the all-day strip's version of
  // it, and `buildMetro` already groups by title and collects the owners so
  // one title is drawn once with a tie between the heads.
  function placeAllDay(resolved, names, dayIx) {
    names.forEach(function (n) {
      allDayEvents.push({ line: registry.add(n, 0.25).key, title: resolved.title, day: dayIx || 0 });
    });
  }

  function placeHoliday(resolved, dayIx, span, index) {
    var named = resolved.lineNames;
    if (!named || !named.length) { addHoliday(resolved.title, dayIx, span, index); return; }
    // One push per line, because `buildMetro` groups all-day entries by
    // title and collects their owners: that is what makes several lines
    // sharing one holiday ONE origin, named once, with the dashed tie
    // between their heads.
    named.forEach(function (n) {
      allDayEvents.push({ line: registry.add(n, 0.25).key, title: resolved.title, day: dayIx || 0 });
    });
  }

  // A named calendar that is kept when empty is kept when it is UNREACHABLE
  // too: a feed being down for an hour should not silently remove somebody
  // from the board. An unnamed one cannot be, since its line is named after
  // the feed and there is nothing to name it until the feed answers.
  (parsed.calendars || []).forEach(function (cal) { if (cal.keepEmpty && cal.name) registry.keep(cal.name); });

  // A feed that fails must not vanish silently. Every failure is recorded
  // in saved state with the time it FIRST happened, so a blip (one 500, a
  // slow morning) changes nothing, and a feed still failing hours later is
  // named on the board. The fetches stay parallel and each keeps its own
  // catch: a 404 on one feed still renders every other line.
  var downNames = [];
  var nowS = Math.floor(Date.now() / 1000);

  await Promise.all((parsed.calendars || []).map(async function (cal) {
    var url = cal.url;
    if (url.indexOf('webcal://') === 0) url = 'https://' + url.slice('webcal://'.length);
    // What this feed is called when it cannot tell us: the config's own
    // name, else the name it gave the last time it answered. Without the
    // remembered one an unnamed feed that goes down loses its identity and
    // comes back as a URL fragment, which is the "Calendar 2" problem.
    var knownName = cal.name || (state && state.calendarNames[cal.url]) || null;
    function failed() {
      if (!state) return;
      if (!state.calendarDown[cal.url]) state.calendarDown[cal.url] = nowS;
      if (nowS - state.calendarDown[cal.url] >= CALENDAR_DOWN_AFTER_S) {
        var label = knownName || urlLabel(cal.url);
        if (downNames.indexOf(label) < 0) downNames.push(label);
      }
      // A kept line keeps its remembered name too, so the rail that is
      // missing its events is still labelled with whose it is.
      if (cal.keepEmpty && knownName) registry.keep(knownName);
    }
    try {
      // No time left is the same outcome as a dead feed from the board's
      // side (the events are missing), so it starts the same clock and
      // clears again on the next render that does reach it.
      var budget = msUntil(deadline);
      if (budget <= 0) { failed(); return; }
      var resp = await fetchWithTimeout(url, Math.min(budget, 4000), cal.headers);
      if (!resp.ok) { failed(); return; }
      var text = await resp.text();
      var parsedIcs = parseIcs(text, tz, days, cal.includeDescription);
      if (state) {
        delete state.calendarDown[cal.url];
        if (parsedIcs.calName) state.calendarNames[cal.url] = parsedIcs.calName;
      }
      // Last resort for whose line this is: the feed's own X-WR-CALNAME,
      // then the last thing in the URL. Only reached when the config named
      // neither the calendar nor a single track — which is the simplest
      // setup there is, a list of ICS links and nothing else. Before this
      // that setup drew an empty board.
      var calLabel = parsedIcs.calName || urlLabel(cal.url);
      // `hideIfEmpty: false` on the CALENDAR keeps the line this calendar
      // owns on the board on a day it has nothing. Which line that is can
      // only be known once the feed has been read, since an unnamed
      // calendar borrows the feed's own name.
      if (cal.keepEmpty) registry.keep(cal.name || parsed.everyoneLine || calLabel);
      parsedIcs.timed.forEach(function (ev) {
        var resolved = applyCalendarRules(ev, todayWeekday, cal, parsed.globalRules, parsed.everyoneLine);
        if (resolved.hide) return;
        // A holiday written as a timed 00:00-23:59 block is still a
        // holiday. Plenty of feeds emit one that way, and which of the two
        // shapes a feed picked is a fact about the exporter, not about the
        // day. Taken before any line is resolved: that is what makes it
        // impossible for one to be created.
        if (cal.holiday || resolved.holiday) {
          placeHoliday(resolved, Math.floor(ev.startMin / 1440), 1, 0);
          return;
        }
        var lineNames = resolved.lineNames || (cal.name ? [cal.name] : null)
          || (parsed.everyoneLine ? [parsed.everyoneLine] : null) || (calLabel ? [calLabel] : null);
        if (!lineNames || !lineNames.length) return;
        // A DAY THE BOARD ONLY MIGHT DRAW COSTS THE BOARD NOTHING YET.
        //
        // An event beyond the two days this has always gathered is only on
        // the board if the rolling view happens, which is not known until
        // every feed is in. Held back rather than registered, because
        // registering it would tally its line's weight and so could move
        // somebody to the other side of the map, or create a line that
        // exists on no day the board is drawing. A day that is not drawn
        // has to leave the board exactly as it found it.
        if (ev.day >= DAY_SPAN) {
          late.push({ names: lineNames, title: resolved.title, startMin: ev.startMin,
            endMin: ev.endMin != null ? ev.endMin : ev.startMin + 30,
            location: ev.location || null, allDay: !!resolved.allDay });
          return;
        }
        // A rule can mark an otherwise-timed event allDay (e.g. a calendar
        // that lists "Public Holiday" as a timed 00:00 entry) — that now
        // routes into the all-day strip instead of the timeline, same as a
        // genuine ICS all-day entry, rather than being silently dropped.
        if (resolved.allDay) {
          placeAllDay(resolved, lineNames, Math.floor(ev.startMin / 1440));
          return;
        }
        // A LONG BLOCK IS AN EVENT LIKE ANY OTHER.
        //
        // A school day, a shift, a desk booking, a delivery used to be a
        // SIDING: a second kind of thing, carried in its own array, with its
        // own geometry, its own caption pass and its own marks, whose whole
        // effect was to take the line off its own lane for the length of it.
        // Nine hours of "Desk booking" displaced Homer's entire day for a
        // fact about where he was sitting, and a line spending the day off
        // its lane is a line whose name at the head of the board points at
        // empty paper.
        //
        // A long block is a person being somewhere for a long time, which is
        // what every event on this board is. It travels as an event, and the
        // client draws it on the main track rather than out in a lane: the
        // marks and the caption say where they are and for how long, and the
        // track stays where its name says it is. Shared by two people it is
        // a shared event, which is a convergence, which is what two children
        // at the same school all day actually looks like.
        var primary = registry.add(lineNames[0], 1);
        // a co-owner on a shared/interchange event gets a smaller weight
        // toward side balancing — they have a ring there too, but it's not
        // "their" event the way the primary owner's is
        var interchangeWith = lineNames.slice(1).map(function (n) { return registry.add(n, 0.5).key; });
        if (lineNames.length > 1) registry.link(lineNames, null, ev.startMin);
        events.push({
          line: primary.key,
          interchange_with: interchangeWith.length ? interchangeWith : undefined,
          title: resolved.title,
          startMin: ev.startMin,
          endMin: ev.endMin != null ? ev.endMin : ev.startMin + 30,
          location: ev.location || null,
        });
      });
      parsedIcs.allDay.forEach(function (ev) {
        var resolved = applyCalendarRules(ev, todayWeekday, cal, parsed.globalRules, parsed.everyoneLine);
        if (resolved.hide) return;
        // The range travels with it: parseIcs already counted which day of
        // the holiday this is, and nothing further down can work it out
        // once the entry has been cut down to a day.
        if (cal.holiday || resolved.holiday) {
          placeHoliday(resolved, ev.day, ev.span, ev.index);
          return;
        }
        var lineNames = resolved.lineNames || (cal.name ? [cal.name] : null)
          || (parsed.everyoneLine ? [parsed.everyoneLine] : null) || (calLabel ? [calLabel] : null);
        if (!lineNames || !lineNames.length) return;
        // WHICH DAY IT IS ON, carried rather than assumed. Dropped here,
        // every all-day entry read as day 0: a holiday that is tomorrow's
        // was declared on today's board, and on a board set to tomorrow
        // the filter below threw every one of them away.
        placeAllDay(resolved, lineNames, ev.day);
      });
    } catch (e) {
      // one calendar failing shouldn't blank the whole render — skip it,
      // but remember that it failed
      failed();
    }
  }));

  pruneState(state, (parsed.calendars || []).map(function (c) { return c.url; }));

  // ---- one event, drawn once -------------------------------------------
  //
  // Two calendars can describe the SAME thing. Bart's "L6 School Day" and
  // Lisa's "L2 School Day" both rename to "School Day", run the same hours,
  // and are the same school day — but they arrived as two events and were
  // drawn as two sidings with two captions, on lines that could be at
  // opposite ends of the board. Anything with the same title over the same
  // minutes is one event on several lines.
  //
  // Merging them here rather than in the template also means the layout
  // learns that those two people are together, which is what decides the
  // order the lines are laid out in.
  function mergeAcrossLines(list) {
    var byWhat = {}, out = [];
    list.forEach(function (ev) {
      var k = ev.title + '\u0000' + ev.startMin + '\u0000' + ev.endMin;
      var seen = byWhat[k];
      if (!seen) { byWhat[k] = ev; out.push(ev); return; }
      var mine = [seen.line].concat(seen.interchange_with || []);
      if (mine.indexOf(ev.line) >= 0) return;             // the same line twice: a duplicate, drop it
      seen.interchange_with = (seen.interchange_with || []).concat([ev.line]);
      if (!seen.location && ev.location) seen.location = ev.location;
    });
    return out;
  }
  var keyToName = {};
  Object.keys(registry.byName).forEach(function (n) { keyToName[registry.byName[n].key] = n; });
  function linkMerged(list) {
    list.forEach(function (ev) {
      if (!ev.interchange_with || !ev.interchange_with.length) return;
      var names = [ev.line].concat(ev.interchange_with)
        .map(function (k) { return keyToName[k]; }).filter(Boolean);
      if (names.length > 1) registry.link(names, null, ev.start_min);
    });
  }
  // ---- which day the board draws
  //
  // One day, chosen by the setting (resolved at the top, before the
  // fetches), and everything is rebased onto it so the rest of the pipeline
  // sees an ordinary single-day board: minutes from that day's own
  // midnight, one entry in `days`, that day's date on the header and that
  // day's forecast beside it. Nothing downstream has to know which day it
  // is looking at, which is the point: "show tomorrow" is a question about
  // WHICH day, not about how a day is drawn.
  //
  // ONE EXCEPTION, AND IT IS STILL REBASED. A day with almost nothing on it
  // borrows the next one (see QUIET_DAY_MAX_EVENTS): the run becomes two
  // days rather than one, minute zero is still the shown day's own
  // midnight, and the board is handed an explicit window into that run.
  // Everything downstream still reads one number line starting at the day
  // it is about; all that changes is how far it goes.
  var shownDay = days[0];
  var dayLo = 0;
  // HOW MANY EVENTS THE SHOWN DAY HAS, counted the way the board counts
  // them: after every rule, every hide and every merge, so one dinner that
  // three calendars describe is one event and not three, and an all-day
  // state is not an event at all -- it has no hour, so it never takes a
  // place on the scale of hours a quiet day is short of.
  function distinctEvents(list) {
    var seen = {}, n = 0;
    list.forEach(function (e) {
      var k = e.title + '\u0000' + e.startMin + '\u0000' + e.endMin;
      if (seen[k]) return;
      seen[k] = true;
      n++;
    });
    return n;
  }
  var onDay = events.filter(function (e) {
    return e.startMin != null && e.startMin >= dayLo && e.startMin < dayLo + 1440;
  });
  // Where the count starts, and where the window will start with it: the
  // two have to agree, or the board decides it is quiet by one measure and
  // then draws itself by another. Only a board about TODAY has a past to
  // leave behind; a board about tomorrow has all of tomorrow ahead of it
  // whatever time it is now.
  // Before noon the boundary is the day's own start, which is what it has
  // always been: a morning board counts and draws the whole day, early
  // events included. From noon it is noon.
  // THE COUNT IS TAKEN ON THE HOUR, AND THE WINDOW IS NOT.
  //
  // These were the same boundary and that was the mistake. Counting from four
  // and never counting again keeps the board still, and it also makes the
  // board blind: a Saturday with three things after four was still drawing
  // only Saturday at a quarter past eight, with one of the three left and
  // nothing said about Sunday. Seen twice on the real panel. A fixed second
  // boundary at nine papered over it and was still wrong at 8:15.
  //
  // So they are separated. The COUNT is taken from the top of the current
  // hour, so the board notices the evening emptying out; the WINDOW still
  // moves exactly once, at four, so the board does not slide left under
  // whoever is reading it. Counting more finely is safe here in a way that
  // drawing more finely is not, and for a reason worth writing down: the set
  // of events still to come only ever SHRINKS as the day goes on, so `quiet`
  // can go from false to true and never back. The board gains tomorrow once,
  // on an hour boundary, and cannot lose it again.
  //
  // The window may therefore draw more than the count counted -- at eight the
  // count sees one event left and the window still opens at four, so the
  // evening stays on the board. That direction is safe. The direction that is
  // not is a board that counts itself quiet and then draws a morning it had
  // decided to leave behind, which is what the two sharing a boundary was for.
  var countFrom = nowMin >= ROLL_SPLIT_MIN ? Math.floor(nowMin / 60) * 60 : 0;
  var stillToCome = onDay.filter(function (e) {
    return (e.endMin == null ? e.startMin : e.endMin) > dayLo + countFrom;
  });
  var rollFrom = nowMin >= ROLL_SPLIT_MIN ? ROLL_SPLIT_MIN : 0;
  var rolling = distinctEvents(stillToCome) <= QUIET_DAY_MAX_EVENTS && days.length > 1;
  // The window, in the shown day's own minutes. It starts at six unless the
  // day itself starts earlier, and ends at six the next evening unless
  // something kept is still running then: a window that cut an event it had
  // already decided to draw would be drawing half of it. Both ends are on
  // the hour and neither is read off the clock, so two refreshes fifteen
  // minutes apart lay the same board out.
  var winFrom = 0, winTo = 1440, dayHi = dayLo + 1440;
  if (rolling) {
    winFrom = Math.max(rollFrom, ROLL_START_MIN);
    // Widened for what the board is KEEPING, never for what it has already
    // decided to leave behind: widening for the morning would put the
    // morning back and undo the count that got here.
    stillToCome.forEach(function (e) { winFrom = Math.min(winFrom, e.startMin - dayLo - 60); });
    winFrom = Math.max(0, Math.floor(winFrom / 60) * 60);
    // Once the window itself has rolled past the afternoon, the board is
    // mostly tomorrow and may as well say so to the end of it.
    var rollEnd = winFrom >= ROLL_SPLIT_MIN ? ROLL_END_LATE_MIN : ROLL_END_MIN;
    dayHi = dayLo + rollEnd;
    // The held-back day now counts, and only now: its line weights and any
    // line it brings with it join the registry here, once the board has
    // decided it is drawing that day at all.
    late.forEach(function (l) {
      if (l.allDay) return;             // a state belongs to the day it is declared on
      if (l.startMin < dayLo + winFrom || l.startMin >= dayHi) return;
      var primary = registry.add(l.names[0], 1);
      var withKeys = l.names.slice(1).map(function (n) { return registry.add(n, 0.5).key; });
      if (l.names.length > 1) registry.link(l.names, null, l.startMin);
      events.push({ line: primary.key, interchange_with: withKeys.length ? withKeys : undefined,
        title: l.title, startMin: l.startMin, endMin: l.endMin, location: l.location });
    });
  }
  // FROM THE DAY'S OWN MIDNIGHT, NOT FROM THE WINDOW.
  //
  // An event the window has moved past is not an event the board has never
  // heard of: the client counts everything before its leading edge and
  // writes "+N earlier" there, which is how a board that has dropped the
  // morning says so instead of quietly being short of it. Filtered out
  // here, that count was zero and four meetings left the board without a
  // word. The window still decides what is DRAWN; this decides what the
  // board knows about.
  function onShownDay(list) {
    return list.filter(function (e) {
      return e.startMin != null && e.startMin >= dayLo && e.startMin < dayHi;
    }).map(function (e) {
      var c = Object.assign({}, e);
      c.startMin = e.startMin - dayLo;
      if (e.endMin != null) c.endMin = e.endMin - dayLo;
      return c;
    });
  }
  events = onShownDay(events);
  if (rolling) {
    winTo = rollEnd;
    events.forEach(function (e) {
      winTo = Math.max(winTo, (e.endMin == null ? e.startMin : e.endMin) + 90);
    });
    winTo = Math.min(2880, Math.ceil(winTo / 60) * 60);
  }
  allDayEvents = allDayEvents.filter(function (e) { return (e.day || 0) === 0; });
  // A HOLIDAY IS A FACT ABOUT ONE DAY, AND THE BOARD MAY BE DRAWING TWO.
  //
  // Christmas is not Christmas Eve's business, so a holiday is stated on its
  // own day and nowhere else. That used to mean day zero and only day zero,
  // which was right while the board drew exactly one day and the reader could
  // pick which. A rolling board reaches into tomorrow and draws tomorrow's
  // appointments, and said nothing about tomorrow being Boxing Day -- it drew
  // the meetings and left out the one fact that explains them.
  //
  // So the borrowed day's holiday travels too, carrying the day it belongs to
  // so the badge for that day can state it (rule 59) and the other one does
  // not. Still one name per day, never two (rule 63).
  holidays = holidays.filter(function (h) { return (h.day || 0) <= (rolling ? 1 : 0); });

  events = mergeAcrossLines(events);
  linkMerged(events);

  events.sort(function (a, b) { return a.startMin - b.startMin; });
  registry.finalize(); // every calendar is in and every event tallied — decide sides now

  // Everything drawn from the forecast belongs to the day on the board.
  // Read at a fixed day 0, the rain markers and the sunset were today's on
  // a board headed with tomorrow's date, which is the same mistake as the
  // temperature and less obvious to catch.
  //
  // The index is into the SNAPSHOT's own run of days, which may have
  // started before today: a forecast fetched last night is still being
  // drawn this morning, and its day 0 is yesterday. Slide by however many
  // civil days have passed since it was taken, and if that runs off the
  // end of the run there is simply nothing to say about this day.
  var snapIx = civilDaysSince(weather && weather.date, today);
  var shownWx = (snapIx >= 0 && weather && weather.perDay && weather.perDay[snapIx]) || null;
  // The day after the one being shown, which only a rolling board draws.
  // The forecast may not reach it -- it is fetched for the run this has
  // always gathered -- and a day with no forecast simply says nothing about
  // the weather rather than borrowing the day before's.
  var nextWx = (snapIx >= 0 && weather && weather.perDay && weather.perDay[snapIx + 1]) || null;
  // One row per day the board may draw, in order, each naming its own day.
  // A short weekday travels with the long one because the board has to be
  // able to write a date marker into a strip an hour label wide.
  function dayRow(civil, wx) {
    return {
      label: dateLabel(civil, extra.locale),
      weekday: localeDatePart(extra.locale || 'en', 'long', 'weekday', civil.y, civil.mo, civil.d),
      weekdayShort: localeDatePart(extra.locale || 'en', 'short', 'weekday', civil.y, civil.mo, civil.d),
      weather: wx,
    };
  }
  var dayRows = [dayRow(shownDay, shownWx || (snapIx === 0 && weather && weather.header) || null)];
  if (rolling) dayRows.push(dayRow(days[1], nextWx));
  function ofShownDay(key) {
    if (shownWx && Array.isArray(shownWx[key])) return shownWx[key];
    // A snapshot with no run of days in it can only be describing its own
    // first day. On any other day, nothing is better than the wrong day's.
    return (snapIx === 0 && weather && Array.isArray(weather[key])) ? weather[key] : [];
  }

  return buildMetro(
    registry.all(), events,
    ofShownDay('milestones'),
    // the forecast for the day being shown, not for today: a board set to
    // tomorrow that carries today's temperature is wrong about the only
    // day it is drawing
    shownWx
      || (snapIx === 0 && weather && weather.header)
      || { hi: null, lo: null, condition: null, rain_chance: null },
    // The "now" marker, and every car riding it, is a statement about
    // where in the day we are. On a board showing tomorrow there is no
    // such minute: drawn anyway it parks a train on each line at a time
    // nobody has reached yet, and drags the axis out to hold a clock badge
    // for a day that has not started.
    nowMin,
    timeLabel(DAY_START_MIN) + ' ' + timeLabel(DAY_END_MIN),
    allDayEvents,
    Object.assign({}, extra, {
      dateLabel: dateLabel(shownDay, extra.locale),
      dateIso: isoDate(shownDay),
      // Composed against the day being shown and the clock on it, so it
      // can neither warn about a day nobody is looking at nor about an
      // hour that has gone.
      // The clock only travels with the day we are standing in: on any
      // other day there is no "already gone".
      serviceAlert: alertFor(extra, snapIx, nowMin),
      // "Today" is only true when it is
      todayWord: true,
      // one entry per day the board MAY draw, each with its own date and
      // its own forecast: a two-day board showing one temperature is
      // wrong about one of the days
      days: dayRows,
      // Where the board starts and stops inside that run. Null unless a
      // quiet day borrowed the next one.
      window: rolling ? { from: winFrom, to: winTo } : null,
      // The sky belongs to the day it is over. On a rolling board that is
      // two skies: tomorrow's sunrise is inside the window and inside the
      // night the board is drawing, which is the one marker that says where
      // the night ends. Shifted onto the same number line everything else
      // is on, and cut to the window, so nothing is marked off the board.
      sun: rolling
        ? ofShownDay('sun').concat(((nextWx && Array.isArray(nextWx.sun)) ? nextWx.sun : [])
            .map(function (m) { return Object.assign({}, m, { atMin: m.atMin + 1440 }); }))
          .filter(function (m) { return m.atMin >= winFrom && m.atMin <= winTo; })
        : ofShownDay('sun'),
      calendarsDown: downNames, holidays: holidays })
  );
}

// ---------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------

async function run(input) {
  // The demo is not something anybody has to switch on: an empty Calendars
  // box rides it already, further down. This is the developer's override --
  // run the example day even over a set of real feeds -- so it is off unless
  // the form says otherwise.
  var useDemoRaw = cf(input, 'use_demo_data').trim().toLowerCase();
  var useDemo = useDemoRaw === 'true';
  var configRaw = cf(input, 'config_json').trim();
  // ONE field for both shapes. parseConfig reads whatever is in it: JSON if
  // it parses as JSON, otherwise one ICS link per line, which is the whole
  // setup for anyone who just wants a line per calendar. calendar_urls was
  // briefly a second field; it is still read so nobody who filled it in
  // loses their calendars.
  var urlsRaw = cf(input, 'calendar_urls').trim();
  if (!configRaw && urlsRaw) configRaw = urlsRaw;
  // Which demo board to show. Unknown or unset falls back to Springfield.
  var demoSet = cf(input, 'demo_set');
  var demoCfg = demoConfigFor(demoSet);
  var latLonRaw = cf(input, 'lat_lon').trim();
  // The timeline runs along whichever side of the canvas is longer. That is
  // the only answer that is ever right — a vertical timeline on a landscape
  // panel wastes most of the board — so it is no longer a setting to get
  // wrong. The field still travels in the payload, always 'auto', because
  // the template reads it and a device on an older build still sends one.
  var orientation = 'auto';
  // Parse once, up front: locale, zone, clock and temperature unit all come
  // from the config when it sets them, and the demo is driven by a config
  // too, so both paths read the same settings from the same place. (Demo
  // mode may still fall back to the built-in day further down; that fallback
  // keeps whatever locale and clock were resolved here.)
  // RIDE THE DEMO UNTIL SOMEBODY FILLS IN SOME DATA.
  //
  // An empty box already took the demo path. A box with something in it
  // that yields no calendars -- JSON with an empty `calendars`, a paste
  // that survived the tidier but described nothing, a list of blank lines
  // -- did not: it fell through to the built-in Springfield day with no
  // weather and no real feeds, which is a visibly worse board and reads as
  // a different fault than the one the reader has.
  //
  // There is no third state. Either the config names calendars to draw or
  // it does not, and until it does the demo is the honest thing to show.
  var typedCfg = configRaw ? parseConfig(configRaw) : null;
  var noUsableConfig = !typedCfg || !typedCfg.calendars.length;
  var effectiveCfg = (useDemo || noUsableConfig) ? parseConfig(JSON.stringify(demoCfg)) : typedCfg;
  var locale = effectiveCfg.locale || userLocale(input);

  // Read before anything else needs it, and written back on every exit
  // below: what the weather was last time the API answered, which feeds
  // have been failing and since when, what those feeds are called, and the
  // last translated string table this device managed to download.
  var state = readState(input);
  // One deadline for the render, shared by the language file, the weather
  // and every calendar.
  var deadline = Date.now() + RENDER_BUDGET_MS;

  var strings = await loadStrings(locale, state, deadline);
  var hour12 = resolveHour12(
    (effectiveCfg.timeFormat || cf(input, 'time_format').trim()).toLowerCase(), locale);
  var tempUnit = resolveTempUnit(effectiveCfg.temperatureUnit, cf(input, 'temperature_unit').trim(), locale);
  // Read once, applied to whichever forecast each path below ends up with.
  // The thresholds are read in the board's own unit, so "cold at or below
  // 0" means 0 of whatever the header is showing.
  var alertOpts = alertSettings(input, tempUnit, strings, hour12);
  var extra = { orientation: orientation, locale: locale, strings: strings, hour12: hour12,
    tempUnit: tempUnit, deadline: deadline, alertOpts: alertOpts };

  // Every exit returns through here. The runtime stores what comes back as
  // `trmnl_state` and hands it to the next render as `input.trmnl.state`, so
  // a render that fell back to the demo must still return it: dropping it
  // on the failing paths would throw away the remembered weather and the
  // "down since" clocks exactly when they matter.
  function done(metro) {
    // `data`, not `metro`: a serverless transform's returned keys ARE the
    // template's root variables, so this is the name every template path
    // starts with.
    return { data: metro, trmnl_state: state };
  }

  if (useDemo || noUsableConfig) {
    // Demo mode has no config.timeZone of its own — resolve straight to
    // the account's own zone/offset (still falling back to UTC) so the
    // "now" marker and any real weather fetch land on the viewer's
    // actual local day, not an arbitrary fixed one.
    var demoTz = resolveTz(effectiveCfg.timeZone, input);
    var demoNowMin = null;
    var demoDate = null;
    try {
      var nowTsDemo = (input.trmnl && input.trmnl.system && input.trmnl.system.timestamp_utc) || Math.floor(Date.now() / 1000);
      var demoToday = fromEpoch(nowTsDemo * 1000, demoTz);
      demoNowMin = demoToday.h * 60 + demoToday.mi;
      demoDate = dateLabel(demoToday, locale);
    } catch (e) { /* keep the illustrative fixed DEMO_NOW_MIN on failure */ }
    var demoWx = await resolveWeather(latLonRaw, demoTz, deadline, state, tempUnit, strings);
    // A demo board has no location, so it would draw no sunrise, no rain
    // and no header weather at all. The sky band, which is half the
    // point of the map, was invisible to anyone who had not already
    // configured a real one. The built-in board gets built-in weather;
    // it needs no network and it applies to the demo ONLY.
    if (!demoWx.weather) {
      var demoSnap = demoWeatherSnapshot(demoSet);
      demoWx = { weather: materializeWeather(demoSnap, strings, tempUnit), stale: false, snapshot: demoSnap };
    }
    var demoExtra = Object.assign({ dateLabel: demoDate }, extra,
      { weatherStale: demoWx.stale, wxSnapshot: demoWx.snapshot });
    // Prefer driving the demo through the real pipeline against this repo's
    // own ICS files, so what it shows is what a working config produces.
    // Any failure — offline device, GitHub unreachable, a bad fetch — falls
    // straight back to the built-in Springfield data rather than an empty
    // board, so the demo is never blank.
    try {
      // No state on the demo path: these are this repo's own demo files,
      // not the user's calendars, and a CDN hiccup on one of them must not
      // put "demo/simpsons/bart.ics" on the board as a feed that is down,
      // nor leave its URL in saved state after the device is configured.
      var demoMetro = await buildFromConfig(input, effectiveCfg, demoWx.weather, demoExtra, null);
      // Every demo member has something on every day, so all of them must
      // come back. Anything less means some calendars failed while others
      // answered — a stale CDN copy, a 404 on a newly added file — and a
      // half-resolved board (two lines out of five, someone else's events)
      // is worse than the offline day. "Some lines appeared" is not a
      // successful demo.
      // The demo is a known quantity: these five lines, no others. Every
      // member has something on every day, and every school/family entry
      // matches a rule that routes it to one of them, so a correct demo
      // resolves to exactly this set. Anything else means the pipeline read
      // something other than what this repo ships — a stale CDN copy of one
      // calendar while the rest are current is the case that actually
      // happens, and it renders a mixed board that is nobody's day. An
      // unexpected line is as wrong as a missing one; both fall back.
      var want = demoCfg.lines.map(function (t) { return t.name; });
      var got = (demoMetro && demoMetro.legend ? demoMetro.legend : []).map(function (t) { return t.name; });
      var complete = want.length === got.length
        && want.every(function (n) { return got.indexOf(n) >= 0; });
      // AND EVERY ONE OF THEM HAS SOMETHING ON.
      //
      // A declared line is drawn on its quiet day now rather than dropped,
      // so "all five names came back" stopped meaning "all five calendars
      // answered": a fetch that returned nothing at all still produced the
      // full set of names over a completely empty board, and that passed as
      // a good demo. Every demo member has something on every day, so an
      // idle one is the same evidence a missing one was.
      var busy = {};
      var keyOf = {};
      (demoMetro && demoMetro.legend ? demoMetro.legend : []).forEach(function (t) { keyOf[t.name] = t.key; });
      (demoMetro && demoMetro.events ? demoMetro.events : []).forEach(function (e) {
        busy[e.owner] = true;
        (e.co_owners || []).forEach(function (k) { busy[k] = true; });
      });
      (demoMetro && demoMetro.all_day ? demoMetro.all_day : []).forEach(function (a) {
        (a.owners || []).forEach(function (k) { busy[k] = true; });
      });
      var everyoneBusy = want.every(function (n) { return !!busy[keyOf[n]]; });
      if (complete && everyoneBusy) return done(demoMetro);
    } catch (e) { /* fall through to the offline demo below */ }
    return done(buildFromDemo(demoWx.weather, demoNowMin, demoExtra));
  }

  // Reached only with calendars to draw: `noUsableConfig` above sends an
  // empty or unusable config to the demo path, weather and all.
  var parsed = effectiveCfg; // never throws — falls back to a bare URL list on invalid JSON

  try {
    var configTz = resolveTz(parsed.timeZone, input);
    var wx = await resolveWeather(latLonRaw, configTz, deadline, state, tempUnit, strings);
    var cfgExtra = Object.assign({}, extra,
      { weatherStale: wx.stale, wxSnapshot: wx.snapshot });
    return done(await buildFromConfig(input, parsed, wx.weather, cfgExtra, state));
  } catch (e) {
    return done(buildFromDemo(null, null, extra));
  }
}

if (typeof module !== 'undefined') {
  module.exports = run;
  // The demo boards, for the test that keeps demo/<show>/config.json in
  // step with them and for the script that writes those files out. The
  // serverless runtime only ever calls the function.
  module.exports.DEMO_SETS = DEMO_SETS;
}
