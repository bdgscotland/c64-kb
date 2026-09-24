---
tool: sim6502
tool_kind: unit-test
maintainer: barryw
license: BSD-2-Clause
home_url: https://github.com/barryw/sim6502
version_verified: "3.4.0"
---

<!-- doc-type: toolchain-reference -->

# Unit testing 6502 routines: a table driver, a simulator, a framework

## Tool

sim6502 is a test runner for assembled 6502 code. A suite file loads a
PRG and its KickAssembler symbol file, sets registers, flags and memory,
calls a routine with `jsr(...)`, and asserts on registers, flags, memory
and the cycle count. Its default backend is a CPU simulator with no
video, no CIA and no ROM unless one is loaded, which is what makes it
fast; a `vice` backend drives a real emulator over a monitor bridge and
was not run here. It is a .NET application; on this machine it was run
from a Release build of the repository checkout with the
`dotnet` 10.0.400 runtime, and its banner reported `v3.4.0`. The licence
in the frontmatter is the two-clause BSD notice in the README's License
section (no LICENSE file in the checkout). The Tool node is sim6502
because it is the program that ran here; 64spec below is a KickAssembler source library,
not a separate executable, and the hand-rolled driver is a pattern.

This page is about the layer under the whole-program verify. The
`headless-verify` recipes ([KickAssembler](../recipes/kickassembler/headless-verify.md),
[Oscar64](../recipes/oscar64/headless-verify.md)) and the vice-reference
section "Verifying a run without a human" grade one program with one
byte at `$02FF`. A unit test asks a smaller question many times: does
one routine give the right answer for these inputs.
Three routes are measured below, on the same routine, the signed 16-bit
compare from `compare_16bit_and_signed`.

**Targets:** 6510

## Build pipeline

Input is a KickAssembler source that holds the routine under test and
either a driver or a spec; output is a PRG for VICE, plus a `.sym` file
for the simulator.

### .PRG — Program file (executable)
**Produced by:** kickassembler
**Consumed by:** vice, sim6502

The driver or spec, assembled. sim6502 loads it with `strip_header =
true` so the two-byte load address is dropped and the bytes land where
the assembler put them.

### .SYM — KickAssembler symbol file
**Produced by:** kickassembler
**Consumed by:** sim6502

Written by `-symbolfile`; one `.label name=$addr` line per label. A
suite reads it so `jsr([s16_less])` and `[passes]` name addresses that
move when the source changes.

## Route 1: a hand-rolled driver, run in VICE

The recipe is [unit-test-driver](../recipes/kickassembler/unit-test-driver.md).
The shape:

- The routine under test is included unchanged, reading its operands
  from fixed zero-page cells (`$FB` to `$FE` here).
- A case table of fixed-size records, one record per case: every input
  the routine reads, then the expected result. Five bytes here (two
  16-bit operands and the expected N flag). A `Case(a, b, less)` macro
  writes a record, and the count is `(cases_end - cases) / CASE_SIZE`
  as a `.label`, so adding a case is one line.
- A loop that copies a record into the operands, calls the routine,
  captures the result (`php`/`pla`/`and #$80` for a flag; a store for a
  value), compares it with the record, and keeps three counters: passes,
  failures, and the index of the first failure (`$FF` when none).
- A report: clear the screen, print the figures, then the
  `headless-verify` checkpoint, `$02FF` = `$01` and border 5 or `$02` and
  border 2.
- One deliberately wrong case behind a preprocessor define
  (`-define BAD_CASE`), so the red path is exercised without editing the
  routine.

How the result leaves the machine, all three measured with the pinned
command at 8,000,000 cycles on the windowless x64sc 3.10:

| Channel | Green build | Red build (`-define BAD_CASE`) |
|---|---|---|
| Border pixel (2, 100) in the exit screenshot | (98, 213, 50) PAL, (114, 189, 103) NTSC: index 5 | (175, 60, 88) PAL, (169, 71, 100) NTSC: index 2 |
| Screen rows 0 and 1, decoded with the char ROM | `CASES PASS FAIL FIRST` / `0E 0E 00 FF` | `CASES PASS FAIL FIRST` / `0F 0E 01 0E` |
| `$02FF` over `-moncommands` (`trace store 02ff` + `command 1 "m 02ff 02ff"`) | last line `>C:02ff  01`, from `STA $02FF` at `$08D5`, cycle 3,023,721 | last line `>C:02ff  02` |

