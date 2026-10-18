; Ultima V for 3RIC - RAM2 ($C800-$CFFF) layout shared by resident.s,
; glue.s, shim.s and music.s (port-ultima5.mjs prepends this file).
;
;   $C800-$C9FF  ROM FAT32 sector buffer
;   $CA00-$CAFD  music player state (below)
;   $CAFE        ROM banking mode
;   $CB00-$CD7F  ROM keyboard state, DOS command line and parameters
;   $CD80-$CDFF  glue.s: game-side music interface
;   $CE00-$CE23  ROM keyboard / mouse state
;   $CEE0-$CEFF  ROM gamepad state
;   $CF00-$CFFF  resident.s

NV          = 6                 ; voices: two AY-3-8910s, three channels each
MS          = $CA00
V_PTRL      = MS+0           ; event stream pointer
V_PTRH      = MS+6
V_DUR       = MS+12           ; ticks left of the current note / rest
V_DONE      = MS+18           ; $FF = voice ended
V_DURA      = MS+24           ; duration index A / B
V_DURB      = MS+30
V_TRANS     = MS+36           ; transpose
V_PITCH     = MS+42           ; current pitch (relative steps add to it)
V_INST      = MS+48           ; instrument record offset in INSTAB
V_LAST      = MS+54           ; last note byte (bit 7 = tie)
V_LEVEL     = MS+60          ; level (high nibble)
V_DEPTH     = MS+66          ; calls in progress (0-3)
V_VST       = MS+72          ; volume envelope stage 0 idle 1 A 2 D 3 S 4 R
V_VENL      = MS+78          ; volume envelope (16 bits)
V_VENH      = MS+84
V_PST       = MS+90          ; pitch envelope: same layout 3*NV later
V_PENL      = MS+96
V_PENH      = MS+102
STKL        = MS+108          ; return addresses: level d of voice x at d*NV+x
STKH        = MS+126          ; (3 levels)
SHADOW      = MS+144          ; R0-R10 of AY0, then of AY1 (22 bytes)
WRITTEN     = SHADOW+22         ; last value written to each register
IF80        = WRITTEN+22        ; the driver's zero page $80-$83 (see glue.s)
GSAVE       = IF80+4            ; game's $80-$83 while the interface is mapped
CURVOL      = GSAVE+4           ; ramped master volume
LATCHL      = CURVOL+1          ; T1 latch for the next tick
LATCHH      = CURVOL+2
NPLAY       = CURVOL+3          ; voices in the current song
CUR         = CURVOL+4          ; song being played from SONGBUF (0 = none)
LOADED      = CURVOL+5          ; song held in SONGBUF (0 = none)
WANT        = CURVOL+6          ; song for the foreground to load (0 = none)
SAVE83      = CURVOL+7          ; volume saved by pause
SWAPPED     = CURVOL+8          ; nonzero while $80-$83 hold the interface
MUS_IER     = CURVOL+9          ; IER value outside ROM sessions ($C0 on, $40 off)
ALLDONE     = CURVOL+10
EVB         = CURVOL+11         ; event byte being parsed
VT_T        = CURVOL+12         ; volume multiply scratch
VT_B        = CURVOL+13
ZPSAVE      = CURVOL+14         ; $F8-$FB around a tick (4 bytes)
ASONG       = ZPSAVE+4          ; song whose second part is in the block buffer
MS_END      = ASONG+1           ; must stay below $CAFE

MB          = $C400             ; Mockingboard VIA (AY0); AY1 at $C480
MB_ORB      = MB+0
MB_ORA      = MB+1
MB_DDRB     = MB+2
MB_DDRA     = MB+3
MB_T1CL     = MB+4
MB_T1LL     = MB+6
MB_T1LH     = MB+7
MB_ACR      = MB+11
MB_IFR      = MB+13
MB_IER      = MB+14
