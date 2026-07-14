# Builds the 3ric Apple-II-clone VM core + WozLib + web bridge to WebAssembly
# using Emscripten.
#
# All shared-library changes are additive and guarded with PLATFORM_WEB /
# __EMSCRIPTEN__, so the existing Windows/Pico builds are unaffected.
#
# Prerequisites: the Emscripten SDK installed (see web/README.md). By default
# this looks for emsdk at $env:EMSDK, else %USERPROFILE%\emsdk.
#
# Usage:  pwsh -File web\build.ps1   (run from anywhere; paths are script-relative)

$ErrorActionPreference = "Stop"
$web  = $PSScriptRoot
$root = Split-Path $web -Parent
$lib  = Join-Path $root "emulator\Badger6502VMLib"
$woz  = Join-Path $root "emulator\WozLib"
$sd   = Join-Path $root "emulator\MockMicroSD"
$data = Join-Path $root "emulator\Data"

# Platform detection: $IsWindows is an automatic variable in PowerShell 7+; on
# Windows PowerShell 5.1 it is undefined, so fall back to $env:OS. On Linux/macOS
# (e.g. GitHub Actions CI) the emsdk environment is sourced beforehand so em++ is
# already on PATH, and the Windows emsdk_env.bat / em++.exe lookup is skipped.
$onWindows = $IsWindows -or ($env:OS -eq 'Windows_NT')

if ($onWindows) {
    $emsdk  = if ($env:EMSDK) { $env:EMSDK } else { Join-Path $env:USERPROFILE "emsdk" }
    $envBat = Join-Path $emsdk "emsdk_env.bat"
    $empp   = Join-Path $emsdk "upstream\emscripten\em++.exe"

    if (-not (Test-Path $envBat)) { throw "emsdk not found at '$emsdk'. Set `$env:EMSDK or install per web/README.md." }
    if (-not (Test-Path $empp))   { throw "em++ not found at '$empp'. Did you run 'emsdk install/activate latest'?" }
}

# Core VM sources. symbols.cpp (debugger) and Disassemble.cpp (Windows-only
# VM::Disassemble) are excluded; nothing compiled for the web references them.
$sources = @(
    (Join-Path $lib "vm.cpp"),
    (Join-Path $lib "cpu.cpp"),
    (Join-Path $lib "Instructions.cpp"),
    (Join-Path $lib "acia.cpp"),
    (Join-Path $lib "via.cpp"),
    (Join-Path $lib "ay38910.cpp"),
    (Join-Path $lib "mockingboard.cpp"),
    (Join-Path $lib "PS2Keyboard.cpp"),
    (Join-Path $lib "badgervmpal.cpp"),
    # WozLib (DriveEmulator is embedded in VM; WozDisk/WozFile are needed to link).
    (Join-Path $woz "DriveEmulator.cpp"),
    (Join-Path $woz "WozDisk.cpp"),
    (Join-Path $woz "WozFile.cpp"),
    # MockMicroSD: bit-banged SPI SD card (web branch = sparse in-memory image).
    (Join-Path $sd "SDCard.cpp"),
    (Join-Path $sd "MappedFile.cpp"),
    # Web bridge.
    (Join-Path $web "web_bridge.cpp")
)

foreach ($s in $sources) {
    if (-not (Test-Path $s)) { throw "source not found: $s" }
}

$out = Join-Path $web "badger6502.js"

$flags = @(
    "-std=c++17",
    "-O2",
    "-DPLATFORM_WEB",
    "-lembind",
    "-I", $lib,
    "-I", $woz,
    "-I", $sd,
    "-I", $web,
    "-sMODULARIZE=1",
    "-sEXPORT_NAME=createBadgerVM",
    "-sALLOW_MEMORY_GROWTH=1",
    "-sENVIRONMENT=web,node",
    "-o", $out
)

# Quote each path argument so spaces in the path survive the cmd round-trip.
$quoted = ($flags + $sources) | ForEach-Object { '"' + $_ + '"' }
$argList = $quoted -join " "

Write-Host "Building -> $out" -ForegroundColor Cyan
if ($onWindows) {
    # Source emsdk_env.bat in the same cmd process that runs em++.exe.
    $cmd = "call `"$envBat`" >nul 2>&1 && `"$empp`" $argList"
    & $env:ComSpec /c $cmd
} else {
    # Linux/macOS (CI): em++ is already on PATH from a sourced emsdk env; allow an
    # explicit override via $env:EMPP. PowerShell splats the argument array
    # directly, so the manual quoting above is unnecessary here.
    $emppCmd = if ($env:EMPP) { $env:EMPP } else { "em++" }
    & $emppCmd @($flags + $sources)
}
if ($LASTEXITCODE -ne 0) { throw "Build failed with exit code $LASTEXITCODE" }

