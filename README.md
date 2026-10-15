# Atenas Client

Launcher de Minecraft con tus propios modpacks. Tus amigos lo abren, ven si hay mods nuevos y juegan con la configuración que tú elegiste. Todo gratis: el launcher es una app de Electron y los packs viven en un repo público de GitHub.

**Qué hace**
- Estado del servidor en vivo (jugadores, ping, MOTD) y botón para copiar la IP.
- Temas de color, tiempo jugado, reparar instalación, acceso a capturas, enlaces a Discord/Web (se configuran en `launcher.config.json` → `links`).
- Cuentas premium (Microsoft) y no premium (solo un nombre, sin conexión).
- Descarga solo lo que cambió: mods nuevos, actualizados y quitados.
- Avisa dentro del launcher (y con notificación de Windows) cuando publicas una actualización.
- Instala solo Java 17/21, Fabric, Quilt, Forge o NeoForge.
- No pisa las configuraciones personales de tus amigos (`options.txt`, etc.).
- Cada archivo se verifica con SHA-256 antes de guardarse.

---

## Parte 1. Preparar el repo de packs (una sola vez)

1. En GitHub crea un repo **público** nuevo, por ejemplo `atenas-packs`.
2. Copia ahí el contenido de la carpeta `packs-example/` (`packs.json` y la carpeta `atenas-smp`).
3. Reemplaza `TU_USUARIO_GITHUB` y `TU_REPO_DE_PACKS` en `packs.json` y en `atenas-smp/pack.json`.
4. Edita `atenas-smp/pack.json`: versión de Minecraft, loader (`fabric`, `quilt`, `forge`, `neoforge`) y su versión. Para Forge/NeoForge la versión es obligatoria; para Fabric/Quilt puedes omitirla y usa la última estable.
5. Pon tus mods en `atenas-smp/files/mods/` y tus configs en `atenas-smp/files/config/`.

## Parte 2. Publicar o actualizar mods (cada vez)

**Forma fácil (recomendada):** escribe tus mods en `atenas-smp/mods.txt` (un slug de Modrinth por línea) y ejecuta:

```bash
npm run pack -- RUTA/atenas-packs/atenas-smp --note "Añadí Create Deco"
```

Descarga los mods con sus dependencias, quita los que borraste, regenera el manifest y deja los jars fuera de Git. Detalles y el diseño del modpack en `MODPACK.md`.

**Forma manual (si prefieres poner los jars tú):**

Desde la carpeta del launcher:

```bash
npm install                      # solo la primera vez
npm run manifest -- RUTA/atenas-packs/atenas-smp --note "Añadí Create y quité Sodium"
```

Eso genera `manifest.json` con los hashes, sube la versión del pack y arma el changelog solo (añadido, quitado, actualizado). Después:

```bash
cd RUTA/atenas-packs
git add . && git commit -m "Actualización de mods" && git push
```

En unos minutos a tus amigos les aparece el aviso en el launcher. Cada 5 minutos revisa, y también al abrirlo.

**Mods pesados o de Modrinth/CurseForge:** el jar tiene que estar en tu `files/` para calcular su hash, pero no hace falta subirlo a GitHub. En `sources` de `pack.json` indica de dónde lo descargarán tus amigos (enlace directo de descarga) y añade esa ruta al `.gitignore` del repo de packs:

```json
"sources": { "mods/sodium.jar": "https://cdn.modrinth.com/data/.../sodium-fabric-0.5.8.jar" }
```

Límite práctico de GitHub: 100 MB por archivo y repo de menos de 1 GB.

**Configuraciones de un solo uso:** los archivos listados en `once` se entregan la primera vez y después son del jugador. `options.txt` y `servers.dat` ya vienen así por defecto.

**Servidor:** si pones `"server": "ip:puerto"` en `pack.json`, el juego entra directo al servidor.

## Parte 3. Crear el instalador para tus amigos

1. Abre `launcher.config.json` y pon la URL real de tu `packs.json` (la "raw" de GitHub).
2. En `package.json`, sección `build.publish`, pon tu usuario y el repo **del launcher** (otro repo público, por ejemplo `atenas-launcher`).
3. Sube este proyecto a ese repo.
4. Crea una etiqueta y súbela:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

GitHub Actions (gratis) construye `Atenas Client Setup 1.0.0.exe` y lo publica en *Releases*. Pásales ese enlace. Cuando saques `v1.0.1` el launcher se actualiza solo.

Si prefieres hacerlo en tu PC con Windows: `npm install` y luego `npm run dist`; el instalador queda en `dist/`.

## Probarlo en tu PC

```bash
npm install
npm start
```

Prueba de la sincronización (no necesita Minecraft): `npm test`.

---

## Notas importantes

- **No premium:** funciona en un jugador y en servidores con `online-mode=false`. Los servidores oficiales y los que verifican cuentas no te dejan entrar. Tampoco hay skins oficiales.
- **Premium:** usa el inicio de sesión oficial de Microsoft; el launcher nunca ve tu contraseña y guarda el token cifrado con el almacén seguro de Windows.
- **Windows SmartScreen:** al no estar firmado el `.exe`, Windows mostrará "Windows protegió su PC". Se pasa con *Más información → Ejecutar de todas formas*. Firmarlo cuesta dinero, por eso no se incluye.
- **Mods que quita el launcher:** la carpeta `mods/` se mantiene idéntica al pack. Si un amigo mete un mod por su cuenta, se borra al sincronizar. Para permitirlo, quita `mods` de `managed` en `pack.json`.
- El icono está en `assets/icon.svg` (editable) y `assets/icon.png`.

## Estructura

```
main.js, preload.js        app de Electron
renderer/                  interfaz
src/lib/sync.js            diferencias de mods y descarga verificada
src/lib/java.js            Java automático (Adoptium)
src/lib/loaders.js         Fabric, Quilt, Forge, NeoForge
src/lib/auth.js            Microsoft y modo sin conexión
tools/generate-manifest.js genera el manifest de un pack
packs-example/             plantilla del repo de packs
```

## Si algo no carga

- **"Modpack sin publicar"**: el launcher encontró `packs.json` pero no `manifest.json`. Ejecuta `npm run pack -- RUTA/atenas-packs/atenas-smp` y luego `git add . && git commit && git push`, espera un minuto y pulsa *Reintentar*.
- **"Sin conexión"**: revisa tu internet o que el repo de packs sea público y la rama se llame `main`.
- **Mods dañados o faltantes**: botón *Reparar* en Inicio.
