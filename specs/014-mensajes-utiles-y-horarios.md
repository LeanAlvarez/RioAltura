# 014 — Mensajes más útiles y a la hora que corresponde

- **Estado:** lista
- **Rama:** feat/014-mensajes-telegram
- **Depende de:** 011 (canal de Telegram), 012 (Salto Grande) — 011 en PR #13
- **Puede ir en paralelo con:** specs de frontend

## Objetivo

Que un mensaje del canal alcance para saber qué pasa sin abrir la app, y que ninguno llegue a una
hora en la que no sirve.

## Estado actual

El estado diario es una sola línea:

> *"Estado de hoy del río Uruguay en Colón: 4,29 m (Normal). Nivel de aviso: Sin aviso."*

Y **el job corre cada hora sin ninguna restricción horaria**: verificado en
`worker/jobs/telegram_avisos.py` (`TELEGRAM_AVISOS_INTERVAL_SECONDS = 3600`, sin filtro de hora).
Hoy una alerta puede sonar a las 3 de la mañana, y el estado diario sale en la primera corrida del
día, que depende de cuándo arrancó el worker: si se reinicia a las 4 AM, el resumen llega a las 4 AM.

**Todos los datos que faltan ya están en la base.** No hay que traer nada nuevo.

## Alcance

### M1 — Estado diario con lo que hace falta

```
🌊 Río Uruguay en Colón — martes 22

📏 Hoy: 4,29 m · Normal
➡️ No subió ni bajó en el último día
📉 Faltan 2,51 m para los 6,80 m

🔮 Próximos días
  mié 23  🔼  entre 2,9 y 4,9 m
  jue 24  🔼  entre 3,3 y 5,3 m
  vie 25  🔼  entre 3,8 y 5,8 m
🟢 Hoy no hay alerta

📅 Medición del puerto: hoy 00:00 (CARU)
⚠️ Orientativo. No reemplaza a Prefectura ni a Defensa Civil.
```

De dónde sale cada cosa, todo ya guardado:

| Dato | Origen |
|---|---|
| Altura, estado y tendencia | `/alturas/ultima` |
| **Cuánto falta para el primer umbral** | `domain/umbrales.ts` — el número más accionable |
| Próximos días con rango **anclado** | `/pronostico` |
| Nivel de aviso | `services/avisos.py` |

**Tres días, no siete**: en un celular, siete filas hacen que nadie lea ninguna. Los siete están en
la app.

### M2 — Río arriba, sólo cuando aporta

Salto Grande **no** entra en todos los mensajes. Se agrega un bloque sólo cuando hay algo que
cambia la lectura:

```
🏞️ Río arriba
🌧️ Llovió 58 mm hace 2 días
🚧 Salto Grande suelta 7.821 m³/s (vertedero cerrado)
```

Criterio para incluirlo: **vertedero abierto**, **lluvia fuerte río arriba en los últimos días**, o
**caudal erogado subiendo de forma marcada**. Si no pasa nada de eso, el bloque no aparece: un dato
que siempre dice lo mismo deja de leerse.

### M3 — La alerta es corta

El cambio de nivel de aviso **no** lleva todo lo anterior. Una alerta que hay que leer entera no es
una alerta:

```
🟡 ATENCIÓN — Río Uruguay en Colón

El río podría llegar a entre 4,6 y 6,6 m el lunes 28.
Hoy está en 4,29 m.

⚠️ Orientativo. No reemplaza a Prefectura ni a Defensa Civil.
Seguí los avisos de Prefectura y Defensa Civil.
```

### M4 — Emojis con disciplina

Sólo los que aportan lectura rápida: 🟢🟡🔴 para el nivel de aviso, 🔼🔽➡️ para la tendencia, y los
de encabezado de bloque. **Nada decorativo.**

**Cada emoji va acompañado de su texto, siempre.** El §7 del `CLAUDE.md` prohíbe que la información
dependa sólo del color, y un emoji es color: 🟡 sin la palabra "Atención" al lado no comunica nada a
quien no distingue colores o usa un lector de pantalla.

### M5 — Horarios según urgencia real

| Tipo | Cuándo se envía |
|---|---|
| Estado diario | **hora fija, 8 AM** hora de Buenos Aires |
| Cambio de nivel de aviso (sale de un pronóstico a 3 días) | **sólo horario diurno**; si cae de noche, espera a la mañana |
| **Umbral real cruzado** — el río llegó de verdad a una altura, sea la oficial o la que eligió el vecino | **cualquier hora, sin excepción** |

