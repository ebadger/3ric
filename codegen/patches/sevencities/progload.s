; Seven Cities of Gold for 3RIC - "insert the program disk" around a load.
;
; Only three loads read the program disk once the game is running: the two
; language-card loads in the game's start-up code and the World Maker load.
; The converter points those JSR $76BD (the game's sector-run loader: A
; sectors from track X, sector Y) here; every other read finds the map disk,
; as it did after the player swapped disks. Appended after the game's shim.
;
; prog_load puts the map disk back afterwards. prog_stay leaves the program
; disk in the drive: the World Maker reads more of its data from it and only
; asks for a blank disk later; its format (see shim.s) selects the map disk.

RUN_LOAD    = $76BD

prog_load:                      ; no caller uses A or flags from $76BD
        stz PORT_DISK
        jsr RUN_LOAD
        lda #1
        sta PORT_DISK
        rts

prog_stay:
        stz PORT_DISK
        jmp RUN_LOAD