# Native PS/2 timing test for the Alternate Reality resident (no game data needed).
#   pwsh codegen\tools\port-altreality.native.ps1
# The resident's NMI receiver is the Ultima V one, so this reuses that
# harness (MSVC build of the shared VM, real PS/2 frames at 94-160-cycle bit
# periods, Caps Lock LED exchange, $C010 strobe on a stop bit) with the
# Alternate Reality resident assembled in. Both games only ever map bank 2,
# which is all this resident restores, so the harness keeps bank 2 mapped.
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'port-ultima5.native.ps1') -Resident (Join-Path $PSScriptRoot '..\patches\altreality\resident.s') -Bank2Only
