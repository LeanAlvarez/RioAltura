# 015 — "Mi casa": a qué altura se moja un punto

- **Estado:** lista
- **Rama:** feat/015-mi-casa
- **Depende de:** 006 (capas de inundación), 011 (avisos por umbral) — mergeadas
- **Puede ir en paralelo con:** specs de worker

## Objetivo

Responder la pregunta que el vecino realmente tiene: **"¿a qué altura del río se moja mi casa?"**.
Todo lo demás que muestra la app es contexto; esto es la respuesta.

## Estado actual

El `CLAUDE.md` lista "Mi casa" en la visión (§1) y describe un ráster de "altura a la que se moja
cada píxel" (§3). **Ninguno de los dos existe**: `generar_capas.py` sólo produce los 43 GeoJSON y su
`index.json`. Mismo patrón que el canal de Telegram y la PWA: está en la visión, no en el código.

## Alcance

### C1 — Marcar un punto en el mapa

El vecino toca su casa en el mapa (o usa su ubicación, si la da). Aparece un marcador y la respuesta.

### C2 — La respuesta se calcula en el navegador, sin mandarnos el punto

**La coordenada de la casa no sale del dispositivo.** No hay endpoint al que se le pregunte, ni
ráster que se descargue entero: el navegador busca la respuesta en **las capas que ya usa el mapa**.

Como las capas están ordenadas por altura, alcanza una **búsqueda binaria**: probar si el punto cae
dentro del agua de la capa del medio, y según el resultado subir o bajar. Sobre 43 capas son ~6
consultas en vez de 43, y varias ya están en la caché del mapa.

Esto no es sólo una optimización: es lo que mantiene intacta la promesa del FAQ. La ubicación de una
casa es dato personal sensible —dice dónde vive alguien—, y la forma más segura de tratarla es no
recibirla nunca.

### C3 — El punto se guarda sólo en el navegador

`localStorage`, con `try/catch`, igual que la preferencia de tema. Si falla o se limpia, la app
funciona y el vecino vuelve a marcar. **No se guarda nada en el servidor y no hace falta cuenta.**

### C4 — Engancha con los avisos por umbral

Una vez calculada la altura, el botón de avisos arma el link de Telegram **con ese valor ya
cargado** (spec 011). El vecino pasa de "mi casa se moja a 7,40 m" a "avisame cuando el río llegue a
7,40" en un toque, sin escribir un número.

### C5 — El disclaimer, que acá es lo más importante

