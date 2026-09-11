// metro-plugin/src/transform.js — TRMNL Serverless entry point.
//
// Two data sources, chosen by the "Use Demo Data" boolean setting:
//   - demo (default): the same hardcoded dummy events this plugin has
//     always shown — no network, no config needed, safe fallback.
//   - config: a real calendar config pasted into the "Calendar Config"
//     setting, same JSON shape as this repo's calendar-config.json /
//     demo-config.json ({ calendars: [{url,name,rules}], tracks, timeZone,
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
// calendar's own rule wins when both assign a track to the same event),
// a `track` field that can be a list (multiple tracks on the same
// event become an interchange node, metro-plugin's own concept for a
// shared event), and an `everyoneTrack` fallback (the first entry in
// `tracks[]`) for any event no rule assigns a track to.
//
// (For compatibility with configs written before tracks were called
// tracks: the legacy top-level `people` key and per-rule `person` field
// are still accepted as aliases for `tracks`/`track`.)
//
// `tracks[].side` ("left"/"work" or "right"/"family") pins a track to a
// side of the map; without it the track a calendar named "Work" assigns
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
// pipeline (hour ticks, sub-spur detection, the "now" marker, tracks
// list) doesn't care whether events came from DUMMY_EVENTS or real ICS.

var DAY_START_MIN = 7 * 60;
var DAY_END_MIN = 21 * 60;
var SECONDARY_THRESHOLD_MIN = 30;
var TRACK_STEP = 10; // px between adjacent track offsets
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
// since midnight LOCAL time. `tracks`: [{key,name,side,hue,track_offset,
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
function buildMetro(tracks, events, weatherMilestones, headerWeather, nowMin, windowLabel, allDayEvents, extra) {
  var trackByKey = {};
  tracks.forEach(function (t) { trackByKey[t.key] = t; });

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

  // A configured track with nothing on today's board gets no line and no
  // legend entry — otherwise every day carries every ever-configured
  // track's empty line, permanently eating spine width. Side/hue/style
  // stay whatever finalize() decided from the FULL registered set (so a
  // track's color/side identity doesn't shift day to day depending on
  // who else happens to be busy); only the per-side offset is repacked
  // against just today's active tracks, closing the gaps a filtered-out
  // track would otherwise leave.
  var activeKeys = {};
  events.forEach(function (ev) {
    if (!trackByKey[ev.track]) return;
    activeKeys[ev.track] = true;
    (ev.interchange_with || []).forEach(function (key) { if (trackByKey[key]) activeKeys[key] = true; });
  });
  (allDayEvents || []).forEach(function (ev) { if (trackByKey[ev.track]) activeKeys[ev.track] = true; });
  tracks.forEach(function (t) { if (t.keep_empty) activeKeys[t.key] = true; });
  tracks = tracks.filter(function (t) { return activeKeys[t.key]; });
  tracks.forEach(function (t) { delete t.keep_empty; }); // bookkeeping, not payload
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
  tracks.sort(function (a, b) {
    if (a.side !== b.side) return a.side === 'left' ? -1 : 1;
    return Math.abs(a.track_offset) - Math.abs(b.track_offset);
  });
  tracks.forEach(function (t) { t.track_offset = TRACK_STEP * (++sideIdx[t.side]) * (t.side === 'left' ? -1 : 1); });
  trackByKey = {};
  tracks.forEach(function (t) { trackByKey[t.key] = t; });

  var items = [];

  events.forEach(function (ev) {
    var track = trackByKey[ev.track];
    if (!track) return; // no resolved/known track for this event — drop it rather than guess
    var coOwners = (ev.interchange_with || []).filter(function (key) { return !!trackByKey[key]; });
    items.push({
      type: 'event',
      _sortMin: ev.startMin,
      title: ev.title,
      start_min: ev.startMin,
      end_min: ev.endMin,
      location: ev.location || null,
      owner: track.key,
      co_owners: coOwners, // other track keys sharing this event (an interchange) — empty for a normal event
      side: track.side,
      hue: track.hue,
      track_width: track.line_width,
      track_style: track.line_style,
      track_offset: track.track_offset,
    });
  });

  // An all-day event is the longest long event there is: it runs the whole
  // visible day on its owner's line. It used to appear only as small text
  // under the date, which said nothing about whose day it was; drawn on the
  // line it reads the same way every other event does, deduped by title and
  // owner. `all_day: true` tells the client not to let this (deliberately
  // full-day-wide) span drag the content-fit window out to match: it renders
  // across whatever window is chosen, clamped.
  var seenAllDay = {};
  (allDayEvents || []).forEach(function (ev) {
    var track = trackByKey[ev.track];
    if (!track) return;
    var key = ev.title + '|' + track.key;
    if (seenAllDay[key]) return;
    seenAllDay[key] = true;
    items.push({ type: 'event', _sortMin: DAY_LO, title: ev.title,
      start_min: DAY_LO, end_min: DAY_HI, location: null, all_day: true,
      owner: track.key, co_owners: [], side: track.side, hue: track.hue,
      track_width: track.line_width, track_style: track.line_style,
      track_offset: track.track_offset });
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
        weather: d.weather || null,
      };
    }),
    secondary_threshold_min: SECONDARY_THRESHOLD_MIN, // sub-spur grouping window — client decides sub-spurs, but this constant is config, not geometry
    // the day the board actually shows, computed here rather than by the
    // caller, which cannot know it until the events are in
    window_label: timeLabel12(DAY_LO, extra) + ' ' + timeLabel12(DAY_HI, extra),
    date_label: (extra && extra.dateLabel) || null,
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
    legend: tracks,
    all_day: [], // an all-day event is an event now, in items, with all_day: true; the key stays for shape compatibility
    items: items,
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
  { key: 'homer', name: 'Homer', side: 'left', track_offset: -10, anchor: true },
  { key: 'lisa', name: 'Lisa', side: 'left', track_offset: -20 },
  { key: 'marge', name: 'Marge', side: 'right', track_offset: 10 },
  { key: 'bart', name: 'Bart', side: 'right', track_offset: 20 },
  { key: 'maggie', name: 'Maggie', side: 'right', track_offset: 30 },
];

