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

- [ ] El estado diario incluye altura, estado, tendencia, **cuánto falta para el primer umbral**,
      tres días de pronóstico anclado y el nivel de aviso.
- [ ] El bloque de río arriba aparece **sólo** cuando el vertedero está abierto, llovió fuerte o el
      caudal sube de forma marcada; en un día tranquilo **no aparece**.
- [ ] El mensaje de cambio de nivel es corto y no incluye el resumen completo.
- [ ] **Ningún emoji lleva información que no esté también en el texto** (§7).
- [ ] El estado diario sale a la hora configurada, no en la primera corrida del día.
- [ ] Un cambio de nivel detectado de noche **no** se publica hasta la mañana.
- [ ] Un umbral real cruzado **sí** se publica de noche, verificado con un test que simule las 3 AM.
- [ ] Las cinco salvaguardas de la 011 siguen pasando sus tests.
- [ ] Los mensajes se ven bien en Telegram móvil (captura en la spec).
- [ ] `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan.

## Cómo verificar

(La completa el agente.)

## Hallazgos

(La completa el agente.)

## Resumen final

(La completa el agente, máximo 5 líneas.)
