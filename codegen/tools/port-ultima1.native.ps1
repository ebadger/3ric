# Native PS/2 timing test for the Ultima I SNES pad glue (no game data needed).
#   pwsh codegen\tools\port-ultima1.native.ps1 [-Pad <pad.s>]
# Builds the shared VM sources with MSVC, then types real PS/2 frames (with a
# Caps Lock LED exchange) while a loop polls the pad glue like STUPH does, so
# pad scans overlap the frames. -Pad assembles another pad.s for comparison.
param([string]$Pad)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$out = Join-Path $root 'codegen\out\ultima1-native'
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
$sources += Join-Path $PSScriptRoot 'port-ultima1.native.cpp'
$exe = Join-Path $out 'u1-native.exe'
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
$env:U1_NATIVE_OUT = $out
$env:U1_NATIVE_ROOT = $root
$env:U1_NATIVE_PAD = $Pad
@'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.U1_NATIVE_ROOT, out = process.env.U1_NATIVE_OUT;
const { assemble } = await import(pathToFileURL(path.join(root, "codegen", "tools", "asm6502.mjs")));
const { buildLoader, PAD_DELAYS } = await import(pathToFileURL(path.join(root, "codegen", "tools", "port-ultima1.mjs")));
const pad = process.env.U1_NATIVE_PAD
  ? assemble(`FIRST_DELAY = ${PAD_DELAYS.first}\nREPEAT_DELAY = ${PAD_DELAYS.repeat}\n` + fs.readFileSync(process.env.U1_NATIVE_PAD, "utf8"))
  : buildLoader([{ name: "X", type: 6, aux: 0, eof: 1 }]).pad;
fs.writeFileSync(path.join(out, "pad.bin"), pad.bytes);
// The glue's own scan; a glue without one (e.g. a PTRIG version) is measured on the ROM routine.
fs.writeFileSync(path.join(out, "scan.txt"), [pad.symbols.SCAN ?? 0xb99b, pad.symbols.SCAN_RET ?? 0xba41].map((a) => a.toString(16)).join(" "));
const program = assemble(`
        .org $0800
        stz $CAFE               ; as the loader leaves the machine
        bit $C007
        lda #$60
        sta $C20E
        stz $CE15
        stz $78
        ldx #0
        lda #1
        sta $03FD
loop:   jsr $0300               ; STUPH $1D64, patched
        bpl loop
        sta $0400,x
        bit $C010
        inx
        bra loop
`);
fs.writeFileSync(path.join(out, "program.bin"), program.bytes);
'@ | & $node --input-type=module -
if ($LASTEXITCODE -ne 0) { throw 'Could not assemble the pad glue/test program' }
$scan = (Get-Content (Join-Path $out 'scan.txt')).Trim() -split ' '
$failed = 0
foreach ($period in @(94, 120, 160)) {
    & $exe (Join-Path $root 'emulator\Data\badger6502.bin') (Join-Path $out 'pad.bin') (Join-Path $out 'program.bin') $period 80 $scan[0] $scan[1]
    if ($LASTEXITCODE -ne 0) { $failed++ }
}
if ($failed) { throw "$failed native PS/2 timing case(s) failed" }
