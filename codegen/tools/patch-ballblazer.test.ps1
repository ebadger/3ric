param(
    [Parameter(Mandatory = $true)][string]$InputDisk
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$inputImage = (Resolve-Path -LiteralPath $InputDisk).Path
$exe = & (Join-Path $PSScriptRoot 'build-port-test.ps1') -Name ballblazer
$out = Split-Path $exe
$env:BALLBLAZER_TEST_INPUT = $inputImage
$env:BALLBLAZER_TEST_OUTPUT = Join-Path $out ('ballblazer-' + [guid]::NewGuid().ToString() + '.woz')
$env:BALLBLAZER_TEST_ROOT = $root
try {
    $metadata = @'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.BALLBLAZER_TEST_ROOT;
const { patchBallblazer } = await import(pathToFileURL(path.join(root, "codegen", "tools", "patch-ballblazer.mjs")));
const rom = fs.readFileSync(path.join(root, "emulator", "Data", "badger6502.bin"));
const result = patchBallblazer(fs.readFileSync(process.env.BALLBLAZER_TEST_INPUT), rom);
fs.writeFileSync(process.env.BALLBLAZER_TEST_OUTPUT, result.woz, { flag: "wx" });
const s = result.payload.resident.symbols;
console.log(JSON.stringify([s.NMI_RETURN, s.STATE_PENDING, s.READ_KEY, s.GAME_PAD_DONE].map(n => n.toString(16))));
'@ | node --input-type=module -
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate the native test image' }
    $symbols = $metadata | ConvertFrom-Json
    foreach ($period in @(94, 120, 160)) {
        & $exe (Join-Path $root 'emulator\Data\badger6502.bin') $env:BALLBLAZER_TEST_OUTPUT $period 80 @symbols
        if ($LASTEXITCODE -ne 0) { throw "Native input case $period/80 failed ($LASTEXITCODE)" }
    }
} finally {
    if (Test-Path -LiteralPath $env:BALLBLAZER_TEST_OUTPUT) {
        Remove-Item -LiteralPath $env:BALLBLAZER_TEST_OUTPUT
    }
}
