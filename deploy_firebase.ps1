# deploy_firebase.ps1 — Commit Git + Deploy Firebase Hosting
# Usage: .\deploy_firebase.ps1

$ErrorActionPreference = "Continue"
$nd = "$PSScriptRoot\node_portable\node-v22.12.0-win-x64"
$log = "$PSScriptRoot\deploy.log"

function Log($msg) {
    $ts = Get-Date -Format "HH:mm:ss"
    "$ts $msg" | Tee-Object -FilePath $log -Append
}

Log "=== HayaPala Deploy Script ==="
Log "Node dir : $nd"

# ── 1. Git add + commit ──────────────────────────────────────────────────────
Log "→ git add -A"
git -C $PSScriptRoot add -A 2>&1 | ForEach-Object { Log $_ }

Log "→ git commit"
git -C $PSScriptRoot commit -m "feat: Firebase Firestore + Auth + Hosting integration (v1.1)" 2>&1 | ForEach-Object { Log $_ }

# ── 2. Install firebase-tools via npx portable ──────────────────────────────
Log "→ Installing firebase-tools..."
& "$nd\npm.cmd" install -g firebase-tools --prefix "$nd" 2>&1 | ForEach-Object { Log $_ }

$fb = "$nd\node_modules\.bin\firebase.cmd"
if (-not (Test-Path $fb)) {
    # Try global npm prefix
    $fb = "$nd\firebase.cmd"
}
if (-not (Test-Path $fb)) {
    $fb = "$nd\node_modules\firebase-tools\bin\firebase.js"
}

Log "firebase binary: $fb"

# ── 3. Deploy to Firebase Hosting ──────────────────────────────────────────
Log "→ firebase deploy --only hosting"
if ($fb -match "\.js$") {
    & "$nd\node.exe" $fb deploy --only hosting --project circlepadel --non-interactive 2>&1 | ForEach-Object { Log $_ }
} else {
    & "$nd\node.exe" "$nd\node_modules\firebase-tools\bin\firebase.js" deploy --only hosting --project circlepadel --non-interactive 2>&1 | ForEach-Object { Log $_ }
}

Log "=== Deploy terminé ==="
