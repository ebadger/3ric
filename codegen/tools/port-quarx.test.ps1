param([Parameter(Mandatory = $true)][string]$InputDisk)
$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$inputPath = (Resolve-Path -LiteralPath $InputDisk).Path
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path -LiteralPath $vswhere)) { throw "Visual Studio C++ build tools are required." }
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw "No Visual Studio C++ toolchain found." }
$setup = Join-Path $vs "VC\Auxiliary\Build\vcvars64.bat"
$lib = Join-Path $root "emulator\Badger6502VMLib"
$woz = Join-Path $root "emulator\WozLib"
$build = Join-Path ([IO.Path]::GetTempPath()) ("3ric-quarx-native-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $build | Out-Null
$oldPath = $env:Path
try {
    $env:Path = (Split-Path $vswhere -Parent) + ";" + $env:Path
    $sources = @((Join-Path $PSScriptRoot "port-quarx.native.cpp"))
    $sources += @("vm.cpp", "cpu.cpp", "Instructions.cpp", "acia.cpp", "via.cpp",
        "ay38910.cpp", "mockingboard.cpp", "snesgamepads.cpp", "PS2Keyboard.cpp",
        "badgervmpal.cpp", "symbols.cpp") | ForEach-Object { Join-Path $lib $_ }
    $sources += @("DriveEmulator.cpp", "WozDisk.cpp", "WozFile.cpp") |
        ForEach-Object { Join-Path $woz $_ }
    $quoted = ($sources | ForEach-Object { '"' + $_ + '"' }) -join " "
    $compile = "call `"$setup`" >nul && cd /d `"$build`" && cl /nologo /std:c++17 /EHsc /O2 /DPLATFORM_WINDOWS /D_CRT_SECURE_NO_WARNINGS /I`"$lib`" /I`"$woz`" /Fequarx-native.exe $quoted"
    & $env:ComSpec /c $compile
    if ($LASTEXITCODE -ne 0) { throw "Native test build failed ($LASTEXITCODE)." }
    & node (Join-Path $PSScriptRoot "port-quarx.test.mjs") --disk $inputPath --native (Join-Path $build "quarx-native.exe")
    if ($LASTEXITCODE -ne 0) { throw "Quarx compatibility checks failed ($LASTEXITCODE)." }
}
finally {
    $env:Path = $oldPath
    Get-ChildItem -LiteralPath $build -File | ForEach-Object {
        $file = $_.FullName
        for ($attempt = 0; ; $attempt++) {
            try {
                Remove-Item -LiteralPath $file -ErrorAction Stop
                break
            }
            catch [System.UnauthorizedAccessException] {
                if ($attempt -ge 5) { throw }
                Start-Sleep -Milliseconds 250
            }
            catch [System.IO.IOException] {
                if ($attempt -ge 5) { throw }
                Start-Sleep -Milliseconds 250
            }
        }
    }
    Remove-Item -LiteralPath $build
}
