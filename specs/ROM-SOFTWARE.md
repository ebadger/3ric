# 3ric — ROM & Software Spec (ROM-SOFTWARE.md)

> The 512 KB system ROM (monitor, DOS shell, BASIC), the character/font ROM, and the 6502
> programs that run on 3ric. This is the software the CPU actually executes; the emulator
> (`EMULATOR.md`) and hardware (`HARDWARE.md`) exist to run it.

---

## Purpose

Provide the machine's firmware and application software: power-on monitor, a FAT32 DOS
shell, Microsoft BASIC, and a growing library of 65C02 programs (games, demos) that load
from a micro-SD card, a Disk II floppy, or the in-browser assembler.

## Contracts / Interfaces

- **3RIC Talks v1:** the public challenge requests original English TTS implemented on
  the 65C02 and dual-AY Mockingboard, with typed input and reusable init/speak routines.
  Its complete, versioned contract is `codegen/challenges/tts/v1/prompt.md`; per-entry
  README/metadata document implementation status, memory, controls, ABI and provenance.
  There are no engines or physical-hardware results in the initial publication.
  Sources are independent PR submissions, not replacements for ordinary gallery samples.
  The target is 3RIC; Apple II compatibility requires a separately verified port.
  RAM includes always-mapped `$0000-$8FFF`, an additional `$9000-$BFFF` when `$C007`
  disables the BASIC overlay (`$C006` restores it), and language-card RAM over upper ROM.
  Using that last region requires safe ROM visibility, input and interrupt handling;
  `$C800-$CFFF` contains system state, not disposable scratch. No hardware map is changed.
- **System ROM:** `emulator/Data/badger6502.bin` (512 KB; first 64 KB mapped `$D000–$FFFF`
  plus banked regions). Contains the monitor, the DOS/FAT32 shell, the Disk II boot PROM
  (`$C600`), and Microsoft BASIC (`$9000–$BFFF`). Reset vector at `$FFFC/$FFFD`. Built with
  cc65/ca65; debug symbols in `badger6502.dbg` (consumed by `codegen/gen_platform_ref.mjs`).
- **Font ROM:** `emulator/Data/fontrom.dat`, loaded by the text renderer.
- **ROM entry points (contract for programs; curated in `codegen/platform/platform-ref.*`):**
  `COUT $FDED`, `COUT1 $FDF0`, `CROUT $FD8E`, `PRBYTE $FDDA`, `HOME $FC58`, `KEYIN $FD1B`;
  DOS shell `dos $EDBC` (mount + `>` prompt), verbs `BSAVE/BLOAD/BRUN/DIR/CAT/CD`, FAT32
  `fat32_file_read/write`.
- **SNES gamepad (contract for programs):** the ROM scans the two SNES pads from an
  interrupt raised on the VIA CB2 edge. A program touches **`PTRIG $C070`** to raise that
  edge (→ NMI pad scan; the NMI is non-maskable, so a program may poll the pad while running
  under `sei`), then reads **`GAMEPAD1 $CEE0`** / `GAMEPAD2 $CEF0` — 16-byte tables, one byte
  per button (`1` = pressed): `B`=0, `Y`=1, `SELECT`=2, `START`=3, `UP`=4, `DOWN`=5,
  `LEFT`=6, `RIGHT`=7, `A`=8, `X`=9, `L`=$A, `R`=$B. `JOYSTICK_MODE $CE15` must be `0`
  (pads — the power-on default). The emulator models the same two active-low SNES shift
  registers on VIA1, so host-supplied controller masks flow through the unmodified ROM scan;
  a disconnected controller reports no buttons. Programs may still reject impossible states
  such as `LEFT`+`RIGHT` defensively. Addresses are exported in
  `codegen/platform/platform-ref.*`. The ROM scan also reloads VIA1 Timer 1 and
  Timer 2; a guest borrowing either timer must account for that reload and for
  the ROM NMI handler acknowledging timer flags.
- **`.PRG` programs:** assembled by the codegen toolchain (`CODEGEN.md`). Sources: tracked
  `.s` files (`codegen/programs/hello.s`, `emulator/AICodeGen/<name>/<name>.s`); assembled
  `.prg` images are git-ignored (regenerated). Run on hardware/SD via `BRUN NAME.PRG <org>`,
  or in the browser via **Load .PRG** / **Assemble & Run**.
- **Archon compatibility experiment:** an image-specific, disk-only adapter for the
  owner-supplied WOZ2 with SHA-256
  `a7722abdfc42ef7372b5183283b6f55464c3817b1c855256186cb5c30e600c8d`.
  It targets the unchanged repository ROM with SHA-256
  `fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435`.
  The game and resulting disk are local inputs/outputs, not repository assets.
  - **Banking:** the original menu temporarily exposes language-card RAM; gameplay
    also uses both language-card banks. Neither preserves 3ric's ROM NMI vector.
    A resident adapter must keep a valid NMI entry when RAM is visible, preserve
    interrupted registers and the selected bank, and coexist with the game's loaded
    graphics/code. Forcing ROM permanently visible or suppressing input is not a fix.
    This profile reserves `$C800-$C9FF`, `$CC00-$CDFF`, `$CF00-$CFFF` and the shared
    language-card NMI vector at `$FFFA-$FFFB`; these are **not general free-RAM
    declarations**. Interactive menu drawing remains RAM-mapped. Bank-switch wrappers
    preserve the requested bank; a stop-bit interrupt at the switch/state-store
    boundary recovers the just-selected mode from the interrupted X register.
  - **Input:** retain keyboard gameplay and the game's options, and adapt the two
    onboard SNES pads through real VIA latch/clock/data pins. Avoid unnecessary
    paddle-timer/strobe NMIs and acknowledge serviced VIA sources without discarding
    an arriving PS/2 clock. Keyboard coverage must include real scan frames and
    bidirectional Caps/Num Lock command exchanges, not only browser `keyDown`.
    The D-pad supplies neutral/low/high digital axes; B or X selects/fires for each
    controller. Both two-player keyboard-side options retain their original side
    assignment. Keyboard direction latches and fire duration remain game-owned.
  - **Delivery:** reject other disk/ROM revisions, write a separate output file,
    preserve unrelated WOZ bits, track layout, metadata and sectors, and regenerate
    affected sector checksums and the container CRC. No firmware, VM, web bridge,
    generated platform-reference or hardware-decoder change is part of this port.
    The patcher checks the full ROM file fingerprint; the boot installer checks the
    relevant NMI proxy/input-code ABI, not a full physical-ROM readback.
  - **Acceptance:** cold-boot the actual output through the Disk II loader in native
    and WASM builds; exercise options, board input and combat, including mixed
    keyboard/pad traffic and bank restoration. Emulator results are not a physical
    board or complete-playthrough certification. The implementation is an
    emulator-verified hardware-trial candidate; commands, fingerprints, coverage and
    remaining limits are recorded in [`docs/porting-logs/archon.md`](../docs/porting-logs/archon.md).
