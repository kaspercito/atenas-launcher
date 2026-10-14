# Atenas Admin · guía de uso

Una herramienta con menú para administrar el modpack **sin editar archivos a mano**: agregas o quitas mods y ella descarga, genera el `manifest.json`, lo sube a GitHub y (si quieres) actualiza el servidor.

## 1. Instalación (una sola vez)

1. Copia a tu repo del launcher, respetando las carpetas:
   - `tools/admin.js`
   - `Atenas-Admin.bat`
   - `.github/workflows/` (el workflow corregido)
2. Necesitas **Node.js 18+** y **Git** instalados, y poder hacer `git push` (ya lo haces).
3. Haz doble clic en **`Atenas-Admin.bat`**.
4. La primera vez te pide la carpeta del pack (la que tiene `mods.txt`, por ejemplo `D:\atenas-packs\atenas-smp`). Se guarda en `admin.config.json`, que no se sube a GitHub.

Alternativa sin el .bat: abre una terminal en la carpeta del launcher y ejecuta `node tools/admin.js`.

## 2. El menú

| # | Opción | Qué hace |
|---|---|---|
| 1 | Ver los mods | Lista los activos y los desactivados. |
| 2 | Buscar y agregar | Buscas por nombre (solo muestra mods de Forge 1.20.1), eliges un número y se agrega. |
| 3 | Agregar por slug | Si ya sabes el slug de Modrinth (`jei`, `create`…). Con `slug@version` fijas una versión. |
| 4 | Quitar un mod | Lo borra de `mods.txt`. |
| 5 | Desactivar / reactivar | Lo comenta o descomenta sin perder la línea. |
| **6** | **PUBLICAR** | Descarga, comprueba, genera el manifest y sube a GitHub. |
| 7 | Cambiar la RAM | Edita mínimo y máximo en `pack.json`. |
| 8 | Actualizar el servidor | Entra por SSH, apaga, sincroniza mods y enciende. |
| 9 | Versión nueva del launcher | Sube la versión, crea la tag y GitHub Actions compila el instalador. |
| 10 | Diagnóstico | Revisa Node, Git, rutas y si hay cambios sin subir. |
| 11 | Traer cambios de tu amigo | Hace `git pull` y muestra quién cambió qué. La opción 6 ya lo hace sola antes de publicar. |

Las opciones 2 a 5 y 7 **solo editan archivos locales**. Nada llega a los jugadores hasta que uses la **6**.

## 3. Flujos típicos

**Agregar un mod**
1. Opción **2**, escribe el nombre, elige el número y confirma.
2. Opción **6**, escribe qué cambió ("Agregado Twilight Forest") y confirma la subida.
3. Cuando pregunte, acepta actualizar el servidor por SSH (o usa la opción **8** luego).

**Quitar un mod**
1. Opción **4**, elige el mod y confirma.
2. Opción **6** y actualiza el servidor.
> Si otro mod lo necesita como dependencia, volverá a entrar solo.

**Probar antes de publicar** (recomendado con mods grandes)
Haz el paso 1 de arriba, pero en la **6** responde **n** a "¿Subir a GitHub ahora?". Los jars quedan descargados en `files/mods/`: copia esa carpeta a una instancia de prueba, abre el juego y, si va bien, vuelve a elegir la **6**.

**Sacar una versión del launcher** (por ejemplo, tras cambiar el diseño)
1. Opción **9**: guarda los cambios con un commit, elige patch/minor/major y confirma.
2. Mira GitHub → **Actions**. Al terminar, el instalador aparece en **Releases**.

## 4. Qué se sube a GitHub y qué no

- **Sí:** `mods.txt`, `pack.json`, `manifest.json`, `mods.lock.json`, `server-exclude.txt` y tus configs de `files/config/`.
- **No:** los `.jar`. Se descargan desde Modrinth (están en `.gitignore`), así que el repo se mantiene pequeño.

`server-exclude.txt` lo genera la herramienta sola: lista los mods que Modrinth marca como solo-cliente y el servidor los omite al sincronizar.

## 5. Problemas comunes

| Mensaje | Solución |
|---|---|
| "No existe X en Modrinth" | El slug está mal: usa la opción 2 para buscarlo por nombre. |
| "No tiene versión para forge 1.20.1" | Ese mod no sirve para este pack. |
| "No se pudieron añadir…" al publicar | Quita o corrige esos mods (opciones 4 y 5) y vuelve a publicar. |
| Push "rejected" / "fetch first" | En la carpeta del pack ejecuta `git pull --rebase` y repite la opción 6. |
| El commit falla | Configura Git: `git config --global user.name "Tu nombre"` y `git config --global user.email "tu@correo"`. |
| SSH pide contraseña cada vez | Normal; para evitarlo configura una llave SSH en tu VM de Azure. |
| El servidor no arranca tras agregar un mod | Revisa `~/atenas-server/logs/latest.log`. Si dice "Missing mandatory dependencies", ese mod necesita otro en el servidor. |
| "No se pudo conectar con Modrinth" | Revisa tu internet y reintenta. |

## 6. Antes de publicar mods grandes

- Prueba siempre con 2 o 3 amigos antes de abrirlo a todos.
- Haz un backup del mundo del servidor (`bash backup.sh`) antes de añadir o quitar mods que cambien el mundo (biomas, estructuras, bloques).
- Quitar un mod que añade bloques u objetos **borra esos bloques del mundo**.
