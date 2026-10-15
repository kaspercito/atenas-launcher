@echo off
cd /d "%~dp0"
set /p V=Version nueva (ej. 1.1.3): 
call npm version %V% --no-git-tag-version
if errorlevel 1 goto error
git add .
git commit -m "v%V%"
git pull --rebase origin main
if errorlevel 1 goto error
git push
if errorlevel 1 goto error
git tag v%V%
git push origin v%V%
if errorlevel 1 goto error
echo.
echo Listo. Mira la pestana Actions en GitHub.
pause
exit /b 0
:error
echo.
echo Algo fallo. No sigas, copia lo que salio arriba y avisame.
pause
