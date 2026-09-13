#!/usr/bin/env bash
# Runs the suites that need no browser: transform.js, the cross-axis solver,
# the time axis, and the config editor. The rendered geometry has its own suite in
# test/layout, which needs headless Chromium. Usage: ./test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/test/transform" && node run.js
cd "$ROOT/test/cross" && node run.js
cd "$ROOT/test/axis" && node run.js
cd "$ROOT/test/config-editor" && npm install --no-audit --no-fund --silent && node run.js
# ...and whether what all of that is testing would still fit on the server.
#
# The board is code on a device, and the device has a 100KB per-file limit
# that nothing outside `push.sh` could see. A session's worth of work went in
# with every suite green and the plugin 5KB too big to deploy, which is a
# thing to find out from a red suite and not at the end of a deploy.
cd "$ROOT" && python3 plugin/squeeze.py --check plugin/src/shared.liquid \
  plugin/src/transform.js tools/node_modules/.bin/esbuild
