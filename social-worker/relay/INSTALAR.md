# Relay de verificación (VM de Azure)

Por qué: Mojang devuelve 403 al `hasJoined` que hace el Worker de Cloudflare. El relay lo hace desde tu VM.

## 0. Comprobar que la VM no está bloqueada (10 segundos)
```
curl -i "https://sessionserver.mojang.com/session/minecraft/hasJoined?username=Notch&serverId=abc123abc123abc1"
```
Debe responder `HTTP/2 204`. Si responde 403, la VM tampoco sirve y hay que usar otra máquina.

## 1. En la VM
```
sudo apt install -y nodejs   # Node 18+
mkdir -p ~/relay && cd ~/relay   # copia aquí relay.mjs
RELAY_KEY=$(openssl rand -base64 24 | tr -d '/+=') ; echo $RELAY_KEY   # GUARDA esta clave
RELAY_KEY=$RELAY_KEY node relay.mjs
```
Prueba local: `curl -i -H "x-relay-key: TU_CLAVE" "http://127.0.0.1:8787/hasJoined?username=Notch&serverId=abc123abc123abc1"` → 204.

## 2. HTTPS
Instala Caddy y en `/etc/caddy/Caddyfile`: `TU-HOST { reverse_proxy 127.0.0.1:8787 }`. `TU-HOST` puede ser un subdominio tuyo (A → IP de la VM) o la etiqueta DNS gratis de la IP pública de Azure (`algo.eastus.cloudapp.azure.com`). Abre los puertos 80 y 443 en el grupo de seguridad de red de Azure.

## 3. Dejarlo permanente
Crea `/etc/systemd/system/atenas-relay.service` con `ExecStart=/usr/bin/node /home/TU_USUARIO/relay/relay.mjs`, `Environment=RELAY_KEY=TU_CLAVE`, `Restart=always`, y luego `sudo systemctl enable --now atenas-relay`.

## 4. Conectar el Worker (en social-worker)
```
npx wrangler secret put MOJANG_RELAY_URL     # https://TU-HOST
npx wrangler secret put MOJANG_RELAY_KEY     # la clave
npx wrangler deploy
```
Si el relay falla, el Worker cae solo al método directo.
