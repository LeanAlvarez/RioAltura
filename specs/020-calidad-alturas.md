# 020 — Que una lectura errónea no llegue al vecino

- **Estado:** lista
- **Rama:** fix/020-calidad-alturas
- **Depende de:** nada (toca ingesta y lectura de alturas)

## Objetivo

Que una medición equivocada de una fuente externa no se convierta en un número con cara de dato en
la pantalla de un vecino — ni en un aviso de Telegram.

## El caso concreto, en producción

El 2026-09-23, `https://rio.miraisoftware.net` mostraba **en la misma pantalla**:

```
Hoy:            3,98 m · Normal · Faltan 2,82 m para los 6,80 m
Próximos días:  "Hoy – 6,24 m medido"
                "El río podría llegar a entre 5,3 y 7,3 m el jueves 24"
```

**7,3 m está por encima del umbral de Alerta (7,10 m).** La app anunciaba que el río podía llegar a
nivel de alerta al día siguiente. No iba a pasar.

Origen, verificado contra las fuentes y no contra la app:

- Serie del INA (serie 80), quince días:
  `3,52 · 3,58 · 3,80 · 3,60 · 3,52 · 3,63 · 3,88 · 4,12 · 4,29 · 4,29 · 4,29 · **6,24**`
- **CARU, el mismo día al mediodía: 3,98 m.** Dos fuentes con **2,26 m** de diferencia.
- Salto Grande evacuando 7.821 m³/s: caudal normal, sin crecida.

El anclaje del pronóstico (`sesgo = altura_real − altura_est_hoy`, §5) propagó el error a los siete
días: sesgo de **+2,06 m**, decayendo con `max(0, 1 − n/7)`.

**Nada en el sistema lo frenó.** `caru.py` tiene un rango absoluto (−1 a 20 m) que 6,24 pasa sin
despeinarse; `ina.py` no tiene ni eso; y no existe ningún control de salto ni de desacuerdo entre
fuentes.

Lo único que evitó un aviso falso al pueblo fue que `TELEGRAM_PUBLICACION_ACTIVA` estaba en `false`.

## Lo que dicen los datos (no lo que se me ocurre)

`CLAUDE.md` §5 prohíbe inventar valores de dominio, así que los umbrales salen de medir la serie
real (1346 días desde 2023).

### El tamaño del salto NO sirve como criterio

```
salto día a día:  medio 0,235   p99 0,930   p999 2,225   MÁXIMO 2,920
```

Un salto de +1,95 m **no es imposible**: está dentro del rango histórico. Un filtro por salto habría
rechazado crecidas reales.

### Lo que distingue un error de una crecida es la FORMA

```
ERRORES (suben y vuelven)        CRECIDAS (suben y siguen)
1,25 → 3,82 → 0,90               3,15 → 4,68 → 5,38
2,18 → 3,51 → 1,95               3,17 → 4,35 → 4,94
2,78 → 4,06 → 3,06
```

Medido como desvío contra el promedio de los dos días vecinos:
`medio 0,135 · p99 0,629 · p999 1,475`. Los tres picos inequívocos están en 2,75 / 1,45 / 1,14.

**Pero esta regla sólo sirve retrospectivamente**: hoy todavía no existe el "mañana".

### La señal usable en tiempo real es el desacuerdo entre fuentes

Sobre 367 días con dos o más fuentes:

```
desacuerdo medio   0,051 m
p95                0,150 m
p99                0,265 m
MÁXIMO HISTÓRICO   0,335 m
```

**En 367 días dos fuentes nunca discreparon más de 33 cm.** El caso de hoy: **2,26 m**, seis veces y
media el máximo histórico. Es una señal limpia, disponible en el momento, con **cero falsos
positivos en toda la serie**.

## Alcance

### D1 — Cuarentena, nunca borrado

`CLAUDE.md` §9 prohíbe borrar históricos: son el insumo para recalibrar. Las lecturas sospechosas se
**marcan**, no se eliminan. Migración nueva con una columna `sospechosa` en `alturas`.

Todo lo que lee alturas para mostrar o para avisar **excluye las sospechosas**. Nada se pierde.

### D2 — Desacuerdo entre fuentes, en la ingesta

Al guardar, si una lectura discrepa con otra fuente del mismo día por más de
`DESACUERDO_MAX_FUENTES_M`, se pone en cuarentena **la que más se aleja de la última medición
confirmada** — que es exactamente el criterio que hoy habría salvado a CARU (3,98, coherente con los
4,29 previos) y descartado al INA (6,24).

### D3 — Picos, retrospectivamente

Cuando un día ya tiene día siguiente, un desvío contra el promedio de sus vecinos por encima de
`DESVIO_PICO_MAX_M` lo marca sospechoso. Se aplica del más desviado al menos, recalculando: si no,
los *hombros* de un pico quedan marcados por culpa del pico.

### D4 — Reproceso de lo ya guardado

Un comando que aplica D2 y D3 sobre lo que ya está en la base. **Es lo que arregla producción hoy**,
sin borrar un solo registro.

### D5 — Que se note