**El criterio es la diferencia entre un pronóstico y una medición.**

Un pronóstico puede esperar a la mañana: se calcula **a 3 días**, así que un "Atención" a las 3 AM y
el mismo a las 8 AM no cambian ninguna decisión. Encima los datos que lo alimentan llegan con horas
de retraso — el INA y Prefectura vienen publicando una vez por día —, así que despertaríamos a un
pueblo con un dato de ayer.

Una medición real no espera. Si el río llegó a evacuación a las 3 de la mañana, se avisa a las 3 de
la mañana.

Hay además un riesgo que pesa: los umbrales están marcados **"calibrado con 2 eventos: provisorio"**
(§5). Una falsa alarma de madrugada no se perdona: la gente silencia el canal, y el día que la
alerta sea de verdad, nadie la lee.

La ventana diurna y la hora del estado diario son **configurables por variable de entorno**, para
poder ajustarlas sin tocar código.

## Fuera de alcance

- No se cambian los umbrales, la curva ni el cero del hidrómetro (§5, §9).
- No se cambian las cinco salvaguardas de la 011: siguen exactamente igual.
- No se agregan fuentes nuevas: todo sale de lo que ya está en la base.
- No se toca el mecanismo de suscripción ni el deep link.

## Criterios de aceptación

- [x] El estado diario incluye altura, estado, tendencia, **cuánto falta para el primer umbral**,
      tres días de pronóstico anclado y el nivel de aviso.
- [x] El bloque de río arriba aparece **sólo** cuando el vertedero está abierto, llovió fuerte o el
      caudal sube de forma marcada; en un día tranquilo **no aparece**.
- [x] El mensaje de cambio de nivel es corto y no incluye el resumen completo.
- [x] **Ningún emoji lleva información que no esté también en el texto** (§7).
- [x] El estado diario sale a la hora configurada, no en la primera corrida del día.
- [x] Un cambio de nivel detectado de noche **no** se publica hasta la mañana.
- [x] Un umbral real cruzado **sí** se publica de noche, verificado con un test que simule las 3 AM.
- [x] Las cinco salvaguardas de la 011 siguen pasando sus tests.
- [ ] Los mensajes se ven bien en Telegram móvil (captura en la spec). Enviado un mensaje real
      (M1) al canal `@RioUruguayNotifica` (`message_id: 8`, ver "Cómo verificar"), pero no adjunté
      una captura de pantalla del celular a este archivo: no tengo forma de sacarla desde este
      entorno de agente. El texto exacto publicado está abajo para que Leandro lo revise en el
      teléfono directamente.
- [x] `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan.

## Cómo verificar

```bash
cd /Users/leandroalvarez/orca/workspaces/RioAltura/mensajes
set -a; . ./.env.local; set +a
docker compose up -d db && uv run alembic upgrade head
uv run ruff check . && uv run ruff format --check . && uv run pytest -q
pnpm -C frontend install
pnpm -C frontend exec tsc --noEmit && pnpm -C frontend build && pnpm -C frontend test
```

Resultado real (2026-09-22), contra la Postgres del worktree (migraciones `0001` → `0006`, sin
migración nueva -- ver "Hallazgos"):

- `alembic upgrade head`: corrió limpio hasta `0006` (última existente; esta spec no agregó
  ninguna).
- `ruff check .`: **All checks passed!**
- `ruff format --check .`: **116 files already formatted**.
- `pytest -q`: **334 passed, 4 skipped, 3 deselected** (los 4 skipped y 3 deselected ya existían
  antes de esta spec: postgres-only y `@pytest.mark.live` de specs anteriores, no tocados acá).
  Nuevos/tocados por esta spec: `backend/tests/test_umbrales_service.py`,
  `worker/tests/test_telegram_mensajes.py`, `worker/tests/test_telegram_rio_arriba.py`, y
  `worker/tests/test_telegram_avisos.py` (adaptado a los nuevos textos M1/M3 y con los tests de
  M5 -- horarios -- agregados).
- `pnpm -C frontend exec tsc --noEmit`: sin salida (sin errores). No toqué el frontend.
- `pnpm -C frontend build`: **✓ built in 937ms**.
- `pnpm -C frontend test`: **26 test files, 256 tests passed**. Ningún archivo nuevo: no había
  nada de frontend que testear para esta spec.

### Envío real, a mano (una sola vez)

Con las credenciales reales del `.env.local` del worktree, corrí los tres jobs de ingesta una vez
(`jobs.alturas.job_actualizar_alturas`, `jobs.google.job_actualizar_pronosticos`,
`jobs.salto_grande.job_actualizar_salto_grande`) para tener datos reales en la base de este
worktree, arme el mensaje de estado diario (M1) con exactamente la misma lógica de producción
(`_publicar_canal`, sin pasar por el scheduler) y lo publiqué una vez en `@RioUruguayNotifica` con
`jobs.telegram_client.send_message` directamente (no un curl suelto), leyendo el token siempre de
la variable de entorno ya exportada.

Texto exacto publicado (`message_id: 8`, Telegram respondió `ok: true`):

```
🌊 Río Uruguay en Colón — martes 22