- **Ultima V SD-card port:** `codegen/tools/port-ultima5.mjs` converts the eight
  owner-supplied ProDOS disk sides into a `U5/` folder for the micro-SD card
  (`CD U5`, `BRUN U5.PRG 0800`). The game data stays local; the repository holds
  the converter and glue (`codegen/patches/ultima5/`).
  - **Loader contract:** Origin's DINKEYDOS is replaced in language-card bank 1 at
    `$D000` by a shim with the same 14-entry jump table, inline parameters, zero
    page (`$52-$55`, `$60-$7F`), `$D600` block buffer and return codes. Each disk is a
    folder; ProDOS names become dot-less 8-character keys looked up only among the
    current disk's files, as `KEY.*`: a one-letter extension names the file's load
    address (aux type) in a table the loader installs (no extension = 0); the loader
    refuses a card where `STARTUP` has none (files left from an older folder). The
    shim calls the ROM's FAT32 routines directly (the calls
    `FLOAD`/`OWRITE` make: `fat32_open_cd $ECEA`, `fat32_finddirent $E9A0`,
    `fat32_opendirent $E7B4`, `fat32_file_read_part $EB69`, `fat32_file_write $EBB5`;
    the loader also uses `fat32_readdirent $E96D`) and the loader refuses a ROM whose
    first 8 bytes of any of them differ from the repository ROM. Loads read bytes
    `[0, size-1]`, writes rewrite existing files in place, a missing file fails with
    `$46`; block `n` is bytes `(n&7)*512` of `RAWnn` (`n/8`, hex). A volume select
    sets the current-directory cluster `$CC20` from a table the loader builds.
  - **Banking and interrupts:** the game runs with the BASIC overlay off (`$CAFE`
    nest count 0) and language-card RAM read/write in bank 1 or 2. The loader points
    the RAM `$FFFA/$FFFE` vectors at a resident in `$CF00-$CFFF`. PS/2 start/data/
    parity edges and the `$C010` strobe (CB1) are serviced there without bank work,
    sharing the ROM receiver state `$CE00/$CE01/$CE19` and reading DATA via `$C20F`;
    the bank switch would otherwise delay the DATA sample past the next bit. Other
    sources record the bank from a `$DFFF` signature, enter the ROM handler through
    a fake RTI frame, and restore `$C083`/`$C08B` and X/Y. The loader refuses a ROM
    whose NMI proxy `$F1BB-$F1C5` differs. ROM FAT32 sessions run with ROM reads and
    bank-1 writes and the music timer held off; `$B0-$BF` is preserved. The IRQ entry
    first tests the Mockingboard T1 flag (`BIT $C40D`, patched in by the loader when
    a card answers) and runs one music tick with bank 1 mapped; other IRQs go to the
    ROM as above.
  - **RAM2 use (this profile only, not a general free-RAM declaration):** `$CF00-$CFFF`
    resident; `$CD80-$CDFF` music glue; `$CA00-$CAD6` player state; player and
    load-address tables in `$CAD7-$CAFD`, `$CC3D-$CCFF`, `$CD00-$CD6B`,
    `$CE24-$CEDF` - areas the ROM writes
    only at boot (`$CC00`/`$CE00` page clears) or from the DOS prompt (command line
    `$CD00`), found by scanning the ROM for absolute references
    (`codegen/patches/ultima5/ram2.inc`).
  - **Music:** a compact player (`music.s`, bank 1) re-implements the 128K edition's
    Mockingboard driver per tick (sequencer, two envelopes, register shadow + flush,
    `$80-$83` request interface) for one song at a time; all 15 songs. The tool
    repacks songs into `SONGnn` in every disk folder, re-encodes durations with the
    fewest bytes and turns repeated phrases into subroutines (player commands `$39 n`
    call / `$3A` return, keeping pitch and durations; calls nest 3 deep), replays
    every voice against Origin's original before writing it, and pre-scales periods,
    noise and timer latches by 1.5734/1.0227 MHz from the user's `MUDR`. Songs fill an
    865-byte buffer after the player; the one song still larger (1, the title theme)
    continues in the `$D600` block buffer, which a block read takes back (the shim
    drops the song, and the player reloads and restarts it). 46 guarded patches open the game's `LDA $EC / LSR / BCC` music gates,
    replace `STA $C009`/`STA $C008` with `JSR mus_in`/`mus_out` (swap `$80-$83` with
    the player's copy), `TEMP.SUBS $15B9` with `mus_setx`, and the `MAIN.SUBS $EE46`
    pause/resume dispatcher with `mus_ctl` (pause silences at once). A song not in
    the buffer is loaded by the foreground at the next keyboard scan.
  - **Trust:** missing files and folders are detected; file contents are trusted.
  - **SNES controllers:** three guarded patches turn the game's keyboard reads
    (`MAIN.SUBS $EFC2`, `STARTUP $8B77`, `VIEW $A75A`, all `LDA $C000`) into
    `JSR pad_key` in the resident. It reads both pads directly from VIA1 port B (no
    `$C070`, so no paddle-timer NMIs) and writes the mapped key to `$C000` as the ROM
    does for PS/2, only when no key is pending. D-pad = arrows (held repeat, only
    while the game's queue `$B8` is empty), A Return, B Space, X T, Y A, L Esc, R E,
    Start Z, Select Q. VIA1 T2 (read-only, one-shot mode) provides the time base.
  - **Machine:** 64 KB play; the game's 128 KB aux-memory path stays off because
    `$FBB3` is not `$06` (music runs on the port's own player instead). `STARTUP`'s
    unconditional IIe aux/RamWorks writes are removed by one byte-verified patch. No
    ROM, VM, web bridge or hardware change is part of the port.

  - **Acceptance and limits:** see [`docs/porting-logs/ultima-v.md`](../docs/porting-logs/ultima-v.md).
- **Seven Cities of Gold SD-card port:** `codegen/tools/port-sevencities.mjs` turns the
  owner-supplied program and map disk images into a `7CITIES/` folder (`CD 7CITIES`,
  `BRUN 7CITIES.PRG 0800`): loader, `GAME.BIN` (the decrypted, patched `$0800-$BFFF`
  image Electronic Arts' boot loader would leave), and the two disks as 140 KB
  DOS-order images that the game reads and writes in place. Game data stays local; the
  repository holds the converter and glue (`codegen/patches/sevencities/`).
  - **Disk contract:** the game's (and World Maker's) RWTS entry jumps to an SD shim in
    its dead code that keeps the IOB contract (seek, read, write, format; status `$40`
    for a bad track) but takes buffer pages from the RWTS's patched loop operands
    (`$8B5F`/`$8A57`; `$125F`/`$1157`), not the stale IOB field. T/S is half of card
    sector `base + (T*16+S)/2`, through the ROM's `sd_readsector`/`sd_writesector`
    (`$E1B9`/`$E21C`, LBA `$B0-$B3`, buffer `$C800`); writes read-modify-write; format
    zeroes `MAP.DSK`. `$CFF0-$CFF7` hold the two files' first sectors, `$CFF8` the disk
    "in drive 1" (program disk only for the start-up language-card loads and the World
    Maker until its format). Owner decision: bound to these ROM internals for floppy
    speed (~0.1 s/sector) rather than ROM DOS commands (~0.8 s).
  - **Loader:** refuses a ROM whose SD routines (`$E141-$E279` checksum) or NMI proxy
    differ; learns each file's first cluster from the ROM FAT32 variables (`$CC00`,
    `$CC04`, `$CC18`, `$CC32`) after an `FLOAD` of 256 bytes, verifies that sector's
    content, and requires an unbroken FAT chain (entries masked to 28 bits; no fallback
    for fragmented files). An unrecognized program-disk release is converted with a
    warning; the code regions the shims replace are not verified for it (owner decision).
    Its final stage runs in `$CA00-$CABF` (no ROM references) while `GAME.BIN` overwrites it.
  - **Banking and interrupts:** the Ultima V resident at `$CF00`, signatures `$A5`/`$5A`
    at bank 1/2 `$DFFF`; the game's IRQ vector and RESET writes are redirected so the LC
    vectors stay the resident's and the ROM's. Three button tests get a `$C070` scan
    first (3RIC buttons are refreshed by the ROM's joystick scan). The copy-protection
    call is replaced by its passed result. No ROM, VM, web bridge or hardware change.
  - **Acceptance and limits:** see [`docs/porting-logs/seven-cities-of-gold.md`](../docs/porting-logs/seven-cities-of-gold.md).
- **Ultima I SD-card port:** `codegen/tools/port-ultima1.mjs` converts the owner-supplied
  single-sided ProDOS disk (volume `/U1`, the 1986 Origin release) into a `U1/` folder
  for the micro-SD card (`CD U1`, `BRUN U1.PRG 0800`). The game data stays local; the
  repository holds the converter and glue (`codegen/patches/ultima1/`).
  - **Loader contract:** only ProDOS is replaced. `U1.SYSTEM` and Origin's file layer
    it relocates to `$B700-$BAFF` (inline-parameter load/save/run entries) run
    unmodified. A ProDOS stand-in provides the global page `$BF00-$BFFF` (MLI entry
    `$BF00`, `MACHID $BF98 = $60` - II+-class, 64 KB, so the game's `/RAM` cache stays
    off; `DEVNUM $BF30 = $60`; every `DEVADR $BF10-$BF2F` entry is "no device") and its
    MLI code and file table in `$BB00-$BEFF`, the region ProDOS gave the layer as its 1 KB
    file buffer (the stand-in never uses it); its dispatch tables, prefix and variables use
    ProDOS-internal global-page bytes (`$BF70-$BF8F`, `$BFA0-$BFFB`). One file is open at a
    time; the MLI preserves X/Y and returns A/carry/Z like ProDOS. Paths resolve by their last component only, so
    `/U1/X` and `/U1.PLAYER/U1.VARS` both live flat in the folder; names become
    dot-less 8-character keys looked up in a table the tool generates (key, type, aux,
    EOF). `READ` becomes `FLOAD key buf mark mark+n-1`; `WRITE` at mark 0 of an existing
    file becomes `OWRITE key buf n` (n no larger than the file); `GET_FILE_INFO`,
    `OPEN`, `GET_EOF`, `CLOSE`, `SET_EOF`, `SET_FILE_INFO`, `GET/SET_PREFIX`,
    `GET_TIME` and `DEALLOC_INTERRUPT` are answered without the card; `GET_PREFIX` is
    `/U1/` (an empty prefix would make `U1.SYSTEM` scan `$0280` backwards over its own code).
    `CREATE`/`DESTROY` return write-protected (`$2B`; the card's file set is fixed),
    block calls return "no device" (`$28`), `ALLOC_INTERRUPT` returns `$25`, anything
    else `$01`.
  - **Player disk:** the character save `/U1.PLAYER/U1.VARS` (458 bytes from `$7E6D`)
    is the folder's `U1VARS`, which the tool creates zero-filled (the game treats it as
    "no saved character"). Saving always succeeds, so the game's floppy formatter is not
    reachable; if it were, every slot reports "No Disk II connected."
  - **Machine:** the game never maps the language card, so the ROM stays visible and its
    unmodified NMI handler serves PS/2, `$C010` and pads; the loader zeroes the ROM NMI
    nest count (`$CAFE`) and turns the BASIC overlay off (`$C007`). `$FBB3 != $06`
    selects the game's Apple II+ path (no `$C019` VBL wait, no IIgs `$C036`). The
    stand-in points the IRQ vector `$03FE` (ProDOS's to own) at a return stub. A ROM DOS
    command changes only `$B0-$BF` of game RAM (measured; it collects text at `$CD00`); the
    MLI saves `$B0-$BF` per call, keeps its own scratch there across each command, and
    streams the command through COUT with `$36/$37` on the collector the loader captured
    from the `$03EA` hook and `MUTE_OUTPUT $CE09` set, both restored after.
    One byte-verified patch: `STUPH $178C` skips the mouse-card probe (3RIC has none;
    the probe reads `$Cn0C/$Cn11/$CnFB` of every slot, including live ACIA/VIA pages).
    `U1.SYSTEM` must match a recorded SHA-256 (the stand-in emulates exactly its calls).
  - **SNES controllers:** one more byte-verified STUPH patch turns the game's input-wait
    keyboard read (`LDA $C000` at `$1D64`) into `JSR $0300`. That pad glue
    (`codegen/patches/ultima1/pad.s`, `$0300-$03BF`, measured unused by the game and the
    ROM) returns what `LDA $C000` would, except that with no key waiting it returns a
    newly pressed button's key with bit 7 set, so the game buffers it like a typed key.
    A typed key always wins, including one decoded during a scan; X/Y are preserved.
    The view-animation read at `$1C59` is left alone. Each poll clocks both pads itself
    on VIA1 port B exactly as the ROM's `@joystick_gamepads` does (latch bit 6 held 8
        cycles, clock bit 7, data bits 5/4 active low, 12 buttons; ~400 cycles, ~1% of the CPU). It does
    **not** use `PTRIG $C070` or call that routine: a `PTRIG` scan runs inside a
    ~1,500-cycle NMI, and the routine leaves through the ROM NMI exit whose blanket
    VIA1 IFR clear drops PS/2 and `$C010` edges - both corrupt real keyboard frames
    (A2Robots on the board; reproduced by `port-ultima1.native.ps1`). Mapping: D-pad =
    arrows (`$0B/$0A/$08/$15`, the codes the game itself maps Return / `/` / `;` / `'`
    to); A Attack, B Enter, X eXit, Y Transact, L Klimb, R Fire, Select Ztats, Start
    Space. Each button sends one key on its own press, however buttons overlap (a press
    that has to wait for a typed key is kept even if released first; both controllers
    share one state per button); the
    last D-pad direction repeats while held (first after 12 scans, then every 8, ≈0.3 s
    then ≈5 steps/s) and only while the game's type-ahead count (`$78`) is 0, so
    releasing never leaves queued moves.
  - **ROM limitation (not changed here):** the ROM NMI handler's Caps/Num Lock
    LED-command path changes Y and does not restore it (for any program on this ROM);
    pressing a lock key mid-game can disturb whatever code it interrupts.
  - **Trust:** ROM DOS command failures are not detected (the ROM reports them only as
    text); the
    generated folder is assumed complete. The game runs ~1.54x Apple II speed (3RIC
    clock, no VBL sync on the II+ path). Loads cost ~0.45 s per KB through the ROM's
    bit-banged SPI path (startup ~22 s, a dungeon ~5 s, a town or castle ~8 s).
  - **Acceptance and limits:** see [`docs/porting-logs/ultima-i.md`](../docs/porting-logs/ultima-i.md).
- **Ultima II SD-card port:** `codegen/tools/port-ultima2.mjs` converts the three
  owner-supplied DOS 3.3 disks (program, player master, galactic) into a `U2/`
  folder for the micro-SD card (`CD U2`, `BRUN U2.PRG 0800`). The game data stays
  local; the repository holds the converter and glue (`codegen/patches/ultima2/`).
  - **Translator contract:** Ultima II uses DOS 3.3 only through Ctrl-D text
    commands printed via `COUT`, so the loader turns the BASIC overlay off (`$CAFE`
    nest count 0; the game uses RAM to `$95FF`) and installs a resident at
    `$9600-$AFFF` (DOS 3.3's old region) as `CSW`. Ordinary characters go to
    `COUT1`; `BLOAD name[,A$]` becomes `FLOAD key addr 0000 len-1`, `BRUN` adds a
    jump, `BSAVE name,A$,L$` becomes `OWRITE key addr len` and must rewrite an
    existing whole file, `NOMON/MON/MAXFILES` are ignored. Each disk is a folder
    (`PROGRAM`, `PLAYER`, `GALACTIC`); keys are a name's first eight letters/digits,
    looked up among the current disk's files in a generated table (address,
    length). A port-only `DISK n` command switches folders (`CD ..`, `CD dir`).
    ROM commands run through the ROM's own collector (from the `$03EA` hook) with
    echo muted, saving `$B0-$BF` and `CSW`; A/X/Y are preserved. An unknown
    command, a file not on the current disk or a partial `BSAVE` stops in the
    monitor with a message before reaching the ROM.
  - **Patches:** seven byte-verified "insert disk" prompts (main program, `CREATE`
    twice, `STARS.OBJ` twice on each of two disks) become `DISK n` commands with
    the ESC wait removed. No other game byte, ROM, VM, web bridge or hardware
    change. The ROM stays mapped (no language-card use), so keyboard NMIs reach the
    unmodified ROM handler. `$9600-$AFFF` is reserved for this profile only.
  - **SNES gamepads:** the loader points the ROM's IRQ vector `$03FE` at the
    resident, clears both Mockingboard VIAs' interrupt enables and runs the first
    VIA's (`$C400`) Timer 1 free running at ~30 Hz (latch `$CCDE`; the game never
    uses the Mockingboard). On a Timer 1 IRQ the resident clocks both pads itself on
    VIA1 port B with the ROM scan's exact pin sequence (`$B99B`: latch `$40`, clock
    `$80`, pad 1 data bit 5, pad 2 bit 4, active low, 16 bits). It never touches
    `PTRIG $C070`: the ROM's `$C070` scan also arms VIA1's paddle timers, and those
    NMIs dropped PS/2 keys on the board in the A2Robots port. No NMI is raised. A
    new press (both pads ORed) becomes a keystroke written to the `$C000` latch
    only if bit 7 is clear, checked just before the store and recorded as sent only
    when stored, so a busy latch retries next tick and a pending key is not
    overwritten (a PS/2 key decoded within those two instructions can still be).
    The game reads pad keys exactly like typed ones (`$C000`/`$C010`, `RDKEY`).
    Mapping: D-pad = Return/`/`/←/→ (north/south/west/east, also direction
    answers), repeating after ~0.33 s every ~0.13 s while held; A = `A`ttack,
    B = `E`nter, X = `T`ransact, Y = `G`et, L = `Z`tats, R = `I`gnite torch,
    Select = ESC, Start = Space. Any other IRQ: an ACIA received byte (the
    emulator routes the ACIA to IRQ; the board routes it to NMI, where the ROM does
    the same) is delivered to `$C000` as a key; anything else returns. The ROM's IRQ
    entry stores A in `$45` (unused by the game); the handler returns with
    `LDA $45`, `RTI`, preserving X/Y. ROM DOS commands run with IRQs masked so the
    poller never interleaves with SD bit-banging; an error stop (including a
    `HELLO` that did not load) disables the timer first. A tick costs about 1,000
    cycles.
  - **Known issues (shipped by owner decision after review):** `BSAVE` passes the
    file length to `OWRITE`, so every 4 KB map save writes one extra sector past the
    file's cluster chain (fix: pass `len-1`); multi-sector saves need a card with
    512-byte clusters; the converter does not reject ambiguous, overlapping or
    truncated input images; command lines over 96 characters are truncated.
  - **Acceptance and limits:** see [`docs/porting-logs/ultima-ii.md`](../docs/porting-logs/ultima-ii.md).
- **Ultima III SD-card port:** `codegen/tools/port-ultima3.mjs` converts the two
  owner-supplied DOS-order disk images of the supported release (side 1 boots a memory
  image carrying the game's own resident DOS; side 2 is the player disk) into a `U3/`
  folder (`CD U3`, `BRUN U3.PRG 0800`). The game data stays local; the repository holds
  the converter and glue (`codegen/patches/ultima3/`).
  - **Loader contract:** the game prints `Ctrl-D BLOAD/BRUN/BSAVE NAME` through `COUT`
    to its own DOS (`CSW = $B44A`), which finds the name in a 96-entry track/sector
    table at `$AF80`. That DOS (`$AF80-$BFFF`, SHA-256-checked) is kept byte for byte,
    because the game checksums `$B42D-$B4AD`, `$B5A8-$B628`, `$B610-$B690` and
    `$B731-$B74C`, reads `$B44A`/`$B766-$B76F` and needs `$03F1 = $B7`. Only its
    DOS 3.3 RWTS is replaced: `$BD00` jumps to a shim at `$BE40-$BFFF` (clear of the
    `$BE3D` byte count and the `$B8E7-$BB28` nibble tables the DOS still writes). The
    first RWTS call of a command (`$48/$49` still at the table entry) moves the whole
    file with `FLOAD NAME addr 0000 len-1` or `OWRITE NAME addr len`; later sector
    calls return at once (`$48/$49` left at the IOB, as RWTS leaves them). All 96
    files share one folder under their own names; side and drive arguments no longer
    matter. `ROST PLRS PRTY SOSA SOSM` must exist for `OWRITE`.
  - **Machine:** 48 KB play, BASIC overlay off (`$CAFE = 0`), no language card, so the
    ROM's NMI/IRQ vectors stay in effect (IRQ → `$03FE`). ROM commands run under `SEI`
    with `$B0-$BF` and `CSW` restored: the music driver keeps its pointers in the
    FAT32 zero page. `MBS` is the one modified game file: its VIA T1 latch (`$411A` →
    `$6429`) and 96 AY note periods are scaled by `1.538472` so tempo and pitch match
    the Apple, and its two `$03FE/$03FF` stores are redirected to the gamepad tick's
    `next_irq` link. Other speaker/delay-loop timing runs ~1.54x faster. No ROM, VM,
    web bridge or hardware change is part of the port.
  - **SNES gamepads:** the loader starts with `SEI`, turns off and clears both
    Mockingboard VIAs' interrupts and resets both AYs (whatever a previous run left
    running; the game itself only resets the first), then runs the second VIA's Timer 1
    (`$C480`) free at ~61 Hz with `$03FE` → a tick in the dead RWTS code at
    `$BD03-$BE3C`. The tick services only its own T1 flag (otherwise `JMP (next_irq)`:
    MBS's handler, or `LDA $45 / RTI`), reads both pads itself through VIA1 port B as
    the ROM scan does (PB6 latch, PB7 clock, active-low PB5/PB4) rather than through
    `PTRIG $C070`, whose ROM NMI scan exits by clearing every VIA1 flag and could drop a
    PS/2 edge, and turns presses (either pad) into keys in `$C000` once the
    previous key was taken: D-pad → Return / `/` / ← / → (north/south/west/east, held
    repeats after ~0.3 s every ~0.15 s), B Space, A `A`ttack, X `E`nter, Y `T`ransact,
    L `K`limb, R `D`escend, Select `I`gnite, Start `G`et. Keyboard input is unchanged.
  - **Acceptance and limits:** see [`docs/porting-logs/ultima-iii.md`](../docs/porting-logs/ultima-iii.md).
- **Wizardry I SD-card port:** `codegen/tools/port-wizardry1.mjs` converts the
  owner-supplied Apple Pascal boot and scenario disks into a `WIZ1/` folder
  (`CD WIZ1`, `BRUN WIZ1.PRG 0800`). The game data stays local; the repository holds
  the converter and glue (`codegen/patches/wizardry1/`).
  - **Volume contract:** `WIZ1.VOL` is one Pascal volume: the scenario disk's
    blocks 0-279 followed by the boot disk's system files, under the boot disk's
    directory header (its byte 25 steers the runtime's volume search). Both "insert
    disk" prompts are answered with RETURN. Four byte-verified p-code patches,
    located through segment dictionaries, remove the two Disk II timing checks and
    the `CASTLE` checks of their `$0479` watermark.
  - **BIOS contract:** the loader stands in for the Pascal boot blocks: 45 pages of
    `RTSTRP.APPLE` at `$9200`, `X=$60`, ROM selected, `JMP ($BEFE)`. The runtime's
    DISKREAD/DISKWRITE body (`$AF31`) jumps to a `$CF00` resident; the shim in
    language-card `$E000` serves unit 4 only (9 otherwise), blocks past the volume
    give 8, and writes outside blocks 2-279 or not in whole blocks give 16 (the
    master boot disk was write-protected; WIZBOOT checks for it).
  - **SD access (ROM internals, owner-approved):** block n is file sector n; the
    loader resolves `WIZ1.VOL`'s FAT chain into a per-cluster LBA table, so any
    cluster size and fragmentation work, and the shim calls `sd_readsector`
    (`$E1B9`) / `sd_writesector` (`$E21C`) with `$B0-$B3`/`$B8` saved. It also
    reads `$CC00/$CC04/$CC08/$CC20/$CC32`. The loader refuses a ROM whose code in
    those ranges has different Fletcher sums; a failed `FLOAD` is not used as a
    probe because it continues with stale state.
  - **Banking and interrupts:** Wizardry maps the empty language card (anti-RESET),
    so the loader fills it with the shim, the cluster table, `$DFFF` signatures
    (`$A5` bank 1, `$5A` bank 2) and RAM NMI/IRQ vectors to the resident, which
    reuses the Ultima V PS/2 fast path and ROM forwarder and restores ROM, bank 1 or
    bank 2 around each BIOS call. `$CF00-$CFFF` is reserved for this profile, not a
    general free-RAM declaration. No ROM, VM, web bridge or hardware change.
  - **Acceptance and limits:** see [`docs/porting-logs/wizardry-i.md`](../docs/porting-logs/wizardry-i.md).
- **ROM DOS load/write semantics (observed, unchanged):** `FLOAD name addr start end`
  takes an inclusive end offset and skips to `start` byte by byte; `BLOAD` stores one
  byte past EOF; `OWRITE` writes whole sectors in place and, for a missing file, falls
  back to `BSAVE` code in the BASIC bank (`$ACFD`), which is unsafe with the overlay off.
  `OWRITE name addr len` writes ⌊len/512⌋+1 sectors (one too many when `len` is a
  multiple of 512; pass `len-1`), and its write loop advances one cluster per sector,
  so multi-sector writes are correct only on cards with 512-byte clusters (as the
  shipped card image is). Found during the Ultima II review; both come from
  `fat32_file_write` (`$EBB5`), which the Ultima V shim now calls directly with the
  file's directory size, so it may be affected too.
- **Adventure (Colossal Cave, A Bit Better Associates 1980) compatibility experiment:**
  an image-specific, disk-only adapter for the owner-supplied 143,360-byte DOS 3.3 `.dsk`
  with SHA-256 `7d429cfd7d1999db3b42d1f4f149efdb16fda67685b282e68208ee4131b37e1d` (or its
  234,496-byte WOZ2 equivalent `426af3b3e925d6c53d98ff239cb5e15b4246de439c61d6bba4960a36da17e075`),
  targeting the unchanged repository ROM `badger6502.bin` (`fcea03683b77b7f113e6d8f0064ea8edbd6c75b04b472ec5c84de1c3a9f86435`).
  The game and resulting disk stay outside the repository.
  - **Language Card BASIC relocation and NMI preservation:** DOS 3.3 occupies `$9600-$BFFF`
    in main RAM, overlapping 3ric's banked ROM BASIC (`$9000-$BFFF`). The patcher relocates
    3ric's MSBASIC (`$9000-$B0FF`, driven by `badger6502.dbg` spans and fixups) by `+$4000`
    into `$D000-$F0FF` across 33 unused sectors (`T3S0-T5S0`), and installs a 1-sector
    stage-2 loader at `T5S1` (all 34 sectors marked allocated in the Track 17 VTOC). At
    boot, `T0S9` (`$BFC8-$BFDB` and `$BFA8-$BFB6`) loads stage 2 at `$0800`; stage 2 verifies
    the ROM NMI proxy (`$F1BB-$F1D5`) and banked PS/2 handler checksum (`$B500-$BDFF`),
    copies `$F100-$FFFF` into Language Card RAM (`$C081`×2), installs a Language-Card-safe
    NMI wrapper at `$FFFA/$FFFB` (`$F040`, servicing PS/2 start/data/parity edges and `$C010`
    CB1 strobes without bank work and forwarding stop-bit/other NMIs via `$B78D`
    (`BIT $C082 / JMP $F1BB`) -> `$BFB1` (`BIT $C080 / JMP LC_RESUME`)), and loads the 33
    BASIC sectors into `$D000-$F0FF` so PS/2 keyboard and VIA interrupts never leave upper
    ROM mapped over Language Card BASIC.
  - **DOS 3.3, `CHAIN`, and Applesoft runtime bridge:** DOS 3.3 vectors, zero-page
    pointers (`TXTTAB $6A`, `VARTAB $6C`, `ARYTAB $6E`, `STREND $70`, `FRETOP $72`,
    `MEMSIZ $76`, `CURLIN $78`), and the machine-language `CHAIN` loader at `$0208` (`T6S13-T6S12`)
    are adapted to 3ric's relocated MSBASIC entry points (`NEWSTT $D0EF`, `LINGET $D2D2`,
    `CLEAR/CLEARC $D2DA`, `RESTORE $D55E`, `RUN $D40D`, `GARBAG $E077`) plus a backwards
    block-move helper `CHAIN_BLTU2`. Both BASIC programs on disk (`ADVENTURE` at `T18S15`
    and `ADVENTURE^Q PART TWO` at `T19S15`) are retokenized to 3ric MSBASIC token bytes.
  - **Applesoft dialect and KIM-1 `FMULT` fix:** the relocated BASIC image adds Applesoft
    statement handlers (`HOME`, `CLEAR`, `CALL`, `HTAB`, `VTAB`, `HIMEM:`, `SPEED=`,
    `ONERR GOTO`, `RESUME`, `POP`), `PEEK(107)`/`PEEK(108)` and `PEEK`/`POKE -16368` (`$C000`/`$C010`)
    hooks, `INLIN` non-destructive backspace (`$08`) and high-bit stripping, single-line
    `INPUT` retry on `EXTRA IGNORED`, 5-byte `GARBAG` variable stride (`$DDBE`), Applesoft
    `+1`/`0` boolean operators (`CMPDONE $DBE6`, `NOT $DAAF`, `OR`/`AND $DB52`), Applesoft
    `FOUT`/`PRINT`/`STR$` number formatting without leading/trailing spaces, and fixes the
    1977 KIM-1 mask-ROM bug at `FMULT` (`$A5C7` / `LC $E5C7`: `$67 $67` -> `$66 $67` =
    `ROR RESULT+2`) so 8-digit travel table entries (`FNM(B)`) evaluate exact 32-bit products.
  - **Acceptance and limits:** verified in headless WASM (`patch-adventure.test.mjs`) from
    cold `C600G` boot through `HELLO`, `ADVENTURE` data loading, `CHAIN` into
    `ADVENTURE^Q PART TWO`, hi-res splash screen, above-ground exploration, unlocking the
    grate, descending `DOWN` into `BELOW THE GRATE`, `IN COBBLE CRAWL`, `IN DEBRIS ROOM`,
    and `IN BIRD CHAMBER`, catching the bird, `PR#1` (`POP` -> `NO PRINTER AVAILABLE`), `INVENTORY`, and `SCORE`. In-game `SAVE`
    exercises `VERIFY` Error 6 through `ONERR GOTO 9000` (`PEEK(222) = 6`), executes
    `SAVING 'ADGMTEST'...` and `NEW : END` cleanly to the prompt without corrupting disk
    tracks (`WozLib` is read-only and does not persist Disk II sector writes), and
    restarts via `RUN ADVENTURE`. See
    [`docs/porting-logs/adventure.md`](../docs/porting-logs/adventure.md).
- **Bouncing Ball (scottybe's community contribution):** the canonical source remains
  `web/programs/bouncing-ball.s`, loaded at `$0800` by the gallery, assembler, or
  `BRUN BOUNCE.PRG 0800`. Its 114-vertex, 128-face checkerboard sphere is transformed,
  back-face culled, filled, and outlined on the 65C02 every frame; it is not a
  prerecorded sprite animation.
  - **Preserved presentation:** the perspective room grid, opaque black/white faces,
    mesh outlines, 64-step two-axis rotation, gravity, wall/floor bounces, and alternating
    hi-res pages retain the contribution's frame-by-frame pixels and motion. Any key
    acknowledges `$C010` and executes `BRK`, as in the original.
  - **Hardware performance:** cache the static room once, restore only the old ball's
    rectangle on the hidden page, and use integer lookup arithmetic, incremental
    polygon-edge intersections, and byte-wide spans instead of per-pixel division.
    Over a 128-frame regression sequence, including both page initializations, mean
    live-frame cost must be at most **one tenth** of the original mean; every individual
    frame must be at least **nine times faster** and stay below **520,000 cycles**.
    The baseline is PR #58's merge `fc4d46e`, averaging 4,814,984 cycles per frame.
    Measure emulated 65C02 cycles, not host time or an increased emulator clock.
    Further optimization must retain fully live transformation and rasterization,
    the existing resolution/mesh detail, and the original pixels. Static arithmetic
    tables are allowed; cached rotation poses, visibility frames, and rendered ball
    animations are not. The user prioritizes this appearance over a second tenfold gain.
  - **Memory and delivery:** the raw image ends below `$2000`; the two display pages
    stay at `$2000-$5FFF`. Scratch state uses `$06-$0F` and `$50-$AF`, outside the ROM's
    text-window and I/O vectors. Tables use `$6000-$6FFF`, and the immutable room cache occupies
    `$7000-$8FFF`, below BASIC ROM. The standalone source builds through the existing
    assembler and `.PRG`/bootable `.woz` exports without assets or a new loader.
    No ROM, VM, bridge, platform-reference, or hardware-decoder contract changes are
    required. Emulator cycle measurements are not a physical-board benchmark.
- **3RIC Groovebox:** `codegen/programs/groovebox.s` is a standalone `$0800` 65C02
  music app, not a browser synthesizer. Its 40x24 text interface edits a looping 16-step
  pattern for six voices: bass, lead, and arpeggio on the left AY; kick, snare, and hi-hat
  on the right AY. It starts playing an original demo at 120 BPM.
  - **Sound:** all synthesis uses the existing slot-4 `$C400/$C480` VIA/AY interface,
    with tone periods calculated for 3RIC's 1.5734375 MHz clock. Each voice has independent
    step enables, pitches, mute, and a Pluck/Soft/Long software-envelope preset. Kick has
    a descending pitch sweep; snare mixes tone and noise; hi-hat uses noise. The right
    chip's noise generator is physically shared: a hat's noise-period setting also
    colors a simultaneously sounding snare. No independent noise generators are faked.
  - **Timing:** left-VIA Timer 1 free-runs at approximately 240 Hz. With IRQ masked,
    `WAI` wakes on its IRQ and the program acknowledges the timer directly; it does not
    replace the ROM IRQ/NMI vectors or disturb the onboard VIA's gamepad wiring. A
    fractional accumulator schedules sixteenth notes at 60-180 BPM in 5-BPM increments,
    independently of drawing and host display refresh. Envelopes and controller
    debouncing use the same hardware timebase. Detail-field redraws defer to the next
    input scan when a six-voice trigger uses the current tick's budget.
  - **Controls:** the first SNES pad uses D-pad to select a voice/step, A to toggle the
    step, B/Y to raise/lower its note, X to mute the voice, Select to cycle its envelope,
    Start to stop/restart from step 1, and L/R to decrease/increase BPM. Navigation
    repeats after a hold delay; other pad actions require a fresh press, including after
    startup. Opposing D-pad directions cancel. Keyboard equivalents are arrows/WASD,
    Space, `+`/`-`, M, I, Return, and `[`/`]`; Q silences the chips and returns to the
    monitor. Gamepad input goes through `PTRIG` and the ROM's `GAMEPAD1` table.
  - **Editing:** disabling a step retains its pitch. Note editing enables the selected
    step and clamps to a two-octave range; the hat instead selects noise periods 1-24.
    Enabled, unmuted edits can be auditioned while stopped. Mute and stop silence voices
    immediately. The selected cell, playback position, voice activity, BPM, note/noise
    period, and envelope remain visible. Edits are RAM-only; reloading restores the demo.
  The raw image ends below its `$6000-$61FF` workspace and uses text page 1, leaving
  the memory map, ROM, core, bridge, and hardware-decoder contracts unchanged. Browser sound still
  requires native 1x speed and an initial pointer/keyboard gesture.
- **Built from Bits (Hackaday showcase):** `codegen/programs/hackaday.s` is an original,
  self-running `$0800` 65C02 showreel, not a browser animation or a prerecorded video.
  - **Four scenes:** a hi-res 3RIC title and moving starfield; a 16-color lo-res plasma;
    a software-rasterized rotating wireframe cube; and a six-channel musical sequencer
    display. The bottom four text rows explain the active hardware technique and controls.
    Scene changes are automatic, with a complete loop of approximately one minute at 1x.
  - **Sound:** an original looping composition programs the two slot-4 AY chips through
    their 6522 ports at `$C400` / `$C480`. Six pitch/level indicators reflect the values
    sent to the chips, not fabricated audio measurements. Music is optional on physical
    machines without the sound expansion; video timing never depends on its presence.
  - **Controls:** 1-4 selects a scene; N/Right advances and Left goes back; Space freezes
    animation and the score and silences sound; M toggles music without freezing the demo.
    Q/Esc silences both AYs, restores page-1 text mode, and returns to the monitor with
    `BRK`. These are ordinary `$C000` / `$C010` keyboard inputs, including the browser's
    existing virtual keyboard.
  - **Timing and memory:** the onboard VIA at `$C200` reserves Timer 2 for a polled
    approximately 25 Hz cadence. Its Timer-2 interrupt is disabled without disabling
    unrelated VIA interrupts; previous ACR/IER settings are restored on exit. Drawing
    must fit within a 63,000-cycle steady-state frame budget. The image ends below
    `$2000`; graphics use page 1 (`$2000-$3FFF`) and the normal text/lo-res page
    (`$0400-$07FF`); lookup tables and working data live in `$6000-$67FF`.
  All pixels, musical register writes, sequencing, and input handling execute on the
  65C02 through existing contracts. No ROM, VM, memory-map, platform-ref, or hardware-decoder changes
  are required. A hardware-compatible binary is not a claim of a physical-board test.
  The ROM's text-window bounds at `$20-$23` (`WNDLFT`/`WNDWDTH`/`WNDTOP`/`WNDBTM`)
  remain untouched throughout the demo. Drawing coordinates use `$58-$5B` instead.
  Q/Esc must restore a usable visible monitor after every scene, not merely produce a
  serial BRK dump; exit coverage includes the on-screen prompt and a subsequent memory
  examination command.
- **Matrix Rain:** `codegen/programs/matrix.s` is a self-running `$0800` hi-res demo:
  - **Presentation:** 40 independent streams of original 3x5 letter/digit glyphs fall
    through 32 character rows. White heads leave green trails whose last two characters
    fade with spatial dithering before being erased. The screen starts populated, without
    a title screen, HUD, or audio.
  - **Motion:** a nonzero 16-bit LFSR chooses glyphs, initial positions, lengths of 8-23
    characters, per-column movement periods of 2-5 animation ticks, and restart gaps of
    4-19 ticks. A stream's entire tail leaves the bottom before that column restarts.
    Incremental cell updates and a short CPU delay pace the demo for native 1x speed;
    selecting a faster emulator clock intentionally speeds it up.
  - **Controls:** Space pauses/resumes both motion and glyph changes; Q or Esc restores
    page-1 text mode, clears the screen, and returns to the ROM monitor with `BRK`.
  - **Memory and portability:** the image ends below `$2000`; hi-res page 1 occupies
    `$2000-$3FFF`, glyph history `$6000-$64FF`, and scanline tables `$6500-$66BF`.
    Off-screen cells are clipped, never wrapped. All animation, keyboard handling, and
    artifact-color selection execute on the CPU using existing machine contracts, with
    no browser-specific drawing or emulator changes.
- **Jungle Quest — The Sunstone Run:** `emulator/AICodeGen/jungle/jungle.s` is an original
  mixed-hi-res action platformer loaded at `$0800`. Its six flip-screens form one authored
  expedition rather than interchangeable obstacle rooms:
  - **Movement:** A/D or Left/Right runs; W/Up/Space jumps; S/Down ducks. Input includes a
    short movement latch for the keyboard's event-driven interface, a four-frame coyote
    window, a five-frame jump buffer, and a low ducking hitbox. A grabbed vine follows a
    pendulum arc and Jump releases it without immediately re-catching; it also releases
    safely over the far bank.
  - **Hardware controls:** SNES D-pad moves/ducks and A/B jumps via the ROM's
    `PTRIG`/`GAMEPAD1` contract. The browser maps standard USB/Bluetooth controllers through
    the emulator's SNES/VIA peripheral; impossible opposing directions remain rejected.
    End screens ignore repeated gameplay keys: Return restarts from the keyboard, while
    Start/A/B must be released before a fresh pad restart press.
  - **World:** screen descriptors define up to two ground gaps, two raised platforms, one
    vine, a checkpoint, and a distinct moving threat. The route teaches a boulder jump,
    platform traversal, an active vine crossing, and ducking under a bat before combining
    those verbs at the ruins and temple.
  - **Objective and rewards:** four mandatory glyphs on the first four screens unlock the
    temple; optional fruit awards score and restores time. The final Sunstone ends the run.
    Death costs one of three lives and five clock units but respawns at the current screen's
    checkpoint with collected items preserved. The initial gameplay clock is 90 units.
  - **Presentation:** a textured jungle/ruins background, water-filled gaps, raised masonry
    and animated player/threat sprites make each screen readable. The mixed-mode HUD shows
    score, time, lives, glyph progress, and contextual gate/status messages.
  Focused headless hooks verify renderer primitives, buffered/coyote jumps, platform and
  gap collision, duck-vs-bat behavior, item effects, checkpoint death, gate progression,
  vine release, timer states, restart input gating, and final victory. The assembled image
  must end below the hi-res page at `$2000`.
- **STAR DUEL:** `emulator/AICodeGen/spacewar/spacewar.s` is an original two-player
  mixed-hi-res gravity-duel loaded at `$0800`. It reuses only un-copyrightable Spacewar-style
  conventions — two ships, a central sun, inverse-distance gravity, wrap, thrust inertia,
  and torpedoes — with original names, silhouettes, HUD copy, and 65C02 code.
  - **Playfield:** mixed hi-res (280×160 XOR vector ships over a persistent sun/starfield)
    plus four text HUD rows. The image ends below `$2000`; row tables live at `$6000/$6100`,
    working RAM at `$6200`, and ship/shot structs at `$6300`.
  - **Gravity:** each live ship is pulled toward the sun at (140, 80) with a 32-entry
    magnitude table indexed by Manhattan distance. Near-sun Chebyshev range 6 is fatal;
    the opponent scores if the match is underway. Ships spawn off the sun's row so the
    opening volley is not eaten by the well. Torpedoes use a Chebyshev box that covers the
    wedge silhouette (radius 10) plus shot step, and die on a ship or the sun.
  - **Controls:** SNES pad 1 and pad 2 both go through `PTRIG` + `GAMEPAD1`/`GAMEPAD2`.
    D-pad left/right rotate, Up/B thrust, A/Y fire, Select hyperspace, Start starts or
    rematches. Opposing D-pad directions cancel. Keyboard P1 is A/D or arrows to rotate,
    W/Up to thrust, S/Space to fire, H for hyperspace; P2 is J/L, I, K/U, N. Q/Esc restores
    page-1 text and `HOME`s to the monitor with `BRK`. First player to 5 kills wins.
  Focused headless hooks cover the row table, XOR plot, gravity sign/magnitude, wrap,
  thrust, firing, sun/ship/shot collisions, scoring, and dual-pad input. No ROM, VM,
  memory-map, platform-ref, or hardware-decoder changes are required.
- **SUNSLING:** `codegen/programs/sunsling.s` is a separate, original two-player
  Spacewar-style game, not a revision or copy of STAR DUEL. It loads at `$0800`.
  - **Flight and combat:** two distinct vector ships duel around a central sun in a
    wrapping 256x160 arena inset within mixed hi-res video. Signed 8.8 velocities,
    16 headings, thrust, and a softened inverse-square gravity approximation run on
    the 65C02. Gravity bends torpedoes as well as ships. Each pilot has four torpedo
    slots; shots inherit launch velocity, expire, and cannot hit their owner. The sun,
    enemy torpedoes, and ship-to-ship contact are lethal. The opponent earns one point
    per death; simultaneous deaths are resolved together, including a 5-5 draw.
    First to five wins. Respawning includes a brief shield against enemy contact,
    but never protection from the sun.
  - **Controls:** each SNES pad uses Left/Right to turn, Up/B to thrust, A/Y to fire,
    Select for a safe-perimeter hyperspace escape (eight-second cooldown), and a fresh
    Start press to start/pause/resume/rematch. Opposing directions cancel; releasing or
    disconnecting a controller releases its level controls.
    Keyboard P1 uses A/D (or Left/Right) to turn, W/S (or Up/Down) for burn/coast,
    F/Space for a short torpedo burst, and E for hyperspace. P2 uses J/L, I/K, U, O.
    Keyboard throttle is explicitly latched on/off, not a fabricated key-up interface:
    both pilots can keep burning while independently steering or firing. Enter starts
    or rematches, P pauses/resumes, M mutes effects, and Q/Esc quits. Pausing freezes
    physics, lifetimes, respawns, and cooldowns; held Start/Select never retrigger.
  - **Presentation and timing:** an original pixel title, persistent starfield/sun,
    XOR ship outlines, exhaust, expanding explosion particles, and four text HUD rows.
    Brief effects toggle the real `$C030` speaker. A polled onboard VIA Timer 2 targets
    30 Hz at native 1x; steady-state work must fit a 52,448-cycle frame, including
    two active pilots and eight torpedoes. The ROM's SNES scan reloads both onboard
    timers, so the frame countdown is armed immediately after that scan, allowing
    1,600 cycles for the current ROM scan and surrounding frame-loop overhead.
    Regression coverage measures idle, one-pad and two-pad scans as well as full
    combat load against the staged ROM; ROM timing changes must not be hidden by
    widening the cadence tolerance. Completion reads the counter's wrap,
    not an IFR bit that a later ROM NMI can acknowledge. Frame periods stay within
    200 cycles of 52,448. The timer interrupt is disabled without
    disabling unrelated VIA interrupts. Prior ACR, Timer-2 interrupt enable, joystick
    mode, and CPU flags are restored on exit, then text page 1, `HOME`, and `BRK`
    return to a usable monitor. ROM text-window bytes and vectors remain untouched.
  - **Memory and delivery:** the raw image ends below `$2000`; hi-res page 1 is
    `$2000-$3FFF`, lookup tables `$6000-$63FF`, state `$6400-$65FF`, and scratch
    zero page `$50-$7F`. The gallery/editor stages the canonical source with the
    existing wildcard and exports ordinary `.PRG` and bootable `.woz` files.
    No ROM, VM, bridge, memory-map, platform-ref, or hardware-decoder changes are
    needed. Emulator measurements do not claim a physical-board playtest.
- **PULSAR DUEL:** `emulator/AICodeGen/pulsar/pulsar.s` is a second, independent
  two-player gravity duel at `$0800`, written from scratch alongside STAR DUEL rather
  than derived from it. It shares only the un-copyrightable Spacewar-style premise — two
  ships, one gravity well, wrap, inertia, torpedoes, hyperspace — and differs in every
  implementation choice below.
  - **Playfield:** a 256×160 *logical* field, so logical x is a single byte and wraps mod
    256 for free; logical x maps to hi-res column x+12 to centre the 280-pixel line, and
    logical y is scanline 0..159 wrapped by hand. Four text HUD rows sit underneath. All
    working RAM and the `ROWL`/`ROWH`/`XBYTE`/`XMASK` tables are part of the image, which
    ends below `$2000` — nothing is scribbled at `$6000`.
  - **Gravity:** the pulsar sits at logical (128, 80), dead centre, so the vertical
    component never needs wrap correction. Distance is the octagonal norm
    `r ~= max(|dx|,|dy|) + min(|dx|,|dy|)/2` (about 6% error, and it guarantees
    `|d| <= r`). A 176-entry table holds `F[r] = round(G*65536/r^3)` with `G = 160`,
    clamped at 10,486 below `r = 10`; per-axis acceleration is `(|d| * F[r]) >> 8` in 8.8 via an
    8x16 shift-add multiply, giving a true inverse-square field with no division.
    Integration is semi-implicit Euler (velocity then position), so orbits are stable.
    Torpedoes fall into the well on exactly the same code path, so shots curve.
  - **Orbital opening:** both pilots spawn *in orbit*, not at rest — 48 logical pixels
    out on opposite sides, travelling 1.64 px/frame tangentially, in the same rotational
    sense. r = 48 keeps the whole path clear of the `y = 0/160` wrap seam; the orbit
    precesses between r = 47 and r = 61 and never falls in unattended.
  - **Rendering:** ships are XOR vector triangles plus an exhaust line, from per-heading
    vertex tables at 32 headings; erasing is literally redrawing the previous
    `(x, y, heading, thrust)`, so the starfield and pulsar survive underneath. Explosions
    are expanding eight-point rings. Lines use signed 8-bit Bresenham with a 48-step
    safety counter.
  - **Controls:** both SNES pads via `PTRIG` + `GAMEPAD1`/`GAMEPAD2` — D-pad left/right
    rotate, Up/B thrust, A/Y fire, Select hyperspace, Start begins or rematches; opposing
    D-pad directions cancel. The keyboard latch has no key-up, so every recognised press
    arms a hold timer that is replayed as held intent for several frames: P1 is A/D, W,
    S, X and P2 is J/L (or arrows), I (or Up), K, M. Q/Esc restores text, `HOME`s, and
    `BRK`s to the monitor. Hyperspace misjumps one time in eight and credits the
    opponent. First to 5 kills wins.
  Verified by `codegen/tools/pulsar.test.mjs`, whose headless hooks cover the row/column
  tables, XOR plot self-inversion, line drawing, the octagonal norm across the x seam,
  gravity sign and magnitude, 240 frames of orbit stability, turning, thrust, velocity
  caps, both wrap axes, per-player torpedo magazines and cooldown, torpedo curvature and
  expiry, pulsar/torpedo kills, spawn protection, respawn, match end, keyboard hold
  timers, dual-pad input, draw/erase round-tripping, HUD contents, and the per-frame
  cycle budget. No ROM, VM, memory-map, platform-ref, or hardware-decoder changes are
  required.
- **Disk & card images:** demo `.woz` (staged from `emulator/WozFileTestApp/testdata/`);
  `emulator/Data/sd.zip` → `web/data/sd.sparse` FAT32 image (`WEB-CLIENT.md`).

## Behaviour / Rules

- **Known limitation — no Applesoft.** The `$E000` BASIC is generic Microsoft BASIC (prompts
  `MEMORY SIZE?`). Disks whose boot auto-runs an Applesoft greeting (DOS 3.3 / Quick-DOS
  System Masters and games chaining through them) load DOS but then trap. Self-booting
  machine-code disks run fine. Treat this as a documented gap, not a bug to paper over.
- **The ROM defines the memory-map contract in practice.** ROM routines assume the `MM_*`
  layout in `vm.h`; a memory-map change means rebuilding/re-verifying the ROM and
  regenerating `platform-ref.*`.
- 6502 sources target the `asm6502.mjs` dialect and conventions in
  `codegen/platform/prompt-system.md`.
- **ROCK STORM performance contract.** An opening-wave live frame (compose the hidden
  page and flip it) must complete in at most **175,000 65C02 cycles** in the headless
  emulator. The live loop must not add a fixed busy-wait when rendering already consumes
  the available frame time. Its cycle check and pixel/gameplay tests live in
  `codegen/tools/rocks.test.mjs`.

## Data flow

`badger6502.bin → mapped $D000–$FFFF + banks; reset → monitor → (Disk II C600G | DOS EC5CG |
BRUN) → user program runs → COUT/screen/serial output`.

For Matrix Rain:
`gallery/sample source → assembler → $0800 program → $C000/$C010 pause/quit input +
LFSR/column timers → glyph history and clipped hi-res cell writes → existing native/WASM
artifact-color renderer → display`; quitting selects text mode and executes ROM `HOME`
then `BRK`.

For Bouncing Ball:
`gallery source / raw PRG / bootable WOZ -> $0800 program -> gravity + rotation ->
cached room restore + live vertex transforms, face visibility, polygon fills, and mesh ->
hidden hi-res page -> $C054/$C055 page flip -> existing hardware/native/WASM display`.
Keyboard input follows the existing `$C000/$C010 -> BRK` path.

For Built from Bits:
`Hackaday landing page / gallery / sample -> existing browser assembler or BRUN -> $0800
program -> keyboard + polled VIA Timer 2 -> scene/score state -> text/lo-res/hi-res RAM
and slot-4 VIA/AY writes -> shared native/WASM video and audio outputs`.

For Jungle Quest:
`keyboard event or SNES poll → movement/jump/duck latches → 8.8 physics → terrain/platform/
hazard/item collision → lives/time/glyph/score state → BG restore + sprite redraw → hi-res
page and mixed-mode HUD`; a screen-edge transition loads the next descriptor, while death
reloads the same descriptor at its checkpoint.

For STAR DUEL:
`keyboard hold-timers or PTRIG + GAMEPAD1/GAMEPAD2 → rotate/thrust/fire/hyperspace intents
→ 8.8 inertia + Manhattan gravity toward the sun → wrap/collisions/score → XOR erase/draw
on hi-res page 1 + mixed-mode HUD`; Q/Esc selects text mode, `HOME`, then `BRK`.

For SUNSLING:
`gallery/editor or raw PRG/WOZ -> $0800 -> keyboard burn/coast and burst latches or
PTRIG/ROM scans of both SNES pads -> timer-paced 8.8 ship/torpedo gravity and inertia
-> toroidal collisions, simultaneous scoring, respawn/shield/cooldown state -> XOR
hi-res vectors + text HUD + $C030 -> existing native/WASM video/audio`.
Pause holds simulation state; quitting restores the borrowed I/O settings and monitor.
For PULSAR DUEL:
`keyboard hold-timers or PTRIG + GAMEPAD1/GAMEPAD2 → rotate/thrust/fire/hyperspace intents
→ XOR erase of last frame's geometry → octagonal-norm inverse-square gravity via an `r^-3`
force table + 8x16 multiply → 8.8 semi-implicit Euler for ships and torpedoes → dual-axis wrap /
collisions / score → XOR draw on hi-res page 1 + mixed-mode HUD → frame pacing`; Q/Esc
selects text mode, `HOME`, then `BRK`.

For Groovebox:
`keyboard or SNES/VIA/ROM scan -> sequencer edits -> Timer 1 IRQ/WAI tick -> step and
software-envelope state -> real VIA/AY register writes -> shared VM stereo PCM -> host
audio`; the program separately writes its editor and playhead into text video RAM.

## Dependencies

- **Upstream:** the assembler/build (cc65/ca65 for the ROM; `CODEGEN.md` for programs).
- **Downstream:** the emulator loads and executes it (`EMULATOR.md`); the platform reference
  is derived from its symbols (`CODEGEN.md`).

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| 3RIC Talks v1 challenge contract | Implemented; no engines yet | Original dual-AY TTS, bank-aware RAM rules, reusable ABI and separate source/PR submissions. No speech or hardware result claimed. |
| System ROM (monitor / DOS shell / FAT32) | Shipped | `badger6502.bin`; boots to monitor. |
| Microsoft BASIC | Shipped | `$9000–$BFFF`; not Applesoft (known gap). |
| Font ROM | Shipped | `fontrom.dat`. |
| Disk II boot PROM | Shipped | `$C600`; boots self-booting WOZ images. |
| Archon disk-only compatibility adapter | Experimental / emulator-verified | Exact-image patcher; actual disk boot, options, keyboard and two-pad board/combat input, runtime mismatch guards, and native PS/2/LED/register/bank checks. Physical board and full-playthrough approval remain open; see the porting log. |
| Ultima V SD-card port | Experimental / emulator-verified | `codegen/tools/port-ultima5.test.mjs` drives the real loader/resident/shim on the ROM DOS with synthetic volumes (and boots the original disks to the title with `U5_DISKS`); `port-ultima5.native.ps1` decodes real PS/2 frames at 94-160-cycle periods with language-card RAM mapped, including Caps Lock LED exchanges and a `$C010` strobe on a stop-bit edge. The suite also plays a synthetic two-region song end to end (on-demand `SONG01` load, timer-IRQ ticks in bank 2, pause/load/resume, reload after a block read), tests the song packer (phrase subroutines, two-region layout, replay check) and the stale-folder check, and checks the 46 music-site patches; a session-only py65 harness matched the player to the reverse-engineered driver per tick for all 15 songs. Manual WASM play covered creation, save, overworld, combat, towne entry, pad-only menu/walking/Ztats, and music (title theme at the title, huts song on *Journey Onward*, on-demand song switches). Board: running after the PS/2 fix; pads and music not yet tried on the board. Dialogue, dungeons and endgame are open; block reads cost ~1.7 M cycles. |
| Seven Cities of Gold SD-card port | Experimental / emulator-verified | `codegen/tools/port-sevencities.test.mjs` runs the real loader, resident and both shim copies on the ROM DOS/SD emulation with synthetic disks at 512-byte and 4 KB clusters, plus missing/fragmented/ROM refusals (`SEVENCITIES_DISKS` adds an original-disk boot to the title); `port-ultima5.native.ps1 -Resident codegen\patches\sevencities\resident.s` passes the native PS/2 checks. Scripted WASM play: menus, sailing, landing, natives; World Maker created a world that then played. A save at the Pub, resume, and the physical board are open; requires contiguous files and the current ROM's SD routines. |
| Ultima I SD-card port | Experimental / emulator-verified | `codegen/tools/port-ultima1.test.mjs` drives the real loader and ProDOS stand-in through the ROM DOS with synthetic files (file info, open/read with marks and EOF, write/read-back, every error path, registers, zero page, NMI) and the SNES pad glue (all 12 buttons, both controllers, one key per press with overlapping buttons, D-pad repeat gated on the game's buffer, keyboard priority including a key decoded mid-scan); `codegen/tools/port-ultima1.native.ps1` clocks real PS/2 frames (94/120/160-cycle bits, Caps Lock LED exchange) while the glue scans, with hundreds of keyboard NMIs landing inside scans, and fails the earlier `PTRIG` version; with `U1_DISK` it plays the original disk through intro, character creation and save, continue, quick-save and Lord British's castle (entered with the pad's B) and checks the stand-in and pad glue stayed intact. Manual WASM play also covered a town, overworld combat and the Dungeon of Doubt (entered and walked with the pad). Space flight, the time machine and the endgame are unverified; the owner's first SD-card run loaded the game and went through character creation (saving, play and the pads not yet confirmed outside the emulator); ROM DOS command failures are not detected (card contents trusted); loads cost ~0.45 s/KB. |
| Ultima II SD-card port | Experimental / emulator-verified | `codegen/tools/port-ultima2.test.mjs` drives the real loader and DOS 3.3 translator on the ROM DOS with synthetic disks (BLOAD/BRUN/BSAVE, folder switches, exact lengths, register preservation, fail-loud errors); with `U2_DISKS` it plays the original disks through title, character creation and save, the overworld and both patched space disk swaps, plus a D-pad move; SNES pads are covered on the emulated pads with the resident clocking VIA1 port B directly (12-button map on both pads, D-pad repeat after 10 ticks then every 4, pending keys kept, A/X/Y/flags preserved, 30 Hz at 2.1% CPU with no scan or paddle-timer NMIs, IRQs masked during ROM DOS commands, timer off at every error stop). Manual WASM play also covered movement, Z-stats, quit-save, dungeon entry, reloading a saved character and the demo slideshow. No physical-board trial yet; towns/dialogue, combat depth, space flight and the endgame were not played through; the game runs ~1.54x faster than on a 1.02 MHz Apple II. Known issue (shipped by owner decision): `OWRITE` gets the file length, so 4 KB map saves write one extra SD sector; saves need 512-byte clusters. |
| Ultima III SD-card port | Experimental / emulator-verified | `codegen/tools/port-ultima3.test.mjs` reconstructs a synthetic boot image and drives the real loader/RWTS shim on the ROM DOS (whole-file loads, zero-page load, write and read-back, IOB/flag state); with `U3_DISKS` it plays the original disks through Mockingboard set-up, title, character creation, party, world, Lord British's castle, a dungeon and an autosave resume after reset, and checks the 61.5 Hz music IRQ; the gamepad tick is checked synthetically (buttons type keys, held directions repeat) and SNES Up walks the real party north. Talking, shops, Moongates, the endgame and the physical board (including pad scans alongside PS/2 typing) are open; ROM DOS command failures are not detected (card contents trusted); loads run ~2 KB/s in the emulator (boot ~30 s). |
| Wizardry I SD-card port | Experimental / emulator-verified | `codegen/tools/port-wizardry1.test.mjs` drives the real loader/resident/shim on the ROM DOS with a synthetic volume on 1-, 8-(fragmented) and 64-sector-cluster cards (reads, writes, errors 8/9/16, NMIs and bank restore, loader refusals), and with `WIZ1_DISKS` plays the original disks from `BRUN` to the training grounds; `port-wizardry1.native.ps1` passes the native PS/2 harness. Manual WASM play reached the tavern (roster write) and the maze. No board trial; combat, deeper levels and a reload after reboot are unverified. Depends on fingerprinted ROM SD/FAT32 internals. |
| M.U.L.E. (Atari 8-bit) SD-card port | Experimental / emulator-verified | `codegen/tools/port-mule.mjs` runs the owner's Atari intro and main game natively. The intro (title, options, controllers, colour and species) runs live on the 3RIC (its logo appears at once, any key passes the title) with a small Atari-OS layer (`intro.s`: boot, OS VBI with shadow registers, the `$E450` jump table, elapsed-time versions of its RTCLOK-equality waits) and a renderer built for hi-res page 2; its warm start returns to the loader (`snap_take`/`intro_done` save and restore the ROM DOS or Disk II boot state), which stashes the configuration and loads the main game. In the main game: its `$2000-$3FFF` block moved to LC `$E000` (325 absolute and 80 pointer relocations from static disassembly and pointer-provenance tracing, plus the music player's 4 pointer compares), hardware stores into an LC-bank-2 register file, 65 hardware reads patched to a runtime (`rt.s`: 60 Hz Mockingboard-VIA VBI, SNES pads or `$C000` keys (W/A/S/D latch, Space fire, Return/1, Tab/2, 3 = START/SELECT/OPTION) as sticks/console keys, POKEY to both AYs including distortion-C pitch and a log volume map, VCOUNT from a phase-locked VIA timer, RTCLOK-equality waits made elapsed-time waits, the game's VBI gated by NMIEN), the display list re-rendered to hi-res page 1 with the game's DLI handlers (`render.s`, LC bank 1; modes 2/4-8/D; nothing written for an unchanged frame; a band whose contents or sprites changed is redrawn with players and missiles composited row by row (no sprite records); sprites in colour cells, double/quad players, missiles and the fifth player, per-band missile positions and widths kept in hi-res screen holes; the map's river drawn blue; colours hashed as the hi-res colours they become; the render gap at least as long as the last render), a clean-room Atari-format FP package (`fp.s`) and an original font. `codegen/tools/port-mule.test.mjs` checks FP against a decimal reference and the layouts; with `MULE_ATR` it asserts no hardware read or JSR/JMP into the moved block is left unpatched, boots the original disk on the WASM 3RIC, plays the intro on the pads (two players, colours and species chosen there, the species grid drawn), reaches the status summary and land grant, checks the summary music's POKEY-to-AY mapping and the keyboard, plays on through the development and production rounds, and boots `MULE.WOZ` through the same intro into the game. The board's PS/2 keyboard, playfield collisions, multicolour players and background colours are not modelled; later rounds, sound by ear and the physical board are unverified; see [`docs/porting-logs/mule.md`](../docs/porting-logs/mule.md). |
| ROM `BLOAD` stores one byte past EOF | Known gap (ROM) | Observed in `fat32_file_read`; programs loading below live data must use `FLOAD 0000 eof-1`. ROM source is not in this repository. |
| Adventure disk-only compatibility adapter | Experimental / emulator-verified | Exact-image `.dsk`/`.woz` patcher (`patch-adventure.mjs`); relocates MSBASIC to LC `$D000-$F0FF`, patches DOS 3.3 + `CHAIN` + Applesoft dialect + KIM-1 `FMULT` `ROR RESULT+2` bug (`$E5C7`), retokenizes `ADVENTURE` and `ADVENTURE^Q PART TWO`, and boots through `CHAIN` into full above-ground and underground gameplay. Physical board confirmation and Disk II write support for `SAVE` remain open; see [`docs/porting-logs/adventure.md`](../docs/porting-logs/adventure.md). |
| 6502 program library | Ongoing | `codegen/programs/`, `emulator/AICodeGen/` (games/demos). |
| Bouncing Ball | Implemented / cycle-guarded | 5,376-byte standalone image; 419,704 mean / 438,580 worst cycles over 128 pixel-identical frames, an 11.47x mean speedup over PR #58 and 14% faster than the first optimized version. `codegen/tools/bouncing-ball.test.mjs` covers motion/page history, all signed-byte products, 4,096 independent angle pairs, 512 independent complete rasters, every restore alignment, extreme positions, memory boundaries, keyboard exit, and ROM WOZ boot. |
| 3RIC Groovebox | Shipped | Six-voice, 16-step Mockingboard sequencer; gamepad/keyboard editing and timer-driven stereo sound. `codegen/tools/groovebox.test.mjs` covers real stereo PCM, all controls, fractional tempo, clean exit, and a dense-step/input deadline below 6,556 cycles. |
| Built from Bits | Implemented | 3,460-byte four-scene showcase with rendering, 63,000-cycle cadence, audio, controls, and WOZ boot coverage. ROM window bounds are preserved; Q/Esc from every scene must leave a visible prompt that can execute and display a subsequent monitor command. |
| Matrix Rain | Shipped | `codegen/programs/matrix.s`; 1,079-byte `$0800` hi-res demo with staggered green trails, white heads, pause/quit controls, and focused rendering, timing, memory-boundary, and monitor-exit coverage in `codegen/tools/matrix.test.mjs`. |
| ROCK STORM vector game | Shipped / cycle-guarded | Opening-wave live frame is 133,262 cycles against a 175,000-cycle limit; both distributed `.prg` copies are generated from `rocks.s`. |
| SNES gamepad input | Shipped | ROM fills `GAMEPAD1/2` on a `$C070` touch; the shared emulator peripheral follows the same VIA serial protocol, and the browser maps two standard USB/Bluetooth controllers into it. |
| Jungle Quest — The Sunstone Run | Shipped | Six-screen `$0800` mixed-hi-res platformer; focused suite includes a complete successful expedition. |
| STAR DUEL | Shipped | Two-player `$0800` mixed-hi-res gravity duel; SNES pads + keyboard; `codegen/tools/spacewar.test.mjs` covers gravity, wrap, shots, collisions, and dual-pad input. |
| SUNSLING | Implemented | Separate original `$0800` two-player gravity duel. Current-ROM scan compensation preserves the strict 200-cycle cadence tolerance; idle/one-pad/two-pad/release coverage and the full-load/900-frame regression pass (worst work 49,833, period 52,536 cycles). `codegen/tools/sunsling.test.mjs` also exercises real-VM physics, both control paths, XOR rendering, simultaneous scoring, monitor restoration, and exported WOZ boot. |
| PULSAR DUEL | Shipped | Independent two-player `$0800` mixed-hi-res orbital duel, 5,632 bytes ending `$1E00`; 256×160 logical field, octagonal-norm inverse-square gravity via an `r^-3` force table, pilots spawn in a stable r=48 orbit, torpedoes curve; live frame measures ~8,600 cycles against the 26,224-cycle budget; `codegen/tools/pulsar.test.mjs` covers 66 checks including 240 frames of orbit stability and draw/erase round-tripping. |
