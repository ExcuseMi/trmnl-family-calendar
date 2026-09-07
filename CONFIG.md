# Calendar Configuration reference

**Just want your calendars showing up?** You don't need any of this — add your ICS link(s) to
the plugin's **Easy ICS** setting (one per entry, add as many as you need) and you're done.
Names are read automatically from each feed and colors auto-assign. Nothing below applies until
you need more than that.

This document explains, field by field, the JSON you paste into the plugin's **Advanced
Configuration** setting instead — for per-calendar colors, filtering, or attaching specific
people to specific events. It's the same JSON the
[Configuration Editor](tools/config-editor.html) generates for you — you don't need to read this
to use the plugin. It's here for when you want to hand-edit the JSON, understand exactly what a
setting does, or troubleshoot why an event isn't showing the color you expected. Turning
Advanced Configuration on replaces Easy ICS entirely — while it's on, Easy ICS is ignored, so
list every calendar you want (including plain ones with no special setup) here in the JSON.

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
object wherever you actually need `name`/`color`/`rules`.

**Freetext mode:** if you don't need JSON at all, the whole Calendar Configuration field also
accepts **plain text — one ICS URL per line, nothing else**:

```
https://cloud.example.com/family.ics
https://cloud.example.com/work.ics
```

This is exactly equivalent to `{"calendars": [<those same URLs>]}` — colors auto-assign the same
way. Whenever the field's contents fail to parse as JSON, they're read this way instead, so a
single pasted URL with no braces or quotes at all works too. The moment you need anything beyond
a URL (a color, a rule), switch to the JSON object form above for that entry.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `url` | text | **yes** | — | The ICS feed's address. `webcal://` links are converted to `https://` automatically. |
| `name` | text | no | the feed's own name (read from its `X-WR-CALNAME`), else `"Calendar 1"`, `"Calendar 2"`, ... | Identifies this calendar — shown, for example, in the "unavailable for a while" banner if its feed stops responding. Set it explicitly only to override what the feed calls itself. Must be unique; a duplicate gets " (2)", " (3)", etc. appended automatically. |
| `color` | [color name](#colors) | no | auto-assigned | Pins this calendar's color. Without it, calendars are colored in the order they appear, cycling through 10 colors. |
| `rules` | list (see [below](#calendarsrules)) | no | — | Attach a [person](#people), hide, retitle, or all-day-ify specific events on this calendar. |

There is no `defaultPerson` field. To attach a person to "anything not already claimed by a more
specific rule", either make them the **first entry** in [`people[]`](#people) (that person
automatically becomes the fallback for any unmatched event, no rule needed at all), or add an
explicit catch-all rule: `{ "match": { "type": "any" }, "person": "Alex" }`.

**Where do I find my ICS link?** Every major calendar app has one, usually tucked into settings:

- **Nextcloud**: Calendar → hover a calendar → ⋯ → *Copy private link*
- **Google Calendar**: Settings → your calendar → *Secret address in iCal format*
- **Outlook / Apple Calendar**: similarly under calendar sharing/export settings

Treat this link like a password — anyone with it can read your calendar.

### `calendars[].rules[]`

The general-purpose way to act on specific events — attach a person, hide, retitle, or turn a
timed event into an all-day one. A top-level `"rules"` key (a sibling of `"calendars"`, not inside
any one calendar) applies globally, checked before every calendar's own list.

```json
"rules": [
  { "match": { "type": "word", "value": "L6" }, "person": "Alex" },
  { "match": { "type": "word", "value": "Standup" }, "rewrite": "Standup", "rewriteFull": true },
  { "match": { "type": "and", "matchers": [
      { "type": "word", "value": "Happy Hour" },
      { "type": "weekday", "value": "FR" }
  ] }, "hide": true },
  { "match": { "type": "status", "value": "tentative" }, "hide": true },
  { "match": { "type": "word", "value": "Desk booking" }, "allDay": true, "rewrite": "Kantoor", "rewriteFull": true }
]
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `match` | [matcher](#matchers-word-vs-regex) | **yes** | — | Tested against the event's title and its ICS description. |
| `person` | text, or list of text | no | — | The person's name (see [`people[]`](#people)) — one name, or a list of them for a shared event (e.g. `["Alex", "Jordan"]`). Doesn't have to already be declared there — but only a *declared* person contributes a badge; an undeclared name still renames, just with no styling. |
| `rename` | true/false | no | `true` for a plain word/regex/contains/exact match, `false` for any/all/and/or/status/weekday | Whether the matched text gets replaced with `person`'s name(s) — joined with " & " when there's more than one. Set `false` to attach the person's color/badge *without* changing the title. |
| `hide` | true/false | no | `false` | Drop the event entirely, composable with any matcher type (status, weekday, and/or). |
| `allDay` | true/false | no | `false` | Render this event as an all-day bar instead of a timed one, regardless of its real start/end time. |
| `rewrite` | text | no | — | Replaces the matched text with literal text — independent of `person`, for titles that need fixing up regardless of who they're assigned to. |
| `rewriteFull` | true/false | no | `false` | `true` replaces the WHOLE title with `rewrite`'s text; the default replaces only the matched substring (only meaningful for a plain word/regex/contains/exact match — see below). |

If more than one rule matches the same event, the **last** one wins **per effect** — a later
rule's `person` overrides an earlier one's, but doesn't cancel an earlier rule's unrelated `hide`.

`rename`/non-full `rewrite` need an actual piece of matched TEXT to substitute — that only exists
when the rule's match is a plain `word`/`regex`/`contains`/`exact` type (or an `and`/`or` that
still bottoms out at one, for the purposes of `person`'s own default). A rule whose match is
`any`/`all`/`status`/`weekday` (or an `and`/`or` combining only those) has nothing to point at, so
`rename` defaults to `false` and a non-full `rewrite` is a no-op — use `rewriteFull: true` there
instead if you want to change the title.

---

## `people[]`

A person is a **color**, plus one small badge shown in the header's own corner (not repeated on
every one of their events — see below). People don't do any matching themselves; *where* a
person's name gets attached to an event is entirely controlled by that calendar's
[`rules`](#calendarsrules).

```json
"people": [
  { "name": "Alex", "color": "pink", "badge": "K" }
]
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `name` | text | **yes** | — | Also the name a `rules[].person` entry references to attach this person. The first person in this list is the automatic "Everyone" fallback (see [`calendars[].rules[]`](#calendarsrules)) and also gets a built-in group icon for their header badge instead of `badge`'s text. |
| `color` | [color name](#colors) | no | — | If set, overrides the calendar's own color for this person's events. |
| `badge` | short text (1–3 characters) | no | `name`'s first letter | Shown in the header's small per-person badge. Ignored for the first (Everyone) person — see `name` above. |

A person with no `color` set still gets the header badge — it just doesn't change the event's own
color, which stays whatever the calendar alone would produce.

The header's own top-left corner (full view only) shows one small badge for every person with at
least one event anywhere in the visible range — a glance at the top of the grid answers "does
anyone have something coming up" without reading every chip below it. Automatic: no setting to
turn it on, it just reflects whoever's actually tagged (by a `rules` entry, or the automatic
Everyone fallback) somewhere in view. This is the *only* place a person's badge shows —
individual event chips never carry one.

---

## Matchers: word vs. regex

`rules[].match` takes a **matcher** — something tested against an
event's title *and* its ICS description (a rule fires if either one matches, so you can hide or
tag an event based on text that's only in the description, not the title — renaming still only
touches the title, so a description-only match with `rename` on leaves the title as-is since
there's nothing to replace there). A matcher is always an explicit object with two fields, `type`
and `value` — never a bare string, so it's unambiguous at a glance which kind you're looking at:

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
{ "match": { "type": "regex", "value": "birthday|verjaardag" }, "hide": true }
```

Any general regex reference ("regex cheat sheet") applies directly. One JSON detail to know:
inside a JSON string, a backslash has to be written **twice** (`\\b`, not `\b`) — a JSON
escaping rule, not a regex one. The [Configuration Editor](tools/config-editor.html)'s Word/Regex
toggle (with a live "test against a sample title" box) handles both of these for you — only
matters if you're hand-typing the JSON.

**Other matcher types** (usable anywhere `rules[].match` is expected, including nested inside
`and`/`or` below):

| `type` | `value` | Matches |
|---|---|---|
| `contains` | text | Plain substring anywhere, no word boundaries — `"team"` matches both "Team Meeting" and "Steam Room". |
| `exact` | text | The ENTIRE title (or description) equals `value`, case-insensitively — nothing more, nothing less. |
| `any` (or `all`) | *(none)* | Matches unconditionally — the "always" case, e.g. a calendar-wide catch-all rule. |
| `status` | `"confirmed"`, `"tentative"`, or `"cancelled"` | The event's ICS `STATUS`. Events with no `STATUS` at all never match any `status` matcher. |
| `weekday` | a day code/name, or a list of them | The event's own local start day. Accepts 2-letter iCal codes (`"MO"`, `"TU"`, `"WE"`, `"TH"`, `"FR"`, `"SA"`, `"SU"`) or full English names (`"Monday"`, ...), case-insensitively; a list means "any of these days". |

**Combining conditions with `and`/`or`:**

```json
{ "match": { "type": "and", "matchers": [
    { "type": "word", "value": "Happy Hour" },
    { "type": "weekday", "value": ["FR"] }
] }, "hide": true }
```

`and`/`or` take a `matchers` array of any of the matcher types above (nesting `and`/`or` inside
each other works too) and combine them — `and` requires every one to match, `or` requires at
least one. There's no separate `not` — express "everything except X" with a `regex` negative
lookahead, or by restructuring the condition (e.g. "hide unless confirmed" is
`{ "type": "status", "value": "tentative" }` OR'd with `{ "type": "status", "value": "cancelled" }`,
rather than "not confirmed").

---

## How a color gets decided

This is the part that trips people up most, so here it is spelled out plainly, least to most
specific:

1. **Base color** — the calendar's own pinned `color`, or if it doesn't have one, colors are
   auto-assigned in the order calendars appear.
2. **Person color** — if the event has a person attached (via `rules`, or the automatic Everyone
   fallback) *and* that person has a `color` set, it overrides the base.

### Worked example

```json
{
  "calendars": [
    {
      "url": ".../school.ics", "color": "blue",
      "rules": [{ "match": { "type": "word", "value": "L6" }, "person": "Alex" }]
    }
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
    {
      "name": "Alex", "url": "https://cloud.example.com/alex.ics",
      "rules": [{ "match": { "type": "any" }, "person": "Alex" }]
    },
    {
      "name": "School",
      "url": "https://cloud.example.com/school.ics",
      "color": "blue",
      "rules": [
        { "match": { "type": "regex", "value": "\\b(L1|L3|L4|L5|K1|K2|K3)\\b" }, "hide": true },
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