The printed line carries what the border cannot: the count and the
index of the first failing case, so a red run says which record to look
at. Each VICE run took about 0.4 s of host time (the `date` difference
around the command, on this machine, warp on). Two runs per model gave
byte-identical PNGs, which is what lets `verify:recipes` pin them.

## Route 2: the simulator

The same PRG and `.sym`, no emulator. A suite file (`tests.6502`):

```text
suites {
  suite("signed 16-bit compare") {
    symbols("/path/unit-test-driver.sym")
    load("/path/unit-test-driver.prg", strip_header = true)

    test("less-overflow", "-32768 < 32767 through the overflow fix-up") {
      $fb = $00
      $fc = $80
      $fd = $ff
      $fe = $7f
      jsr([s16_less], stop_on_rts = true, fail_on_brk = true)
      assert(n == true, "N is set: a < b")
    }

    test("not-less-equal", "0 is not below 0") {
      $fb = $00
      $fc = $00
      $fd = $00
      $fe = $00
      jsr([s16_less], stop_on_rts = true, fail_on_brk = true)
      assert(n == false, "N is clear: a >= b")
    }

    test("driver-table", "the whole table through the driver's own loop") {
      jsr([run_cases], stop_on_rts = true, fail_on_brk = true)
      assert([passes] == $0e, "fourteen passes")
      assert([fails] == $00, "no failures")
      assert([first_fail] == $ff, "no first failing case")
    }
  }
}
```

Run here: `dotnet Sim6502TestRunner.dll -s tests.6502` printed one
`PASSED` line per test with the test's name and description, then
`3 of 3 tests ran successfully in suite 'signed 16-bit compare'.` and
`1 of 1 suites passed.`, and exited 0. The whole run, runtime start
included, took 0.12 s of host time against VICE's 0.4 s for one model.
A failing assertion prints the test as `FAILED` with the assertion's
message and the values (`Expected 0 == 1 in assertion '...'`), the
suite line becomes `2 of 3`, and the exit code is 1.

Two findings from the run. A memory read in an assertion is
`[symbol]` for a symbol or `peekbyte($addr)` for a bare address;
`[$02ff]` is a parse error. And the simulator has no KERNAL: the first
version of the third test called the driver's entry point, which prints
through `CHROUT`, and the `jsr` reported an error because `$FFD2` held
zeros and the run hit a `BRK`. The driver's loop was split into
`run_cases`, which the simulator calls, and `report`, which only VICE
runs. A routine that touches the KERNAL or the chips is tested by
loading the ROM at `$E000` (the suite grammar allows it; not run here)
or by the `vice` backend.

What the simulator is for: the routine's arithmetic, many cases, in a
build step a developer runs on every save. Its cycle counts come from
its own core; the README says they are meaningful on `sim` and `vice`,
and how they compare with x64sc was not measured here.

## Route 3: 64spec

64spec (`github.com/64bites/64spec`, version 0.7.0, last commit
2019-11-19, MIT) is a KickAssembler source library. A spec file imports
`64spec.asm`, opens with `sfspec: :init_spec()`, runs code and asserts
with pseudocommands such as `:assert_a_equal #42`, `:assert_n_set`,
`:assert_c_cleared`, and closes with `:finish_spec()`. It assembled
unchanged with KickAssembler 5.25 (`-libdir` pointing at its `lib/`)
despite dating from 2019, and the two quick-start
examples and a three-assertion spec on the compare routine were run in
VICE with the pinned command:

- It clears the screen, switches to the lowercase character set, prints
  a banner (its name and version, the author, the documentation URL),
  then one character per assertion as it runs: `.` for a pass, `x` for
  a failure.
- The last line is the tally: `All tests PASSED: (1/1)` in green text,
  `All Tests FAILED: (0/1)` in red, or `Some tests PASSED: (2/3)` in red
  when the spec on the compare routine ran with one assertion that was
  wrong on purpose.
- The border and the text turn green or red with the verdict, the same
  channel the driver uses, so the border-pixel harness in the
  vice-reference section reads a 64spec run unchanged. There is no
  `$02FF` byte; a harness that wants one adds a store after
  `:finish_spec()`, whose default exit is `rts`, or reads the tally
  from the screenshot with the lowercase half of the char ROM.
- Its configuration is a table set with `.eval config_64spec(...)` or
  from the command line (`:on_exit`, `:write_final_results_to_file`,
  `:result_file_name`); the file option writes the tally through the
  KERNAL to a disk file, which was not run here.

