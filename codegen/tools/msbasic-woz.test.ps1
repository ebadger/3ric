# msbasic-woz.test.ps1 — native PS/2 check for the MS-BASIC boot disk (Windows + MSVC).
# Builds msbasic-woz.native.cpp against the shared VM sources, writes a disk with
# msbasic-woz.mjs, then types through the ROM's PS/2 decoder at several bit periods,
# picodisk READY-stall lengths and Enter-release times. See specs/ROM-SOFTWARE.md.
param(
    [string]$Node = 'node'
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$out = Join-Path $root 'codegen\out\msbasic-native'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$lib = Join-Path $root 'emulator\Badger6502VMLib'
$wozLib = Join-Path $root 'emulator\WozLib'
$sd = Join-Path $root 'emulator\MockMicroSD'
$rom = Join-Path $root 'emulator\Data\badger6502.bin'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $vs) { throw 'Visual C++ build tools not found' }
$sources = @(
    'vm.cpp', 'cpu.cpp', 'Instructions.cpp', 'acia.cpp', 'via.cpp', 'ay38910.cpp',
    'mockingboard.cpp', 'snesgamepads.cpp', 'PS2Keyboard.cpp', 'badgervmpal.cpp', 'symbols.cpp'
) | ForEach-Object { Join-Path $lib $_ }
$sources += @('DriveEmulator.cpp', 'WozDisk.cpp', 'WozFile.cpp') | ForEach-Object { Join-Path $wozLib $_ }
$sources += @('SDCard.cpp', 'MappedFile.cpp') | ForEach-Object { Join-Path $sd $_ }
$sources += Join-Path $PSScriptRoot 'msbasic-woz.native.cpp'
$exe = Join-Path $out 'msbasic-native.exe'
$arguments = @(
    '/nologo', '/std:c++17', '/EHsc', '/O2', '/W0', '/DPLATFORM_WINDOWS',
    '/D_CRT_SECURE_NO_WARNINGS', '/DUNICODE', '/D_UNICODE',
    ('/I' + $lib), ('/I' + $wozLib), ('/I' + $sd), ('/Fe:' + $exe)
) + $sources
$quoted = ($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
$env:PATH = (Split-Path $vswhere) + ';' + $env:PATH
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'
& $env:ComSpec /c ('call "' + $vcvars + '" >nul && cd /d "' + $out + '" && cl ' + $quoted + ' >nul')
if ($LASTEXITCODE -ne 0) { throw "Native build failed ($LASTEXITCODE)" }

$woz = Join-Path $out ('basic-' + [guid]::NewGuid().ToString() + '.woz')
try {
    & $Node (Join-Path $PSScriptRoot 'msbasic-woz.mjs') $woz --rom $rom | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate the MS-BASIC disk' }
    $hold = 80
    foreach ($period in @(94, 120, 160)) {
        foreach ($stall in @(0, 60, 90)) {
            foreach ($release in @(150000, 2500000)) {
                & $exe $rom $woz $period $hold $stall $release
                if ($LASTEXITCODE -ne 0) { throw "Native PS/2 case $period/$hold/$stall/$release failed" }
            }
        }
    }
    Write-Output 'PASS PS/2 typing, Shift+= as +, reaches disk BASIC across bit periods, READY stalls and mid-boot releases'
} finally {
    if (Test-Path -LiteralPath $woz) { Remove-Item -LiteralPath $woz }
}
