# Serves the web/ folder over HTTP so the browser can fetch the .wasm with the
# correct application/wasm MIME type (.wasm cannot be loaded from file://).
#
# Usage:  pwsh -File web\serve.ps1 [-Port 8000]

param([int]$Port = 8000)

$web = $PSScriptRoot
Write-Host "Serving $web at http://localhost:$Port/  (Ctrl+C to stop)" -ForegroundColor Cyan
Set-Location $web
python -m http.server $Port
