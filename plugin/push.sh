#!/usr/bin/env bash
# Push to TRMNL with the source comments stripped.
#
# shared.liquid carries a lot of explanation — why each constant is what it
# is, which screenshot each rule came from — and it outgrew the server's
# 100KB limit for a single template file. The comments are worth more in the
# repo than the bytes are on the server, so the pushed copy drops every
# whole-line `//` comment and nothing else. Inline trailing comments, string
# contents and `https://` URLs are untouched, since only lines that START
# with `//` are removed.
#
# Usage: ./push.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/src/shared.liquid"
BAK="$(mktemp)"
cp "$SRC" "$BAK"
restore() { cp "$BAK" "$SRC"; rm -f "$BAK"; }
trap restore EXIT

python3 - "$SRC" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
kept = [l for l in s.split('\n') if l.lstrip()[:2] != '//']
out = re.sub(r'\n{3,}', '\n\n', '\n'.join(kept))
open(p, 'w').write(out)
print('shared.liquid: %d -> %d bytes' % (len(s), len(out)), file=sys.stderr)
PY

# the stripped copy must still build, or we would push a broken template
(cd "$HERE" && trmnlp build >/dev/null)
grep -q 'data-metro-debug' "$HERE/_build/full.html" || { echo "stripped build lost the canvas" >&2; exit 1; }

(cd "$HERE" && echo "y" | trmnlp push)
