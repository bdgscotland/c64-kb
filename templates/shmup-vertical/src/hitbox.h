// hitbox.h: collision boxes per animation frame, tested only for the pairs
// that can hurt each other (per_frame_hitbox).
#ifndef HITBOX_H
#define HITBOX_H

#include "game.h"

// Boxes that enemies can hit: the ship, then the bullets.
#define BOX_PLAYER 0
#define BOX_SHOT   1            // 1-4, bullets 0-3
#define BOX_ENEMY  5            // the count of the above

void box_off(char slot);
void box_ship(char hx, char sy);        // where the ship is drawn
void box_bullet(char i, char hx, char line);
void collide(void);                     // enemies from the actor table against these

// What collide() reports; main.c decides what a hit does.
void on_enemy_shot(char e, char bullet);
void on_player_hit(char e);

#pragma compile("hitbox.c")

#endif