Si la lectura más reciente quedó en cuarentena, la app usa la anterior válida **con su fecha**, que
es lo que §6 ya exige: nunca mostrar datos viejos sin decir cuándo son.

## Fuera de alcance

- No se cambian umbrales, curva, cero del hidrómetro ni textos de riesgo (§5, §9).
- No se toca el frontend salvo lo que salga solo de recibir datos limpios.
- No se agregan dependencias.

## Criterios de aceptación

- [x] Los dos umbrales viven en `dominio.py` con su procedencia medida y documentada, y un test
      falla si alguien los cambia sin volver a medir.
- [x] Sobre la serie real (3094 filas), D2 marca **exactamente una**: el 6,24 del INA del
      2026-09-23. Ningún otro de los 367 días con dos fuentes.
- [x] D3 marca exactamente los tres picos (2023-08-19, 2024-12-07, 2025-03-21), **no marca sus
      hombros** y no toca ninguna crecida real — incluido el caso límite del 2024-04-16, con desvío
      0,93 contra un umbral de 1,00.
- [x] Nada se borra: **3094 filas antes y después**, 4 marcadas.
- [x] Las cuatro consultas de lectura filtran (auditadas una por una). `altura_en(2026-09-23)` pasó
      de 6,24 a **4,03**, y `get_ultima` de 6,24 (ina) a **4,03 (prefectura)**.
- [x] Los avisos por umbral propio leen `obtener_ultima`, que ahora filtra: una lectura en
      cuarentena no puede disparar un aviso.
- [ ] **Verificado en producción** tras el deploy (ver más abajo).
- [x] `ruff`, `pytest` (347 + 4 skipped), `pnpm build` y `pnpm test` (324) pasan.

## Cómo verificar

```bash
uv run alembic upgrade head
uv run python -m jobs.calidad revisar              # simulación: dice qué marcaría
uv run python -m jobs.calidad revisar --aplicar    # marca
uv run ruff check . && uv run pytest -q
```

Reproduciendo el estado exacto de producción sobre la serie real:

```
INFO calidad: marcadas 1 filas por desacuerdo
INFO calidad: marcadas 3 filas por pico

   fecha    | altura_m | fuente | motivo_sospecha
------------+----------+--------+-----------------
 2023-08-19 |     3.51 | ina    | pico
 2024-12-07 |     4.06 | ina    | pico
 2025-03-21 |     3.82 | ina    | pico
 2026-09-23 |     6.24 | ina    | desacuerdo

filas totales: 3094, en cuarentena: 4   ← nada borrado
altura del 2026-09-23 que ve la app: 4.03   (era 6,24)
última lectura: 4.03 de prefectura          (era 6,24 de ina)
```

**En producción, después del deploy**, desde el host del VPS:

```bash
W=$(docker ps --format '{{.Names}}' | grep worker | head -1)
docker exec $W python -m jobs.calidad revisar            # mirar primero
docker exec $W python -m jobs.calidad revisar --aplicar
```

## Hallazgos

- **Las cuatro lecturas en cuarentena son del INA.** Sobre 3094 filas y tres fuentes, todos los
  artefactos vienen del mismo hidrómetro. No es una conclusión de esta spec —hacen falta más datos—
  pero queda anotado: si el patrón sigue, conviene revisar el orden de preferencia de la cadena
  (§5 pone al INA primero).
- **Los tres días idénticos previos al incidente (4,29 · 4,29 · 4,29) también son sospechosos**, y
  ninguna de las dos reglas los detecta: un sensor trabado repitiendo el último valor no salta ni
  por desacuerdo ni por forma. Queda fuera de alcance y anotado como pendiente.
- **El tamaño del salto no sirve como criterio**, contra la intuición: el máximo real día a día es
  2,92 m y el p999 es 2,225 m. El salto de +1,95 m del incidente está *dentro* del rango normal. Un
  filtro por salto habría rechazado crecidas reales y dejado pasar el error igual.
- **Mi primer test estaba mal, no la regla.** Inventé un caso (3,00 → 5,50 → 5,80) más abrupto que
  nada que ocurra en la serie real, la regla lo marcó con razón, y por un momento pareció un falso
  positivo. Se reemplazó por el caso real más exigente que existe (2024-04-16, desvío 0,93). **La
  disciplina de usar datos reales vale también para los tests.**
- Un `regex` que agregaba el filtro a las consultas no aplicó en `get_ultima` —la función que
  alimenta la tarjeta "Hoy" *y* los avisos de Telegram— y la verificación lo encontró. Después se
  auditaron las cuatro consultas una por una.

## Resumen final

Una lectura errónea del INA (6,24 m contra 3,98 m de CARU el mismo día) infló el pronóstico de siete
días y le anunciaba a Colón que el río podía llegar a 7,3 m — por encima del umbral de Alerta. Nada
lo frenaba. Ahora hay dos reglas con umbrales **medidos sobre la serie real**, no inventados: dos
fuentes nunca discreparon más de 0,335 m en 367 días, y lo que distingue un error de una crecida es
la forma (sube y vuelve) y no el tamaño del salto. Las lecturas dudosas se ponen en cuarentena, nunca
se borran (§9): 4 marcadas de 3094, todas del INA, sin tocar una sola crecida real.
