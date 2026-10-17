# Native PS/2 timing test for the Wizardry I resident (no game data needed).
#   pwsh codegen\tools\port-wizardry1.native.ps1
# The resident's NMI receiver is the Ultima V one, so this reuses that
# harness (MSVC build of the shared VM, real PS/2 frames at 94-160-cycle bit
# periods, Caps Lock LED exchange, $C010 strobe on a stop bit, language-card
# banks swapped between keys) with the Wizardry resident assembled in.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$out = Join-Path $root 'codegen\out'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$resident = Join-Path $out 'wizardry1-resident.s'
# The shim entry is the only symbol the resident needs from outside.
("SHIM_DISK = `$E000`n" + (Get-Content (Join-Path $root 'codegen\patches\wizardry1\resident.s') -Raw)) |
    Set-Content -Path $resident -NoNewline
& (Join-Path $PSScriptRoot 'port-ultima5.native.ps1') -Resident $resident
