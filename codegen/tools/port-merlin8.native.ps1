# Native PS/2 timing test for the Merlin-8 resident (no Merlin data needed).
#   pwsh codegen\tools\port-merlin8.native.ps1
# Builds the shared VM sources with MSVC and reuses the Ultima V harness
# (port-ultima5.native.cpp: real PS/2 frames at 94/120/160-cycle bit periods,
# Caps Lock LED exchange, $C010 strobe on a stop bit, every NMI checked for
# registers, flags, language-card bank and BASIC overlay). The program keeps
# Merlin's two modes - bank 2 read-only and bank 1 read/write - and swaps
# them between keys, checking each time that writes are still off or on.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$out = Join-Path $root 'codegen\out\merlin8-native'
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
$exe = Join-Path $out 'merlin8-native.exe'
$arguments = @(
    '/nologo', '/std:c++17', '/EHsc', '/O2', '/W0', '/DPLATFORM_WINDOWS',
    '/D_CRT_SECURE_NO_WARNINGS', '/DUNICODE', '/D_UNICODE',
    ('/I' + $lib), ('/I' + $woz), ('/I' + $sd), ('/Fe:' + $exe)
) + $sources
$quoted = ($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'
& $env:ComSpec /c ('call "' + $vcvars + '" >nul && cd /d "' + $out + '" && cl ' + $quoted + ' >build.log')
if ($LASTEXITCODE -ne 0) { Get-Content (Join-Path $out 'build.log') | Select-Object -Last 20; throw "Native build failed ($LASTEXITCODE)" }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Users\ebadger\emsdk\node\22.16.0_64bit\bin\node.exe' }
$env:M8_NATIVE_OUT = $out
$env:M8_NATIVE_ROOT = $root
$entry = @'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.M8_NATIVE_ROOT, out = process.env.M8_NATIVE_OUT;
const { assemble } = await import(pathToFileURL(path.join(root, "codegen", "tools", "asm6502.mjs")));
const { buildLoader } = await import(pathToFileURL(path.join(root, "codegen", "tools", "port-merlin8.mjs")));
const resident = buildLoader().resident;
fs.writeFileSync(path.join(out, "resident.bin"), resident.bytes);
const s = resident.symbols;
const program = assemble(`
        .org $0800
        stz $CAFE
        bit $C007               ; BASIC overlay off, as Merlin runs
        lda $C089               ; read ROM, write bank 1 + high RAM
        lda $C089
        lda #$05                ; bank 1: no bit 6 at $DFFF
        sta $DFFF
        lda #$B1
        sta $D000
        lda #<$${s.NMI_ENTRY.toString(16)}
        sta $FFFA
        lda #>$${s.NMI_ENTRY.toString(16)}
        sta $FFFB
        lda $FFFE
        sta $FFFE
        lda $FFFF
        sta $FFFF
        lda $C081               ; read ROM, write bank 2
        lda $C081
        lda #$60                ; bank 2: Merlin's RTS at $DFFF
        sta $DFFF
        lda #$B2
        sta $D000
        lda $C080               ; bank 2 read-only, like Merlin's editor
        ldx #0
        ldy #$77                ; Y must survive every NMI
        lda #1
        sta $03FD
wait:   lda $C000
        bpl wait
        sta $0300,x
        bit $C010
        inx
        cpx #7
        beq idle                ; stop polling: the stop-bit strobe check follows
        txa
        and #1
        beq use2
        lda $C08B               ; bank 1 read/write
        lda $C08B
        lda $D000
        cmp #$B1
        bne fail
        inc $D000               ; writes on
        lda $D000
        cmp #$B2
        bne fail
        dec $D000
        bra wait
use2:   lda $C080               ; bank 2 read-only
        lda $D000
        cmp #$B2
        bne fail
        inc $D000               ; writes off
        lda $D000
        cmp #$B2
        bne fail
        bra wait
fail:   lda #$EE
        sta $03FE
        jmp fail
idle:   ldy #$77
        lda $C08B
        lda $C08B
idle2:  bra idle2
`);
fs.writeFileSync(path.join(out, "program.bin"), program.bytes);
console.log(s.NMI_ENTRY.toString(16));
'@ | & $node --input-type=module -
if ($LASTEXITCODE -ne 0) { throw 'Could not assemble the resident/test program' }
$failed = 0
foreach ($period in @(94, 120, 160)) {
    # At 94-cycle bits the next frame's first edges can land while the ROM is
    # selected for a forwarded stop bit; the ROM serves those directly, so fewer
    # NMIs pass through the resident than the harness's default 200.
    & $exe (Join-Path $root 'emulator\Data\badger6502.bin') (Join-Path $out 'resident.bin') (Join-Path $out 'program.bin') $entry.Trim() $period 80 150
    if ($LASTEXITCODE -ne 0) { $failed++ }
}
if ($failed) { throw "$failed native PS/2 timing case(s) failed" }
