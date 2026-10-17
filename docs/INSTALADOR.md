# Instalador de Atenas Client

`npm run dist` genera `dist/Atenas-Client-Setup-<versión>.exe` (en GitHub Actions se genera al subir un tag `v*`).

- Asistente en español: bienvenida, **aviso y condiciones** (`build/license.txt`), carpeta de instalación, instalación y pantalla final con «Ejecutar Atenas Client».
- Instala por usuario (no pide permisos de administrador) y crea accesos directos en el escritorio y el menú Inicio.
- **Desinstalar no borra** tus modpacks, mundos ni ajustes (están en `%USERPROFILE%\.atenasclient`).
- Actualizaciones automáticas con `electron-updater` (las diferenciales usan el `.blockmap`).

Gráficos del instalador, en `build/`: `icon.ico`, `installerSidebar.bmp` y `uninstallerSidebar.bmp` (164×314), `installerHeader.bmp` (150×57).
