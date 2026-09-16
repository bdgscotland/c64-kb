---
tool: sim6502
tool_kind: unit-test
maintainer: barryw
license: MIT
home_url: https://github.com/barryw/sim6502
---

<!-- doc-type: toolchain-reference -->

# sim6502 — 6502 Unit-Test CLI

## Tool

sim6502 is a unit-test framework for 6502 assembly programs. It loads assembled `.prg` binaries into an execution backend, runs test routines via a small DSL, and asserts against register state, memory contents, and cycle counts. It exits 0 on pass and 1 on any failure, making it suitable for CI.

**Targets:** 6510

sim6502 supports four execution backends. For C64 work the two relevant ones are the internal simulator (`sim`) and the VICE emulator (`vice`). The `novavm` and `verilator` backends target a different hardware platform (e6502/NovaVM) and are out of scope for C64 development.

The tool is distributed as a .NET CLI application. Test files use a custom DSL with a `.6502` extension (sometimes called `.test` in older project conventions). The grammar is defined in ANTLR 4 at `sim6502/Grammar/sim6502.g4` in the repository.

## Quick Reference

**Install:**

```bash
# Run via Docker (no .NET runtime required)
docker run -v ${PWD}:/code -it ghcr.io/barryw/sim6502:latest -s /code/mytest.6502

# Or install .NET and run directly
dotnet Sim6502TestRunner.dll -s mytest.6502
```

**Run a test file:**

```bash
dotnet Sim6502TestRunner.dll -s mytest.6502          # default: --backend sim
dotnet Sim6502TestRunner.dll -s mytest.6502 -t        # -t prints instruction trace
```

**Exit codes:** `0` = all tests passed, `1` = one or more tests failed.

**Filter tests:**

```bash
dotnet Sim6502TestRunner.dll -s tests.6502 --filter "sprite*"
dotnet Sim6502TestRunner.dll -s tests.6502 --test "sprite-position-msb"
dotnet Sim6502TestRunner.dll -s tests.6502 --filter-tag "regression"
dotnet Sim6502TestRunner.dll -s tests.6502 --exclude-tag "slow"
dotnet Sim6502TestRunner.dll -s tests.6502 --filter "sprite*" --list   # list without running
```

## The Test DSL

Test files are parsed by an ANTLR 4 grammar. The canonical grammar file is `sim6502/Grammar/sim6502.g4`. The following syntax is derived directly from that grammar.

### File structure

Every test file has a single top-level `suites` block containing one or more `suite` blocks, each of which contains one or more `test` blocks:

```
suites {
  suite("Suite name") {
    ; suite-level configuration
    symbols("path/to/program.sym")
    load("path/to/program.prg", strip_header = true)
    load("kernal.rom", address = $e000)

    setup {
      ; runs before every test in this suite
      [boardState] = $00
    }

    test("test-id", "Human description") {
      ; assignments, jsr calls, assertions
    }
  }
}
```

Comments use `;` (same as 6502 assembly).

### Suite-level directives

| Directive | Description |
|-----------|-------------|
| `system(c64)` | C64 memory model with `$01` banking, ROM overlays, `$D000–$DFFF` I/O storage |
| `system(generic_6502)` | Flat 64 KB RAM, MOS 6502 |
| `system(generic_6510)` | Flat 64 KB RAM, MOS 6510 with `$00`/`$01` I/O port |
| `system(generic_65c02)` | Flat 64 KB RAM, WDC 65C02 opcodes |
| `processor(6502)` | Deprecated alias for `system(generic_6502)` |
| `symbols("file.sym")` | Load KickAssembler symbol file; enables `[SymbolName]` references |
| `load("file.prg", strip_header = true)` | Load binary, strip 2-byte load-address header |
| `load("rom.bin", address = $e000)` | Load binary at explicit address |
| `rom("kernal", "kernal.rom")` | Load ROM image into `system(c64)` memory map (`basic`, `kernal`, `chargen`) |

If `system()` is omitted, the default is `system(generic_6502)`.

### Number formats (from grammar tokens)

| Format | Syntax | Example |
|--------|--------|---------|
| Hexadecimal | `$xxxx` or `0xXXXX` | `$D011`, `0xFF` |
| Decimal | Plain digits | `1024` |
| Binary | `%xxxxxxxx` | `%10101010` |

### Symbol references

Symbols from a `.sym` file are referenced with square brackets. Namespaced symbols use dot notation:

```
[FillMemory]          ; simple symbol
[vic.SP0X]            ; namespaced symbol (vic namespace, SP0X label)
[c64lib_timers] + $02 ; symbol + offset expression
```

### Assignments

Inside `test` or `setup` blocks, you set up memory and registers before calling a subroutine:

```
; Register assignment
a = $ff
x = 0
y = [r0L]

; Processor flag assignment
c = true
n = false
z = 1

; Memory assignment (byte if value <= 255, word if > 255)
$d020 = $0e          ; write byte to border color register
[r1] = $1234         ; write 16-bit word to symbol address
[Loc1] + $02 = $d0   ; write to symbol + offset
```

### JSR execution

`jsr` executes code at an address and blocks until a stop condition is met:

```
; Stop when the subroutine executes RTS at the original call level
jsr([FillMemory], stop_on_rts = true, fail_on_brk = true)

; Stop when the program counter reaches a specific address
jsr($2000, stop_on_address = $2100, fail_on_brk = true)

; Stop at a symbol address
jsr([FillMemory], stop_on_address = [CopyMemory], fail_on_brk = false)
```

`stop_on_rts` tracks call depth correctly — RTS calls from nested subroutines do not trigger exit. `fail_on_brk = true` fails the test if a BRK instruction is encountered.

### Assertions

```
assert(comparison, "description")
```

Comparison operators: `==`, `!=`, `<>`, `>`, `<`, `>=`, `<=`.

**Memory and symbol assertions:**

```
assert($d020 == $0e, "Border color is light blue")
assert([vic.SP0X] == $ff, "Sprite 0 X position")
assert([MyVector].w == $1000, "16-bit word matches")   ; .w = read as word
assert([MyValue].b == $42, "byte value")               ; .b = read as byte (default)
assert($1234.l == $34, "low byte of $1234")            ; .l = low byte
assert($1234.h == $12, "high byte of $1234")           ; .h = high byte
```

**Register and flag assertions:**

```
assert(a == $00, "Accumulator is zero")
assert(x >= 8, "X is at least 8")
assert(c == true, "Carry is set")
assert(z == false, "Zero flag is clear")
```

**Cycle count assertions:**

```
assert(cycles < 1000, "Routine completed in under 1000 cycles")
assert(cycles <= 500, "Fast path taken")
```

**Memory utility assertions:**

```
; memchk: verify entire range equals one value
assert(memchk($1234, $100, $bd), "256 bytes filled with $bd")

; memcmp: verify two regions are identical
assert(memcmp($e000, $4000, $2000), "8 KB regions match")
```

### Built-in functions (usable in assertions and assignments)

| Function | Description |
|----------|-------------|
| `peekbyte(addr)` | Return 8-bit value at address |
| `peekword(addr)` | Return 16-bit little-endian value at address and address+1 |
| `memchk(addr, size, val)` | True if all bytes in range equal val |
| `memcmp(src, dst, size)` | True if two memory regions are identical |
| `memfill(addr, count, val)` | Fill memory region (use in setup/test body, not assertions) |
| `memdump(addr, count)` | Print hex dump to console (debug aid) |

### Test options

```
test("test-id", "Description", skip = true, trace = true, timeout = 10000, tags = "smoke,regression") {
```

| Option | Description |
|--------|-------------|
| `skip = true` | Skip this test (appears in results but does not run) |
| `trace = true` | On failure, print a full instruction trace with register state per instruction |
| `timeout = N` | Cycle limit; test fails if exceeded; `0` disables |
| `tags = "tag1,tag2"` | Comma-separated tags for `--filter-tag` / `--exclude-tag` |

### Complete example

This is a self-contained test for a sprite-positioning routine that matches the patterns in the sim6502 README:

```
suites {
  suite("Sprite positioning") {
    system(c64)
    symbols("/build/sprites.sym")
    load("/build/sprites.prg", strip_header = true)
    load("/roms/kernal.rom", address = $e000)

    setup {
      [vic.MSIGX] = $00
    }

    test("sprite-x-below-256", "X < 256 does not set MSB", tags = "regression") {
      x = $00          ; sprite index
      a = $ff          ; X position
      y = $40          ; Y position
      $02 = $40        ; Y position in zero page

      jsr([PositionSprite], stop_on_rts = true, fail_on_brk = true)

      assert([vic.SP0X]  == $ff, "X register written")
      assert([vic.SP0Y]  == $40, "Y register written")
      assert([vic.MSIGX] == $00, "MSB not set for X < 256")
      assert(cycles < 200, "Routine is fast")
    }
  }
}
```