// A deliberately busy day in Springfield: two meetings starting minutes
// apart on one line (lane stacking), two- and four-track interchanges, a
// long day at school and a shift at the plant as sidings, and an
// evening cluster once everyone is home.
var DEMO_EVENTS = [
  { track: 'marge', interchange_with: ['bart', 'lisa'], title: 'School Run', startMin: 7 * 60 + 45, endMin: 8 * 60 + 15 },
  { track: 'homer', title: 'Shift Briefing', startMin: 8 * 60, endMin: 8 * 60 + 15 },
  { track: 'homer', title: 'Donut Run', startMin: 8 * 60 + 20, endMin: 8 * 60 + 35 },
  { track: 'marge', title: 'Dr. Hibbert', startMin: 10 * 60, endMin: 10 * 60 + 45 },
  { track: 'homer', title: '1:1 with Mr. Burns', startMin: 11 * 60, endMin: 11 * 60 + 30, location: 'The Office' },
  { track: 'marge', interchange_with: ['homer'], title: 'Lunch at Krusty Burger', startMin: 12 * 60, endMin: 13 * 60 },
  { track: 'homer', title: 'Safety Inspection', startMin: 14 * 60, endMin: 15 * 60 },
  { track: 'lisa', title: 'Sax Practice', startMin: 15 * 60 + 30, endMin: 16 * 60 + 15, location: 'Band Room' },
  { track: 'marge', interchange_with: ['bart', 'lisa'], title: 'Pick Up', startMin: 16 * 60, endMin: 16 * 60 + 20 },
  { track: 'bart', title: 'Skate Park', startMin: 16 * 60 + 30, endMin: 17 * 60 + 30 },
  { track: 'marge', title: 'Groceries', startMin: 17 * 60 + 30, endMin: 18 * 60, location: 'Kwik-E-Mart' },
  { track: 'marge', interchange_with: ['homer', 'bart', 'lisa', 'maggie'], title: 'Family Dinner', startMin: 18 * 60 + 30, endMin: 19 * 60 + 30 },
  { track: 'homer', title: "Moe's Tavern", startMin: 19 * 60 + 45, endMin: 21 * 60 },
  { track: 'bart', interchange_with: ['lisa'], title: 'Itchy & Scratchy', startMin: 20 * 60, endMin: 20 * 60 + 30 },
];

