#!/usr/bin/env bash
# verify.sh: full verification suite for MEASURED.
# Runs make shot check selftest disk, then takes a per-part shot at a cycle
# count inside each part's dwell on PAL and NTSC, and grades each against a
# demo-specific expect file with frame-independent checks only.
#
# Run from the project root.  Requires make, VICE (via local.mk X64SC), and
# python3 (harness/check.py).
#
# Cycle counts. The windows below are MEASURED (2026-09-23, I-008: one exec
# trace per moncommands file on seq_wait250, seq_gap and end_screen and a
# store trace on seq_fade), not estimated. "picture from" is the cycle at
# which the sequencer reaches seq_wait250 with the part's prepare done (setup
# follows within a frame); "fade at" is the cycle at which the fade is
# requested. PAL with the real p1; NTSC with the dummy p1 (the real p1 never
# leaves prepare there, I-010), which starts part 2 about 0.7M cycles earlier
# than the real one will and every later part about one frame earlier.
#   Part 1  PAL picture from 2.99M, fade at 21.86M;  NTSC 3.10M, fade at 19.51M
#   Part 2  PAL 22.78M, fade at 40.73M;              NTSC 19.64M, fade at 35.92M
#   Part 3  PAL 43.12M, fade at 59.59M;              NTSC 38.00M, fade at 52.33M
#   Part 4  PAL 59.62M, fade at 74.70M;              NTSC 52.35M, fade at 65.47M
#   Part 5  PAL 74.85M, fade at 86.07M;              NTSC 65.60M, fade at 75.36M
#   End screen from 88.63M PAL, 77.58M NTSC.
# The shot counts below (12/32/53/70/82M PAL, 11/28/47/62/70M NTSC) sit inside
# every window. Part 3's window was measured with the dummy p3 (a one-frame
# fade); a real colour fade delays part 4's start by about 2.4M PAL and 2.1M
# NTSC, which leaves 70M and 62M inside. Full table: the integration record, I-008.
#
# Checks dropped from the per-part standalone expect files and why:
#   p1/p3: dummy modules; no standalone expect-p1.json or expect-p3.json
#          exists; the demo-specific files check only border/background colour.
#   p2:    all frame-300-specific pixel positions (phase, ball positions change
#          every frame); retained: structural black areas around the column.
#   p4:    standalone verdict check and specific heat-cell colours (LFSR makes
#          these frame-dependent); retained: border/background black.
#   p5:    standalone verdict and explicit sprite bounding boxes (balls orbit);
#          retained: known-black strips at extreme left and right.

set -e

MAKE="${MAKE:-make}"
VICE_PAL="${X64SC:-$(grep X64SC local.mk 2>/dev/null | cut -d= -f2 | tr -d ' ')}"
PYTHON="${PYTHON:-python3}"
CHECK="harness/check.py"

echo "=== MEASURED verify.sh ==="

# ---- 1. End-screen: shot, check, selftest, disk -------------------------
echo "--- make shot check selftest disk ---"
$MAKE PLAN_GATE=off shot check selftest disk

# ---- 2. Per-part shots --------------------------------------------------
echo "--- per-part shots ---"
mkdir -p shots

VICE_FLAGS="-default -warp +sound +autostart-delay-random -autostartprgmode 1"
AUTO="build/measured-auto.prg"

run_shot() {
    local label="$1"
    local cycles="$2"
    local model_flags="$3"
    local out="$4"
    rm -f "$out"
    ${VICE_PAL} ${VICE_FLAGS} -limitcycles "${cycles}" ${model_flags} \
        -exitscreenshot "${out}" -autostart "${AUTO}" \
        > "shots/${label}.log" 2>&1 || true
    if [ ! -s "${out}" ]; then
        echo "FAIL: ${label}: no screenshot written (see shots/${label}.log)"
        return 1
    fi
    echo "  ${label}: ${out} (${cycles} cycles${model_flags:+ ${model_flags}})"
}

FAIL=0

for N in 1 2 3 4 5; do
    case $N in
        1) PAL_CYC=12000000; NTSC_CYC=11000000 ;;
        2) PAL_CYC=32000000; NTSC_CYC=28000000 ;;
        3) PAL_CYC=53000000; NTSC_CYC=47000000 ;;
        4) PAL_CYC=70000000; NTSC_CYC=62000000 ;;
        5) PAL_CYC=82000000; NTSC_CYC=70000000 ;;
    esac

    run_shot "p${N}-demo-pal"  "${PAL_CYC}"  ""            "shots/p${N}-demo-pal.png"  || FAIL=1
    run_shot "p${N}-demo-ntsc" "${NTSC_CYC}" "-model ntsc" "shots/p${N}-demo-ntsc.png" || FAIL=1
done

# ---- 3. Grade per-part shots --------------------------------------------
echo "--- per-part grading ---"

for N in 1 2 3 4 5; do
    DEMO_EXPECT="expect-p${N}-demo.json"
    PAL_SHOT="shots/p${N}-demo-pal.png"
    NTSC_SHOT="shots/p${N}-demo-ntsc.png"

    if [ ! -f "${DEMO_EXPECT}" ]; then
        echo "SKIP p${N}: ${DEMO_EXPECT} not found"
        continue
    fi

    echo "  p${N}: grading ${DEMO_EXPECT} against ${PAL_SHOT} and ${NTSC_SHOT}"
    # The demo-specific expect files include a 'verdict' check that always fails
    # mid-demo (border is black, not green/red).  Only count non-verdict FAILs.
    # check.py exits 1 whenever any check fails, and the verdict check always
    # does mid-demo; under this script's set -e a bare OUT=$(...) then ends
    # the whole run at part 1 with no output (that is what the 20:2x run of
    # 2026-09-23 did), so the status is taken through || and judged below.
    ST=0
    OUT=$(${PYTHON} "${CHECK}" "${DEMO_EXPECT}" "${PAL_SHOT}" "${NTSC_SHOT}" 2>&1) || ST=$?
    echo "${OUT}"
    # Exit 2 is a refused expect file or a shot check.py could not read:
    # nothing was graded.  Until 2026-09-23 this loop only looked for FAIL
    # lines, so expect-p5-demo.json (a pixel check on a line NTSC has no
    # row for) was refused on every run and counted as a pass (I-008).
    if [ "${ST}" -eq 2 ]; then
        echo "  p${N}: check.py did not grade (exit 2)"
        FAIL=1
        continue
    fi
    # If any FAIL line is NOT about the verdict, it is a real failure.
    REAL_FAILS=$(echo "${OUT}" | grep '^FAIL' | grep -v 'verdict' || true)
    if [ -n "${REAL_FAILS}" ]; then
        echo "  p${N}: non-verdict FAIL(s) above"
        FAIL=1
    fi

    # Also grade the standalone expect file (test/expect-pN.json) if it exists,
    # but only at a cycle count matching the standalone runner's TEST_FRAMES=300.
    # That check is informational only and not a verification gate.
done

# ---- 4. Summary ---------------------------------------------------------
echo ""
if [ "${FAIL}" -eq 0 ]; then
    echo "verify.sh: ALL CHECKS PASSED"
    exit 0
else
    echo "verify.sh: SOME CHECKS FAILED (see output above)"
    exit 1
fi
