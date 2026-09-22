# 009 — CARU como tercera fuente de altura

- **Estado:** lista
- **Rama:** feat/009-caru
- **Depende de:** 002 (alturas INA + Prefectura) — mergeada
- **Puede ir en paralelo con:** specs de frontend (esta no lo toca)

## Objetivo

Que la app siga teniendo la altura del puerto cuando el INA y Prefectura no
publican. Hoy, si las dos fallan, no hay altura: el anclaje del pronóstico no se
aplica y la tarjeta de hoy queda sin valor medido.

## Por qué, con evidencia

El 2026-09-22, con el worker corriendo, pasó exactamente eso:

- El INA respondió `200` pero **sin ninguna lectura en las últimas 24 h**. El
  worker lo detectó obsoleto y cayó a Prefectura, como manda el §6.
- **Prefectura venía parada en el mismo instante**: las dos fuentes tenían como
  lectura más nueva `2026-09-21 03:00 UTC`.
- Resultado: `anclaje.aplicado = false`, motivo "No hay altura real disponible
  para hoy", y la tarjeta de hoy mostrando rango en vez de valor medido.

CARU, en cambio, **sí tenía el dato de ese día**. Verificado sobre la página real:

| Puerto | Fecha - Hora | Registro |
|---|---|---|
| Colón | **22/09/2026 - 00:00** | **4.29** |
| Colón | 21/09/2026 - 12:00 | 4.29 |
| Colón | 21/09/2026 - 00:00 | 4.29 |

**El valor coincide exactamente con el del INA (4,29 m).** Eso confirma que CARU
publica sobre el mismo cero del hidrómetro y que no hay que convertir nada.

## Alcance

- **C1 — Cliente de CARU** en `worker/jobs/caru.py`, con timeout, reintentos con
  backoff y `User-Agent` identificable (§6).
- **C2 — Tercer eslabón de la cadena**: INA → Prefectura → **CARU**. No cambia el
  orden de los dos primeros.
- **C3 — Valor de fuente nuevo** `caru`, junto a `ina` y `prefectura`.
- **C4 — Tests con fixtures grabadas** del HTML real. Nunca llaman a la fuente
  (§6). Incluye el caso de HTML cambiado: la app degrada, no rompe.
- **C5 — Documentar la fuente** en `dominio.py` y en el FAQ ("¿De dónde salen los
  datos?").

## Fuente

```
http://190.0.152.194:8080/alturas/web/user/altura/12
```

- Estación **12 = Colón**. Se usa la página **por estación**, no la tabla general:
  pesa 12,5 KB contra 38 KB, tiene tres columnas (`Puerto`, `Fecha - Hora`,
  `Registro`) y trae **historial de 7 días**, así que una corrida perdida se
  recupera sola.
- **Publica cada 12 h** (00:00 y 12:00), no cada hora.
- Fechas en formato `DD/MM/AAAA - HH:MM`, hora local argentina.
- Altura con **punto** decimal (`4.29`), a diferencia de la UI, que usa coma.

## Diseño / decisiones

### CARU va tercera, no primera

Es la comisión binacional del río Uruguay —la citamos en nuestro propio
disclaimer como autoridad oficial— así que como fuente es más legítima que
scrapear Prefectura. **Pero publica cada 12 h**, contra la frecuencia horaria del
INA. Una fuente más autorizada pero menos frecuente no sirve como principal: la
app quedaría hasta 12 h desactualizada aun con todo funcionando. Va tercera, que
es donde aporta: cuando las otras dos no publican.

### Es scraping, y hay que tratarlo como tal

Es HTML sobre **HTTP plano y una IP cruda**, sin dominio ni TLS. El §6 ya marca
el scraping de Prefectura como último recurso; esto es la misma categoría con
menos garantías de transporte. En consecuencia:

- El parser **no puede asumir la estructura**: si el HTML cambia, el job registra
  el fallo y la app sigue con lo que tenía, con su fecha a la vista (§6). Nunca
  una excepción sin atrapar ni un dato inventado.
- Se valida el rango del valor antes de guardarlo: una altura fuera de lo
  físicamente posible se descarta y se registra, no se guarda.
- **No se envía ningún dato del usuario** a esa IP: el worker la consulta, nunca
  el frontend.

### No se toca el cero del hidrómetro

El valor de CARU coincide con el del INA (4,29 m el 22/09), así que se guarda tal
cual. Si en algún momento aparece una diferencia sistemática, **eso es una spec
aparte**: el §5 prohíbe tocar el cero por cuenta propia.

## Fuera de alcance

- No se cambia el orden INA → Prefectura.
- No se cambia el cero del hidrómetro, los umbrales ni la curva (§5, §9).
- No se toca el frontend, salvo la respuesta del FAQ sobre el origen de los datos.
- No se resuelve el retraso de fondo del INA: esta spec agrega un respaldo, no
  arregla la fuente principal.

## Archivos compartidos que puede tocar

- `backend/app/config/dominio.py` — **sólo** para agregar el identificador de la
  estación de CARU y su URL, con la fuente documentada. Sin modificar nada.
- `contracts/openapi.yaml` — el valor `caru` en el enum de `fuente`.
- Migración nueva si el enum de `fuente` es un tipo de base (nunca editar una
  migración existente, §2).

## Criterios de aceptación

- [ ] Con INA y Prefectura caídos o sin datos frescos, la altura llega de CARU y
      `fuente` dice `caru`.
- [ ] El orden de la cadena es INA → Prefectura → CARU, verificado con tests.
- [ ] El parser tolera HTML cambiado: registra el fallo y la app sigue con el
      último dato conocido, con su fecha visible. Sin excepciones sin atrapar.
- [ ] Valores fuera de rango físico se descartan y se registran.
- [ ] Tests con fixtures grabadas del HTML real; ninguno llama a la fuente (§6).
- [ ] El FAQ menciona CARU entre las fuentes.
- [ ] `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan.

## Cómo verificar

(La completa el agente.)

## Hallazgos

(La completa el agente.)

## Resumen final

(La completa el agente, máximo 5 líneas.)
