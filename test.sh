#!/usr/bin/env bash
# Runs the three suites that need no browser: transform.js, the cross-axis
# solver, and the config editor. The rendered geometry has its own suite in
# test/layout, which needs headless Chromium. Usage: ./test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/test/transform" && node run.js
cd "$ROOT/test/cross" && node run.js
cd "$ROOT/test/config-editor" && npm install --no-audit --no-fund --silent && node run.js
