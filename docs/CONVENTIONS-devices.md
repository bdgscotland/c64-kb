# Device Conventions

`docs/hardware/devices.md` lists the things plugged into the machine
that a recipe needs: controllers, user-port adapters, drives,
cartridges, RAM expansions. It carries `<!-- doc-type: device-reference -->`
and `src/graph/extract/device.ts` reads it (schema 36, #87). A section
that breaks these rules is warned about and not ingested.

## One H2 per device

```
## EasyFlash

**Device:** `easyflash`
**Device kind:** cartridge
**Device port:** expansion
**VICE attach:** crt 32
**Claims:** expansion_io1 (owns), expansion_io2 (owns)
**Claims basis:** derived-listing

Prose: what it is, the registers or lines it uses, the VICE source file
and the recipe whose run attaches it.
```

| Line | Value |
|------|-------|
| `**Device:**` | The node name, lower case with underscores. A controller carries its port in the name (`joystick_port_2`), since one in port 1 and one in port 2 occupy different units. |
| `**Device kind:**` | `input`, `output` (a printer), `storage`, `memory` or `cartridge`. `output` was added with the printer section; before it a printer had no kind to take. |
| `**Device port:**` | `control_1`, `control_2`, `user`, `expansion` or `serial`. Every port but `serial` has one socket, so two devices on it cannot be attached at once. |
| `**VICE attach:**` | How x64sc attaches it: `default` (attached with no option; quote the `-dumpconfig` line in the prose), `flags <x64sc options>` (the exact options, e.g. `flags -controlport2device 2`), `disk` (a runs.json `"disk"`, a D64 in drive 8) or `crt <n>` (a runs.json `"cartridge"` whose `.crt` header gives hardware type n). |
| `**Claims:**` | The technique Claims grammar (`CONVENTIONS-techniques.md`) with two modes only: `owns` (the device's lines occupy the unit; a second owner cannot be attached with it) and `shares` (devices use the unit side by side under a protocol, as two ports share the SID pot lines). `none` when it occupies no unit. No line is unknown, never none. |
| `**Claims basis:**` | `measured-vice` when a pinned recipe run attached the device and used each claimed unit; `derived-listing` when any claim is read from VICE's source for the device. |

A device earns a section only when a recipe's pinned run attaches it or
VICE attaches it by default (rule 7). The prose names the evidence and
its rung.

## A recipe names the devices its run attaches

A recipe page's frontmatter `devices:` key lists Device names
(`CONVENTIONS-recipes.md`): `devices: [disk_1541_ii]`. Each becomes
`Recipe -[:REQUIRES_DEVICE]-> Device`. `[]` says the recipe needs nothing
beyond the stock machine; no key is unknown.

`npm run verify:recipes` checks the key against `docs/recipes/runs.json`
before it runs VICE: every device the run attaches (a `"disk"`, a
`"cartridge"` of the matching CRT type, the `flags` of a device's
`flags` line) must be listed, and every listed device must be attached by
the run or be a `default` device. A run with a `"disk"` whose flags set
`-drive8type` to anything but 1542 fails, since `disk_1541_ii` would no
longer describe it. A cartridge's type is read from the built `.crt`.

## What reads it

`c64_recipe_lookup` names each device a recipe requires, with its port,
attach line and claims. `c64_check_compatibility` reports
`recipe_device_conflict` (info) when a recipe of one input and a recipe of
the other require devices that both own one unit or sit on one
single-socket port.
