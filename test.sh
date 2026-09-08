#!/usr/bin/env bash
# Runs both regression suites: transform.js (plain Node) and the configuration editor
# (jsdom-driven). Usage: ./test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/test/transform" && node run.js
cd "$ROOT/test/config-editor" && npm install --no-audit --no-fund --silent && node run.js
