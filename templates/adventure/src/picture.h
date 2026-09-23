// picture.h: the character set and the room picture strip (c64-kb techniques
// mcm_text and charset_copy_rom_to_ram). Rows 0-6 are multicolour cells
// (colour RAM 8-15); every other cell keeps a colour of 0-7 and stays hires,
// so one $D016 value serves the whole screen and no raster split is needed.
#ifndef PICTURE_H
#define PICTURE_H

#define CHARSET  ((char *)0x3800)
#define PIC_ROWS 7

void video_init(void);          // charset copy, glyphs, $D016/$D018/$D021-$D023
void picture_draw(char p);      // RLE-decode picture p into rows 0-6

#pragma compile("picture.c")

#endif
