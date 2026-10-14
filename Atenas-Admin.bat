@echo off
chcp 65001 >nul
title Atenas Admin
cd /d "%~dp0"
where node >nul 2>nul || (echo Necesitas instalar Node.js: https://nodejs.org ^& pause ^& exit /b)
where git >nul 2>nul || (echo Necesitas instalar Git: https://git-scm.com ^& pause ^& exit /b)
node tools\admin.js
pause
