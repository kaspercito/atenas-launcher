# Cómo subir todo a GitHub y trabajar con un amigo

Ya tienes dos repositorios:
- `github.com/kaspercito/atenas-launcher` (el launcher y la herramienta Atenas Admin)
- `github.com/kaspercito/atenas-packs` (el modpack; el launcher lee sus archivos públicos)

> **Mantén `atenas-packs` público.** El launcher descarga `manifest.json` desde `raw.githubusercontent.com` sin iniciar sesión; si lo vuelves privado, deja de funcionar.

## Paso 1 · Subir los archivos nuevos (tú)

**A) Repo del launcher** (ej. `D:\atenas-launcher`). Copia dentro, respetando carpetas:

| Archivo del zip | Va en |
|---|---|
| `atenas-launcher/tools/admin.js` | `tools/admin.js` |
| `atenas-launcher/Atenas-Admin.bat` | raíz |
| `atenas-launcher/ADMIN-GUIA.md` y `COMPARTIR-GITHUB.md` | raíz |
| `atenas-launcher/.github/workflows/build.yml` | `.github/workflows/build.yml` (reemplaza) |

Luego, en una terminal dentro de esa carpeta:
```
git add -A
git commit -m "Atenas Admin y workflow corregido"
git push
```

**B) Repo del pack** (ej. `D:\atenas-packs`). Copia a `atenas-smp/`:
- `mods.txt`
- `pack.json`
- `.gitattributes` (hace que los cambios de ustedes dos en `mods.txt` se junten sin chocar)

**No copies `manifest.json`**: se genera solo. Después:
1. Haz doble clic en `Atenas-Admin.bat` (en el repo del launcher).
2. Opción **6 · Publicar**. Descarga los mods, genera el manifest nuevo y lo sube a GitHub.

Con esto el pack queda con 6 GB, chat de voz, zoom y los mods nuevos.

## Paso 2 · Invitar a tu amigo

Hazlo en **los dos repos**:
1. En GitHub abre el repo → **Settings** → **Collaborators** (o *Collaborators and teams*) → **Add people**.
2. Escribe su usuario de GitHub y elige el rol **Write**.
3. Él recibe un correo o una notificación y debe **aceptar la invitación**.

Después envíale **`GUIA-AMIGO.md`**. Tiene todo lo que necesita.

## Paso 3 · Reglas para no pisarse

1. Avísense antes de publicar ("voy a subir mods"). Si no se avisan, la herramienta igual trae sus cambios antes de publicar y junta las listas, pero conviene hablar.
2. Siempre usen la opción **6** para subir: trae lo del otro, descarga, genera el manifest y sube, todo en orden.
3. Quien prueba un mod nuevo lo abre en el juego **antes** de publicar. Cuando se sube, todos los jugadores reciben la actualización.
4. Si algo sale mal, GitHub guarda el historial: en el repo del pack, pestaña **Commits**, se puede volver a una versión anterior.

## Importante: seguridad

- Un colaborador con permiso **Write** puede cambiar el pack que reciben todos los jugadores y sacar versiones del launcher. Dáselo solo a gente de confianza.
- Alternativa más segura: que tu amigo haga un **fork** del repo, edite y envíe un **Pull Request**; tú lo revisas y lo aceptas.
- **Nunca** le mandes contraseñas ni tokens. Cada uno usa su propia cuenta de GitHub. `admin.config.json` es personal y no se sube.
- El acceso al servidor (SSH/Azure) es aparte: tu amigo solo lo tendrá si tú le das su propia llave.