## Simulator vs. VICE Backend

sim6502 supports two backends relevant to C64 work:

| Backend | Flag | Speed | Hardware emulation |
|---------|------|-------|--------------------|
| Internal simulator | `--backend sim` | Fast (no I/O) | CPU + memory map only |
| VICE emulator | `--backend vice` | Slower | Full C64: VIC-II, SID, CIA, interrupts |

### When to use `--backend sim`

- Routine is purely computational (sort, copy, fill, math)
- No hardware register reads that depend on live chip state
- No interrupt handlers (CIA timers, raster IRQs do not fire on `sim`)
- Want the fastest possible CI gate

### When to use `--backend vice`

- Routine sets up or reads VIC-II state (raster line, sprite registers, bank)
- Code relies on CIA timer behavior
- Testing interrupt handler setup
- Asserting on DMA cycle timing

**Key behavioral difference:** On `--backend sim`, reading `$D012` returns whatever was last written there. On `--backend vice`, it returns the current VIC-II raster counter (constantly changing). Cycle counts also differ: `sim` counts instruction cycles but does not model DMA stealing or interrupt overhead; `vice` is cycle-accurate to real C64 hardware.

### Using the VICE backend

The VICE backend requires a VICE fork with MCP server support built in (mainstream VICE does not include this):

```bash
git clone -b feature/mcp-server https://github.com/barryw/vice-mcp.git
cd vice-mcp
./autogen.sh && ./configure --enable-mcp-server && make -j$(nproc)
```

Start VICE with the MCP server:

```bash
x64sc -mcpserver -mcpserverport 6510
```

Run tests against it:

```bash
dotnet Sim6502TestRunner.dll -s tests.6502 --backend vice
dotnet Sim6502TestRunner.dll -s tests.6502 --backend vice --launch-vice   # auto-start x64sc
dotnet Sim6502TestRunner.dll -s tests.6502 --backend vice --vice-warp false  # real-time speed
```

Note: the VICE backend used by sim6502 (`--mcpserver`, port 6510) is a different integration point than the standalone vice-mcp MCP server (port 6502). They are compatible tools that can coexist.

## Loading a Program

### PRG format

A C64 `.prg` file begins with a 2-byte little-endian load address, followed by the code/data. Two load patterns:

```
; Load address is embedded in first 2 bytes of file (standard C64 PRG)
; strip_header = true removes those 2 bytes before loading at the embedded address
load("program.prg", strip_header = true)

; Load at an explicit address, overriding the file header
load("kernal.rom", address = $e000)

; Load without stripping — use only if you want those 2 bytes in memory
load("program.prg")
```

If neither `address` nor `strip_header = true` is given, sim6502 reads the first 2 bytes as the load address and places the remaining bytes starting there.

### Symbol files

Symbol files let tests reference named labels instead of hardcoded addresses:

```
symbols("/build/program.sym")
```

sim6502 currently supports KickAssembler `.sym` format:

```
.label ENABLE=$80
.label UpdateTimers=$209d
```

Namespaced symbols from KickAssembler are also supported:

```
.namespace vic {
  .label SP0X = $d000
}
```

Referenced in tests as `[vic.SP0X]`.

**Oscar64 symbol files:** Oscar64 generates `.lbl` label files. These are not KickAssembler `.sym` format and are not directly supported by sim6502's `symbols()` directive. To use Oscar64 output with sim6502, either use hardcoded addresses in assertions or write a conversion step in the build pipeline.

### ROM images

When using `system(c64)`, ROM images can be loaded into fixed regions:

```
suite("C64 with ROMs") {
  system(c64)
  rom("basic",   "basic.rom")    ; $A000–$BFFF
  rom("kernal",  "kernal.rom")   ; $E000–$FFFF
  rom("chargen", "chargen.rom")  ; $D000–$DFFF (when character ROM banked in)
}
```

## Cycle Counting

`cycles` is the total cycle count consumed by the last `jsr` call. It is available in assertions and resets with each `jsr`:

```
jsr([StableRasterSetup], stop_on_rts = true, fail_on_brk = true)

; Stable raster IRQ setup must complete in a bounded cycle window
assert(cycles < 300, "Setup fits in one raster line (63 cycles PAL, budget 300)")
```

Cycle counting is meaningful on both `sim` and `vice` backends, but with different accuracy:

- **`sim`**: counts instruction cycles from the 6502 timing tables; does not model DMA, interrupts, or memory banking delays
- **`vice`**: cycle-accurate, includes DMA stealing, interrupt overhead, all hardware effects

