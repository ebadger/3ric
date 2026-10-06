param(
    [Parameter(Mandatory = $true)][string]$InputDisk
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$inputImage = (Resolve-Path -LiteralPath $InputDisk).Path
$out = Join-Path $root 'codegen\out\castle-wolfenstein-native'
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
$sources += Join-Path $PSScriptRoot 'patch-castle-wolfenstein.native.cpp'
$exe = Join-Path $out 'wolf-native-test.exe'
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
$testImage = Join-Path $out ('wolf-' + [guid]::NewGuid().ToString() + '.woz')
try {
    & node (Join-Path $PSScriptRoot 'patch-castle-wolfenstein.mjs') $inputImage $testImage
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate the native test image' }
    $metadata = & node --input-type=module -e 'import fs from "node:fs"; import {pathToFileURL} from "node:url"; const {detectCastleProfile,buildControllerPayload} = await import(pathToFileURL(process.argv[2])); const p=detectCastleProfile(fs.readFileSync(process.argv[3])); console.log(JSON.stringify({profile:p.id,pad:buildControllerPayload(p).resident.symbols.PAD.toString(16)}));' wolf-profile-probe (Join-Path $PSScriptRoot 'patch-castle-wolfenstein.mjs') $inputImage
    if ($LASTEXITCODE -ne 0) { throw 'Could not identify the native test profile' }
    $metadata = $metadata | ConvertFrom-Json
    & $exe (Join-Path $root 'emulator\Data\badger6502.bin') $testImage $metadata.profile $metadata.pad
    if ($LASTEXITCODE -ne 0) { throw "Native keyboard check failed ($LASTEXITCODE)" }
} finally {
    if (Test-Path -LiteralPath $testImage) {
        Remove-Item -LiteralPath $testImage
    }
}
