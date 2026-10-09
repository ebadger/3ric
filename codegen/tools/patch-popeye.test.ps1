param(
    [Parameter(Mandatory = $true)][string]$InputDisk
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$inputImage = (Resolve-Path -LiteralPath $InputDisk).Path
$out = Join-Path $root 'codegen\out\popeye-native'
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
$sources += Join-Path $PSScriptRoot 'patch-popeye.native.cpp'
$exe = Join-Path $out 'popeye-test.exe'
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
$env:POPEYE_TEST_INPUT = $inputImage
$env:POPEYE_TEST_OUTPUT = Join-Path $out ('popeye-' + [guid]::NewGuid().ToString() + '.woz')
$env:POPEYE_TEST_ROOT = $root
try {
    $metadata = @'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.POPEYE_TEST_ROOT;
const { patchPopeye } = await import(pathToFileURL(path.join(root, "codegen", "tools", "patch-popeye.mjs")));
const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
const result = patchPopeye(fs.readFileSync(process.env.POPEYE_TEST_INPUT), rom);
fs.writeFileSync(process.env.POPEYE_TEST_OUTPUT, result.woz, { flag: "wx" });
const s = result.payload.symbols;
console.log(JSON.stringify([s.TITLE_WAIT, s.GAME_CALL, s.GAME_EVENT, s.READ_FIRE,
    s.INPUT_READY, s.LEVEL, s.KEY_X, s.KEY_FIRE].map(n => n.toString(16))));
'@ | node --input-type=module -
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate the native test image' }
    $symbols = $metadata | ConvertFrom-Json
    foreach ($period in @(120, 160)) {
        & $exe (Join-Path $root 'emulator\Data\badger6502.bin') $env:POPEYE_TEST_OUTPUT $period @symbols
        if ($LASTEXITCODE -ne 0) { throw "Native PS/2 case $period/80 failed ($LASTEXITCODE)" }
    }
} finally {
    if (Test-Path -LiteralPath $env:POPEYE_TEST_OUTPUT) {
        Remove-Item -LiteralPath $env:POPEYE_TEST_OUTPUT
    }
}
