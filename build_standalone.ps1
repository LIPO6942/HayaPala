# HayaPala — Build Standalone HTML
# Usage: .\build_standalone.ps1

$BASE = "$PSScriptRoot\public"
$OUT  = "$PSScriptRoot\public\hayapala_standalone.html"

Write-Host '[HayaPala] Lecture des fichiers sources...' -ForegroundColor Cyan

$html = Get-Content "$BASE\index.html" -Raw -Encoding UTF8
$css  = Get-Content "$BASE\css\app.css"  -Raw -Encoding UTF8

$inlineCSS = '<style>' + "`n" + $css + "`n" + '</style>'
$html = $html -replace '<link rel="stylesheet" href="\./css/app\.css.*?" />', $inlineCSS

$html | Set-Content $OUT -Encoding UTF8

$size = [math]::Round((Get-Item $OUT).Length / 1024)
Write-Host "[HayaPala] Fichier standalone mis a jour : $OUT" -ForegroundColor Green
Write-Host "[HayaPala] Taille : $size KB" -ForegroundColor Green
