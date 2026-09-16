# c64-game-starter Makefile
#
# Primary toolchain: Oscar64 (oscar64 binary must be in PATH, or set OSCAR64=).
# Secondary toolchain: KickAssembler (update KICKASS to point at your KickAss.jar).
#
# Targets:
#   all    — check prerequisites, then build game.prg (default)
#   check  — verify oscar64 is available; print a clear error if not
#   clean  — remove build artifacts
#   run    — build then launch in VICE (requires x64sc in PATH)

OSCAR64  ?= oscar64
# Update this path to point at your KickAss.jar installation:
KICKASS  ?= java -jar /path/to/KickAss.jar
# Use the cycle-accurate emulator. On macOS Homebrew, both x64 and x64sc
# crash at launch in g_settings_new unless the GSettings schemas are
# discoverable — the `run` target exports the required env vars below.
VICE     ?= x64sc

PRG      = game.prg
ASM_PRG  = sprites_asm.prg

.PHONY: all clean run check briefing-check

all: briefing-check check $(PRG)

# Refuse to build until the agent has consulted the c64-kb. The marker
# is the same one the .claude/hooks/pre-src-edit.sh PreToolUse hook
# checks, so agent-time enforcement and build-time enforcement agree.
# Drop `briefing-check` from the `all:` line above if you really want
# to skip — but that's the kind of decision that should be deliberate,
# not accidental.
briefing-check:
	@if [ ! -f .kb-briefing-done ]; then \
	  echo "ERROR: c64-kb briefing not run for this project."; \
	  echo ""; \
	  echo "Required steps before build:"; \
	  echo "  1. Call c64_game_briefing(\"<your concept>\", archetype=\"<shmup|platformer|puzzle|adventure>\")"; \
	  echo "     or c64_demo_briefing(\"<your concept>\")."; \
	  echo "  2. Drill into proposed techniques: c64_technique_lookup + c64_pitfalls_for."; \
	  echo "  3. Read the build_order recipe(s): c64_recipe_lookup."; \
	  echo "  4. Record that the briefing was consumed: touch .kb-briefing-done"; \
	  echo ""; \
	  echo "Bypass with one-line reason if genuinely trivial:"; \
	  echo "  echo \"bypass: typo fix\" > .kb-briefing-done"; \
	  exit 1; \
	fi

check:
	@command -v $(OSCAR64) >/dev/null 2>&1 || \
	  { echo "ERROR: oscar64 not in PATH. Install from https://github.com/drmortalwombat/oscar64"; exit 1; }

# Step 1: assemble the KickAssembler sprite multiplexer stub.
# If KickAssembler is not configured, skip this step and build without it.
$(ASM_PRG): src/asm/sprites.asm
	@if $(KICKASS) -version >/dev/null 2>&1; then \
	  echo "Assembling KickAssembler sprite stub..."; \
	  $(KICKASS) src/asm/sprites.asm -o $(ASM_PRG); \
	else \
	  echo "INFO: KickAssembler not available (update KICKASS in Makefile). Skipping asm stub."; \
	  touch $(ASM_PRG); \
	fi

# Step 2: compile Oscar64.
# If the asm .prg is non-empty (KickAss ran), pass it as extra source.
$(PRG): src/main.c $(ASM_PRG)
	@if [ -s "$(ASM_PRG)" ]; then \
	  $(OSCAR64) -O2 -o=$(PRG) -tf=prg src/main.c $(ASM_PRG); \
	else \
	  $(OSCAR64) -O2 -o=$(PRG) -tf=prg src/main.c; \
	fi
	@echo "Built $(PRG). Load in VICE: $(VICE) -autostart $(PRG)"

clean:
	rm -f $(PRG) $(ASM_PRG) *.map *.lbl *.asm *.vs *.sym

run: $(PRG)
	@# macOS Homebrew GTK3 ships compiled GSettings schemas under
	@# /opt/homebrew/share/glib-2.0/schemas but does not register the
	@# system-wide XDG_DATA_DIRS path. Without these env vars VICE crashes
	@# in g_settings_new before the emulator window appears. Harmless on
	@# Linux where the paths just don't exist.
	XDG_DATA_DIRS=/opt/homebrew/share:/usr/local/share:/usr/share:$$XDG_DATA_DIRS \
	GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas \
	$(VICE) -autostart $(PRG)
