# Candidate B3: "Stabs, half time". Tune B2 with voice 1 rewritten for a
# half-time feel at the same tempo: kick on 1 (and 2 and 4, so a drum stands
# on every beat as the gate asks), the snare on 3 only, the bass in eighth
# pairs after each drum ("K . b b K . b b S . b b K . b b"), the stabs, hats,
# drop, build, lead and structure exactly B2's. Same grammar, same sections,
# same SYNC_POS; the maintainer picks by ear between the two feels.
import copy, importlib.util, os
_p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tune_B2.py")
_s = importlib.util.spec_from_file_location("tune_B2", _p)
_b2 = importlib.util.module_from_spec(_s); _s.loader.exec_module(_b2)

STYLE = _b2.STYLE
SECTIONS = _b2.SECTIONS
SYNC_POS = _b2.SYNC_POS
TUNE = copy.deepcopy(_b2.TUNE)
TUNE['name'] = "Candidate B3: Stabs, half time"
TUNE['patterns'].update(
    # voice 1 only. Hits: kick 1, 2 and 4, snare 3, one pluck after the first
    # kick of each half; h2 rolls into the riff.
    h1="K i=bass C2 r r K r r r S i=bass C2 r r K r r r",
    h2="K i=bass C2 r C2 K r r r S i=bass C2 r C2 K S S S",
    # The riff: a rest after every drum, then two plucks; the fifth on 14
    # with the stab; four of the eight plucks on odd sixteenths.
    bA="K r i=bass C2 C2 K r i=bass C3 C2 S r i=bass Bb1 C2 K r i=bass G2 C2",
    bB="K r i=bass C2 G1 K r i=bass C3 C2 S r i=bass Bb1 G1 K r i=bass Bb2 C2",
    bF="K r i=bass C2 C2 K r i=bass C3 C2 S i=bass Bb1 Bb1 C2 K i=bass G1 i=tom G4 F4",
    bR="K i=bass C2 C2 C2 K r i=bass C3 C2 S i=bass Bb1 Bb1 C2 K S S S",
)
