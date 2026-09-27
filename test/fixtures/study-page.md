---
kind: studied
---
<!-- doc-type: game-design -->

# Study: a test shooter

A fixture for the studied-design tests (schema 40). Not a real study; the
figures are invented.

## Test shooter (studied)

**Game design:** `test_shooter_study`
**Instance of:** vertical_shmup
**Region:** PAL
**Studied from:** Test Shooter (1985, Ann Coder, Test House); image sha1=0123456789abcdef0123456789abcdef01234567; session studies/sessions/test-shooter.json
**IRQ chain:** play pal: $41C5 @ line 30, $4284 @ line 50/52, $4389 @ line 192 (measured-vice, obs test#1-#3)
**IRQ chain:** title pal: $4134 @ line 30 (measured-vice, obs test#4)
**Memory map:** VIC bank 3; screen $C000; charset $D000; sprites $E000-$E7FF; $01=$35 in play (measured-vice, obs test#5-#9)
**Diverges from archetype:** extra: invalid_mode_band, not_a_technique; missing: soft_scroll_v
**Measured frame:** play pal worst=18000 typical=15000 (measured-vice-study, frame mode over 200 frames, obs test#10)