For stable-raster-IRQ recipes, always verify cycle counts with `--backend vice` before declaring them correct. A routine that passes a `cycles < 63` assertion on `sim` may fail on `vice` once CIA and VIC-II DMA cycles are included.

## CI Integration

sim6502 exits `0` if all tests pass, `1` if any test fails. This maps directly to standard CI exit-code conventions.

**GitHub Actions example:**

```yaml
- name: Run 6502 tests
  run: |
    docker run --rm \
      -v ${{ github.workspace }}:/code \
      ghcr.io/barryw/sim6502:latest \
      -s /code/tests/suite.6502
```

**Output format:** Test results print to stdout. Each test prints `PASSED: test-id` or `FAILED: test-id — message`. A summary line at the end shows pass/fail counts.

With `trace = true` on a test, a failure includes a full instruction trace:

```
FAILED: buggy-code — Carry should be set
Expected: c == true, Got: c == false

Execution trace (247 instructions):
$1832: LDA $2157      A=$B6 X=$74 Y=$00 SP=$F7 NV-bdizc
$1835: AND #$7F       A=$36 X=$74 Y=$00 SP=$F7 nv-bdizc
...
```

Flags are uppercase when set, lowercase when clear.

## Pairing with vice-mcp

sim6502 and vice-mcp cover two different phases of the development loop:

**sim6502** is the automated test harness. It runs fast and headlessly on the `sim` backend, and hardware-accurately on the `vice` backend. Run it in a tight loop as code changes. When all tests are green, the recipe is correct by assertion.

**vice-mcp** is the interactive debugger. Use it when a sim6502 test fails and you need to understand the failure interactively — step through instructions, observe VIC-II state, catch watchpoint hits, examine sprite data addresses.

**Agent workflow:**

```
1. Build with Oscar64 or KickAssembler
2. Run sim6502 --backend sim (fast sanity check)
   PASS → continue
   FAIL → fix obvious logic errors

3. Run sim6502 --backend vice (hardware-accurate)
   PASS → recipe is correct
   FAIL → escalate to vice-mcp

4. vice-mcp interactive session:
   connect() → loadProgram() → setBreakpoint()
   → step through, readVicState(), readSprites()
   → identify root cause

5. Fix code → return to step 1
```

Because sim6502's VICE backend and vice-mcp both connect to the same VICE binary, they cannot run simultaneously against the same VICE instance. Run sim6502 tests first, then start a vice-mcp session for interactive debugging.

## Pitfalls

**Undocumented opcode behavior differs between backends.** The `sim` backend uses the 6502Net simulator, which implements documented opcodes accurately but may differ from VICE on illegal/undocumented opcodes (LAX, SAX, DCP, ISC, etc.). If a recipe uses illegal opcodes, declare `--backend vice` as canonical for that recipe and note this in the recipe frontmatter. Do not use the `sim` backend to certify cycle counts for code that relies on undocumented behavior.

**CIA timers and IRQs fire on `vice` but not on `sim`.** A test that asserts `cycles < 1000` may pass on `sim` (no interrupts) and fail on `vice` (CIA timer fires, pushes registers, runs IRQ handler, adds overhead). For timing-sensitive tests, measure on `vice` and set the cycle budget accordingly.

**Oscar64 does not emit KickAssembler `.sym` files.** Oscar64 generates `.lbl` label files (different format). The `symbols()` directive in sim6502 only accepts KickAssembler `.sym` format. When testing Oscar64 output, either hardcode addresses in tests or add a build step to convert `.lbl` to `.sym`.

**`stop_on_rts` and nested JSR depth.** On `--backend vice`, `stop_on_rts` is implemented via breakpoints and synthetic stack manipulation (not native call-depth tracking). If your subroutine uses tail calls or self-modifying return addresses, the depth calculation may mis-fire. Use `stop_on_address` for routines with non-standard return patterns.

**Snapshot restore race on `vice` backend.** The VICE backend saves a snapshot after loading all binaries, and restores it before each test. If VICE's snapshot directory is out of space or has a permissions issue, the run fails immediately. Check VICE logs if you see `Failed to save snapshot 'sim6502_suite_N'`.

## See Also

- [vice-mcp-reference.md](vice-mcp-reference.md) — Interactive VICE debugging; use when sim6502 tests fail
- [../toolchains/oscar64-reference.md](../toolchains/oscar64-reference.md) — Primary C64 toolchain; builds the `.prg` files that sim6502 tests
