# Activar la presencia de amigos (una sola vez, 5 minutos, gratis)

Sin esto, la pestaña **Amigos** solo ve quién está dentro del servidor. Con esto también ve **"Jugando <modpack>"** y **"En el launcher"**, y avisa cuando un amigo se conecta.

## Opción A · Desde el panel de Cloudflare (la más fácil)
1. Crea una cuenta gratis en https://dash.cloudflare.com
2. **Storage & Databases → KV → Create** → nombre `PRESENCE`.
3. **Workers & Pages → Create → Hello World** → ponle de nombre `atenas-presence` → **Deploy** → **Edit code** → borra todo, pega el contenido de `docs/presence-worker.js` → **Deploy**.
4. En el Worker: **Settings → Bindings → Add → KV namespace** → variable `PRESENCE` → elige el KV del paso 2 → **Deploy**.
5. Copia la URL del Worker (termina en `.workers.dev`).
6. Pégala en `launcher.config.json`:
   ```json
   "presenceUrl": "https://atenas-presence.TU-USUARIO.workers.dev"
   ```
7. Sube la versión en `package.json`, haz `git tag vX.Y.Z` y `git push --tags` como siempre. Los launchers instalados se actualizan solos.

## Opción B · Por consola
Con Node instalado, en la carpeta del proyecto: `npx wrangler login`, luego `npx wrangler kv namespace create PRESENCE`, pega el `id` en `wrangler.toml` y ejecuta `npx wrangler deploy`.

## Probar que funciona
Abre en el navegador `https://TU-WORKER.workers.dev/presence?names=kasper` → debe salir `{}` (o los datos del nick si está conectado). Si sale `Falta enlazar el KV`, repite el paso 4.

## Cosas que conviene saber
- **Plan gratis:** KV permite 1000 escrituras al día. El Worker solo escribe cuando cambia el estado de alguien o cada ~200 s, así que alcanza para un grupo de amigos (decenas de personas, varias horas al día).
- **Estado "conectado":** el launcher avisa cada 90 s y al cerrarse del todo (desde la bandeja o con la X si "seguir en segundo plano" está apagado). Si un PC se apaga de golpe, el amigo aparece conectado hasta ~5 minutos.
- **Privacidad:** cada jugador puede apagar "Mostrar mi estado a mis amigos" en Ajustes. El servicio solo guarda nick, modpack y si está jugando, y lo borra solo a los 15 minutos.
- **Seguridad:** los nicks no se verifican (sirve para amigos, no para seguridad). Cualquiera que conozca la URL y un nick podría ver o falsear su estado.
