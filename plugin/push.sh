#!/usr/bin/env bash
# Push to TRMNL with the source comments stripped.
#
# Both source files carry a lot of explanation: why each constant is what it
# is, which screenshot each rule came from, what broke and why the fix is
# shaped the way it is. Both have outgrown the server's 100KB per-file
# limit. The comments are worth more in the repo than the bytes are on the
# server, so the pushed copies drop every whole-line comment and nothing
# else. Inline trailing comments, string contents and `https://` URLs are
# untouched, since only lines that START with the comment marker are
# removed. shared.liquid also carries Liquid `{% comment %}` blocks, which
# are stripped the same way.
#
# The originals are restored on the way out, whatever happens.
#
# Usage: ./push.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIQUID="$HERE/src/shared.liquid"
TRANSFORM="$HERE/src/transform.js"
BAK_L="$(mktemp)"; BAK_T="$(mktemp)"
cp "$LIQUID" "$BAK_L"; cp "$TRANSFORM" "$BAK_T"
restore() { cp "$BAK_L" "$LIQUID"; cp "$BAK_T" "$TRANSFORM"; rm -f "$BAK_L" "$BAK_T"; }
trap restore EXIT

python3 - "$LIQUID" "$TRANSFORM" <<'PY'
import re, sys

LIMIT = 100 * 1024

def strip(path, name):
    s = open(path).read()
    # Liquid comment blocks, which the server would ship to the device and
    # which say nothing to it. Only in the template.
    body = re.sub(r'\{%-?\s*comment\s*-?%\}.*?\{%-?\s*endcomment\s*-?%\}', '', s, flags=re.S) \
        if name.endswith('.liquid') else s
    kept = [l for l in body.split('\n') if l.lstrip()[:2] != '//']
    out = re.sub(r'\n{3,}', '\n\n', '\n'.join(kept))
    open(path, 'w').write(out)
    print('%s: %d -> %d bytes' % (name, len(s), len(out)), file=sys.stderr)
    if len(out) > LIMIT:
        print('%s is still %d bytes over the server\'s %d limit. Nothing was pushed; '
              'the source is untouched.' % (name, len(out) - LIMIT, LIMIT), file=sys.stderr)
        sys.exit(1)

strip(sys.argv[1], 'shared.liquid')
strip(sys.argv[2], 'transform.js')
PY

# the stripped copies must still build, or we would push a broken template
(cd "$HERE" && trmnlp build >/dev/null)
grep -q 'data-metro-debug' "$HERE/_build/full.html" || { echo "stripped build lost the canvas" >&2; exit 1; }
node -e "require('$TRANSFORM')" || { echo "stripped transform.js does not load" >&2; exit 1; }

(cd "$HERE" && echo "y" | trmnlp push)