What it adds over the driver: named assertions on every register and
flag, a running dot-line so a hang shows where it stopped, and no
counting code to write. What it does not add: a case table. A spec is
straight-line code, one block per case, so a sweep over many inputs
still wants a loop and a table, and the two combine (the table loop
calls the routine, then a 64spec assertion on the captured result).

## Route 4: ca65 test executors

cc65 ships `sim65`, a host simulator with its own link target; the cc65
tree's regression tests run through it. Run here: `sim65 --version`
printed `sim65 V2.18`, and a one-line C program returning 3, built with
`cl65 -t sim6502`, made `sim65` exit with status 3 in about 4 ms of host
time. So the channel is the process exit code: a ca65 test driver
returns its failure count and `make` reads it. Its `sim6502` target is
not the C64 (no KERNAL, no chips, its own memory map), so a routine
tested there is tested as arithmetic only; the same routine linked into
the driver pattern above runs in VICE unchanged. A ca65 version of the
case-table driver was not written here.

## What unit tests cannot see

A unit test runs the routine with the machine otherwise idle. It cannot
see what the C64 does to a routine while the game is running:
a badline stealing 40 to 43 cycles from the middle of it, the raster
position when it finishes, an IRQ arriving between two instructions
that were meant to be atomic, sprite DMA, or the CIA timer that the
routine was supposed to beat. A compare that passes every case in this
table can still be the reason a raster split tears, because the split's
budget was counted without the badline. That is what the pinned
whole-program run is for: `-limitcycles` on a real frame sequence, an
exit screenshot of the actual raster, `$02FF` from code that ran under
the game's own interrupts. Keep both. The table finds the arithmetic
error in a tenth of a second; the whole-program verify finds the one the
table cannot express.

## Makefile rule

```makefile
.DELETE_ON_ERROR:
KICKASS  ?= java -jar $(KICKASS_JAR)
X64SC    ?= x64sc
SIMRUN   ?= dotnet $(SIM6502_DIR)/Sim6502TestRunner.dll

unit-test-driver.prg unit-test-driver.sym: unit-test-driver.asm
	$(KICKASS) $< -o unit-test-driver.prg -symbolfile

.PHONY: unit sim
sim: unit-test-driver.prg unit-test-driver.sym tests.6502
	$(SIMRUN) -s tests.6502

unit: unit-test-driver.prg
	timeout 180 $(X64SC) -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
	  -limitcycles 8000000 -exitscreenshot unit.png -autostart $< >/dev/null 2>&1; \
	python3 verdict.py unit.png
```

`sim` fails the build on the runner's exit code 1. `unit` needs the
border-pixel script from the vice-reference section as `verdict.py`,
because x64sc's own exit status is 1 on every `-limitcycles` run and
carries nothing; the `;` keeps make from stopping on it. Not run as a
Makefile here; the two commands were run by hand as written.

## Pitfalls

**A pointer for `(ptr),y` must be in zero page.** The first driver put
`ptr` as a `.word` among the counters at `$0911`, and KickAssembler 5.25
assembled `lda (ptr),y` as `B1 11` with no error or warning: the operand
was truncated to its low byte. Every case failed and the first failing
index was `00`. `-bytedump` shows the operand; the fix is a `.const` in
zero page. The same truncation in a `.byte` escape is recorded under
`illegal_opcode_portability` in `docs/pitfalls/cpu.md`.

**The simulator has no KERNAL.** A `jsr` into a routine that calls
`CHROUT` runs into zeros at `$FFD2` and stops on `BRK`. Split the code
under test from its reporting, or load the ROM in the suite.

**A green suite says nothing about timing.** See "What unit tests
cannot see" above.

## See also

- [unit-test-driver](../recipes/kickassembler/unit-test-driver.md): the driver, pinned on both models.
- [headless-verify (KickAssembler)](../recipes/kickassembler/headless-verify.md) and [headless-verify (Oscar64)](../recipes/oscar64/headless-verify.md): the whole-program verdict this page sits under.
- `runtime/vice-reference.md`, "Verifying a run without a human": the three routes for reading `$02FF` back, used unchanged here.
- `compare_16bit_and_signed` in [maths](../techniques/maths.md) and [compare-16bit-signed](../recipes/kickassembler/compare-16bit-signed.md): the routine under test and its full sweep.
- [kickassembler-reference](kickassembler-reference.md): `-define`, `-symbolfile`, `-libdir`, `-bytedump`.
