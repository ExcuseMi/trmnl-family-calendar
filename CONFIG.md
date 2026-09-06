# Calendar Configuration reference

**Just want your calendars showing up?** You don't need any of this — paste your ICS link(s),
one per line, into the plugin's **Easy ICS** setting and you're done. Names are read
automatically from each feed and colors auto-assign. Nothing below applies until you need more
than that.

This document explains, field by field, the JSON you paste into the plugin's **Advanced
Configuration** setting instead — for per-calendar colors, filtering, or attaching specific
people to specific events. It's the same JSON the
[Configuration Editor](tools/config-editor.html) generates for you — you don't need to read this
to use the plugin. It's here for when you want to hand-edit the JSON, understand exactly what a
setting does, or troubleshoot why an event isn't showing the color you expected. Advanced
Configuration adds to Easy ICS, it doesn't replace it — mix a few simple calendars in Easy ICS
with one that needs the extra setup here.

If you just want to get set up, use the
**[Configuration Editor](https://excusemi.github.io/trmnl-family-calendar/tools/config-editor.html)**
instead — it builds this JSON for you through a form, and lets you test it against your real
calendars before you save anything.

---

## Contents

- [The short version](#the-short-version)
- [Overview](#overview)
- [`locale` / `timeZone`](#locale--timezone)
- [`calendars[]`](#calendars)
- [`people[]`](#people)
- [Matchers: word vs. regex](#matchers-word-vs-regex)
- [How a color gets decided](#how-a-color-gets-decided)
- [Full example](#full-example)
- [Common mistakes](#common-mistakes)

---

## The short version

At minimum, all you need is one calendar:

```json
{
  "calendars": [
    { "url": "https://your-calendar-app.example.com/your-secret-link.ics" }
  ]
}
```

Everything else — colors, people, holidays — is optional, and layers on top of this without
changing it.

---

## Overview

The whole configuration is **one JSON object** with up to four top-level keys, all optional
except `calendars`:

| Key | What it's for |
|---|---|
| [`locale`](#locale--timezone) | Overrides the language day/month names render in |
| [`timeZone`](#locale--timezone) | Overrides which IANA time zone the grid uses |
| [`calendars`](#calendars) | Your ICS feeds — the actual event sources |
| [`people`](#people) | Names you can attach to events, each with their own color/badge |

```json
{
  "locale": "en",
  "timeZone": "Europe/Brussels",
  "calendars": [ { ... }, { ... } ],
  "people": [ { ... } ]
}
```

A note on how strict this is: **nothing here is validated harshly.** If an entry is missing a
required field, has invalid JSON, or points at a broken URL, the plugin skips that one entry and
keeps going with everything else, rather than showing an error for your whole calendar. This is
deliberate — it's meant to tolerate you editing the JSON a bit at a time.

**The default hour range** the grid shows (e.g. "7-21") isn't set here — it's the plugin's own
**Visible Hours** field, alongside Time Format/Location in the plugin's settings, not in this
JSON. Like everything else in the grid's layout, it's only ever a *starting point*: real
events, sunrise/sunset, and the current hour always widen it further, and hours outside your
configured range but inside that wider window render compressed rather than disappearing or
padding out to full size.

---

## `locale` / `timeZone`

Both optional, and both override something that's normally auto-detected from your TRMNL
account instead of set here:

```json
{ "locale": "en", "timeZone": "Europe/Brussels" }
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `locale` | a locale tag, e.g. `"en"`, `"nl-BE"`, `"fr"` | your TRMNL account's own locale | Controls day/month name language. Any locale your browser/`Intl` supports — not a fixed list. |
| `timeZone` | an IANA zone name, e.g. `"Europe/Brussels"`, `"America/New_York"` | your TRMNL account's own time zone | Which zone events/sun times/the current-time line are computed in. There's no separate plugin setting for this — set it here if you need to override the account default. |

You'd normally leave both out entirely and let them follow your account — they exist mainly for
a calendar you want to read the same way regardless of who's actually viewing the device (e.g.
this repo's own [demo config](demo-config.json) pins both, so the demo looks identical no matter
whose TRMNL account loads it), or for a device physically living in a different zone than your
account's own settings.

---

## `calendars[]`

The list of ICS feeds to show. **This is the only required part of the configuration** — without
at least one calendar, the plugin has nothing to display.

```json
"calendars": [
  {
    "url": "https://cloud.example.com/family.ics",
    "name": "Family",
    "color": "pink"
  }
]
```

**Simple mode:** if you don't need a `name`, a pinned `color`, or any of the advanced fields below,
a calendar entry can just be the URL itself — a plain string instead of an object. Each one gets a
color auto-assigned (cycling through the same palette a calendar with no `color` set would use),
same as leaving `color` out of the full object form:

```json
"calendars": [
  "https://cloud.example.com/family.ics",
  "https://cloud.example.com/work.ics"
]
```

The two forms mix freely in the same list — use the plain string for a quick add, and the full
object wherever you actually need `name`/`color`/`exclude`/`defaultPerson`/`personRules`.

**Freetext mode:** if you don't need JSON at all, the whole Calendar Configuration field also
accepts **plain text — one ICS URL per line, nothing else**:

```
https://cloud.example.com/family.ics
https://cloud.example.com/work.ics
```

This is exactly equivalent to `{"calendars": [<those same URLs>]}` — colors auto-assign the same
way. Whenever the field's contents fail to parse as JSON, they're read this way instead, so a
single pasted URL with no braces or quotes at all works too. The moment you need anything beyond
a URL (a color, `exclude`, a person), switch to the JSON object form above for that entry.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `url` | text | **yes** | — | The ICS feed's address. `webcal://` links are converted to `https://` automatically. |
| `name` | text | no | the feed's own name (read from its `X-WR-CALNAME`), else `"Calendar 1"`, `"Calendar 2"`, ... | Identifies this calendar — shown, for example, in the "unavailable for a while" banner if its feed stops responding. Set it explicitly only to override what the feed calls itself. Must be unique; a duplicate gets " (2)", " (3)", etc. appended automatically. |
| `color` | [color name](#colors) | no | auto-assigned | Pins this calendar's color. Without it, calendars are colored in the order they appear, cycling through 10 colors. |
| `exclude` | [matcher](#matchers-word-vs-regex), or list of matchers | no | — | Any event whose title matches **hides it entirely**, only from this calendar. |
| `personRules` | list (see below) | no | — | Rules for attaching a [person](#people) to specific events on this calendar. |
| `defaultPerson` | text, or list of text | no | — | Person name(s) to attach to every event on this calendar that no `personRules` entry matched. One name, or a list for a calendar that's already shared between people. |

**Where do I find my ICS link?** Every major calendar app has one, usually tucked into settings:

- **Nextcloud**: Calendar → hover a calendar → ⋯ → *Copy private link*
- **Google Calendar**: Settings → your calendar → *Secret address in iCal format*
- **Outlook / Apple Calendar**: similarly under calendar sharing/export settings

Treat this link like a password — anyone with it can read your calendar.

### `calendars[].personRules[]`

Each entry attaches a [person](#people) to specific events on that one calendar, by matching
their title:

```json
"personRules": [
  { "match": { "type": "word", "value": "L6" }, "person": "Alex" },
  { "match": { "type": "word", "value": "L6" }, "person": "Alex", "rename": false },
  { "match": { "type": "word", "value": "family trip" }, "person": ["Alex", "Jordan"] }
]
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `match` | [matcher](#matchers-word-vs-regex) | **yes** | — | Tested against every event's title on this calendar. |
| `person` | text, or list of text | **yes** | — | The person's name (see [`people[]`](#people)) — one name, or a list of them for a shared event (e.g. `["Alex", "Jordan"]`). Doesn't have to already be declared there — but only a *declared* person contributes a badge; an undeclared name still renames, just with no styling. |
| `rename` | true/false | no | `true` | Whether the matched text gets replaced with `person`'s name(s) — joined with " & " when there's more than one. Set `false` to attach the person's color/badge *without* changing the title — e.g. tagging "L6" events as Alex's without rewriting "L6" to "Alex" on screen. |

Rules are checked **in the order you list them**, against each other's output — so if an
earlier rule renames "L6" to "Alex", a later rule can match against "Alex" instead of "L6". If
more than one rule matches the same event, the **last** one wins.

---

## `people[]`

A person is a **color**, plus one small badge shown in the header's own corner (not repeated on
every one of their events — see below). People don't do any matching themselves; *where* a
person's name gets attached to an event is entirely controlled by that calendar's
[`personRules`/`defaultPerson`](#calendarspersonrules).

```json
"people": [
  { "name": "Alex", "color": "pink", "badge": "K" }
]
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `name` | text | **yes** | — | Also the name `personRules[].person` / `defaultPerson` reference to attach this person. |
| `color` | [color name](#colors) | no | — | If set, overrides the calendar's own color for this person's events. |
| `badge` | short text (1–3 characters) | no | `name`'s first letter | Shown in the header's small per-person badge. |

A person with no `color` set still gets the header badge — it just doesn't change the event's own
color, which stays whatever the calendar alone would produce.

The header's own top-left corner (full view only) shows one small badge for every person with at
least one event anywhere in the visible range — a glance at the top of the grid answers "does
anyone have something coming up" without reading every chip below it. Automatic: no setting to
turn it on, it just reflects whoever's actually tagged (by `personRules`/`defaultPerson`)
somewhere in view. This is the *only* place a person's badge shows — individual event chips never
carry one.

---

## Matchers: word vs. regex

`exclude` and `personRules[].match` both take a **matcher** — something tested against an
event's title. A matcher is always an explicit object with two fields, `type` and `value` —
never a bare string, so it's unambiguous at a glance which kind you're looking at:

**Word (the default, and normally all you need):** `type: "word"`. `value` is matched
case-insensitively, on whole-word boundaries, so `"L1"` matches "L1 Field Trip" but not "L10
Field Trip" or "XL1" — no regex knowledge, no escaping, needed:

```json
{ "match": { "type": "word", "value": "L6" }, "person": "Alex" }
```

**Regex (the expert option):** `type: "regex"`. For anything a plain word can't express —
matching several alternatives at once, a character class, excluding one word while requiring
another. `value` is used as-is, standard JavaScript-flavored regex:

```json
{ "match": { "type": "regex", "value": "\\bL[1345]\\b" }, "person": "Alex" },
"exclude": [{ "type": "regex", "value": "birthday|verjaardag" }]
```

Any general regex reference ("regex cheat sheet") applies directly. One JSON detail to know:
inside a JSON string, a backslash has to be written **twice** (`\\b`, not `\b`) — a JSON
escaping rule, not a regex one. The [Configuration Editor](tools/config-editor.html)'s Word/Regex
toggle (with a live "test against a sample title" box) handles both of these for you — only
matters if you're hand-typing the JSON.

A list mixes both freely:

```json
"exclude": [
  { "type": "word", "value": "L1" },
  { "type": "word", "value": "K2" },
  { "type": "regex", "value": "\\bL[45]\\b" }
]
```

---

## How a color gets decided

This is the part that trips people up most, so here it is spelled out plainly, least to most
specific:

1. **Base color** — the calendar's own pinned `color`, or if it doesn't have one, colors are
   auto-assigned in the order calendars appear.
2. **Person color** — if the event has a person attached (via `personRules`/`defaultPerson`)
   *and* that person has a `color` set, it overrides the base.

### Worked example

```json
{
  "calendars": [
    { "url": ".../school.ics", "color": "blue", "personRules": [{ "match": { "type": "word", "value": "L6" }, "person": "Alex" }] }
  ],
  "people": [
    { "name": "Alex", "color": "pink", "badge": "K" }
  ]
}
```

- An event titled **"L6 Math"** → attached to Alex → **pink**, badge **"K"**. The calendar's own
  blue never shows because Alex's color overrides it.
- An event titled **"Staff Meeting"** (no "L6") → matches nothing → plain **blue** (the
  calendar's own color), no badge at all.

---

## Full example

Everything combined, including a public holiday calendar (which the
[Configuration Editor](tools/config-editor.html) can add for you with one click — pick your
country, and it fills in a real calendar entry like the one below):

```json
{
  "locale": "en",
  "timeZone": "Europe/Brussels",
  "calendars": [
    { "name": "Alex", "url": "https://cloud.example.com/alex.ics", "defaultPerson": "Alex" },
    {
      "name": "School",
      "url": "https://cloud.example.com/school.ics",
      "color": "blue",
      "exclude": [
        { "type": "word", "value": "L1" }, { "type": "word", "value": "L3" },
        { "type": "word", "value": "L4" }, { "type": "word", "value": "L5" },
        { "type": "word", "value": "K1" }, { "type": "word", "value": "K2" },
        { "type": "word", "value": "K3" }
      ],
      "personRules": [
        { "match": { "type": "word", "value": "L6" }, "person": "Alex" }
      ]
    },
    {
      "name": "Holidays",
      "url": "https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics",
      "color": "red"
    }
  ],
  "people": [
    { "name": "Alex", "color": "pink", "badge": "K" }
  ]
}
```

### Colors

One of: `red` `orange` `yellow` `lime` `green` `cyan` `blue` `violet` `purple` `pink`, an
explicit gray shade `gray-10` through `gray-75` (in steps of 5 — `gray-10` is darkest, `gray-75`
is lightest), or literal `black` / `white`. Named colors automatically render as real color on
color TRMNL panels and fall back to a distinct gray on black-and-white ones; an explicit
`gray-N` (or `black`/`white`) gives you direct control over exactly how light or dark something
reads.

---

## Common mistakes

- **Putting `"hours"` in this JSON.** It used to live here; it's now the plugin's own **Visible
  Hours** setting field (a plain "7-21" string, not JSON) alongside Location. A stray `"hours"`
  key in this config is simply ignored.
- **A single backslash in a regex.** `\bL6\b` in raw JSON is invalid — it needs to be `\\bL6\\b`.
  If your pattern silently doesn't match anything, this is the first thing to check. (The
  Configuration Editor's form fields avoid this entirely — only matters if hand-editing JSON.)
- **Writing a bare string for `match`/`exclude` instead of a `{ "type", "value" }` object.** A
  matcher is never a bare string — `"match": "L6"` is invalid (silently ignored, so the rule just
  never matches). Write `{ "match": { "type": "word", "value": "L6" } }` instead — or, if "L6"
  was meant as a regex, `{ "type": "regex", "value": "\\bL6\\b" }` (though plain `"word"`/`"L6"`
  already means the same thing here, with none of the escaping).
- **Expecting `name` to rename or match events on its own.** It doesn't — renaming/matching always
  happens through `personRules`/`defaultPerson`, never `name` directly; `name` only identifies the
  calendar (e.g. in the "unavailable for a while" banner).
- **A person with no color pinned still needing to look different.** If you want Alex's events
  to visually stand out, `people[].color` has to actually be set — otherwise their events just
  keep whatever color the calendar itself uses, with only the header's own badge to tell them
  apart (see [`people[]`](#people) — no per-event badge exists to fall back on).
- **A trailing comma, or a stray quote**, breaking the whole JSON. Paste it into the
  [Configuration Editor](tools/config-editor.html) or any JSON validator to check before saving —
  malformed JSON falls back to showing nothing configured at all.
