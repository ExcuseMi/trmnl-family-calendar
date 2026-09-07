# Configuring this plugin as an LLM

You're helping someone write the **Advanced Configuration** JSON for the
[Family Calendar](https://github.com/ExcuseMi/trmnl-family-calendar) TRMNL
plugin. This file is a compact reference for that one job. For prose explanations and worked
examples, see [CONFIG.md](CONFIG.md) in this repo — this file is the terse/structured version of
the same schema.

First check whether they need this JSON at all: if they just want their calendar(s) showing up,
with no per-calendar colors, filtering, or people, tell them to add the ICS link(s) — one per
entry — into the plugin's separate **Easy ICS** setting instead, and stop there. Only produce the
JSON below once they actually need something Easy ICS can't do; it goes in the **Advanced
Configuration** field. Turning that field's toggle on replaces Easy ICS entirely (it's ignored
while Advanced Configuration is on) — so the JSON needs to list every calendar they want, not
just the ones needing special setup.

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
possible input (no color/rules on any calendar); otherwise generate the JSON below.

```
{
  "locale"?: string,                              // e.g. "en", "nl-BE" — overrides the TRMNL
                                                    // account's own locale (day/month names)
  "timeZone"?: string,                             // IANA name, e.g. "Europe/Brussels" —
                                                    // overrides the account's own time zone
  "rules"?: Rule[],                                // global rules, checked before any calendar's
                                                    // own (see Rule below); last matching rule
                                                    // wins per effect (person/hide/allDay/rewrite)
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
      "rules"?: Rule[]                              // this calendar's own rules, checked after
                                                        // global ones — see Rule below
    }
  ],
  "people"?: [
    {
      "name": string, "color"?: Color,
      "badge"?: string                              // shown in the header's own per-person badge
                                                        // (defaults to name's first letter) —
                                                        // full view only, never on event chips.
                                                        // Note: for the FIRST person in this list
                                                        // (see below) badge is ignored and a
                                                        // built-in group icon renders instead.
    }
  ]
}
```

**The first entry in `people[]` is the automatic "Everyone" fallback** — any event no rule
assigns to someone more specific gets attached to them automatically, no rule needed. This is the
*only* way to get that behavior; there is no separate `defaultPerson` field (an older version of
this schema had one — it no longer exists and is silently ignored if written).

```
Rule = {
  "match": Matcher,                                 // required
  "person"?: string | string[],                     // attach person(s) to matching events
  "rename"?: bool,                                   // default true (false when match's top-level
                                                       // type is any/all/and/or/status/weekday,
                                                       // since there's no specific text to rename
                                                       // to the person's name) — replaces matched
                                                       // text with person's name(s), joined " & "
  "allDay"?: bool,                                   // render as an all-day bar instead of timed
  "hide"?: bool,                                     // drop the event entirely
  "rewrite"?: string,                                // replace matched text with literal text
                                                       // (ignored — no-op — if match's top-level
                                                       // type has no literal text, unless
                                                       // rewriteFull is also set)
  "rewriteFull"?: bool                               // true: rewrite replaces the WHOLE title,
                                                       // not just the matched substring
}
```
Rules within one list (global, or one calendar's own) are checked **in order**; if more than one
matches the same event, the **last** one wins per effect (a later rule's `person` overrides an
earlier one's, etc. — effects don't merge). Global rules are checked before a calendar's own.

`Color` = one of `red orange yellow lime green cyan blue violet purple pink`, or `gray-N` for
N in `10 15 20 25 30 35 40 45 50 55 60 65 70 75` (10=darkest, 75=lightest), or literal `black` /
`white`.

`Matcher` = `{ "type": "word", "value": string }` (default — matched case-insensitively on
whole-word boundaries, so `"L1"` matches "L1 Trip" but not "L10 Trip"; no escaping needed) OR
`{ "type": "regex", "value": string }` for a real regex (JavaScript-flavored) when a plain word
can't express it. Always this object shape — never a bare string. Prefer `"word"`. Word/regex
(plus `contains`/`exact`) test against the event's title *and* its ICS description.

Other matcher types, usable anywhere a `Matcher` is expected (including nested inside `and`/`or`):
- `{ "type": "contains", "value": string }` — plain substring, no word boundaries.
- `{ "type": "exact", "value": string }` — the whole title (or whole description) must equal `value`.
- `{ "type": "any" }` (or `"all"`) — matches unconditionally, no `value`.
- `{ "type": "status", "value": "confirmed" | "tentative" | "cancelled" }` — the event's ICS STATUS.
- `{ "type": "weekday", "value": string | string[] }` — the event's local start day. Accepts
  2-letter iCal codes (`"MO"`..`"SU"`) or full names (`"Monday"`); a list means "any of these".
- `{ "type": "and", "matchers": Matcher[] }` / `{ "type": "or", "matchers": Matcher[] }` —
  combine any of the above; nests freely. `rename`/non-full `rewrite` only replace matched text
  when the rule's TOP-LEVEL match is a plain `word`/`regex`/`contains`/`exact` — an `and`/`or`/
  `status`/`weekday` top-level match has no literal substring to replace, so rename is a no-op
  unless you also use `rewriteFull: true`.

## How matching/precedence actually works

- **Color**: calendar's own pinned color (else auto-assigned by position) → person's color (if a
  rule, or the automatic Everyone fallback, attached one). Later/more-specific wins.
- No person badge ever shows on an event chip; it only ever appears once, in the header's own
  per-person badge (see `people[].badge` above, full view only), covering every distinct person
  with anything anywhere in the visible range — not per event.
- **`rules` are checked in array order**; `rename` (default `true` for a plain
  word/regex/contains/exact match) replaces the matched text with the person's name(s) in the
  title — joined with " & " when `person` is a list of more than one.

## Common mistakes to avoid generating

- Generating a top-level `"hours"` key. It's not part of this JSON — visible hour range is the
  plugin's own separate "Visible Hours" setting field, not something this config controls.
- Writing a bare string for `match` (e.g. `"match": "L6"`) instead of the `Matcher` object shape
  — always `{ "type": "word", "value": "L6" }` or `{ "type": "regex", "value": ... }`.
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
      "rules": [{ "match": { "type": "any" }, "person": "Alex" }]
    }
  ],
  "people": [
    { "name": "Alex", "color": "pink", "badge": "A" }
  ]
}
```

A shared-event variant (e.g. a family calendar where one event belongs to more than one kid):

```json
"rules": [
  { "match": { "type": "word", "value": "family trip" }, "person": ["Alex", "Jordan"] }
]
```

Hand the result to the person to paste into the plugin's **Calendar Configuration** field.