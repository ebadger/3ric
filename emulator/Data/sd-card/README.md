# The emulators' micro-SD card

`emulator/Data/sd.zip` is the micro-SD card the 3RIC emulators ship with. The browser
build turns it into `web/data/sd.v2.sparse` (`web/build.ps1`), and the WinUI host unpacks
it to `data\sd.001`. Since 2026-10-22 it holds one game, **Dirt Bike**, and nothing else.
It replaced a 2 GB card of about 100 Apple II game `.PRG`s, by the owner's decision.

| On the card | What it is |
|-------------|------------|
| `DIRTBIKE/TITLE`, `T01`-`T30` | the title and menu file and the 30 tracks: raw sectors of the disk's files |
| `DIRTBIKE/DIRTHOF` | the hall of fame, as on the release disk; the game writes it |
| `DIRTBIKE/DIRTBIKE.PRG` | the loader, the resident and the patched game (`BRUN DIRTBIKE.PRG 0800`) |
| `DIRTBIKE/README.TXT` | the notice below, for the 3RIC screen (`CAT README.TXT`) |
| `DIRTBIKE/LICENSE.TXT` | the GNU General Public License, version 3 |

The two notice files are kept here, in `DIRTBIKE/`, and copied onto the card byte for byte.

## Play it

- On the web: <https://ebadger.github.io/3ric/?brun=DIRTBIKE/DIRTBIKE.PRG> starts it
  through the ROM DOS. The page powers on with the card inserted, so at the `>` prompt
  you can also type `CD DIRTBIKE`, then `BRUN DIRTBIKE.PRG 0800`.
- In the WinUI host: the same two commands. The host copies `data\sd.001` into its local
  data folder on first run and keeps that copy, so a host that ran before this card
  keeps the old one: delete `sd.001` from the app's local data folder to get this card.
- On the board: copy the `DIRTBIKE` folder to the card's root.

Loading takes about 8 s, the title 2 s more. Controls, timing and limits:
[`docs/porting-logs/dirt-bike.md`](../../../docs/porting-logs/dirt-bike.md).

## Licence

Dirt Bike is by Arnaud Verhille ([habib256](https://github.com/habib256)): a side-view
motocross for the Apple II+, inspired by Brad Quick's Macintosh *Dirt Bike*. It is free
software under the [GNU General Public License, version 3](DIRTBIKE/LICENSE.TXT), with no
warranty. It is a separate work from 3RIC, which is MIT-licensed (see
[`NOTICE`](../../../NOTICE)).

The copy on this card was **modified for 3RIC on 2026-10-22**. It loads its files
through the 3RIC ROM DOS instead of DOS 3.3, plays on the SNES pads, runs at Apple II
speed, and its menu quits to the ROM DOS. The 3RIC loader and resident (MIT) are linked
into `DIRTBIKE.PRG`, and the modified game as a whole is distributed under the GPL v3.

## Corresponding source

- **The game:** <https://github.com/habib256/pom2games> at commit
  [`8140d9ffca77b366ce8e952171c3e8294e574514`](https://github.com/habib256/pom2games/tree/8140d9ffca77b366ce8e952171c3e8294e574514)
  (2026-10-22): `dirtbike/` and the shared `dev/` build tree it uses (`make -C dirtbike`).
  The input is that commit's `dist/DIRTBIKE.dsk`: 143,360 bytes, SHA-256
  `ea40bda3dd58a31674af742736fd900dcbfd264ad4ef04eab09b6d59e247096e`, git blob
  `d8e050b3a85322c8e41ee6dc282b5e9481a187b1`.
- **The 3RIC changes**, in this repository:
  [`codegen/tools/port-dirtbike.mjs`](../../../codegen/tools/port-dirtbike.mjs) (the
  byte-checked patches and the file layout) and
  [`codegen/patches/dirtbike/`](../../../codegen/patches/dirtbike/) (`loader.s`,
  `resident.s`), described in
  [`docs/porting-logs/dirt-bike.md`](../../../docs/porting-logs/dirt-bike.md).
- **The card:** [`codegen/tools/make-sd-card.mjs`](../../../codegen/tools/make-sd-card.mjs)
  with [`codegen/tools/ultima5/fat32.mjs`](../../../codegen/tools/ultima5/fat32.mjs).

The card holds only the game's own files. The release disk's DOS 3.3 and its `HELLO`
program are not on it.

## Rebuild the card

```powershell
curl.exe -L -o DIRTBIKE.dsk https://github.com/habib256/pom2games/raw/8140d9ffca77b366ce8e952171c3e8294e574514/dist/DIRTBIKE.dsk
node codegen/tools/make-sd-card.mjs DIRTBIKE.dsk     # writes emulator/Data/sd.zip
```

The tool refuses any other disk. The image is deterministic, so the rebuilt `sd.001`
is the committed one, byte for byte (SHA-256
`4fa16d2ea32126227e8e3588ea2b39243a5467c08b610c0ed8fc271161d80f85`, `IMAGE_SHA256` in the
tool). The zip's compressed bytes depend on Node's zlib.

`node codegen/tools/make-sd-card.test.mjs` runs in the Pages build. Without the disk,
it checks:

- the card's layout and files, and the notices against this folder;
- that `DIRTBIKE.PRG` and `TITLE` are the release (by SHA-256) plus exactly the
  converter's patches, with the loader and resident the committed sources assemble.

With `DIRTBIKE_DSK=<path>` it also rebuilds the card and compares it byte for byte. After
changing the converter, the loader or the resident, rebuild the card in the same commit
and update `IMAGE_SHA256` (the tool prints the new value). If the card's contents change,
also rename the served file in `web/build.ps1`, `web/make_sd_sparse.py` and
`web/index.html` (`sd.v2.sparse` to `sd.v3.sparse`), because `web/Caddyfile` caches
`data/` for a year.

## Format

The zip has one deflated entry, `sd.001`: a 64 MB (131,072-sector) raw card image with
an MBR and one FAT32 partition (type `0x0C`) at LBA 2048. The partition has 32 reserved
sectors, two FATs, 512-byte clusters, the root directory at cluster 2, and volume label
`3RIC`; directory entries carry no timestamps. The ROM DOS reads and writes it; the
ROM's multi-sector `OWRITE` needs 512-byte clusters.
