@echo off
chcp 65001 >nul
title CirclePadel — Git Push + Firebase Deploy
color 0A
set "DIR=%~dp0"
set "NODE=%DIR%node_portable\node-v22.12.0-win-x64\node.exe"
set "NPM=%DIR%node_portable\node-v22.12.0-win-x64\npm.cmd"

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║   CirclePadel v1.1 — Git Push + Firebase Deploy  ║
echo  ║   Projet : circlepadel.web.app                   ║
echo  ╚══════════════════════════════════════════════════╝
echo.

:: ── 1. Vérifier Node.js ──────────────────────────────────────────────────────
if not exist "%NODE%" (
    echo [ERREUR] Node.js portable introuvable.
    echo Chemin attendu : %NODE%
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('"%NODE%" --version 2^>^&1') do echo [OK] Node.js : %%v

:: ── 2. Git push sur GitHub ───────────────────────────────────────────────────
echo.
echo [→] Ajout des fichiers modifiés...
git -C "%DIR%" add -A

echo [→] Commit des changements locaux...
git -C "%DIR%" commit -m "chore: auto-commit before deploy" 2>nul
if %errorlevel% equ 0 (echo [OK] Commit créé) else (echo [INFO] Rien à commiter ou déjà commité)

echo [→] Push vers GitHub (LIPO6942/HayaPala)...
echo     Si une authentification est demandée, entrez vos identifiants GitHub.
git -C "%DIR%" push origin main
if %errorlevel% equ 0 (
    echo [OK] Push GitHub réussi !
) else (
    echo [WARN] Push échoué ^(vérifiez vos credentials GitHub^)
)

:: ── 3. Installer firebase-tools localement ───────────────────────────────────
set "FB=%DIR%node_modules\.bin\firebase.cmd"
if not exist "%FB%" (
    echo.
    echo [→] Installation de firebase-tools ^(environ 2-3 min^)...
    echo     Connexion internet requise.
    "%NPM%" install firebase-tools --save-dev --prefix "%DIR%"
)

if not exist "%FB%" (
    echo.
    echo [ERREUR] firebase-tools non trouvé après installation.
    echo Essayez manuellement : npm install -g firebase-tools
    pause & exit /b 1
)
echo [OK] firebase-tools trouvé.

:: ── 4. Connexion Firebase ────────────────────────────────────────────────────
echo.
echo [→] Vérification connexion Firebase...
"%FB%" projects:list 2>nul | findstr "circlepadel" >nul
if %errorlevel% neq 0 (
    echo [→] Connexion à Firebase ^(le navigateur va s'ouvrir^)...
    "%FB%" login
)

:: ── 5. Deploy Firebase Hosting ───────────────────────────────────────────────
echo.
echo [→] Déploiement Firebase Hosting...
"%FB%" deploy --only hosting --project circlepadel

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║   ✓ Déployé sur https://circlepadel.web.app     ║
echo  ╚══════════════════════════════════════════════════╝
echo.
pause