# Stage the ROM + font images next to the page for fetch() at runtime.
# These copies are gitignored (the originals live in emulator\Data).
$webData = Join-Path $web "data"
New-Item -ItemType Directory -Force -Path $webData | Out-Null
foreach ($f in @("badger6502.bin", "fontrom.dat")) {
    $src = Join-Path $data $f
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $webData $f) -Force
    } else {
        Write-Warning "data file missing: $src"
    }
}

# Stage a bootable 5.25" floppy as the one-click "Boot Disk" demo. The Apple-II
# clone has no Applesoft, so DOS-3.3 disks trap; this self-booting machine-code
# game runs straight into a hi-res title. Copied from the in-repo WOZ test
# images to data\disk.woz (gitignored, like the other data copies).
$diskSrc = Join-Path $root "emulator\WozFileTestApp\testdata\WOZ 2.0\Dino Eggs - Disk 1, Side A.woz"
if (Test-Path $diskSrc) {
    Copy-Item $diskSrc (Join-Path $webData "disk.woz") -Force
} else {
    Write-Warning "demo disk missing: $diskSrc (Boot Disk button will be unavailable)."
}

# Generate the compact sparse micro-SD image (data\sd.sparse) straight from
# emulator\Data\sd.zip. The raw image is a 2GB, mostly-zero FAT32 disk; the
# sparse form keeps only the ~11.5MB of non-zero sectors. Skipped if already
# present (regeneration takes ~20s). Gitignored like the other data copies.
$sparse = Join-Path $webData "sd.sparse"
if (-not (Test-Path $sparse)) {
    $sdScript = Join-Path $web "make_sd_sparse.py"
    $sdZip    = Join-Path $data "sd.zip"
    if (Test-Path $sdZip) {
        $py = Get-Command python -ErrorAction SilentlyContinue
        if ($py) {
            Write-Host "Generating $sparse from sd.zip (~20s)..." -ForegroundColor Cyan
            & $py.Source $sdScript $sdZip $sparse
            if ($LASTEXITCODE -ne 0) { Write-Warning "sd.sparse generation failed ($LASTEXITCODE); SD card will be unavailable." }
        } else {
            Write-Warning "python not found; skipping sd.sparse generation (SD card will be unavailable)."
        }
    } else {
        Write-Warning "SD image missing: $sdZip (SD card will be unavailable)."
    }
}

Write-Host "Build succeeded:" -ForegroundColor Green
Get-ChildItem $web -Filter "badger6502.*" | ForEach-Object { "  {0,-22} {1,10:N0} bytes" -f $_.Name, $_.Length }
Get-ChildItem $webData | ForEach-Object { "  data\{0,-16} {1,10:N0} bytes" -f $_.Name, $_.Length }

# Stage the in-browser assembler + sample sources for the web "Assemble & Run"
# editor. Single source of truth: the assembler lives in codegen\tools and the
# sample programs in codegen\programs / emulator\AICodeGen. These web copies are
# gitignored (like the data\ copies above) and regenerated by this script; the
# Pages workflow runs build.ps1 before staging so CI picks them up too.
Copy-Item (Join-Path $root "codegen\tools\asm6502.mjs") (Join-Path $web "asm6502.mjs") -Force
# wozgen.mjs powers the editor's "Download .woz" button; it imports asm6502.mjs
# (staged above) and must sit beside it in web\.
Copy-Item (Join-Path $root "codegen\tools\wozgen.mjs") (Join-Path $web "wozgen.mjs") -Force
$webPrograms = Join-Path $web "programs"
New-Item -ItemType Directory -Force -Path $webPrograms | Out-Null
$samples = @(
    (Join-Path $root "emulator\AICodeGen\swarm\swarm.s"),
    (Join-Path $root "emulator\AICodeGen\rocks\rocks.s"),
    (Join-Path $root "emulator\AICodeGen\jungle\jungle.s"),
    (Join-Path $root "emulator\AICodeGen\life\life.s"),
    (Join-Path $root "emulator\AICodeGen\snake\snake.s"),
    (Join-Path $root "emulator\AICodeGen\blocks\blocks.s"),
    (Join-Path $root "emulator\AICodeGen\paddles\paddles.s"),
    (Join-Path $root "emulator\AICodeGen\bricks\bricks.s"),
    (Join-Path $root "emulator\AICodeGen\2048\2048.s"),
    (Join-Path $root "emulator\AICodeGen\mines\mines.s")
)
# Every .s under codegen\programs is also staged (this already covers hello.s). Drop a new
# source there and add a gallery.json entry to feature it in the Community Gallery — no need
# to edit this list by hand.
$samples += Get-ChildItem -Path (Join-Path $root "codegen\programs") -Filter *.s -File -ErrorAction SilentlyContinue |
    ForEach-Object { $_.FullName }
foreach ($s in $samples) {
    if (Test-Path $s) { Copy-Item $s (Join-Path $webPrograms (Split-Path $s -Leaf)) -Force }
    else { Write-Warning "sample source missing: $s" }
}
Write-Host "Staged web assembler + $($samples.Count) sample sources into web\ and web\programs\." -ForegroundColor Green
