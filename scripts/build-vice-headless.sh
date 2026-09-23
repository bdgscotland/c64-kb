#!/bin/sh
# Build a windowless VICE 3.10 x64sc into .tools/vice-headless/ and a wrapper
# that every emulator launch in this repo picks up (src/services/vice-bin.ts).
#
# Why: the GTK build opens a window on every headless run and takes the
# desktop's focus. VICE 3.10 ships a headless front end (--enable-headlessui)
# whose exit screenshots are byte-identical to the GTK build's; measured on the
# pinned recipes, PAL and NTSC, disk-backed included, 2026-09-22.
#
# Needs: a C toolchain, autotools' runtime deps the tarball's configure asks
# for, libpng, and on macOS `brew install dos2unix xa` (configure refuses
# without both). On Debian/Ubuntu: build-essential xa65 dos2unix libpng-dev
# pkg-config flex bison (configure stops without flex). A Linux build matched
# all 54 pinned PNGs it could run, 2026-09-23. Takes about a minute on a
# recent machine.
#
# Usage: npm run vice:headless      (or: sh scripts/build-vice-headless.sh)
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TOOLS="$ROOT/.tools/vice-headless"
SRC="$TOOLS/src"
VER=3.10
TARBALL="vice-$VER.tar.gz"
SHA256=8e5bac18cbcb9f192380ad3ef881f8790f5b75c41d7b3da65d831985d864d6d1
URL="https://sourceforge.net/projects/vice-emu/files/releases/$TARBALL/download"

mkdir -p "$SRC" "$TOOLS/bin"
cd "$SRC"
if [ ! -f "$TARBALL" ]; then
  echo "fetching $TARBALL"
  curl -L -o "$TARBALL" "$URL"
fi
if command -v shasum >/dev/null 2>&1; then
  echo "$SHA256  $TARBALL" | shasum -a 256 -c -
else
  echo "$SHA256  $TARBALL" | sha256sum -c -
fi
[ -d "vice-$VER" ] || tar xzf "$TARBALL"

for tool in dos2unix xa; do
  command -v "$tool" >/dev/null 2>&1 || { echo "missing $tool (macOS: brew install dos2unix xa)"; exit 1; }
done

mkdir -p build && cd build
if [ ! -f Makefile ]; then
  "../vice-$VER/configure" --disable-arch --disable-pdf-docs --disable-html-docs \
    --enable-headlessui --without-pulse --without-alsa --without-oss --with-png
fi
# A plain top-level make; `make x64sc` races on .deps under -j.
JOBS=$( (sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4) )
make -j"$JOBS"

cp src/x64sc "$TOOLS/x64sc-headless"
rm -rf "$TOOLS/data" && cp -R "../vice-$VER/data" "$TOOLS/data"

# The build is not installed, so it needs -directory pointing at its data, and
# VICE only honours that AFTER -default (which resets the search path). The
# wrapper inserts it in the right place so the pinned commands run unchanged.
cat > "$TOOLS/bin/x64sc" <<EOF
#!/bin/sh
BIN="$TOOLS/x64sc-headless"
DATA="$TOOLS/data"
seen=0
for a in "\$@"; do
  if [ "\$a" = "-default" ] && [ \$seen -eq 0 ]; then set -- "\$@" "\$a" -directory "\$DATA"; seen=1; else set -- "\$@" "\$a"; fi
  shift
done
[ \$seen -eq 0 ] && set -- -directory "\$DATA" "\$@"
exec "\$BIN" "\$@"
EOF
chmod +x "$TOOLS/bin/x64sc" "$TOOLS/x64sc-headless"
# c1541 makes the blank disks the disk-backed recipes attach (runs.json "disk").
cp src/c1541 "$TOOLS/bin/c1541" && chmod +x "$TOOLS/bin/c1541"
echo "windowless x64sc ready: $TOOLS/bin/x64sc"
echo "smoke: $("$TOOLS/bin/x64sc" -help 2>&1 | head -1)"
