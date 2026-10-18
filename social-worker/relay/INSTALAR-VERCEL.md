# Relay en Vercel (sin VM, gratis)

1. Crea cuenta en https://vercel.com (plan Hobby) e instala la CLI: `npm i -g vercel`.
2. En la carpeta `relay/vercel`: `vercel login`, luego `vercel --prod` (acepta los valores por defecto).
3. Pon la clave: `vercel env add RELAY_KEY production` (16+ caracteres, guárdala) y vuelve a correr `vercel --prod`.
4. Prueba (debe dar 204; si da 403, Mojang también bloquea esa red):
   `curl -i -H "x-relay-key: TU_CLAVE" "https://TU-PROYECTO.vercel.app/api/hasJoined?username=Notch&serverId=abc123abc123abc1"`
5. Conecta el Worker (en social-worker):
   `npx wrangler secret put MOJANG_RELAY_URL`  → `https://TU-PROYECTO.vercel.app/api`  (termina en /api, sin barra final)
   `npx wrangler secret put MOJANG_RELAY_KEY`  → la misma clave
   `npx wrangler deploy`
