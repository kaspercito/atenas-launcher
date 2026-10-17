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
- **Identidad y verificación premium:** la identidad es el nick. Con una **cuenta de Microsoft (premium)** el launcher y el cliente de Minecraft demuestran con Mojang que la cuenta es tuya: piden un desafío (`/auth/challenge`), lo registran en Mojang con tu sesión (`joinServer`; solo el dueño de la cuenta puede) y el Worker lo comprueba en `sessionserver.mojang.com/.../hasJoined` (`/auth/verify`). Si Mojang lo confirma, el nick queda **verificado** (`users.verified = 1`) y solo las instalaciones que lo demostraron pueden usarlo (máx. 5 PC; otra PC se verifica sola con su sesión de Minecraft). Las **cuentas sin conexión** quedan como no verificadas: amigos y chat funcionan igual, pero **no pueden elegir ni mostrar cosméticos privados** (como la mascota Catalina). Si alguien usó un nick sin ser su dueño, el dueño real lo recupera al verificarse. Los clientes viejos (sin verificación) siguen funcionando como cuentas sin verificar.
- **Solicitudes:** para agregar a alguien, esa persona debe haber abierto Atenas al menos una vez. Si los dos se envían solicitud a la vez, quedan como amigos solos.
- **Chat:** solo entre amigos aceptados; se guardan los últimos 200 mensajes de cada conversación; quitar a un amigo borra la conversación.
- **Límites del plan gratis de D1:** 100 000 escrituras y 5 millones de lecturas por día. El servicio solo escribe cuando cambia el estado de alguien (o cada ~40 s para renovar), así que alcanza de sobra para un grupo de amigos.
- **Datos que guarda:** nick, estado (launcher / jugando / servidor), amistades y mensajes. Cada jugador puede apagar "Mostrar mi estado a mis amigos" en Ajustes.

## Activar el panel /admin (ADMIN_KEY)
El panel `https://TU-WORKER.workers.dev/admin` sirve para crear cosméticos, darle la mascota Catalina a otros nicks, etc. Está **apagado** hasta que crees la clave secreta `ADMIN_KEY` (mínimo 12 caracteres):
1. Inventa una clave larga (si quieres, genera una: `node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"`) y guárdala en tu gestor de contraseñas.
2. En esta carpeta (`social-worker`): `npx wrangler secret put ADMIN_KEY` → pega la clave y Enter (no se ve al escribir; es normal).
   (Desde el panel web: Workers & Pages → tu Worker → Settings → Variables and Secrets → Add → tipo **Secret**, nombre `ADMIN_KEY`.)
3. `npx wrangler deploy` si además cambiaste el código del Worker.
4. Abre `/admin` en el navegador y pega la clave. Tras 10 intentos fallidos se bloquea 10 minutos.
Nunca la escribas en `wrangler.toml` ni la subas a GitHub. Para cambiarla, repite el paso 2.

## Probar el Worker en local (sin Cloudflare)
`node social-worker/test/test-social-worker.js`, `node social-worker/test/test-cosmetics-admin.js` y `node social-worker/test/test-verify.js` (Node 22+; usan un D1 de mentira sobre SQLite y un Mojang de mentira).
