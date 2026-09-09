# Metro Calendar — agent notes

- The plugin lives in `plugin/` (TRMNL Serverless: `src/transform.js` + `src/*.liquid`); its own guidelines are in `plugin/AGENTS.md`, the layout design in `DESIGN.md`, the config schema in `CONFIG.md`.
- Use TRMNL framework classes (https://trmnl.com/framework/docs/3.3) over inline styles wherever a class exists.
- Three suites: `./test.sh` at the root (transform.js + config editor, plain Node) and `cd test/layout && npm test` (the rendered geometry, headless Chromium, a few minutes). Run all three plus `trmnlp lint` before pushing.
- Layout changes need a screenshot at a real device size, zoomed on what changed, **as well as** a green suite. Read `plugin/AGENTS.md` "Testing the layout" first: it covers what the harness measures, the difference between a well-formed drawing and a truthful one, and the two ways a green run has lied here before.
- `tools/config-editor.html` runs `plugin/src/transform.js` and the `<script>` from `plugin/src/shared.liquid` unmodified for its preview; keep the header markup it mirrors in sync when the template's header changes.
