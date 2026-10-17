# Native PS/2 timing test for the Flight Simulator II resident (no game data needed).
#   pwsh codegen\tools\patch-fs2.native.ps1
# Builds the shared VM sources with MSVC and the generic harness in
# port-ultima5.native.cpp, then types ULTIMA5 as real PS/2 frames (bit periods
# 94/120/160 cycles, DATA held 80) while a program keeps language-card RAM
# mapped and swaps bank 1/bank 2 continuously the way FS2's $F8B0/$F8BC helpers
# do: record the bank in $0E43, then select it with two reads. An NMI that
# resumes on the first selecting read may return with exactly the recorded bank
# already mapped (each such window must be hit); everywhere else the bank must be
# unchanged. The program also starts with a stale $0E43 = 1 that lc_on must
# clear, and checks language-card writes still work after NMIs, including in an
# idle loop that never reselects the bank.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$out = Join-Path $root 'codegen\out\fs2-native'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$lib = Join-Path $root 'emulator\Badger6502VMLib'
$woz = Join-Path $root 'emulator\WozLib'
$sd = Join-Path $root 'emulator\MockMicroSD'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $vs) { throw 'Visual C++ build tools not found' }
$sources = @(
    'vm.cpp', 'cpu.cpp', 'Instructions.cpp', 'acia.cpp', 'via.cpp', 'ay38910.cpp',
    'mockingboard.cpp', 'snesgamepads.cpp', 'PS2Keyboard.cpp', 'badgervmpal.cpp', 'symbols.cpp'
) | ForEach-Object { Join-Path $lib $_ }
$sources += @('DriveEmulator.cpp', 'WozDisk.cpp', 'WozFile.cpp') | ForEach-Object { Join-Path $woz $_ }
$sources += @('SDCard.cpp', 'MappedFile.cpp') | ForEach-Object { Join-Path $sd $_ }
$sources += Join-Path $PSScriptRoot 'port-ultima5.native.cpp'
$exe = Join-Path $out 'fs2-native.exe'
$arguments = @(
    '/nologo', '/std:c++17', '/EHsc', '/O2', '/W0', '/DPLATFORM_WINDOWS',
    '/D_CRT_SECURE_NO_WARNINGS', '/DUNICODE', '/D_UNICODE',
    ('/I' + $lib), ('/I' + $woz), ('/I' + $sd), ('/Fe:' + $exe)
) + $sources
$quoted = ($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
$env:PATH = (Split-Path $vswhere) + ';' + $env:PATH
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'
& $env:ComSpec /c ('call "' + $vcvars + '" >nul && cd /d "' + $out + '" && cl ' + $quoted + ' >build.log')
if ($LASTEXITCODE -ne 0) { Get-Content (Join-Path $out 'build.log') | Select-Object -Last 20; throw "Native build failed ($LASTEXITCODE)" }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Users\ebadger\emsdk\node\22.16.0_64bit\bin\node.exe' }
$env:FS2_NATIVE_OUT = $out
$env:FS2_NATIVE_ROOT = $root
$info = @'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.FS2_NATIVE_ROOT, out = process.env.FS2_NATIVE_OUT;
const { assemble } = await import(pathToFileURL(path.join(root, "codegen", "tools", "asm6502.mjs")));
const { buildResident } = await import(pathToFileURL(path.join(root, "codegen", "tools", "patch-fs2.mjs")));
const resident = buildResident();
fs.writeFileSync(path.join(out, "resident.bin"), resident.bytes);
const s = resident.symbols;
const h = v => "$" + v.toString(16);
const program = assemble(`
        .org $0800
        jsr ${h(s.BOOT_INIT)}       ; ROM check, $CAFE = 0, BASIC overlay off
        lda #1
        sta $0E43                   ; stale flag, as after power-on or a bank-1 restart
        jsr ${h(s.LC_ON)}           ; must clear it, set the RAM NMI vector, map bank 2
        lda $0E43
        beq flag_ok
        jmp fail
flag_ok:
        lda #$5A
        sta $D000                   ; bank 2 marker
        lda #$E2                    ; the game's vector setup, as patched
        ldx #$A7
        jsr ${h(s.SET_NMI)}
        lda #1
        sta $0E43
        lda $C08B
        lda $C08B
        lda #$4C
        sta $D000                   ; bank 1 marker
        lsr $0E43
        lda $C083
        lda $C083
        ldx #0
        ldy #$77                    ; Y must survive every NMI
        lda #1
        sta $03FD
wait:   lda #1                      ; FS2 $F8B0: record bank 1, then select it
        sta $0E43
win1:   lda $C08B
win1b:  lda $C08B
        lda $D000
        cmp #$4C
        bne fail
        lsr $0E43                   ; FS2 $F8BC: record bank 2, then select it
win2:   lda $C083
win2b:  lda $C083
        lda $D000
        cmp #$5A
        bne fail
        cpy #$77
        bne fail
        jsr wcheck                  ; bank 2 still writable
        lda $C000
        bpl wait
        sta $0300,x
        sta $C010
        inx
        cpx #7
        bne wait
idle:   ldy #$77                    ; stop polling: the stop-bit strobe check follows
        jsr wcheck                  ; NMIs here return with no reselection after them
        lda $D000
        cmp #$5A
        bne fail
        bra idle
wcheck: lda #$A5                    ; language-card write-enable survived the NMIs
        sta $D002
        cmp $D002
        bne fail
        lda #$5A
        sta $D002
        cmp $D002
        bne fail
        rts
fail:   lda #$EE
        sta $03FE
        jmp fail
`);
fs.writeFileSync(path.join(out, "program.bin"), program.bytes);
const p = program.symbols;
// MemoryReadMapping: 2 = language-card bank 1, 3 = bank 2.
console.log(s.NMI_ENTRY.toString(16) + " " + p.WIN1.toString(16) + ":2," + p.WIN2.toString(16) + ":3");
'@ | & $node --input-type=module -
if ($LASTEXITCODE -ne 0) { throw 'Could not assemble the resident/test program' }
$entry, $windows = $info.Trim().Split(' ')
$failed = 0
foreach ($period in @(94, 120, 160)) {
    & $exe (Join-Path $root 'emulator\Data\badger6502.bin') (Join-Path $out 'resident.bin') (Join-Path $out 'program.bin') $entry $period 80 $windows
    if ($LASTEXITCODE -ne 0) { $failed++ }
}
if ($failed) { throw "$failed native PS/2 timing case(s) failed" }
