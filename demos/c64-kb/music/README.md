# The music: three tunes, one data image under the KERNAL

The player is `src/parts/music3_player.asm`, the KB's own three-voice
player (original code, BSD-3) with wavetables, pulse and filter programs,
hard restart, swing, an NTSC skip that keeps the PAL tempo, and the KB's
`sid_env3_filter_envelope` as filter kind 2. This directory holds what is
needed to regenerate the tune data it plays.

| File | What it is |
| ---- | ---------- |
| `tune_A2.py` | Tune A, "Lists (darker)": C minor, 150 BPM, 60 bars, loops to bar 4. Every part and the end screen. |
| `tune_B2.py` | Tune B, "Stabs": G minor, 166.7 BPM, 26 bars, loops to bar 2. In the image as tune 1, not played: held back pending the maintainer's ear. |
| `tune_B3.py` | "Stabs, half time": tune B with voice 1 rewritten. Not in the demo; kept so the two feels can be compared by ear. |
| `tune_C.py` | Tune C, "After": C minor, 125 BPM, 16 bars, a coda. In the image as tune 2, not played: held back. |
| `instruments.py` | The instrument bank the tunes pick from. |
| `mkmusic_multi.py` | The compiler: several tune modules in, one data file out. |
| `tunecheck.py` | The gates a tune must pass, and the distance report between two tunes. |

## How the data image is built

```
python3 mkmusic_multi.py tune_A2.py tune_B2.py tune_C.py ../src/parts/music3_data.asm
```

The tunes are numbered 0, 1 and 2 in the order given; a silent list is
the number after them. Patterns, instruments, filter programs and the
wavetable are pooled: tune 0 goes in first and verbatim, and each later
tune reuses any table whose compiled bytes already exist in the pool.
The output is one file in two pieces. The header (tune count, speeds,
loop points, voice 3's read tick, order-list pointers) is assembled in
the player's block at `$1000`, because `music_init` reads it with the
KERNAL banked in. The image, everything `music_play` reads, is
assembled at `$6000` under `.pseudopc $E000`, so every address inside
it is `$E000`-based. The output of that command today is byte for byte
the `music3_data.asm` in `src/parts/`.

## Why it lives under the KERNAL

The demo is a single file and RAM below `$E000` is spoken for: the
parts' code, bank 1's bitmap and tables, the frame meter, the dispatcher
tables. The 8 KB under the KERNAL ROM is used by nothing else. The
sequencer copies the image from its load address to `$E000` once at
start, before part 1 runs, so part 2 may overwrite `$6000` with its
bitmap. Around every `music_play` call the sequencer sets `$01 = $35`,
banks the KERNAL out, and puts the value it found back afterwards. The
compiler refuses an image that ends at or above `$7800` where it loads
or `$F000` where it runs: the loader-based version in progress takes
`$F000-$F1FF` and `$F800-$FFF9`, so all the tunes together get 4 KB.
Today's image is 2,133 bytes.

## The ENV3 filter envelope

Tune A's break and tune B's drop use filter kind 2: voice 3 is gated
with each bass note and held out of the mix, and its envelope, read back
from `$D41C`, drives the filter cutoff. Both passages were checked in
the emulator against a SID register dump, every cutoff write equal to
the logged envelope.

## The gates

`python3 tunecheck.py tune_A2.py` prints each gate with its figure.
`python3 tunecheck.py tune_B2.py --against tune_A2.py` adds the distance
report, five figures that must read DIFFERS for a tune meant to sound
unlike the first. Tune C is a coda with no drums and fails four gates
by design (tempo, motif count, hats, bass density).

Nobody but the maintainer has listened to any of these tunes.
