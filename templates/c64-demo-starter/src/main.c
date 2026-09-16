// main.c — c64-demo-starter entry point
//
// Demonstrates the foundational Oscar64 demo pattern:
//   - Direct screen RAM writes for the welcome message
//   - Border/background colour setup via vic.h
//   - A single raster IRQ at line 100 that changes the border colour
//     (the "stable raster IRQ" pattern from rasterirq.h)
//
// Build:
//   oscar64 -O2 -o=main.prg -tf=prg src/main.c
//
// References:
//   docs/recipes/oscar64/hello-world.md          — printf / basic build
//   docs/recipes/oscar64/stable-raster-irq.md    — rirq_* idioms
//   docs/toolchains/oscar64-reference.md          — flag reference
//
// Replace the welcome message and raster write with your demo effects.

#include <c64/vic.h>       // vic struct, VCOL_* constants
#include <c64/rasterirq.h> // rirq_init, rirq_build, rirq_write, rirq_set, etc.

// ---------------------------------------------------------------------------
// Screen and color RAM convenience macros.
// Default VIC bank 0 text screen at $0400; color RAM at $D800.
// ---------------------------------------------------------------------------
#define Screen ((char *)0x0400)
#define Color  ((char *)0xd800)
#define COLS   40

// ---------------------------------------------------------------------------
// Welcome message: screen codes for "C64-KB DEMO STARTER -- REPLACE ME"
// Written directly to screen RAM (no KERNAL CHROUT needed).
// Screen codes: letters A-Z = 1-26, digits 0-9 = 48-57, '-' = 45, space = 32.
// (Digits are NOT 16-25 — those are the letters P-Y. Use the 48-57 range.)
// ---------------------------------------------------------------------------
static const char msg[] = {
    // C  6  4  -  K  B  sp D  E  M  O  sp S  T  A  R  T  E  R
     3,54,52,45,11, 2,32, 4, 5,13,15,32,19,20, 1,18,20, 5,18,
    // sp -- sp R  E  P  L  A  C  E  sp M  E
    32,45,45,32,18, 5,16,12, 1, 3, 5,32,13, 5,
    0 // sentinel
};

// ---------------------------------------------------------------------------
// Raster IRQ code block.
// RIRQCode is a 31-byte struct; declare at file scope (static storage).
// Holds up to 5 register writes that execute at the programmed raster line.
// ---------------------------------------------------------------------------
static RIRQCode rirq_bar;

// ---------------------------------------------------------------------------
// Write the welcome message to screen row 12 (middle of the screen),
// centred in the 40-column display.
// ---------------------------------------------------------------------------
static void draw_message(void)
{
    // Count message length (up to sentinel 0)
    char len = 0;
    while (msg[len]) len++;

    // Start column to centre the text
    char col = (COLS - len) / 2;
    char row = 12; // row 12 of 25

    for (char i = 0; msg[i]; i++) {
        char pos = row * COLS + col + i;
        Screen[pos] = msg[i];
        Color[pos]  = VCOL_LT_BLUE; // light blue text on black background
    }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
int main(void)
{
    // --- Screen setup ---
    vic.color_border = VCOL_LT_BLUE; // light blue border (C64 default)
    vic.color_back   = VCOL_BLACK;   // black background

    // Clear screen RAM and color RAM
    for (int i = 0; i < 1000; i++) {
        Screen[i] = 0x20; // PETSCII space
        Color[i]  = VCOL_BLACK;
    }

    // Draw the welcome message
    draw_message();

    // --- Raster IRQ setup ---
    // rirq_init(true): install through the KERNAL IRQ vector at $0314/$0315.
    // 'true' is safe for PRG programs that load over BASIC.
    // See docs/recipes/oscar64/stable-raster-irq.md for full explanation.
    rirq_init(true);

    // Build a 1-write IRQ code block: at raster line 101 (one below 100),
    // store VCOL_WHITE into the border colour register.
    // Replace this with multiple rirq_write calls for raster bars.
    rirq_build(&rirq_bar, 1);
    rirq_write(&rirq_bar, 0, &vic.color_border, VCOL_WHITE);

    // Install into slot 0, targeting raster line 100.
    // rirq_set fires one line below the given value, so this fires at line 101.
    rirq_set(0, 100, &rirq_bar);

    // Sort slots by ascending raster line before starting.
    rirq_sort();

    // Enable VIC-II raster interrupt and unmask the CPU IRQ.
    // The handler runs autonomously from this point.
    rirq_start();

    // --- Main loop ---
    // The demo runs in the raster IRQ. The main loop just idles.
    // For animation: call rirq_wait() here, update state, then rirq_sort().
    for (;;) { }

    return 0;
}
