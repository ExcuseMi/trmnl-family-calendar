# Configuring this plugin as an LLM

You're helping someone write the **Advanced Configuration** JSON for the
[Family Calendar](https://github.com/ExcuseMi/trmnl-family-calendar) TRMNL
plugin. This file is a compact reference for that one job. For prose explanations and worked
examples, see [CONFIG.md](CONFIG.md) in this repo — this file is the terse/structured version of
the same schema.

First check whether they need this JSON at all: if they just want their calendar(s) showing up,
with no per-calendar colors, filtering, or people, tell them to paste the ICS link(s) — one per
line — into the plugin's separate **Easy ICS** setting instead, and stop there. Only produce the
JSON below once they actually need something Easy ICS can't do; it goes in the **Advanced
Configuration** field, which adds to (not replaces) whatever's in Easy ICS.

Output ONE JSON object, no comments, no trailing commas, matching the shape below. Prefer
`"type": "word"` over `"type": "regex"` wherever a word does the job (see `Matcher` below) — only
reach for regex when the user's intent genuinely needs a pattern (alternation, a character class,
excluding one thing while requiring another). Regexes in JSON need every backslash doubled
(`\bL6\b` → `"\\bL6\\b"`). If you can't verify field names against this file from memory, re-read
it rather than guessing — a misspelled key is silently ignored, not an error.

## Schema

Alternative top-level shape: if the whole field's contents fail to parse as JSON, they're read as
**freetext instead — one ICS URL per line, nothing else** — equivalent to
`{"calendars": [<those URLs>]}`. Only offer this when the user explicitly wants the simplest
possible input (no color/exclude/personRules on any calendar); otherwise generate the JSON below.

```
{
  "locale"?: string,                              // e.g. "en", "nl-BE" — overrides the TRMNL
                                                    // account's own locale (day/month names)
  "timeZone"?: string,                             // IANA name, e.g. "Europe/Brussels" —
                                                    // overrides the account's own time zone
  "calendars": [                                  // required, at least one; a plain string entry
                                                    // (just the URL) is shorthand for { "url":
                                                    // string } with everything else defaulted —
                                                    // the two forms mix freely in one array
    {
      "url": string,                              // required — ICS link (webcal:// ok)
      "name"?: string,                             // identifies this calendar (e.g. in an
                                                    // "unavailable" banner); if omitted, read
                                                    // from the feed's own X-WR-CALNAME at
                                                    // render time, else "Calendar 1", ...; never
                                                    // renames or matches anything by itself —
                                                    // usually best left out entirely
      "color"?: Color,                              // pins this calendar's default color
      "exclude"?: Matcher | Matcher[],               // matches hidden entirely
      "personRules"?: [
        { "match": Matcher, "person": string | string[], "rename"?: bool }  // rename defaults
                                                        // true; person: one name or several for
                                                        // a shared event, e.g. ["Alex","Jordan"]
      ],
      "defaultPerson"?: string | string[]             // applied when no personRule matched;
                                                        // same one-or-several shape as above
    }
  ],
  "people"?: [
    {
      "name": string, "color"?: Color,
      "badge"?: string                              // shown in the header's own per-person badge
                                                        // (defaults to name's first letter) —
                                                        // full view only, never on event chips
    }
  ]
}
```

`Color` = one of `red orange yellow lime green cyan blue violet purple pink`, or `gray-N` for
N in `10 15 20 25 30 35 40 45 50 55 60 65 70 75` (10=darkest, 75=lightest), or literal `black` /
`white`.

`Matcher` = `{ "type": "word", "value": string }` (default — matched case-insensitively on
whole-word boundaries, so `"L1"` matches "L1 Trip" but not "L10 Trip"; no escaping needed) OR
`{ "type": "regex", "value": string }` for a real regex (JavaScript-flavored) when a plain word
can't express it. Always this object shape — never a bare string. Prefer `"word"`.

## How matching/precedence actually works

- **Color**: calendar's own pinned color (else auto-assigned by position) → person's color (if
  `personRules`/`defaultPerson` attached one). Later/more-specific wins.
- No person badge ever shows on an event chip; it only ever appears once, in the header's own
  per-person badge (see `people[].badge` above, full view only), covering every distinct person
  with anything anywhere in the visible range — not per event.
- **`personRules` are per-calendar**, checked in array order against that one calendar's events
  only; `rename` (default `true`) replaces the matched text with the person's name(s) in the
  title — joined with " & " when `person` is a list of more than one.

## Common mistakes to avoid generating

- Generating a top-level `"hours"` key. It's not part of this JSON — visible hour range is the
  plugin's own separate "Visible Hours" setting field, not something this config controls.
- Writing a bare string for `match`/`exclude` (e.g. `"match": "L6"`) instead of the `Matcher`
  object shape — always `{ "type": "word", "value": "L6" }` or `{ "type": "regex", "value": ... }`.
- Un-escaped backslashes inside a `"regex"`-type `value` (`"\bL6\b"` is invalid JSON-as-written;
  must be `"\\bL6\\b"`).
- Treating `name` as something that renames or matches events — it only identifies the calendar.
- Giving a person a `badge` but no `color` when the intent was "make their events look
  different" — without `color`, their events keep the calendar's own color; only the header's
  own badge differs.

## Minimal worked example

```json
{
  "calendars": [
    { "name": "Family", "url": "https://cloud.example.com/family.ics", "color": "blue" },
    {
      "name": "Alex", "url": "https://cloud.example.com/alex.ics",
      "defaultPerson": "Alex"
    }
  ],
  "people": [
    { "name": "Alex", "color": "pink", "badge": "A" }
  ]
}
```

A shared-event variant of `personRules` (e.g. a family calendar where one event belongs to more
than one kid):

```json
"personRules": [
  { "match": { "type": "word", "value": "family trip" }, "person": ["Alex", "Jordan"] }
]
```

Hand the result to the person to paste into the plugin's **Calendar Configuration** field.