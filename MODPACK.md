# Atenas SMP · Supervivencia con propósito
> Forge 1.20.1 · ~60 mods · pensado para que siempre haya algo que hacer

## El gancho
Un survival sin meta se muere en dos semanas. Atenas tiene **una amenaza común, una meta común y metas personales**:
- **Amenaza: los jefes de Cataclysm** al inicio, y más adelante **el Wither Storm** (Cracker's Wither Storm Mod), que llega como evento en una actualización del pack. No está en el lanzamiento.
- **Meta común: construir la ciudad de Atenas** (Ágora, puerto, mercado, fábricas) con los materiales que cada fase desbloquea.
- **Metas personales: misiones** con Heracles (`odyssey-quests`), un capítulo por fase, con recompensas reales.

## La escalera de progreso (farmeo obligatorio)
Cada fase pide recursos de la anterior. Nadie salta pasos.

| Fase | Qué se hace | Qué hay que farmear / vencer | Desbloquea |
|---|---|---|---|
| 1. Refugio | Casa, comida, primer mapa, claim | Cultivos, madera, hierro; sobrevivir las primeras noches | Waystones, Create básico |
| 2. Granjas y cocina | Huertos, cocina, almacenamiento | Granjas de Farmer's Delight, mochilas | Equipo de diamante |
| 3. Mecánica | Fábricas y automatización | Create: farms automáticas para producir en masa | Materiales para equipo de jefes |
| 4. Mazmorras | Terralith + YUNG's + Alex's Caves + Mowzie | Explorar, saquear (Lootr) y vencer mini-jefes | Netherite y armas de jefe |
| 5. Cataclysm | Los jefes duros (Cataclysm) | Armadura y armas se fabrican con **drops de jefes**: hay que repetir peleas | Gear de final |
| 6. El Wither Storm (más adelante) | Pelea conjunta, todo el servidor | Equipo de fase 5, comida, pociones, bases de retirada | La ciudad completa y el título del servidor |

Los jefes de Cataclysm limitan el daño por golpe y castigan tácticas de trampa, así que el equipo y la habilidad importan (según su documentación).

## Misiones (Heracles)
1. Instala el pack y entra a un mundo de prueba.
2. Abre el libro de misiones y usa el editor en el juego (necesitas ser operador) para crear un capítulo por fase.
3. Cada misión: 1 tarea clara (conseguir X, matar a Y, construir Z) y recompensa útil (materiales, waystones, comida, un cofre de botín).
4. Copia la carpeta de configuración de Heracles a `files/config/` del pack y ejecuta `npm run pack`.

## Que nunca se aburran
- **Evento semanal:** concurso de construcción, carrera de exploración, cacería de un jefe de Cataclysm.
- **Libro de la ciudad:** obras terminadas y quién las hizo.
- **Hitos del servidor:** cada fase completada por el grupo se celebra con fuegos artificiales en el Ágora.
- **Wither Storm como evento:** ya está fuera de `mods.txt`. El día del anuncio quita el `#` de la línea `crackers-wither-storm-mod`, corre `npm run pack` y haz push; los jugadores ven el aviso de actualización.

## Antes de abrirlo a todos
- **El Wither Storm (cuando lo actives) es pesado:** se carga siempre y se ve a miles de bloques. Es el mod con más riesgo para PCs malas y para el servidor. Pruébalo con 3 o 4 personas antes de lanzar.
- **Puede destruir construcciones:** guarda copias del mundo y usa claims en la ciudad. Revisa los ajustes del mod en su config y en la página del mod en Modrinth.
- **RAM:** con Cataclysm, Alex's Caves, Create y el Wither Storm, sube el mínimo a 4G y recomienda 6G (`pack.json → ram`). En el servidor, 6 a 8 GB.
- **Optimización ya incluida:** Embeddium, ModernFix, FerriteCore, Entity Culling, ImmediatelyFast, Dynamic FPS. Las animaciones (Not Enough Animations) son ligeras; los shaders (Oculus) quedan opcionales.
- **Compatibilidad:** nadie probó esta combinación junta. Corre `npm run pack`, revisa la lista de "No se pudieron añadir" y abre el juego antes de publicar. Los slugs nuevos no los pude comprobar todos desde aquí.

## Cómo lo administras
1. Edita `mods.txt` (un slug de Modrinth por línea; `slug@version` para fijar).
2. `npm run pack -- RUTA/atenas-packs/atenas-smp --note "texto"`
3. `git add . && git commit -m "Update" && git push`
4. Tus amigos reciben el aviso y se actualizan con un clic. Reinicia el servidor para que también se sincronice.
