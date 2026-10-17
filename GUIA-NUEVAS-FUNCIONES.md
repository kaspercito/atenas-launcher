# Novedades v1.3.0 · Amigos con solicitudes y chat

- **Solicitudes de amistad:** escribes el nick, la otra persona acepta o rechaza. Ya no se agrega a nadie sin permiso.
- **Chat privado** entre amigos, en el launcher y dentro del juego con **Shift+Tab** (también desde el menú principal y el de pausa del Atenas Client).
- **Avisos** de mensajes, solicitudes y amigos que se conectan, en el launcher (Windows) y en pantalla dentro de Minecraft.
- La insignia numérica de Amigos ya no tapa el ícono; el selector de modpack se ve bien con 1 o 2 packs.
- Todo corre en un Worker de Cloudflare (gratis) que **reemplaza** al servicio de presencia viejo.

**Qué tienes que hacer tú (una sola vez):** sigue `social-worker/LEEME.md` (crear la base D1 `atenas-social` y `npx wrangler deploy`). Mientras no lo hagas, el launcher dirá "servicio no disponible". La URL va en `launcher.config.json` → `"socialUrl"`.

---

# Novedades v1.2.0 · Amigos

**Qué cambia en la pestaña Amigos**
- Ves la **cara** de cada amigo, quién está **en el servidor**, **jugando <modpack>** o **en el launcher**.
- **Aviso de Windows** cuando un amigo se conecta (se puede apagar en Ajustes → *Avisarme cuando un amigo se conecte*). El punto verde de la pestaña se actualiza solo, aunque no la tengas abierta.
- Tu estado se actualiza al instante al entrar a jugar o cerrar el juego, y desaparece al salir del todo (bandeja → *Salir del todo*).
- Si el servicio de presencia no responde, el launcher lo dice en vez de marcar a todos como desconectados.
- No puedes añadirte a ti mismo.

**Arreglos de fondo (presencia)**
- Antes, si el reloj del PC de un amigo estaba mal, todos aparecían desconectados. Ahora la antigüedad la calcula el servicio.
- Antes cada launcher escribía cada minuto en el KV gratis de Cloudflare (límite 1000 escrituras/día) y se agotaba con pocos amigos. Ahora solo escribe cuando cambia el estado o cada ~200 s.

**Qué tienes que hacer tú (una vez):** el servicio de presencia hay que activarlo en Cloudflare y poner su URL en `launcher.config.json` → `"presenceUrl"`. Guía de 5 minutos: `presence/LEEME.md`. Si ya lo tenías activado, **vuelve a pegar el nuevo `docs/presence-worker.js`** en tu Worker (el anterior sigue funcionando pero con los problemas de arriba). Sin presencia, los amigos solo se ven cuando están dentro del servidor.

**Para publicar v1.2.0:** `git add -A` · `git commit -m "v1.2.0"` · `git tag v1.2.0` · `git push && git push --tags`. La versión de `package.json` ya es 1.2.0 y debe coincidir con el tag.

---

# Novedades v1.1.2

## 1. Actualización automática del launcher (arreglada)
**Qué fallaba:** solo se comprobaba una vez al abrir, sin avisos y los errores se ocultaban. Además, si el tag de GitHub no coincide con la `version` de `package.json`, el launcher instalado nunca ve la versión nueva.

**Ahora:** comprueba al abrir y cada 30 min, muestra un aviso con barra de descarga y botón **Reiniciar y actualizar**, y hay un botón en Ajustes → *Buscar actualizaciones*. Los errores quedan en `%USERPROFILE%\.atenasclient\logs\updater.log`. El workflow falla si el tag no coincide con la versión.

**Para publicar una versión nueva:**
1. Sube `version` en `package.json` (ej. `1.1.3`).
2. `git commit -am "v1.1.3"` · `git tag v1.1.3` · `git push && git push --tags`
3. Espera a que Actions termine y deja el release **publicado** (no borrador). El repo debe ser **público**.
Solo funciona en el launcher **instalado** (no con `npm start`). Los modpacks se siguen actualizando aparte, cada 5 min.

## 2. Discord Rich Presence
1. https://discord.com/developers/applications → New Application (el nombre es lo que se ve: "Atenas Client").
2. Copia el **Application ID** a `launcher.config.json` → `"discordClientId"`.
3. En Rich Presence → Art Assets sube una imagen con el nombre `icon`.
Se activa/desactiva en Ajustes. Muestra "En el launcher" o "Jugando <modpack>" con el tiempo.

## 3. Amigos y chat
Pestaña **Amigos**: envías solicitudes por nick, ves quién está en el launcher o jugando (y en qué servidor) y chateas. Se activa una vez con `social-worker/LEEME.md` (Worker de Cloudflare + base D1, gratis) y la URL en `launcher.config.json` → `"socialUrl"`. Los nicks no se verifican con Mojang: sirve para amigos, no para seguridad. El sistema anterior (`presence/`, `presenceUrl`, KV `PRESENCE`) ya no se usa.

## 4. Instalador
`build/installer.nsh`: textos de bienvenida y final propios, enlace a GitHub y, al desinstalar a mano, pregunta si borrar también modpacks, mundos y ajustes (las actualizaciones nunca borran nada). Genera el .exe con el tag como siempre.

## 5. Instalador propio (como el de Lunar Client)
Carpeta `installer/`: una mini-app con interfaz a medida (fondo animado, logo, barra de progreso). Descarga el instalador oficial del último release, lo ejecuta en silencio y abre el launcher. El workflow lo compila y lo sube al release como **`Atenas-Client-Instalador.exe`**.
Enlace fijo para tus amigos: https://github.com/kaspercito/atenas-launcher/releases/latest/download/Atenas-Client-Instalador.exe
Para verlo sin publicar: `npm run installer` (necesita que ya exista un release).
El `Atenas-Client-Setup-x.y.z.exe` sigue en el release porque lo usan el instalador propio y la actualización automática; no lo borres.
