# HayaPala — Build Standalone HTML
# Fusionne le HTML, CSS et JS en un seul fichier autonome
# Usage: .\build_standalone.ps1

$BASE = "c:\Users\moslem5017\Desktop\doc perso\hayaPala\HayaPala\public"
$OUT  = "c:\Users\moslem5017\Desktop\doc perso\hayaPala\HayaPala\public\hayapala_standalone.html"

Write-Host "[HayaPala] Lecture des fichiers sources..." -ForegroundColor Cyan

$html = Get-Content "$BASE\index.html" -Raw -Encoding UTF8
$css  = Get-Content "$BASE\css\app.css"  -Raw -Encoding UTF8
$js   = Get-Content "$BASE\js\app.js"    -Raw -Encoding UTF8

# Remplacer la balise <link rel="stylesheet" href="./css/app.css" />
# par le CSS inline
$inlineCSS = "<style>`n$css`n</style>"
$html = $html -replace '<link rel="stylesheet" href="\./css/app\.css" />', $inlineCSS

# Remplacer la balise <script src="./js/app.js"></script>
# par le JS inline
$inlineJS = "<script>`n$js`n</script>"
$html = $html -replace '<script src="\./js/app\.js"></script>', $inlineJS

# Sauvegarder
$html | Set-Content $OUT -Encoding UTF8

$size = [math]::Round((Get-Item $OUT).Length / 1024)
Write-Host "[HayaPala] ✓ Fichier standalone créé : $OUT" -ForegroundColor Green
Write-Host "[HayaPala] Taille : $size KB" -ForegroundColor Green
Write-Host "[HayaPala] Ouvrez ce fichier directement dans Chrome sans serveur !" -ForegroundColor Yellow
