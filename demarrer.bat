@echo off
title HayaPala — Lancement du serveur

echo.
echo  ====================================================
echo    HayaPala Padel Club  ^|  Serveur local
echo  ====================================================
echo.

:: Node.js portable (fourni avec le projet)
set NODE="%~dp0node_portable\node-v22.12.0-win-x64\node.exe"

:: Vérifier si Node portable existe
if exist %NODE% (
    echo  [OK] Node.js portable trouvé
    goto :start_server
)

:: Chercher Node.js installé sur le système
set NODE=""
for %%P in (
    "C:\Program Files\nodejs\node.exe"
    "C:\Program Files (x86)\nodejs\node.exe"
) do (
    if exist %%P set NODE=%%P
)

if %NODE%=="" (
    echo  [ERREUR] Node.js non trouvé !
    echo  Téléchargez Node.js sur https://nodejs.org
    pause
    exit /b 1
)

:start_server
echo  [OK] Démarrage du serveur...
echo  [OK] URL : http://localhost:3000
echo.

:: Ouvrir Chrome après 2 secondes
start /b cmd /c "timeout /t 2 /nobreak >nul && start chrome http://localhost:3000"

:: Démarrer le serveur
cd /d "%~dp0"
%NODE% server.js

pause