// Sidings: the line kinks out to siding level for the span
// rather than branching, for a place you simply ARE for a while.
var DEMO_STATIONS = [
  { track: 'homer', title: 'Sector 7-G', location: 'Springfield Nuclear', startMin: 9 * 60, endMin: 17 * 60 },
  { track: 'bart', title: 'Springfield Elementary', location: 'Room 12', startMin: 8 * 60 + 30, endMin: 15 * 60 },
  { track: 'lisa', title: 'Springfield Elementary', location: 'Room 4', startMin: 8 * 60 + 30, endMin: 15 * 60 },
];

var DEMO_ALLDAY = [
  { track: 'maggie', title: 'With Grampa' },
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
function demoOwnTrack(name, file) {
  return demoCalendar(name, file, [{ match: { type: 'any' }, track: name }]);
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
  tracks: [
    { name: 'Homer', side: 'left' },
    { name: 'Marge' },
    { name: 'Bart' },
    { name: 'Lisa' },
    { name: 'Maggie' },
  ],
  calendars: [
    demoOwnTrack('Homer', 'simpsons/homer.ics'),
    demoOwnTrack('Marge', 'simpsons/marge.ics'),
    demoOwnTrack('Bart', 'simpsons/bart.ics'),
    demoOwnTrack('Lisa', 'simpsons/lisa.ics'),
    demoOwnTrack('Maggie', 'simpsons/maggie.ics'),
    // One school calendar split by class code, the way a real school feed
    // is. rename:false throughout — a track assignment rewrites the matched
    // text into the track's name by default, which would turn "Family
    // Dinner" into the entire guest list.
    demoCalendar('School', 'simpsons/school.ics', [
      { match: { type: 'word', value: 'L6' }, track: 'Bart', rename: false },
      { match: { type: 'word', value: 'K3' }, track: 'Lisa', rename: false },
      { match: { type: 'regex', value: '^(?:L6|K3)\\s+' }, rewrite: '' },
    ]),
    demoCalendar('Family', 'simpsons/family.ics', [
      { match: { type: 'contains', value: 'Family Dinner' }, track: ['Marge', 'Homer', 'Bart', 'Lisa', 'Maggie'], rename: false },
      { match: { type: 'contains', value: 'School Run' }, track: ['Marge', 'Bart', 'Lisa'], rename: false },
      { match: { type: 'contains', value: 'Spring Break' }, track: 'Bart', allDay: true, rename: false },
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
  tracks: [
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
      { match: { type: 'regex', value: '^Fry:' }, track: 'Fry', rename: false },
      { match: { type: 'regex', value: '^Leela:' }, track: 'Leela', rename: false },
      { match: { type: 'regex', value: '^Bender:' }, track: 'Bender', rename: false },
      { match: { type: 'regex', value: '^Amy:' }, track: 'Amy', rename: false },
      { match: { type: 'regex', value: '^Professor:' }, track: 'Professor', rename: false },
      { match: { type: 'regex', value: '^[A-Za-z]+:\\s*' }, rewrite: '' },
    ]),
    demoCalendar('Deliveries', 'futurama/deliveries.ics', [
      { match: { type: 'contains', value: 'Delivery Run' }, track: ['Fry', 'Leela', 'Bender'], rename: false },
      { match: { type: 'contains', value: 'Good News' }, track: ['Professor', 'Fry', 'Leela', 'Bender', 'Amy'], rename: false },
      { match: { type: 'contains', value: 'Crew Debrief' }, track: ['Fry', 'Leela', 'Bender'], rename: false },
      { match: { type: 'contains', value: 'Ship Inspection' }, track: 'Leela', allDay: true, rename: false },
    ]),
  ],
};

// The smallest board worth drawing: two people who share a flat. One long
// solo siding (a day at a desk) and one evening they are both at.
var FRIENDS_CONFIG = {
  locale: 'en-US',
  timeFormat: '12h',
  tracks: [
    { name: 'Monica', side: 'left' },
    { name: 'Rachel' },
  ],
  calendars: [
    // a long block someone spends in one place is a STATION, not a meeting:
    // the line runs straight on and the block is a siding beside it
    demoCalendar('Monica', 'friends/monica.ics', [
      { match: { type: 'contains', value: 'Head Chef Shift' }, rename: false },
      { match: { type: 'any' }, track: 'Monica' },
    ]),
    demoCalendar('Rachel', 'friends/rachel.ics', [
      { match: { type: 'contains', value: 'Desk booking' }, rename: false },
      { match: { type: 'any' }, track: 'Rachel' },
    ]),
    demoCalendar('Apartment 20', 'friends/apartment.ics', [
      { match: { type: 'contains', value: 'Central Perk' }, track: ['Monica', 'Rachel'], rename: false },
      { match: { type: 'contains', value: 'Laundry' }, track: ['Monica', 'Rachel'], rename: false },
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
      return { track: st.track, title: st.title, location: st.location || null, startMin: st.startMin, endMin: st.endMin };
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
  var lines = unfoldIcs(text);
  var raw = [];
  var cur = null;
  // The feed's own name. A config that names its calendars never needs it,
  // but the simplest setup there is — a list of ICS links and nothing else
  // — has no other way to know whose line this is.
  var calName = null;
  lines.forEach(function (line) {
    if (line === 'BEGIN:VEVENT') { cur = {}; return; }
    if (line === 'END:VEVENT') { if (cur) raw.push(cur); cur = null; return; }
    if (!cur) {
      if (line.indexOf('X-WR-CALNAME:') === 0) calName = unescapeIcsText(line.slice('X-WR-CALNAME:'.length)).trim() || null;
      return;
    }
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
        var isWeeklySpan = !isDirectSpan && ev.rrule && (endOrd - startOrd) <= DAY_MS
          && weeklyRruleMatchesToday(ev.rrule, ev.dtstart, di.d.y, di.d.mo, di.d.d, di.weekday, tz);
        if (!isDirectSpan && !isWeeklySpan) return;
        if (!ev.recurrenceId && ev.uid && overriddenDates[ev.uid + '|' + di.key]) return;
        if (ev.exdates && ev.exdates[di.key]) return;   // taken out of the series
        allDay.push({ title: ev.title, desc: ev.desc || '', status: ev.status || '',
          location: ev.location || '', categories: ev.categories || [], day: dayIx });
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
  // `track` is the current field name; `person` is accepted too, for
  // configs written before tracks were called tracks.
  var track = normalizeNameList(spec.track !== undefined ? spec.track : spec.person);
  var allDay = spec.allDay === true;
  var hide = spec.hide === true;
  // `siding` (and the `station` it shipped as) used to live here: a rule
  // could declare that an event's own track leaves the running line for its
  // span instead of branching into a lane. Both keys are gone, and a config
  // that still carries either is read the same as one that does not — the
  // key is simply ignored, which is what happens to any key this does not
  // recognise. The layout decides it now, from how long the block is; see
  // SIDING_MIN_MIN in buildFromConfig.

  var rewrite = typeof spec.rewrite === 'string' ? spec.rewrite : null;
  var rewriteFull = spec.rewriteFull === true;
  if (!track && !allDay && !hide && rewrite === null) return null; // a no-op rule is dropped, not kept
  var isAnyMatch = spec.match && (spec.match.type === 'any' || spec.match.type === 'all');
  // rename defaults to true (a rule assigning a track also renames the
  // title to that track, historically the common case) EXCEPT on an
  // any/all match, where there's no specific text to rename and silently
  // overwriting every title would be surprising — there it defaults to
  // false and must be opted into.
  var rename = track ? (isAnyMatch ? spec.rename === true : spec.rename !== false) : false;
  return { match: m.test, rx: m.rx, usesDesc: !!m.usesDesc, track: track, allDay: allDay, hide: hide, rename: rename, rewrite: rewrite, rewriteFull: rewriteFull };
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

// Parses the "Calendar Config (JSON)" setting text into
// { calendars, tracks, timeZone, globalRules, everyoneTrack }. Never
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
          : { calendars: raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean) };
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

  var tracks = {};
  var everyoneTrack = null;
  // `tracks` is the current field name; `people` is accepted too, for
  // configs written before tracks were called tracks.
  (Array.isArray(data.tracks) ? data.tracks : Array.isArray(data.people) ? data.people : []).forEach(function (item) {
    if (!item || typeof item !== 'object') return;
    var name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) return;
    var color = typeof item.color === 'string' ? item.color.trim().toLowerCase() : '';
    var badgeSrc = typeof item.badge === 'string' && item.badge.trim() ? item.badge.trim() : name;
    var badge = Array.from(badgeSrc)[0].toUpperCase(); // Array.from, not [0] — keeps a full surrogate pair (emoji) intact
    // optional explicit side of the map: "left"/"work" or "right"/"family"
    var sideRaw = typeof item.side === 'string' ? item.side.trim().toLowerCase() : '';
    var side = (sideRaw === 'left' || sideRaw === 'work') ? 'left' : (sideRaw === 'right' || sideRaw === 'family') ? 'right' : null;
    if (everyoneTrack === null) everyoneTrack = name;
    // A track with nothing on today's board gets no line, which is what
    // stops every day carrying every ever-configured person's empty rail.
    // `hideIfEmpty: false` opts out: the line is drawn whatever happens, so
    // the board reads the same shape every day and a quiet person still has
    // a place on it. Only `false` counts; anything else keeps the default.
    tracks[name.toLowerCase()] = { name: name, color: color, badge: badge, side: side, keepEmpty: item.hideIfEmpty === false };
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
    // declared, and there may be no tracks[] entry to hang it off at all.
    calendars.push({ name: name, url: item.url.trim(), rules: rules, headers: headers,
      includeDescription: includeDescription, keepEmpty: item.hideIfEmpty === false });
  });

  return { calendars: calendars, tracks: tracks, timeZone: timeZone, locale: locale, timeFormat: timeFormat, temperatureUnit: temperatureUnit, globalRules: globalRules, everyoneTrack: everyoneTrack };
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
// Returns { title, trackNames, allDay, hide }; trackNames is an array
// (possibly with more than one name — a multi-track rule becomes an
// interchange event) or null if nothing assigned one.
function applyCalendarRules(ev, weekday, cal, globalRules, everyoneTrack) {
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
  var trackNames = null;
  var renameRule = null;
  var rewriteRule = null;
  var allDay = false;
  var hide = false;

  globalRules.concat(cal.rules).forEach(function (rule) {
    if (!rule.match(ctx)) return;
    if (rule.hide) hide = true;
    if (rule.allDay) allDay = true;

    if (rule.track) {
      trackNames = rule.track;
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
    finalTitle = replaceMatch(originalTitle, renameRule.rx, renameRule.track.join(' & '));
  }
  // NOTE: everyoneTrack is deliberately NOT applied here — a calendar's
  // own name is meant to be the fallback for one that has no rule
  // assigning anyone (see buildFromConfig), and everyoneTrack is the
  // last resort after THAT. Applying it here unconditionally used to make
  // the calendar-name fallback unreachable dead code: with tracks[] set,
  // EVERY unnamed-by-rule event (i.e. every event from any calendar with
  // no rules at all, or whose rules didn't match this one) landed on
  // everyoneTrack instead of that calendar's own name — so calendars
  // literally named after a track (a common real setup: one calendar per
  // family member, no rules needed) never got their events attributed to
  // themselves at all.

  return { title: finalTitle, trackNames: trackNames, allDay: allDay, hide: hide };
}

// Converts a config track's `color` (a plain framework hue name like
// "blue", or "gray-NN"/"black"/"white") into the "hue-65"-style token
// this plugin's tracks/nodes use ("hue-40" style) — null (fall back to the auto HUE_CYCLE)
// if unset or not one of those.
function hueTokenForColor(color) {
  if (!color) return null;
  if (HUE_NAMES.indexOf(color) !== -1) return color + '-40';
  if (color === 'black' || color === 'white' || /^gray-\d+$/.test(color)) return color;
  return null;
}

// A small, growable track registry — seeded from parsed.tracks, but
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
function makeTrackRegistry(parsed) {
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

  // Registered, weightless, and kept even with nothing on it today. Used by
  // `hideIfEmpty: false` on a track or a calendar.
  function keep(name) {
    if (!name) return null;
    var t = add(name, 0);
    t.keep_empty = true;
    return t;
  }

  function explicitSide(name) {
    var c = parsed.tracks[name.toLowerCase()];
    return (c && (c.side === 'left' || c.side === 'right')) ? c.side : null;
  }

  // How often two tracks are in the same place at the same time. Every
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

  // Lay the tracks out as ONE chain, strongest link first, then extended at
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
    // household's main line. Failing that (a config that names no tracks at
    // all, or lists none that survived), the busiest line. It used to be
    // whichever line happened to sit innermost-left, which the chain no
    // longer decides by load.
    var configured0 = order.filter(function (n) { return parsed.tracks[n.toLowerCase()]; })[0];
    var anchor = configured0 || chain.slice().sort(function (a, b) { return counts[b] - counts[a]; })[0];

    var boardOrder = chain.slice();
    boardOrder.forEach(function (name, pos) {
      var t = byName[name];
      var side = pos <= cut ? 'left' : 'right';
      // the chain runs outward-left to outward-right, so the slot nearest
      // the spine is the LAST left entry and the FIRST right one
      var idx = side === 'left' ? cut - pos : pos - cut - 1;
      var configured = parsed.tracks[name.toLowerCase()];
      t.side = side;
      t.track_offset = TRACK_STEP * (idx + 1) * (side === 'left' ? -1 : 1);
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
  // The run of days the board may draw. Three is the ceiling: past that a
  // day gets less axis than its own events need and the board stops being
  // a timeline. How many of them are actually DRAWN is the client's call,
  // made against the real canvas; this only has to make sure the data is
  // there for it to choose from.
  var days = [];
  for (var di = 0; di < DAY_SPAN; di++) days.push(addCivilDays(today, di));

  var registry = makeTrackRegistry(parsed);
  // Every explicitly-configured track is registered up front, even with
  // zero events today, so they still get a line and (if they set an
  // explicit side) it's honored regardless of load.
  Object.keys(parsed.tracks).forEach(function (key) {
    var t = parsed.tracks[key];
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
      if (cal.keepEmpty) registry.keep(cal.name || parsed.everyoneTrack || calLabel);
      parsedIcs.timed.forEach(function (ev) {
        var resolved = applyCalendarRules(ev, todayWeekday, cal, parsed.globalRules, parsed.everyoneTrack);
        if (resolved.hide) return;
        var trackNames = resolved.trackNames || (cal.name ? [cal.name] : null)
          || (parsed.everyoneTrack ? [parsed.everyoneTrack] : null) || (calLabel ? [calLabel] : null);
        if (!trackNames || !trackNames.length) return;
        // A rule can mark an otherwise-timed event allDay (e.g. a calendar
        // that lists "Public Holiday" as a timed 00:00 entry) — that now
        // routes into the all-day strip instead of the timeline, same as a
        // genuine ICS all-day entry, rather than being silently dropped.
        if (resolved.allDay) { allDayEvents.push({ track: registry.add(trackNames[0], 0.25).key, title: resolved.title }); return; }
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
        var primary = registry.add(trackNames[0], 1);
        // a co-owner on a shared/interchange event gets a smaller weight
        // toward side balancing — they have a ring there too, but it's not
        // "their" event the way the primary owner's is
        var interchangeWith = trackNames.slice(1).map(function (n) { return registry.add(n, 0.5).key; });
        if (trackNames.length > 1) registry.link(trackNames, null, ev.startMin);
        events.push({
          track: primary.key,
          interchange_with: interchangeWith.length ? interchangeWith : undefined,
          title: resolved.title,
          startMin: ev.startMin,
          endMin: ev.endMin != null ? ev.endMin : ev.startMin + 30,
          location: ev.location || null,
        });
      });
      parsedIcs.allDay.forEach(function (ev) {
        var resolved = applyCalendarRules(ev, todayWeekday, cal, parsed.globalRules, parsed.everyoneTrack);
        if (resolved.hide) return;
        var trackNames = resolved.trackNames || (cal.name ? [cal.name] : null)
          || (parsed.everyoneTrack ? [parsed.everyoneTrack] : null) || (calLabel ? [calLabel] : null);
        if (!trackNames || !trackNames.length) return;
        allDayEvents.push({ track: registry.add(trackNames[0], 0.25).key, title: resolved.title });
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
  function mergeAcrossTracks(list) {
    var byWhat = {}, out = [];
    list.forEach(function (ev) {
      var k = ev.title + '\u0000' + ev.startMin + '\u0000' + ev.endMin;
      var seen = byWhat[k];
      if (!seen) { byWhat[k] = ev; out.push(ev); return; }
      var mine = [seen.track].concat(seen.interchange_with || []);
      if (mine.indexOf(ev.track) >= 0) return;             // the same track twice: a duplicate, drop it
      seen.interchange_with = (seen.interchange_with || []).concat([ev.track]);
      if (!seen.location && ev.location) seen.location = ev.location;
    });
    return out;
  }
  var keyToName = {};
  Object.keys(registry.byName).forEach(function (n) { keyToName[registry.byName[n].key] = n; });
  function linkMerged(list) {
    list.forEach(function (ev) {
      if (!ev.interchange_with || !ev.interchange_with.length) return;
      var names = [ev.track].concat(ev.interchange_with)
        .map(function (k) { return keyToName[k]; }).filter(Boolean);
      if (names.length > 1) registry.link(names, null, ev.start_min);
    });
  }
  // ---- which day the board draws
  //
  // One day, chosen by the setting, and everything is rebased onto it so
  // the rest of the pipeline sees an ordinary single-day board: minutes
  // from that day's own midnight, one entry in `days`, that day's date on
  // the header and that day's forecast beside it. Nothing downstream has
  // to know which day it is looking at, which is the point: "show
  // tomorrow" is a question about WHICH day, not about how a day is drawn.
  // Today, tomorrow, or "tomorrow once today is mostly over". The last is
  // what a screen on a wall actually wants: in the evening, what you need
  // to see is what you are getting up to, and by then today has already
  // happened.
  var showPref = cf(input, 'show_day').trim().toLowerCase();
  var showIx = 0;
  if (showPref === 'tomorrow') showIx = 1;
  else if (showPref === 'auto') {
    var sh = parseInt(cf(input, 'switch_hour').trim(), 10);
    if (!isFinite(sh) || sh < 0 || sh > 23) sh = 18;
    if (nowMin >= sh * 60) showIx = 1;
  }
  if (showIx >= days.length) showIx = days.length - 1;
  var shownDay = days[showIx];
  var dayLo = showIx * 1440, dayHi = dayLo + 1440;
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
  allDayEvents = allDayEvents.filter(function (e) { return (e.day || 0) === showIx; });

  events = mergeAcrossTracks(events);
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
  var snapIx = showIx + civilDaysSince(weather && weather.date, today);
  var shownWx = (snapIx >= 0 && weather && weather.perDay && weather.perDay[snapIx]) || null;
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
    showIx === 0 ? nowMin : null,
    timeLabel(DAY_START_MIN) + ' ' + timeLabel(DAY_END_MIN),
    allDayEvents,
    Object.assign({}, extra, {
      dateLabel: dateLabel(shownDay, extra.locale),
      // Composed against the day being shown and the clock on it, so it
      // can neither warn about a day nobody is looking at nor about an
      // hour that has gone.
      // The clock only travels with the day we are standing in: on any
      // other day there is no "already gone".
      serviceAlert: alertFor(extra, snapIx, showIx === 0 ? nowMin : null),
      // "Today" is only true when it is
      todayWord: showIx === 0,
      // one entry per day the board MAY draw, each with its own date and
      // its own forecast: a two-day board showing one temperature is
      // wrong about one of the days
      days: [{
        label: dateLabel(shownDay, extra.locale),
        weekday: localeDatePart(extra.locale || 'en', 'long', 'weekday', shownDay.y, shownDay.mo, shownDay.d),
        weather: shownWx || (snapIx === 0 && weather && weather.header) || null,
      }],
      sun: ofShownDay('sun'), calendarsDown: downNames })
  );
}

// ---------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------

async function run(input) {
  var useDemoRaw = cf(input, 'use_demo_data').trim().toLowerCase();
  var useDemo = useDemoRaw !== 'false'; // default true (demo) unless explicitly turned off
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
  var effectiveCfg = (useDemo || !configRaw) ? parseConfig(JSON.stringify(demoCfg)) : parseConfig(configRaw);
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
    return { metro: metro, trmnl_state: state };
  }

  if (useDemo || !configRaw) {
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
      var want = demoCfg.tracks.map(function (t) { return t.name; });
      var got = (demoMetro && demoMetro.legend ? demoMetro.legend : []).map(function (t) { return t.name; });
      var complete = want.length === got.length
        && want.every(function (n) { return got.indexOf(n) >= 0; });
      if (complete) return done(demoMetro);
    } catch (e) { /* fall through to the offline demo below */ }
    return done(buildFromDemo(demoWx.weather, demoNowMin, demoExtra));
  }

  var parsed = effectiveCfg; // never throws — falls back to a bare URL list on invalid JSON
  if (!parsed.calendars.length) {
    return done(buildFromDemo(null, null, extra)); // nothing usable in the config — degrade to demo rather than error the render
  }

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
