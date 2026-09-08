# Metro Calendar — agent notes

- The plugin lives in `plugin/` (TRMNL Serverless: `src/transform.js` + `src/*.liquid`); its own guidelines are in `plugin/AGENTS.md`, the layout design in `DESIGN.md`, the config schema in `CONFIG.md`.
- Use TRMNL framework classes (https://trmnl.com/framework/docs/3.3) over inline styles wherever a class exists.
- Run `trmnlp lint` and `./test.sh` before pushing; verify layout changes with real screenshots of `trmnlp build` output at device sizes (see `plugin/AGENTS.md`).
- `tools/config-editor.html` runs `plugin/src/transform.js` and the `<script>` from `plugin/src/shared.liquid` unmodified for its preview; keep the header markup it mirrors in sync when the template's header changes.