📏 Hoy: 4,29 m · Normal
➡️ No subió ni bajó en el último día
📉 Faltan 2,51 m para los 6,80 m

🔮 Próximos días
  mié 23  🔼  entre 3,7 y 5,7 m
  jue 24  🔼  entre 4,0 y 6,0 m
  vie 25  🔼  entre 4,3 y 6,3 m
🟢 Hoy no hay alerta

🏞️ Río arriba
🌧️ Llovió 58 mm hace 2 días
🚧 Salto Grande suelta 7.821 m³/s (vertedero cerrado)

📅 Medición del puerto: hoy 00:00 (INA)
⚠️ Orientativo. No reemplaza a Prefectura ni a Defensa Civil.
```

El bloque "Río arriba" (M2) salió solo porque los datos reales de hoy de Salto Grande disparan el
criterio de lluvia fuerte (58 mm hace 2 días, por encima del piso de 30 mm) -- es el mismo evento
que ya documenta la spec 012. El token no se imprimió en ningún momento de todo el proceso (ver
criterio de aceptación "confirmación de que el token no apareció impreso").

## Hallazgos

- **Sin migración nueva.** No agregué la migración `0007` que anticipaba la tarea. El caso que la
  motivaba -- "trackear que un cambio de nivel detectado de noche está pendiente de publicarse a
  la mañana" -- ya queda cubierto por lo que la migración `0005`/`0006` (spec 011) persiste:
  `telegram_estado_canal.nivel_candidato`/`corridas_candidato` (el estado del antirebote, S1). En
  vez de agregar una columna nueva de "pendiente", hice que la corrida de la ventana diurna
  cerrada simplemente **no publique** y persista el mismo avance del candidato que ya persistía
  antes de esta spec (antes se persistía igual, aunque `debe_publicar` fuera `False` por no
  haberse sostenido 2 corridas). El resultado es el mismo dato dos veces reusado: "todavía no
  sostenido" y "sostenido pero esperando la ventana" son, para el antirebote, el mismo estado
  ("hay un candidato, no está publicado"), así que no hay nada nuevo que guardar. Lo verifiqué con
  `test_m5_cambio_de_nivel_de_noche_no_se_publica_hasta_la_manana` en
  `worker/tests/test_telegram_avisos.py`.
- **Criterio de "lluvia fuerte" (M2), inventado para esta spec, no es un umbral de dominio.**
  `LLUVIA_FUERTE_MM = 30` en `worker/jobs/telegram_rio_arriba.py`. Es más alto que el piso de 5 mm
  que ya usa la tarjeta web (`LLUVIA_SIGNIFICATIVA_MM` en `frontend/src/components/saltoGrande.ts`)
  porque ese piso solo decide si la tarjeta -- siempre visible -- muestra una frase; acá decide si
  vale la pena *interrumpir* el mensaje diario con un bloque nuevo. Elegí 30 mm mirando la propia
  muestra de datos de la spec 012 (13, 58, 1, 10 mm en cuatro días consecutivos): 58 es claramente
  el evento que se sale de lo normal, y de hecho fue el que disparó el bloque en el envío real de
  hoy.
- **Criterio de "caudal subiendo de forma marcada" (M2), también inventado, tampoco es un umbral
  de dominio.** `SUBIDA_MARCADA_RELATIVA = 0.15` (15 %) en el mismo archivo. Más alto que el 3 %
  que usa `tendenciaCaudal` en `saltoGrande.ts` para la flechita ▲/▼/→ de la tarjeta web -- ese 3 %
  solo filtra ruido operativo normal de la represa, no alcanza para justificar un bloque nuevo en
  el mensaje diario.
- **El mensaje corto de cambio de nivel (M3) ya no lleva "Dato del dd/mm HH:MM (fuente)".** La
  spec 011 pedía, como criterio de aceptación, que "todo mensaje de aviso" llevara fecha/hora del
  dato y su fuente. El formato literal que pide esta spec 014 para M3 no lo incluye (solo "Hoy está
  en X m."), a cambio de ser corto de verdad. Interpreté que esta spec, más nueva y explícita sobre
  seguir el formato literal, reemplaza esa parte del criterio de la 011 a propósito -- es
  justamente el objetivo de M3 ("una alerta que hay que leer entera no es una alerta") -- pero no
  estaba dicho en estos términos, así que lo dejo anotado por si Leandro lo quiere distinto.
- **Texto para "vuelta a la normalidad" (A3) en formato M3, sin ejemplo en la spec.** La spec solo
  da el ejemplo literal para "Atención". Para `sin_aviso` usé: `"🟢 SIN AVISO — Río Uruguay en
  Colón"` + `"El nivel de aviso volvió a la normalidad."` + `"Hoy está en X m."`, siguiendo la
  misma estructura y el mismo pie que el ejemplo dado. Mismo criterio para "Alerta probable": el
  encabezado usa `NIVELES_AVISO_TEXTO[nivel].upper()`, ya aprobado en `frontend/src/domain/aviso.ts`.
