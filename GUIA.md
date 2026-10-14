# Guía completa · Atenas Launcher

Usas **dos repos públicos** en GitHub (tu usuario: `kaspercito`):

| Repo | Contiene | Carpeta en tu PC |
|---|---|---|
| `atenas-launcher` | El código del launcher (el `.exe`) | `C:\Users\Miguel\Desktop\launcher` |
| `atenas-packs` | `packs.json`, `mods.txt`, configs y `manifest.json` | `C:\atenas-packs` |

## 1. Primera vez: subir los packs
```bash
cd C:\atenas-packs
git init
git add .
git commit -m "Primer pack"
git branch -M main
git remote add origin https://github.com/kaspercito/atenas-packs.git
git push -u origin main
```
Antes, comprueba que `packs.json` esté en la raíz y que no quede `TU_USUARIO_GITHUB` en ningún archivo. Los jars de Modrinth no se suben: `pack.json → sources` guarda sus enlaces.

## 2. Primera vez: subir el launcher y crear el instalador
Reemplaza la carpeta del launcher con la de este zip (v1.0.0) y:
```bash
cd C:\Users\Miguel\Desktop\launcher
npm install
npm start                      # pruébalo antes de subir
git init
git add .
git commit -m "Atenas Launcher v1.0.0"
git branch -M main
git remote add origin https://github.com/kaspercito/atenas-launcher.git
git push -u origin main
git tag v1.0.0
git push origin v1.0.0
```
GitHub Actions compila el instalador y lo deja en **Releases** (3 a 5 min). Esa es la descarga que les pasas a tus amigos. La etiqueta debe coincidir con la versión de `package.json`.

Si ya tenías el repo del launcher subido, solo haz `git add . && git commit -m "Diseño premium" && git push`, y después los dos comandos de `git tag v1.0.0`.

## 3. Mods: agregar, quitar, fijar, actualizar
Todo se edita en `C:\atenas-packs\atenas-smp\mods.txt`.

| Quiero | Hago |
|---|---|
| Agregar | Nueva línea con el slug de Modrinth (`construction-wand`) |
| Quitar | Borro la línea (o le pongo `#`) |
| Fijar versión | `slug@version` (`create@6.0.8`) |
| Actualizar todo | Nada que editar; al empacar toma lo último compatible |

Luego, siempre igual:
```bash
cd C:\Users\Miguel\Desktop\launcher
npm run pack -- C:\atenas-packs\atenas-smp --note "Qué cambió"
cd C:\atenas-packs
git add .
git commit -m "Actualización de mods"
git push
```
- `--dry` prueba sin descargar. La nota es el changelog que ven tus amigos.
- **ImmediatelyFast:** el jar `+1.20.4` que resolvió tu pack es normal: Modrinth lo marca compatible con 1.20.1 (otros packs 1.20.1 lo usan). No lo cambies salvo que el juego falle.
- **Mods que no están en Modrinth (FTB, etc.):** descarga el jar de CurseForge y ponlo en `atenas-smp\files\mods\`. El script no lo toca, pero ese jar sí debe subirse a GitHub (máx. 100 MB).
- **Alternativas a los que no se encontraron:** Open Parties and Claims (en lugar de FTB Chunks/Teams), Construction Wand (en lugar de Building Gadgets). Verifica que tengan versión Forge 1.20.1.

## 4. Configs, RAM, versión de Minecraft/Forge
- Configs: en `atenas-smp\files\config\`, luego empacar y push. Lo listado en `once` (de `pack.json`) se entrega solo la primera vez.
- RAM, IP del servidor, versión de Forge: edita `atenas-smp\pack.json`, empaca y push.

## 5. Actualizar el launcher
```bash
cd C:\Users\Miguel\Desktop\launcher
npm version patch   # 1.0.0 → 1.0.1, 1.0.2…
git push --follow-tags
```
Los launchers instalados se actualizan solos desde Releases.

## 6. ¿Se actualiza solo, como Lunar Client?
- **Launcher:** sí, se actualiza solo desde Releases.
- **Mods y configs:** revisa cada 5 minutos y al abrir; avisa con el changelog y se actualiza con un clic, descargando solo lo que cambió.
- Con `managed: ["mods"]` la carpeta `mods/` queda idéntica al pack: un mod que el amigo meta por su cuenta se borra. Para permitirlos, quita `"mods"` de `managed`.
- Windows mostrará "Windows protegió su PC" (el `.exe` no está firmado): *Más información → Ejecutar de todas formas*.

## 7. Qué trae el diseño
- Fondo con aurora, rejilla suave, parallax con el mouse y partículas (se apaga en Ajustes → "Fondo animado").
- Tarjetas de cristal con foco de luz que sigue al cursor y botón Jugar con degradado en movimiento.
- Icono nuevo: corona de laurel dorada con la A.
- **Ctrl+K**: paleta de acciones (jugar, copiar IP, carpeta, capturas, reparar, registro, cambiar tema, buscar mod).
- Atajos: `1` Inicio, `2` Mods, `3` Novedades, `4` Ajustes, `/` buscar mods.

## 8. Si algo falla
- **"Modpack sin publicar":** falta `manifest.json`. Ejecuta `npm run pack` y haz push.
- **"Sin conexión":** el repo de packs debe ser público y la rama `main`.
- **Mods dañados o faltantes:** botón *Reparar* en Inicio.
- **Crash al jugar:** revisa `logs\latest.log` en la carpeta del juego.

## 9. Página web / celular
La carpeta `docs/` es una página adaptada a celular (estado del servidor en vivo, botón Copiar IP, descarga del launcher). Para publicarla gratis: en el repo `atenas-launcher` → Settings → Pages → *Deploy from a branch* → `main` y carpeta `/docs`. Quedará en `https://kaspercito.github.io/atenas-launcher/`. Ajusta nombre, IP y repo en `CFG` al inicio del script de `docs/index.html`. El launcher en sí es solo para Windows.

## 10. Servidor
Todo está en `atenas-servidor.zip` (ver su `README-SERVIDOR.md`).
