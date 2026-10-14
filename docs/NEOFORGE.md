# Modpack de NeoForge en Atenas

Todo se hace desde **Atenas Admin**; el launcher de tus amigos se encarga solo del resto.

## 1. Crear el pack
1. En **Ajustes del pack** pon el nombre y la **versión de Minecraft** (por ejemplo `1.21.1`).
2. En **Loader** elige **NeoForge** y pulsa **Ver versiones**: te lista las últimas de esa versión de Minecraft. Elige una y se rellena sola (ej. `21.1.172`).
3. **RAM**: para modpacks de NeoForge suele ir bien 6 a 8 GB máximo. Cada jugador puede cambiarla en sus Ajustes.
4. **Servidor** (opcional): la IP a la que entra directo al abrir el juego.
5. Guarda los ajustes.

Soporta NeoForge moderno (Minecraft 1.20.2 en adelante) y el de **1.20.1** (versiones `47.x`).

## 2. Añadir mods
En **Añadir mods** solo aparecen mods compatibles con la versión de Minecraft y el loader del pack (Modrinth y CurseForge). Los que no estén ahí, arrástralos como `.jar` en **Mis .jar**.

## 3. Publicar
**Vista previa** para revisar dependencias y compatibilidad, y luego **Publicar**. Tus amigos reciben el aviso solos.

## Qué hace el launcher por ti
- **Java**: lo descarga solo la primera vez. Java 17 hasta Minecraft 1.20.4 y Java 21 desde la 1.20.5.
- **NeoForge**: ejecuta el instalador oficial en la primera instalación (puede tardar unos minutos).
- **Argumentos de Java del loader**: los lee del propio perfil de NeoForge (módulos, `--add-opens`…), no hay que tocar nada.

## Si algo falla
- **Reparar instalación** (Inicio o Ajustes) vuelve a verificar mods y archivos.
- Pulsa **Registro** en Inicio para ver el detalle de lo que pasó al arrancar.
- Si cambias la versión de Minecraft o de NeoForge, usa **Vista previa** antes de publicar: los mods de la versión anterior pueden no servir.
