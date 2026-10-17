# Activar Amigos + Chat (una sola vez, ~5 minutos, gratis)

Esto es lo que hace funcionar **solicitudes de amistad, lista de amigos, estado en línea y chat** en el launcher **y** en el cliente de Minecraft (Shift+Tab). Corre en Cloudflare Workers + D1 (plan gratis).

## Opción A · Por consola (la más corta)
Con Node instalado, en esta carpeta (`social-worker`):

```
npx wrangler login
npx wrangler d1 create atenas-social
```
Copia el `database_id` que te muestra y pégalo en `wrangler.toml` (reemplaza `PEGA_AQUI_EL_ID_DE_LA_BASE_D1`). Luego:

```
npx wrangler deploy
```
Las tablas se crean solas la primera vez que alguien usa el servicio. Wrangler te imprime la URL del Worker (termina en `.workers.dev`).

> El Worker se llama `atenas-presence` a propósito: **reemplaza** al Worker de presencia viejo y la URL que ya tienes en `launcher.config.json` (`presenceUrl` / `socialUrl`) sigue funcionando. Si usas otro nombre, pon la URL nueva en `launcher.config.json` → `"socialUrl"` **y** en `AtenasClient/.../SocialClient.java` → `DEFAULT_URL`.

## Opción B · Desde el panel de Cloudflare
1. https://dash.cloudflare.com → **Storage & Databases → D1 SQL database → Create** → nombre `atenas-social`.
2. **Workers & Pages** → abre tu Worker `atenas-presence` (o crea uno nuevo) → **Edit code** → borra todo y pega el contenido de `worker.mjs` → **Deploy**.
3. En el Worker: **Settings → Bindings → Add → D1 database** → variable `DB` → elige `atenas-social` → **Deploy**.

## Probar que funciona
Abre `https://TU-WORKER.workers.dev/` en el navegador: debe salir `{"name":"atenas-social","v":2,"ok":true}`.
Si en el launcher aparece "Falta enlazar la base de datos D1", repite el paso 3 de la opción B.

## Cómo funciona (por si lo necesitas)
- **Identidad:** el primer dispositivo que usa un nick se lo queda (clave secreta por instalación, guardada como hash). El launcher y el cliente de la misma PC comparten la clave (`%USERPROFILE%\.atenasclient\social.json`), así que son la misma persona. Si un nick lleva 30 días sin usarse, otra instalación puede reclamarlo. No hay verificación con Mojang: sirve para amigos, no para seguridad.
- **Solicitudes:** para agregar a alguien, esa persona debe haber abierto Atenas al menos una vez. Si los dos se envían solicitud a la vez, quedan como amigos solos.
- **Chat:** solo entre amigos aceptados; se guardan los últimos 200 mensajes de cada conversación; quitar a un amigo borra la conversación.
- **Límites del plan gratis de D1:** 100 000 escrituras y 5 millones de lecturas por día. El servicio solo escribe cuando cambia el estado de alguien (o cada ~40 s para renovar), así que alcanza de sobra para un grupo de amigos.
- **Datos que guarda:** nick, estado (launcher / jugando / servidor), amistades y mensajes. Cada jugador puede apagar "Mostrar mi estado a mis amigos" en Ajustes.

## Probar el Worker en local (sin Cloudflare)
`node social-worker/test/test-social-worker.js` (Node 22+; usa un D1 de mentira sobre SQLite).
