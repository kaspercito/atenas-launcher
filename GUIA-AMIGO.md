# Guía para colaborar en Atenas SMP

Vas a poder agregar y quitar mods del modpack con un menú, sin tocar archivos a mano.

## 1. Instala (una sola vez)
- **Git**: https://git-scm.com
- **Node.js 18 o superior** (versión LTS): https://nodejs.org
- Una cuenta de **GitHub**. Pásale tu usuario a quien te invitó y **acepta la invitación** que te llega por correo.

## 2. Configura Git (una vez)
Abre una terminal (cmd o PowerShell) y ejecuta, con tus datos:
```
git config --global user.name "Tu nombre"
git config --global user.email "tu@correo.com"
```

## 3. Descarga los dos repositorios en la MISMA carpeta
```
mkdir D:\atenas
cd D:\atenas
git clone https://github.com/kaspercito/atenas-launcher
git clone https://github.com/kaspercito/atenas-packs
```
La primera vez, Git abre el navegador para que inicies sesión en GitHub: hazlo con tu cuenta.

Quedará así:
```
D:\atenas\atenas-launcher
D:\atenas\atenas-packs
```

## 4. Abre la herramienta
En `D:\atenas\atenas-launcher` haz doble clic en **`Atenas-Admin.bat`**.
Encuentra sola la carpeta del pack. Si te la pregunta, escribe `D:\atenas\atenas-packs\atenas-smp`.

## 5. Agrega un mod
1. Opción **2** → escribe el nombre del mod → elige el número → confirma.
   (Solo aparecen mods que funcionan en **Forge 1.20.1**.)
2. **Pruébalo en el juego** antes de publicar, para ver que no rompe nada.
3. Opción **6 · Publicar** → escribe qué agregaste → confirma. Los jugadores recibirán el aviso de actualización.

## 6. Otras opciones útiles
- **4** quita un mod · **5** lo desactiva sin borrarlo · **1** lista todo.
- **11** trae lo que hizo el otro admin y muestra quién cambió qué.

## 7. Reglas de oro
- Avisa en el chat antes de publicar para no hacerlo a la vez que otro.
- No subas mods que no hayas probado.
- Si algo falla, copia el mensaje de error tal cual y pásalo en el chat.

Guía completa: `ADMIN-GUIA.md`.
