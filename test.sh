#!/usr/bin/env bash
# Runs the transform.js regression suite locally. No Docker needed — just Node.
# Usage: ./test.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/test/transform"
node run.js
