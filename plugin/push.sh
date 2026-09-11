#!/usr/bin/env bash
# Push to TRMNL, with the source comments stripped and the JS minified.
#
# Both source files carry a lot of explanation: why each constant is what it
# is, which screenshot each rule came from, what broke and why the fix is
# shaped the way it is. Both have outgrown the server's 100KB per-file
# limit. That explanation is worth more in the repo than the bytes are on
# the server, so the copy that goes to the device is squeezed and the
# working copy is put straight back afterwards, whatever happens.
#
# Two steps, in this order:
#
#   1. Drop every whole-line comment, and shared.liquid's Liquid
#      `{% comment %}` blocks. Only lines that START with the marker go, so
#      trailing comments, string contents and `https://` URLs are untouched.
#   2. Minify the JavaScript, identifiers included. That is worth ~22KB on
#      shared.liquid, which had run out of room under the 100KB limit and
#      could not be pushed at all.
#
#      It used to leave identifiers alone for two reasons. The first is
#      answered rather than given up: the layout suite finds the payload by
#      looking for the `METRO` literal so it can measure the artefact that
#      really ships, and the template now writes `window.METRO` first and
#      aliases it. A property name is not an identifier and the mangler
#      leaves it alone, so the marker survives and the local alias is free
#      to become a letter.
#
#      The second is a real loss: a stack trace off the device no longer
#      names the function it came from. That is the price of the file
#      fitting on the server at all, and the source it maps back to is one
#      `git show` away.
#
# Nothing is uploaded until the squeezed copies have been built AND actually
# run: a minifier that broke the layout would otherwise push cleanly and
# draw nothing on the panel.
#
# Usage: ./push.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
LIQUID="$HERE/src/shared.liquid"
TRANSFORM="$HERE/src/transform.js"
ESBUILD="$ROOT/tools/node_modules/.bin/esbuild"

# Lint the REAL sources, before the squeeze below strips the comments out of
# them. One of trmnlp's checks counts words that appear in comments, so a
# stripped copy is a different question from the one the reader of this
# repository is asking, and the easier one.
"$HERE/lint.sh" || { echo "trmnlp lint is not clean; nothing was uploaded" >&2; exit 1; }

BAK_L="$(mktemp)"; BAK_T="$(mktemp)"
cp "$LIQUID" "$BAK_L"; cp "$TRANSFORM" "$BAK_T"
restore() { cp "$BAK_L" "$LIQUID"; cp "$BAK_T" "$TRANSFORM"; rm -f "$BAK_L" "$BAK_T"; }
trap restore EXIT

[ -x "$ESBUILD" ] || (cd "$ROOT/tools" && npm install --no-audit --no-fund --silent)
[ -x "$ESBUILD" ] || { echo "no esbuild in tools/node_modules; run 'npm install' in tools/" >&2; exit 1; }

python3 - "$LIQUID" "$TRANSFORM" "$ESBUILD" <<'PY'
import re, subprocess, sys

LIMIT = 100 * 1024
liquid, transform, esbuild = sys.argv[1:4]

def minify(js, why):
    r = subprocess.run([esbuild, '--minify'],
                       input=js, capture_output=True, text=True)
    if r.returncode != 0:
        print('could not minify %s:\n%s' % (why, r.stderr.strip()), file=sys.stderr)
        sys.exit(1)
    return r.stdout

def report(name, before, after):
    print('%s: %d -> %d bytes' % (name, before, after), file=sys.stderr)
    if after > LIMIT:
        print("%s is still %d bytes over the server's %d limit. Nothing was pushed; "
              'the working copy is untouched.' % (name, after - LIMIT, LIMIT), file=sys.stderr)
        sys.exit(1)

def uncomment(s):
    return re.sub(r'\n{3,}', '\n\n',
                  '\n'.join(l for l in s.split('\n') if l.lstrip()[:2] != '//'))

# ---- transform.js: plain JavaScript, all of it
src = open(transform).read()
out = minify(uncomment(src), 'transform.js')
open(transform, 'w').write(out)
report('transform.js', len(src), len(out))

# ---- shared.liquid: an HTML template with one big inline <script>.
# Only the script is JavaScript, and the one Liquid expression inside it is
# swapped for a placeholder first: a minifier reads `{{ data | json }}` as
# a syntax error, and putting it back afterwards is exact because the token
# cannot occur in the source.
src = open(liquid).read()
body = re.sub(r'\{%-?\s*comment\s*-?%\}.*?\{%-?\s*endcomment\s*-?%\}', '', src, flags=re.S)
body = uncomment(body)
i = body.index('<script>') + len('<script>')
j = body.index('</script>', i)
PLACEHOLDER = '__METRO_PAYLOAD_LIQUID__'
js = body[i:j].replace('{{ data | json }}', PLACEHOLDER)
if PLACEHOLDER not in js:
    print('shared.liquid: the METRO payload expression moved; teach push.sh the new one',
          file=sys.stderr)
    sys.exit(1)
js = minify(js, "shared.liquid's inline script").replace(PLACEHOLDER, '{{ data | json }}')
out = body[:i] + '\n' + js + body[j:]
open(liquid, 'w').write(out)
report('shared.liquid', len(src), len(out))
PY

# The squeezed copies have to build, load, and actually lay a map out.
(cd "$HERE" && trmnlp build >/dev/null)
node -e "require('$TRANSFORM')" || { echo "the minified transform.js does not load" >&2; exit 1; }
node "$HERE/verify-build.js"

(cd "$HERE" && echo "y" | trmnlp push)
