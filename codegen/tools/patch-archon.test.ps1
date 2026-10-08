param(
    [Parameter(Mandatory = $true)][string]$InputWoz
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$inputImage = (Resolve-Path -LiteralPath $InputWoz).Path
$out = Join-Path $root 'codegen\out\archon-native'
$exe = & (Join-Path $PSScriptRoot 'build-port-test.ps1') -Name archon
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
