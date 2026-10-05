param(
    [Parameter(Mandatory = $true)][string]$InputWoz
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$inputImage = (Resolve-Path -LiteralPath $InputWoz).Path
$out = Join-Path $root 'codegen\out\archon-native'
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
$sources += Join-Path $PSScriptRoot 'patch-archon.native.cpp'
$exe = Join-Path $out 'archon-test.exe'
$arguments = @(
    '/nologo', '/std:c++17', '/EHsc', '/O2', '/W0', '/DPLATFORM_WINDOWS',
    '/D_CRT_SECURE_NO_WARNINGS', '/DUNICODE', '/D_UNICODE',
    ('/I' + $lib), ('/I' + $woz), ('/I' + $sd), ('/Fe:' + $exe)
) + $sources
$quoted = ($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
$env:PATH = (Split-Path $vswhere) + ';' + $env:PATH
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'
& $env:ComSpec /c ('call "' + $vcvars + '" >nul && cd /d "' + $out + '" && cl ' + $quoted)
if ($LASTEXITCODE -ne 0) { throw "Native build failed ($LASTEXITCODE)" }
$env:ARCHON_TEST_INPUT = $inputImage
$env:ARCHON_TEST_OUTPUT = Join-Path $out ('archon-' + [guid]::NewGuid().ToString() + '.woz')
$env:ARCHON_TEST_ROOT = $root
try {
    $metadata = @'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.ARCHON_TEST_ROOT;
const { patchArchon } = await import(pathToFileURL(path.join(root, "codegen", "tools", "patch-archon.mjs")));
const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
const result = patchArchon(fs.readFileSync(process.env.ARCHON_TEST_INPUT), rom);
fs.writeFileSync(process.env.ARCHON_TEST_OUTPUT, result.woz, { flag: "wx" });
const s = result.payload.resident.symbols;
console.log(JSON.stringify([s.NMI_RETURN, s.STATE_PENDING, s.MENU_PAD, s.GAME_PAD, s.GAME_PAD_DONE].map(n => n.toString(16))));
'@ | node --input-type=module -
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate the native test image' }
    $symbols = $metadata | ConvertFrom-Json
    foreach ($period in @(94, 120, 160)) {
        & $exe (Join-Path $root 'emulator\Data\badger6502.bin') $env:ARCHON_TEST_OUTPUT $period 80 @symbols
        if ($LASTEXITCODE -ne 0) { throw "Native input case $period/80 failed ($LASTEXITCODE)" }
    }
} finally {
    if (Test-Path -LiteralPath $env:ARCHON_TEST_OUTPUT) {
        Remove-Item -LiteralPath $env:ARCHON_TEST_OUTPUT
    }
}
