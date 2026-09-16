#!/usr/bin/env bash
# Fetch the High Voltage SID Collection (HVSC) into data/hvsc-corpus/.
#
# HVSC is research-use-only. This script downloads it into a gitignored
# directory; nothing about HVSC is committed to the repo. The download
# URL points at the current HVSC release; bump HVSC_VERSION when a new
# update ships (biannual: June + December).
#
# Idempotent: skips download if the unpacked corpus is already present.

set -euo pipefail

HVSC_VERSION="${HVSC_VERSION:-84}"  # HVSC update number (84 = Dec 2025)
HVSC_URL="https://www.hvsc.c64.org/download/C64Music/HVSC_${HVSC_VERSION}_C64Music.zip"
HVSC_SHA256="${HVSC_SHA256:-}"      # optional pin
DEST_DIR="${DEST_DIR:-data/hvsc-corpus}"
ZIP_PATH="$(dirname "$DEST_DIR")/hvsc-${HVSC_VERSION}.zip"

mkdir -p "$DEST_DIR" "$(dirname "$ZIP_PATH")"

# If the C64Music marker directory is already present, assume the corpus is
# unpacked. (Idempotency.)
if [[ -d "$DEST_DIR/C64Music" ]]; then
    echo "HVSC already present at $DEST_DIR/C64Music — skipping download."
    echo "To force re-download: rm -rf $DEST_DIR/C64Music && $0"
    exit 0
fi

echo "Downloading HVSC #${HVSC_VERSION} from $HVSC_URL..."
echo "(This is ~70MB. Will skip on re-run.)"
if ! command -v curl >/dev/null 2>&1; then
    echo "ERROR: curl not installed." >&2
    exit 1
fi
if ! command -v unzip >/dev/null 2>&1; then
    echo "ERROR: unzip not installed." >&2
    exit 1
fi
curl -fL --progress-bar "$HVSC_URL" -o "$ZIP_PATH"

if [[ -n "$HVSC_SHA256" ]]; then
    echo "Verifying SHA-256..."
    if command -v shasum >/dev/null 2>&1; then
        ACTUAL_SHA=$(shasum -a 256 "$ZIP_PATH" | cut -d' ' -f1)
    else
        ACTUAL_SHA=$(sha256sum "$ZIP_PATH" | cut -d' ' -f1)
    fi
    if [[ "$ACTUAL_SHA" != "$HVSC_SHA256" ]]; then
        echo "ERROR: SHA-256 mismatch. Expected $HVSC_SHA256, got $ACTUAL_SHA." >&2
        exit 1
    fi
fi

echo "Unpacking into $DEST_DIR..."
unzip -q "$ZIP_PATH" -d "$DEST_DIR"
rm -f "$ZIP_PATH"

echo "HVSC ready at $DEST_DIR/C64Music"
echo "Tune count: $(find "$DEST_DIR/C64Music" -name '*.sid' | wc -l)"
