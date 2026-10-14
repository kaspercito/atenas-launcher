# Atenas Admin

Panel de escritorio para el dueño del launcher. Sin comandos: añades, quitas o subes mods con clics y publicas.

## Abrir
Doble clic en `Atenas Admin.bat` (o `npm run admin`). La primera vez busca solo la carpeta `atenas-packs`
(junto a `atenas-launcher`); si no la encuentra, pulsa **Cambiar carpeta**.

## Qué hace
- **Mods**: lista por secciones (las de tu `mods.txt`), con *nuevo / cambia de versión / se quitará*, 📌 fijar versión, 🗑 quitar.
- **Añadir mods**: busca en Modrinth (solo versiones compatibles con tu Minecraft + loader), elige sección y versión.
- **Mis .jar**: arrastra aquí mods que no están en Modrinth; se copian a `files/mods`.
- **Publicar**: *Vista previa* (no cambia nada) → *Publicar*: descarga, revisa dependencias, regenera `manifest.json`,
  hace commit + push. **Si falta una dependencia o un mod no existe, no sube nada** y te dice qué corregir.
- **Descartar cambios**: vuelve la lista a como estaba al abrir / al publicar.

Tus comentarios y secciones de `mods.txt` se respetan. Requisitos: Node, Git con sesión iniciada en GitHub.
Los .jar de más de 95 MB se rechazan (límite de GitHub).

## CurseForge
Pestaña **Añadir mods → CurseForge**. La primera vez pide una API key gratuita (console.curseforge.com → API keys); se guarda cifrada en tu PC.
- Se baja la última versión compatible y sus dependencias obligatorias; las URL van a `pack.json` → `sources` (los .jar no se suben a GitHub).
- Tus peticiones quedan en `curseforge.json` y lo resuelto en `curseforge.lock.json` (súbelos a git).
- Si el autor desactivó las descargas fuera de CurseForge, el mod sale marcado ⛔ y no se puede automatizar.
- En la lista de mods, los que Modrinth no encuentra traen un botón **🔎 CF** que busca directamente allí.