Ningún referente grande da una altura exacta por propiedad. El servicio del Reino Unido
([gov.uk/check-long-term-flood-risk](https://www.gov.uk/check-long-term-flood-risk)) busca por código
postal y dice textualmente:

> *"This service does not tell you how likely it is that an individual property will flood"*

Aclaran que el umbral de la puerta, el nivel del piso y las rejillas de aire son factores que el
mapa no puede conocer. FEMA usa zonas con porcentaje anual; First Street, un score. **Nuestro
enfoque es más específico que el de cualquiera de ellos**, y eso lo hace más útil y más peligroso.

El dato que lo alimenta tiene límites duros:

- El DEM es **Copernicus GLO-30: píxeles de 30 m**, y es de superficie — **incluye techos y
  árboles**, no el suelo.
- Los polígonos están simplificados a ~20 m de tolerancia.
- El modelo **no conoce defensas, desagües, bombeo ni lluvia local**.
- El desfase de datum EGM2008 ↔ IGN sigue sin resolverse de forma independiente (§5).

Por eso, junto a la respuesta, **siempre y sin poder cerrarse**:

> **Es un cálculo aproximado, no una medición de tu casa.**
> Usa una imagen satelital de 30 metros que incluye techos y árboles, y no conoce el umbral de tu
> puerta, el nivel del piso, las defensas ni los desagües. Puede errar por metros.
> Ante una crecida, seguí a Prefectura y a Defensa Civil.

La altura se muestra **redondeada al escalón de las capas** (0,25 m), nunca con más precisión de la
que el dato tiene.

### C6 — Marcar, cambiar y borrar el punto, con un botón que se vea

**Defecto encontrado al usar la app**: el handler de click del mapa marcaba "Mi casa" en **cualquier**
click, sin condición (`map.on("click", …)` en `map.ts`). Tocar el mapa para cerrar un popup, para
mirar otra zona o sin querer movía la casa del vecino, y no había forma de deshacerlo ni de borrarla.
Reportado así: *"tengo que poder eliminar o editar el puntero porque me equivoqué y no puedo
modificarlo"*.

De fondo hay un problema de diseño: la función era **un click escondido en el mapa**. Un vecino
—sobre todo uno mayor— no toca un mapa al azar a ver qué pasa. La función existía y no se usaba.

Se da vuelta: el gesto pasa a ser **explícito y con estado visible**.

- **Sin punto marcado** → un botón `📍 Marcar mi casa`.
- **Al tocarlo** → el mapa entra en **modo elección**: cartel encima del lienzo ("Tocá tu casa en el
  mapa"), cursor de mira, y un botón `Cancelar`. **Sólo en este modo un click marca el punto**; en
  cualquier otro momento el mapa se navega sin riesgo de mover nada.
- **El modo se apaga solo** al marcar (es de un uso), al cancelar y al apretar `Escape`.
- **Con punto marcado** → la respuesta, y debajo `Elegir otro punto` y `Borrar`.
- **`Borrar`** saca el marcador del mapa, limpia `localStorage` y vuelve la tarjeta a su estado
  inicial. **Sin diálogo de confirmación**: no es una acción destructiva ni irrecuperable —es un
  punto en un mapa— y un diálogo más es fricción para alguien que ya está inseguro. Volver a
  marcarlo son dos toques.

### C7 — Explicarle al vecino cómo se usa

Junto al botón, un `¿Cómo se usa?` plegable (`<details>`, sin JS) con los tres pasos:

> 1. Tocá **"Marcar mi casa"**
> 2. Tocá tu casa en el mapa
> 3. Te decimos a qué altura del río llega el agua ahí

Y una cuarta línea con la promesa de privacidad, que es la que hace que alguien se anime a marcar su
propia casa:

> El punto queda guardado **sólo en este teléfono**. No se envía a ningún lado.

El marcador lleva su etiqueta "Mi casa" visible en el mapa, para distinguirlo de las capas azules y
del hidrómetro.

## Fuera de alcance

- **No se guarda nada en el servidor** y **no hay login**. Decisión del usuario: el punto vive en el
  navegador. Si algún día se quiere sincronizar entre dispositivos, es una spec propia con su
  infraestructura de cuentas y su política de privacidad.
- No se genera el ráster por píxel del §3: la búsqueda binaria sobre las capas existentes responde lo
  mismo sin un artefacto nuevo que versionar ni descargar. Si en el futuro hiciera falta más
  precisión, ahí sí conviene.
- No se cambian las capas, los umbrales ni la curva (§5, §9).
- No se agregan dependencias.

## Diseño / decisiones

### Por qué la búsqueda binaria y no el ráster

| | Búsqueda binaria sobre las capas | Ráster por píxel |
|---|---|---|
| La coordenada sale del dispositivo | **no** | sí, o se baja el ráster entero |
| Artefacto nuevo que versionar | no | sí, y pesado |
| Descarga en 3G | ~6 capas, varias ya en caché | el ráster completo, o un endpoint |
| Precisión | la del DEM, igual | la del DEM, igual |

La precisión es la misma porque **las dos salen del mismo DEM de 30 m**. Lo que cambia es el costo y
la privacidad.

### Casos que hay que resolver bien

- **Punto fuera del área modelada**: decirlo, no inventar una altura.
- **Punto que ya está bajo agua** a la altura mínima de las capas (3,00 m): decir que está en zona
  que se inunda con el río en su nivel habitual.
- **Punto que no se moja ni a 20 m**: decir eso, que es la buena noticia, sin sugerir que es
  imposible que se inunde — la lluvia local y los desagües no están en el modelo.

## Criterios de aceptación

- [x] El vecino puede marcar un punto tocando el mapa, y ve la altura a la que se moja.
      Verificado en navegador (Playwright, `pnpm dev` real): click → tarjeta "Mi casa" muestra la
      altura calculada (ver "Cómo verificar").
- [x] **La coordenada nunca se envía al servidor**, verificado inspeccionando el tráfico de red.
      `frontend/scripts/verificar-mi-casa-privacidad.mjs`: 0 coincidencias de la lat/lng clickeada
      (probada con 3-6 decimales, con punto y con coma) en ninguna URL ni body de ninguna request
      posterior al click.
- [x] La búsqueda usa a lo sumo ~6 capas, no las 43. Verificado por test unitario
      (`domain/miCasa.test.ts`, cuenta las llamadas a `cache.get`) y en navegador real: **6
      requests de capas GeoJSON tras el click**, exactamente `ceil(log2(43))`.
- [x] El punto sobrevive a recargar la página, y la app funciona si `localStorage` falla.
      Persistencia verificada en navegador (marcador y resultado reaparecen tras `page.reload()`);
      el "nunca lanza" de `leerPuntoGuardado`/`guardarPunto` está cubierto por
      `miCasaStorage.test.ts` con un storage que tira `DOMException` en cada llamada.
- [x] El botón de avisos arma el link de Telegram con la altura ya cargada. `precargarUmbral`
      (`avisosTelegram.ts`) llamada desde `mountMiCasa`; verificado visualmente en navegador (sin
      test unitario: requiere `querySelector` sobre DOM real, y el entorno de vitest del repo es
      `"node"`, sin jsdom — mismo criterio que el resto de `mountAvisosTelegram`).
- [x] El disclaimer se ve junto a la respuesta, **siempre**, y no se puede cerrar. Testeado
      (`miCasa.test.ts`: el HTML nunca incluye `<button`) y confirmado en navegador.
- [x] La altura se muestra redondeada al escalón de las capas. La búsqueda binaria devuelve
      `entry.h` tal cual, sin cálculo adicional (`domain/miCasa.test.ts`, test "la altura devuelta
      es exactamente la de la capa encontrada").
- [x] Los tres casos de borde (fuera del área, ya inundado a 3 m, seco a 20 m) tienen su texto y su
      test. `domain/miCasa.test.ts` (`buscarAlturaInundacion`, `deriveMiCasaView`) y
      `components/miCasa.test.ts`.
- [x] El FAQ explica que el punto se guarda sólo en el navegador y que no se envía a ningún lado.
      Entrada "privacidad" extendida en `faq.ts`; test existente sigue verde.
- [x] Funciona a 360 px, en ambos temas. Verificado en navegador: 336 px de ancho de tarjeta a 360
      px de viewport, sin overflow horizontal de la página, en `light` y en `dark`.
- [x] **(C6)** Un click en el mapa **fuera del modo elección no mueve ni crea** el marcador.
      Verificado en la app real con **control positivo**: el script cuenta los clicks que Leaflet
      recibe de verdad, porque "no pasó nada" también es el resultado de un click que nunca llegó.
- [x] **(C6)** `Marcar mi casa` entra en modo elección, con cartel y cursor propios; `Cancelar`,
      `Escape` y marcar el punto lo apagan. Los cuatro caminos verificados en navegador.
- [x] **(C6)** `Elegir otro punto` vuelve a entrar en modo elección y el segundo punto reemplaza al
      primero: queda **un solo** marcador y el valor de `localStorage` cambia.
- [x] **(C6)** `Borrar` saca el marcador del mapa, limpia `localStorage` (verificado recargando la
      página) y la tarjeta vuelve a "sin punto", sin diálogo de confirmación.
- [x] **(C7)** El `¿Cómo se usa?` muestra los tres pasos y la promesa de privacidad, plegado por
      defecto. Capturas en `specs/assets/015/c6-*.png` (360 y 1280 px, claro y oscuro); sin
      overflow horizontal y los botones miden 44 px de alto en los tres anchos.
- [x] `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan. Ver "Cómo verificar" para los resultados
      literales.

## Cómo verificar

```bash
cd /Users/leandroalvarez/orca/workspaces/RioAltura/micasa
set -a; . ./.env.local 2>/dev/null; set +a

# Backend/worker (sin cambios en esta spec; confirmado que siguen pasando)
uv run ruff check .            # All checks passed!
uv run ruff format --check .   # 117 files already formatted
uv run pytest -q               # 335 passed, 4 skipped, 3 deselected

# Frontend
pnpm -C frontend install
pnpm -C frontend exec tsc --noEmit   # sin salida = OK
pnpm -C frontend build               # OK (tsc --noEmit && vite build)
pnpm -C frontend test                # 292 passed (30 archivos)

# Navegador (con el server de dev del worktree corriendo, puerto de .env.local: 5203)
pnpm -C frontend dev --host 127.0.0.1 --port "$WEB_PORT" &
URL="http://127.0.0.1:$WEB_PORT" node frontend/scripts/verificar-mi-casa-privacidad.mjs
```

Resultado real del script de privacidad (T9), corrido contra el dev server real:

```
✓ el mapa expone window.mapaInundacion con un método containerPointToLatLng utilizable
✓ el disclaimer fijo (C5) aparece junto a la respuesta
✓ el disclaimer no tiene ningún botón para cerrarlo
6 requests después del click.
✓ ninguna URL ni body de las requests posteriores al click contiene la lat/lng clickeada
  Punto clickeado: lat=-32.21037850723933, lng=-58.144969940185554
Capas GeoJSON pedidas después del click: 6 (h_0825, h_1150, h_1600, h_1300, h_1500, h_1400.geojson)
✓ se consultan a lo sumo 6 capas después del click (ceil(log2(43))), no las 43
OK: la coordenada de Mi casa nunca sale del dispositivo.
```

Verificación manual adicional en navegador (Playwright, script ad-hoc no commiteado — sólo
`verificar-mi-casa-privacidad.mjs` queda en el repo, spec 015 T9 pidió uno solo):

- **Persistencia**: se marca un punto, se recarga la página (`page.reload()`) y tanto el marcador
  naranja "Mi casa" como el resultado de la tarjeta reaparecen sin volver a tocar el mapa.
- **360 px, ambos temas**: tarjeta "Mi casa" con 336 px de ancho a 360 px de viewport, sin
  overflow horizontal de la página, en `colorScheme: "light"` y `"dark"`.
- **3 puntos reales de Colón** (lat/lng aproximados, buscados a partir de `PUERTO_HIDROMETRO` y
  `COLON_CENTER` en `map.ts`; resultados reales, no supuestos):
  - Hidrómetro del puerto / costanera (`-32.2147, -58.137`, la misma coordenada de
    `PUERTO_HIDROMETRO`): **se moja a 4,25 m** — bajo, como se esperaba de un punto de la
    costanera. (Un click de mouse *literal* ahí lo intercepta el propio marcador del hidrómetro,
    que tiene su popup — se confirmó disparando el mismo evento `click` de Leaflet que dispara un
    click real, que pasa por el mismo handler de `map.ts`, para separar esa interferencia de
    marcador de la lógica de la app.)
  - Centro de la ciudad (`-32.2205, -58.155`): **"no se moja ni con el río en 20,00 m"** — seco en
    todo el rango modelado, como se esperaba de un punto alejado del río.
  - Fuera del área modelada (`-33.0, -58.145`, bien al sur del `bbox` real
    `[-58.35, -32.35, -57.95, -32.1]`): **"Ese punto queda fuera del área que mapeamos"**.

### C6/C7 — marcar, cambiar, borrar y la ayuda

```bash
cd frontend
pnpm exec tsc --noEmit          # sin errores
pnpm test                       # 30 archivos, 303 tests
pnpm build

# Con `pnpm dev` levantado (WEB_PORT de .env.local):
URL=http://127.0.0.1:5203 node scripts/verificar-mi-casa-controles.mjs
node scripts/capturas-mi-casa.mjs     # captura y mide 360/1280, claro y oscuro
```

`verificar-mi-casa-controles.mjs` corre 35 chequeos sobre la app real, en este orden: control
positivo de que el click llega a Leaflet → el click fuera del modo elección no marca → el botón
enciende el modo (cartel + cursor) → `Escape` cancela → `Cancelar` cancela → el click en modo
elección marca y apaga el modo → "Elegir otro punto" reemplaza sin acumular marcadores → `Borrar`
limpia mapa y `localStorage` y sobrevive a recargar → la ayuda de C7 está y va plegada.

Los últimos chequeos cubren los arreglos de la revisión, y **seis de ellos fallan si se revierte el
código** (verificado con `git stash`: la ayuda plegándose sola, el nodo `aria-live` recreado, el foco
perdido, y los tres del escenario de 3G). Dos escenarios se prueban con la red frenada a propósito
(`page.route` con demora): `index.json` a 6 s y el chunk de `map.ts` a 5 s.

`capturas-mi-casa.mjs` deja las capturas en `specs/assets/015/` y mide lo que una captura no
muestra: sin overflow horizontal de la página y 44 px de alto en cada botón, a 360 y 1280 px, en
`light` y `dark`.

Backend sin tocar, verde igual: `uv run ruff check . && uv run ruff format --check . && uv run
pytest -q` → 335 passed, 4 skipped.

### Arreglos de la revisión (previos al merge)

Un revisor sobre el diff de C6/C7 encontró cinco defectos reales. Todos arreglados, todos con un
chequeo que falla si se revierten:

1. **El modo elección no servía hasta que cargaban las capas.** El cartel, el cursor y el
   `map.on("click")` vivían dentro del `.then()` de `fetchCapaIndex()`, pero el botón de la tarjeta
   se puede apretar mucho antes. En 3G —el target de `CLAUDE.md` §7— el vecino tocaba "Marcar mi
   casa", tocaba el mapa y no pasaba nada. Se subieron fuera del `.then()`: marcar es dibujar un
   círculo, no necesita el índice. Y si `index.json` **falla**, ahora el mapa lo avisa
   (`onCapaIndexError`) en vez de dejar la tarjeta en "Buscando…" para siempre con un modo encendido
   que no lleva a ningún lado.
2. **El punto guardado se perdía** si el vecino entraba al modo elección antes de que cargaran las
   capas: la restauración corría una sola vez y sólo si la tarjeta seguía en "sin punto", así que
   quedaba un punto en `localStorage` que la app ya no mostraba. Ahora la guarda mira si el vecino
   marcó algo (`puntoMarcado`), no en qué pantalla está.
3. **La región `aria-live` se destruía y recreaba en cada cambio**, con el texto ya adentro: así no
   la anuncia casi ningún lector de pantalla. Además el estado de error llevaba `role="alert"` y
   `aria-live="polite"` juntos, y el `polite` explícito degradaba el `assertive` implícito.
4. **El foco volvía a `<body>` en cada acción**, porque el botón apretado desaparecía con el
   repintado. Quien navega por teclado tenía que tabular desde el principio del documento.
5. **El `¿Cómo se usa?` se plegaba solo**: el vecino leía el paso 1, lo ejecutaba, y la ayuda se
   cerraba justo antes de los pasos 2 y 3 — el flujo exacto que C7 existe para sostener.

Los cuatro últimos salían de la misma causa: **reescribir el `innerHTML` entero de la tarjeta en
cada cambio de estado**. Se separó en un armazón fijo (`renderEstructuraMiCasa`, que se escribe una
sola vez y contiene la región `aria-live` y el `<details>`) y tres pedazos que se repintan
(`partesMiCasa`). El foco se traslada al botón que ocupa el lugar del que desapareció.

**Y un sexto, que apareció al escribir el chequeo del punto 2**: la tarjeta pinta su botón antes de
que termine de importarse `map.ts`, que es un chunk aparte de ~46 kB comprimidos. En 3G el toque se
perdía en silencio. Ahora la intención se anota y se aplica cuando el import resuelve; si el módulo
no carga nunca, la tarjeta vuelve a su estado inicial en vez de esperar un click que nadie escucha.

## Hallazgos

- `#tarjeta-telegram` no tiene ningún `grid-area` asignado en ninguno de los 3 breakpoints de
  `style.css` (cae en el flujo implícito de la grilla). Es preexistente a esta spec — no se tocó,
  porque no es parte del alcance de "Mi casa" y la instrucción del repo es anotar hallazgos fuera
  de alcance, no arreglarlos en silencio.
- Decisión de diseño no explicitada en la spec ni en `odd/tasks/mi-casa.md`: el reordenamiento de
  coordenadas `{lat, lng}` (Leaflet) → `[lng, lat]` (GeoJSON) se implementó en
  `domain/miCasa.ts` (función testeada), no en `map.ts` como sugería la exploración previa —
  `map.ts` no tiene test unitario (toca DOM/Leaflet real), así que mover esa conversión a una
  función pura y testeada reduce el riesgo de invertir el orden por error. El comportamiento
  observable es el mismo.
- `mountAvisosTelegram`/`precargarUmbral`/`mountMiCasa` no tienen test unitario porque tocan
  `document.querySelector` sobre DOM real, y el `vitest.config` de este repo usa
  `environment: "node"` (sin jsdom) — mismo criterio ya establecido por `mountThemeToggle` y
  `mountAvisosTelegram` antes de esta spec. Se verificaron a mano en navegador real (ver "Cómo
  verificar").

- **Defecto real encontrado usando la app (C6), no por los tests.** `map.ts` marcaba "Mi casa" en
  **cualquier** click del mapa (`map.on("click", …)` sin ninguna condición): tocar para cerrar un
  popup o para mirar otra zona movía la casa del vecino, y no había forma de borrarla. Los 291
  tests de entonces pasaban en verde, porque ninguno ejercitaba el handler de Leaflet. Es el mismo
  patrón que ya se repitió en esta serie de specs: **el defecto sólo aparece mirando la app
  corriendo.**
- **Falso positivo en la propia verificación, atrapado a tiempo.** El primer chequeo "un click
  fuera del modo elección no marca" pasaba en verde... porque el click nunca llegaba al mapa:
  clickear un botón de la tarjeta hace que Playwright scrollee la página, y las coordenadas
  absolutas calculadas antes quedaban viejas (`page.mouse.click` las usa tal cual). Se arregló de
  dos formas, y las dos importan: el click ahora va por `locator.click({position})`, que scrollea y
  traduce solo; y el chequeo negativo lleva un **control positivo** que cuenta los clicks que
  Leaflet recibe de verdad. Un test que afirma "no pasó nada" no vale nada si no prueba primero que
  algo debería haber pasado.
- El test "el disclaimer no tiene forma de cerrarse" medía que **la tarjeta entera** no tuviera
  ningún `<button`. Con C6 la tarjeta sí tiene botones, así que se reescribió para medir el
  invariante que la spec realmente pide: que el **bloque del disclaimer** no lleve ningún control.
  Mismo arreglo en `verificar-mi-casa-privacidad.mjs`.

## Resumen final

"Mi casa" responde a qué altura del río se moja un punto, con búsqueda binaria sobre 6 de las 43
capas y **sin que la coordenada salga nunca del dispositivo** (verificado interceptando todo el
tráfico). Al usarla apareció un defecto que ningún test veía: el mapa marcaba la casa en
**cualquier** click, así que tocar el mapa la movía y no había forma de borrarla; ahora el gesto es
explícito (botón → modo elección → click), con "Elegir otro punto", "Borrar" y un "¿Cómo se usa?"
de tres pasos. 303 tests de frontend y 335 de backend en verde, más 23 chequeos sobre la app real —
uno de ellos un control positivo, porque el primer chequeo negativo pasaba en verde clickeando al
vacío.
