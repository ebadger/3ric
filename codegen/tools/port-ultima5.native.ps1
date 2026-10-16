# Native PS/2 timing test for the Ultima V resident (no game data needed).
#   pwsh codegen\tools\port-ultima5.native.ps1
# Builds the shared VM sources with MSVC, then types ULTIMA5 as real PS/2
# frames while a program keeps language-card RAM mapped and swaps banks.
param([string]$Resident)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$out = Join-Path $root 'codegen\out\ultima5-native'
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
$exe = Join-Path $out 'u5-native.exe'
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
$env:U5_NATIVE_OUT = $out
$env:U5_NATIVE_ROOT = $root
$env:U5_NATIVE_RESIDENT = $Resident
$entry = @'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.U5_NATIVE_ROOT, out = process.env.U5_NATIVE_OUT;
const { assemble } = await import(pathToFileURL(path.join(root, "codegen", "tools", "asm6502.mjs")));
const { buildLoader, BANKSIG_VALUE } = await import(pathToFileURL(path.join(root, "codegen", "tools", "port-ultima5.mjs")));
let resident;
if (process.env.U5_NATIVE_RESIDENT) {
  resident = assemble(`BANKSIG_VALUE = $${BANKSIG_VALUE.toString(16)}\n` + fs.readFileSync(process.env.U5_NATIVE_RESIDENT, "utf8"));
} else {
  resident = buildLoader([{ key: "STARTUP", aux: 0x8000, eof: 1, volmask: 1 }]).resident;
}
fs.writeFileSync(path.join(out, "resident.bin"), resident.bytes);
const s = resident.symbols;
const program = assemble(`
        .org $0800
        stz $CAFE
        bit $C007               ; BASIC overlay off, as the game runs
        lda $C089               ; read ROM, write bank 1 + high RAM
        lda $C089
        lda #$${BANKSIG_VALUE.toString(16)}
        sta $DFFF
        lda #$4C
        sta $D000
        lda #<$${s.NMI_ENTRY.toString(16)}
        sta $FFFA
        lda #>$${s.NMI_ENTRY.toString(16)}
        sta $FFFB
        lda #<$${s.IRQ_ENTRY.toString(16)}
        sta $FFFE
        lda #>$${s.IRQ_ENTRY.toString(16)}
        sta $FFFF
        lda $C081               ; read ROM, write bank 2
        lda $C081
        lda #$00
        sta $DFFF
        lda #$5A
        sta $D000
        lda $C083               ; bank 2 read/write, like Ultima V
        lda $C083
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
        lda $C08B
        lda $C08B
        lda $D000
        cmp #$4C
        bne fail
        bra wait
use2:   lda $C083
        lda $C083
        lda $D000
        cmp #$5A
        bne fail
        bra wait
fail:   lda #$EE
        sta $03FE
        jmp fail
idle:   ldy #$77
        bra idle
`);
fs.writeFileSync(path.join(out, "program.bin"), program.bytes);
console.log(s.NMI_ENTRY.toString(16));
'@ | & $node --input-type=module -
if ($LASTEXITCODE -ne 0) { throw 'Could not assemble the resident/test program' }
$failed = 0
foreach ($period in @(94, 120, 160)) {
    & $exe (Join-Path $root 'emulator\Data\badger6502.bin') (Join-Path $out 'resident.bin') (Join-Path $out 'program.bin') $entry.Trim() $period 80
    if ($LASTEXITCODE -ne 0) { $failed++ }
}
if ($failed) { throw "$failed native PS/2 timing case(s) failed" }
