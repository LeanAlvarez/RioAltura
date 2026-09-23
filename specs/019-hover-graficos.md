# 019 — Poder leer un valor en los gráficos

- **Estado:** lista
- **Rama:** feat/019-hover-graficos
- **Depende de:** 018 (mergeada)

## Objetivo

Que en cualquier gráfico se pueda apuntar a un día y leer **qué valor tuvo**. Hoy sólo se puede en
uno de los cuatro.

## El hallazgo

Auditando los gráficos contra el catálogo de anti-patrones de `dataviz`, la app sale bien parada en
lo que más suele romperse:

```
✓ sin doble eje Y      (el error nº1 del catálogo)
✓ grillas sólidas, no punteadas
✓ colores de estado y de serie separados   (spec 018)
✓ existe una vista de texto como alternativa
```

Pero falta la capa de hover, que `dataviz` pide **por defecto** en líneas y áreas: *"un gráfico en
HTML/SVG **es** interactivo; enviá crosshair + tooltip"*.

`grafico.ts` lo tiene. `historial.ts`, `precision.ts` y `aguasArriba.ts` tienen `legend: {show:
false}` y **nada que lo reemplace**: se ve la forma de la curva pero no hay forma de saber qué valor
tiene un punto. En el historial completo, que abarca años, eso significa que se ve que hubo una
crecida grande en mayo de 2024 y no se puede leer a cuánto llegó sin ir a buscarlo a otro lado.

## Alcance

### D1 — Una sola implementación, no cuatro

El tooltip de `grafico.ts` está embebido y atado a sus propias series. Se extrae a
`graficos/tooltip.ts` como una pieza reusable: un plugin de uPlot que reporta el índice apuntado y
posiciona una capa, más una función de contenido que cada gráfico provee.

`grafico.ts` pasa a usar la pieza extraída, para que no queden dos implementaciones que se separen
con el tiempo.

### D2 — Contenido de tooltip puro y testeado

Cada gráfico provee `contenido(idx) -> string | null` a partir de sus series ya calculadas. Son
funciones puras, sin DOM, así que se testean: qué dice el tooltip del historial en un día con
alerta, qué dice el de precisión cuando falta el pronóstico de ese día, y `null` cuando no hay
ningún valor.

### D3 — Que también sirva con el dedo

En mobile no hay hover. uPlot sigue el cursor en `touchmove`, así que el tooltip aparece al
arrastrar sobre el gráfico. Lo que hay que garantizar es que **no tape el punto que se está
mirando** ni se salga del lienzo — el mismo ajuste de borde que ya hace `grafico.ts`.

La vista "Ver como texto" sigue siendo la alternativa accesible y no se toca: el tooltip suma, no
reemplaza.

## Fuera de alcance

- No se cambian los datos, las series, los colores ni las escalas.
- No se agregan dependencias.
- No se toca `superficie`, que es un SVG propio con su slider y no una serie temporal.

## Criterios de aceptación

- [x] Los cuatro muestran tooltip al apuntar, verificado en navegador.
- [x] Una sola implementación: `graficos/tooltip.ts`. `grafico.ts` migró, y con eso se borraron
      **30 líneas de cálculo táctil a mano** que el hook `setCursor` hace innecesarias.
- [x] Las tres funciones de contenido son puras y tienen test (8 casos), incluidos "no hay dato ese
      día" y fuera de rango.
- [x] No se sale del lienzo, probado al 8 %, 50 % y 95 % del ancho en los cuatro gráficos.
- [x] Funciona con el dedo, verificado en un contexto `hasTouch` real.
- [x] Sin overflow en 360/390/768/1280 × claro/oscuro.
- [x] `ruff`, `pytest` (335 + 4 skipped), `pnpm build` y `pnpm test` (324) pasan.

## Cómo verificar

```bash
cd frontend
pnpm exec tsc --noEmit && pnpm test && pnpm build
URL=http://localhost:<WEB_PORT>/ node scripts/verificar-hover.mjs
```

Salida real:

```
✓ evolución y pronóstico: el tooltip aparece al apuntar
    "mar, 11 ago · Altura real: 6,19 m"
✓ historial completo: el tooltip aparece al apuntar
    "1 de abr de 2025 · 1,48 m"
✓ precisión del pronóstico: el tooltip aparece al apuntar
    "lun, 10 ago · Midió 6,58 m · Decía 5,91 m · Le erró 0,67 m"
✓ aguas arriba: el tooltip aparece al apuntar
    "vie, 25 sept · Colón 4,84 m · Aguas arriba 5,35 m"
✓ con el dedo el tooltip también aparece
```

## Hallazgos

- **Defecto encontrado de paso, introducido por la spec 018:** al hacer que `historico` comparta
  color con `pronostico`, el gráfico de aguas arriba quedó con **Colón y aguas arriba del mismo
  color**, distinguidos sólo por el patrón de guiones — leían `--graf-pronostico` y
  `--graf-historico`, que desde la 018 son el mismo valor. Dos lugares distintos **sí** son
  identidad y merecen hue propio. Se arregló con una regla clara para ese gráfico: **el color es el
  lugar y el guión es el tipo de dato**. Las dos líneas son pronósticos, así que van punteadas; lo
  que las distingue es dónde se mide, y Colón se queda con el azul que en toda la app significa
  "acá".
- **Migrar `grafico.ts` borró código, no lo agregó.** Tenía 30 líneas que calculaban a mano el
  índice más cercano en `touchstart`, porque "uPlot no traduce touch a cursor". El hook `setCursor`
  sí se dispara con el dedo — verificado en un contexto `hasTouch` real—, así que toda esa rama
  desapareció.
- **Dos veces me falló la verificación antes que el código.** Primero apunté el mouse a coordenadas
  absolutas y el gráfico estaba en `y=1900`, fuera del viewport: el tooltip "no aparecía" porque el
  puntero no llegaba. Después el chequeo táctil falló con un `TouchEvent` sintético en un navegador
  sin soporte táctil, que no genera los eventos de mouse de compatibilidad. En los dos casos el
  código estaba bien. **Antes de arreglar, comprobar que la prueba prueba lo que dice.**
- El script de capturas de la 018 tenía el puerto de su worktree hardcodeado; ahora lee `WEB_PORT`.

## Resumen final

Tres de los cuatro gráficos no tenían forma de leer un valor: se veía la forma de la curva y nada
más. Ahora los cuatro comparten una capa de hover (`graficos/tooltip.ts`), implementada como plugin
de uPlot para que funcione igual con mouse y con el dedo — migrar el que ya lo tenía borró 30 líneas
de manejo táctil a mano. De paso apareció un defecto de la 018: en el gráfico de aguas arriba Colón y
aguas arriba habían quedado del mismo color. 324 tests y 9 chequeos de navegador.