- **Texto de la línea de nivel de aviso dentro del estado diario (M1), sin ejemplo para
  "Atención"/"Alerta probable".** La spec solo muestra el caso `sin_aviso` ("🟢 Hoy no hay
  alerta"). Para los otros dos usé `"🟡 Nivel de aviso: Atención"` / `"🔴 Nivel de aviso: Alerta
  probable"`, coherente con M4 (emoji siempre con su texto).
- **Ubicación del bloque "Río arriba" (M2) dentro del mensaje diario (M1), sin especificar en la
  spec.** Lo puse después del bloque de pronóstico/nivel de aviso y antes del pie
  (medición/disclaimer): es contexto adicional, no lo primero que hay que leer, pero tampoco quería
  que quedara pegado al pie legal.
- **Ventana diurna inclusiva en ambos extremos.** `TELEGRAM_VENTANA_DIURNA_INICIO_HORA=8` y
  `TELEGRAM_VENTANA_DIURNA_FIN_HORA=21` (default) se interpretan como `inicio <= hora <= fin`, así
  que la corrida de las 21:00 todavía cuenta como diurna. No estaba especificado si el límite
  superior era inclusivo o exclusivo.
- **A2 (estado diario) no es "a las 8 en punto", es "en la primera corrida cuya hora local ya
  alcanzó la hora configurada".** El job sigue corriendo cada hora (`TELEGRAM_AVISOS_INTERVAL_SECONDS`
  no cambió); si el worker estuviera caído justo a las 8, el estado diario sale en la primera
  corrida siguiente que ya pasó las 8, no se pierde ese día. Me pareció más robusto que exigir una
  coincidencia exacta de hora, que un reinicio del worker podría hacer fallar.
- No toqué `contracts/openapi.yaml`, `backend/app/config/dominio.py` (los valores de umbral),
  ni el mecanismo de suscripción/deep link -- fuera de alcance según la spec.

## Resumen final

M1 (estado diario completo), M2 (bloque "Río arriba" condicional) y M3 (aviso corto) implementados
en `worker/jobs/telegram_mensajes.py` y `worker/jobs/telegram_rio_arriba.py` (nuevo), con
disciplina de emojis (M4) verificada por tests. M5 separa los tres horarios en
`worker/jobs/telegram_avisos.py` sin migración nueva: A2 espera la hora configurada
(`TELEGRAM_HORA_ESTADO_DIARIO`), A1/A3 esperan la ventana diurna
(`TELEGRAM_VENTANA_DIURNA_*_HORA`) reusando el estado del antirebote de la spec 011 como "pendiente
de publicar", y B1/B2 (umbral real) siguen sin restricción horaria. Las cinco salvaguardas de la
011 y sus tests existentes siguen intactos. `ruff`, `pytest` (334 passed), `tsc`, `pnpm build` y
`pnpm test` (256 passed) corren limpios contra la Postgres real del worktree; publiqué un mensaje
de estado diario real en `@RioUruguayNotifica` (`message_id: 8`) con datos reales de la base, sin
imprimir el token en ningún momento.
