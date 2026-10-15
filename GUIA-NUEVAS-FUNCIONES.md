# Novedades v1.1.2

## 1. Actualización automática del launcher (arreglada)
**Qué fallaba:** solo se comprobaba una vez al abrir, sin avisos y los errores se ocultaban. Además, si el tag de GitHub no coincide con la `version` de `package.json`, el launcher instalado nunca ve la versión nueva.

**Ahora:** comprueba al abrir y cada 30 min, muestra un aviso con barra de descarga y botón **Reiniciar y actualizar**, y hay un botón en Ajustes → *Buscar actualizaciones*. Los errores quedan en `%APPDATA%\Atenas Launcher\updater.log`. El workflow falla si el tag no coincide con la versión.

**Para publicar una versión nueva:**
1. Sube `version` en `package.json` (ej. `1.1.3`).
2. `git commit -am "v1.1.3"` · `git tag v1.1.3` · `git push && git push --tags`
3. Espera a que Actions termine y deja el release **publicado** (no borrador). El repo debe ser **público**.
Solo funciona en el launcher **instalado** (no con `npm start`). Los modpacks se siguen actualizando aparte, cada 5 min.

## 2. Discord Rich Presence
1. https://discord.com/developers/applications → New Application (el nombre es lo que se ve: "Atenas Launcher").
2. Copia el **Application ID** a `launcher.config.json` → `"discordClientId"`.
3. En Rich Presence → Art Assets sube una imagen con el nombre `icon`.
Se activa/desactiva en Ajustes. Muestra "En el launcher" o "Jugando <modpack>" con el tiempo.

## 3. Amigos
Pestaña **Amigos**: añades nicks de Minecraft y ves quién está **en el servidor** (sale del ping, que solo lista hasta 12 jugadores). Para ver también "Jugando <pack>" / "En el launcher":
1. Cloudflare → Workers & Pages → pega `docs/presence-worker.js`, crea un KV llamado `PRESENCE` y enlázalo.
2. Pon la URL del Worker en `launcher.config.json` → `"presenceUrl"`.
GitHub solo hospeda archivos estáticos, por eso la presencia en vivo necesita este mini servicio (gratis). Los nicks no se verifican: sirve para amigos, no para seguridad.

## 4. Instalador
`build/installer.nsh`: textos de bienvenida y final propios, enlace a GitHub y, al desinstalar a mano, pregunta si borrar también modpacks, mundos y ajustes (las actualizaciones nunca borran nada). Genera el .exe con el tag como siempre.
