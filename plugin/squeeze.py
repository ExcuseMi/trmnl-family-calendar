#!/usr/bin/env python3
"""Squeeze the two source files down to what the server will accept.

Both carry a lot of explanation -- why each constant is what it is, which
screenshot each rule came from, what broke and why the fix is shaped the way
it is -- and both have outgrown the server's 100KB per-file limit. That
explanation is worth more in the repo than the bytes are on the server, so
the copy that goes to the device is squeezed and the working copy is put
straight back afterwards.

Three passes, in this order:

  1. Drop every whole-line `//` comment, and shared.liquid's Liquid
     `{% comment %}` blocks. Only lines that START with the marker go, so
     trailing comments, string contents and `https://` URLs are untouched.
  2. Minify the JavaScript, identifiers included.
  3. Minify the CSS, which until this existed was shipped as written: the
     stylesheet is a third explanation by weight, and `//` is not how CSS
     spells a comment, so pass 1 never touched a byte of it. 8.8KB of
     stylesheet is 1.5KB of stylesheet, and it was that, not the code, that
     had put this file over the limit.

Run directly to WRITE the squeezed copies (push.sh restores them), or with
--check to report the sizes and change nothing, which is what ./test.sh
does so this can never be discovered at deploy time again.

Usage: squeeze.py [--check] <shared.liquid> <transform.js> <esbuild>
"""
import re
import subprocess
import sys

LIMIT = 100 * 1024
PLACEHOLDER = '__METRO_PAYLOAD_LIQUID__'


def run(esbuild, args, text, why):
    r = subprocess.run([esbuild] + args, input=text, capture_output=True, text=True)
    if r.returncode != 0:
        print('could not minify %s:\n%s' % (why, r.stderr.strip()), file=sys.stderr)
        sys.exit(1)
    return r.stdout


def uncomment(s):
    return re.sub(r'\n{3,}', '\n\n',
                  '\n'.join(l for l in s.split('\n') if l.lstrip()[:2] != '//'))


def squeeze_transform(src, esbuild):
    return run(esbuild, ['--minify'], uncomment(src), 'transform.js')


def squeeze_liquid(src, esbuild):
    body = re.sub(r'\{%-?\s*comment\s*-?%\}.*?\{%-?\s*endcomment\s*-?%\}', '', src, flags=re.S)
    body = uncomment(body)
    # The one big inline <script>. The Liquid expression inside it is swapped
    # for a placeholder first: a minifier reads `{{ data | json }}` as a
    # syntax error, and putting it back afterwards is exact because the token
    # cannot occur in the source.
    i = body.index('<script>') + len('<script>')
    j = body.index('</script>', i)
    js = body[i:j].replace('{{ data | json }}', PLACEHOLDER)
    if PLACEHOLDER not in js:
        print('shared.liquid: the METRO payload expression moved; teach squeeze.py the new one',
              file=sys.stderr)
        sys.exit(1)
    js = run(esbuild, ['--minify'], js, "shared.liquid's inline script").replace(PLACEHOLDER, '{{ data | json }}')
    body = body[:i] + '\n' + js + body[j:]
    # ...and every <style>, which is Liquid-free and can go through whole.
    def css(m):
        return '<style>' + run(esbuild, ['--loader=css', '--minify'], m.group(1),
                               "shared.liquid's stylesheet") + '</style>'
    return re.sub(r'<style>(.*?)</style>', css, body, flags=re.S)


def report(name, before, after):
    print('%s: %d -> %d bytes' % (name, before, after), file=sys.stderr)
    return after <= LIMIT


def main():
    args = sys.argv[1:]
    check = '--check' in args
    args = [a for a in args if a != '--check']
    liquid, transform, esbuild = args
    ok = True
    for path, fn in ((transform, squeeze_transform), (liquid, squeeze_liquid)):
        src = open(path).read()
        out = fn(src, esbuild)
        name = path.rsplit('/', 1)[-1]
        if not report(name, len(src), len(out)):
            print("%s is %d bytes over the server's %d limit."
                  % (name, len(out) - LIMIT, LIMIT), file=sys.stderr)
            ok = False
        elif not check:
            open(path, 'w').write(out)
    if not ok:
        print('nothing was written; the working copies are untouched.', file=sys.stderr)
        sys.exit(1)


main()
