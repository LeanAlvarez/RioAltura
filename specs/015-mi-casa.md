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

## Resumen final

Implementado "Mi casa" (C1-C5): búsqueda binaria (~6 de 43 capas) con ray-casting propio
(`pointInPolygon.ts`), 100% client-side — verificado con script de red que ninguna request lleva
la coordenada. Persiste en `localStorage` (patrón de `theme.ts`), precarga el umbral de Telegram,
y siempre muestra el disclaimer fijo de C5, sin botón de cerrar. `ruff`/`pytest`/`tsc`/`build`/
`vitest` pasan (292 tests nuevos+existentes en frontend, 335 en backend/worker sin cambios).
Hallazgo fuera de alcance: `#tarjeta-telegram` sin `grid-area` (preexistente, no tocado).
