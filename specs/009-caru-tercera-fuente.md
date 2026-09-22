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

- [x] Con INA y Prefectura sin datos frescos, la altura llega de CARU y `fuente`
      dice `caru`. **Verificado contra las tres fuentes reales**, no con mocks.
- [x] El orden de la cadena es INA → Prefectura → CARU, con un test que falla si
      se le pide a CARU teniendo Prefectura dato fresco.
- [x] El parser tolera HTML cambiado: lanza `FuenteError` y el llamador conserva
      el último dato conocido. Sin excepciones sin atrapar.
- [x] Valores fuera de rango físico se descartan y se registran.
- [x] 8 tests de parser sobre la fixture grabada + 4 de cadena; ninguno llama a
      la fuente (§6).
- [x] El FAQ menciona CARU entre las fuentes.
- [x] `ruff` limpio (83 archivos), 192 tests py, 217 web, build OK.

## Cómo verificar

```bash
cd <worktree> && set -a; . ./.env.local; set +a
docker-compose up -d db && uv run alembic upgrade head   # incluye la 0004

# Parser contra la fixture grabada (nunca toca la fuente)
uv run pytest worker/tests/test_caru.py -q                # 8 tests
# Cadena de tres eslabones
uv run pytest worker/tests/test_alturas_job.py -q         # 9 tests
uv run ruff check . && uv run ruff format --check . && uv run pytest -q

# La cadena real, contra las tres fuentes en vivo
uv run python -c "
from app.repositories.db import get_engine
from jobs import alturas
from jobs.http import build_client
with build_client() as c: print(alturas.actualizar_alturas(get_engine(), c))
"
```

Salida real del 2026-09-22:

```
alturas: ina has no reading in the last 24h, trying next source
alturas: prefectura has no reading in the last 24h, trying next source
resultado: {'fuente': 'caru', 'fetched': 753, 'inserted': 753}
```

Y en la base, con las tres fuentes conviviendo:

| fuente | filas | lectura más nueva |
|---|---|---|
| caru | 14 | **2026-09-22 03:00 UTC** |
| prefectura | 738 | 2026-09-21 03:00 UTC |
| ina | 1 | 2026-09-21 03:00 UTC |

## Hallazgos

### La cadena sólo chequeaba la frescura del INA

El defecto de fondo, encontrado al implementar: el job caía a Prefectura cuando
el INA estaba obsoleto, pero **después confiaba en Prefectura apenas respondía**,
sin mirar si sus lecturas también eran viejas. Por eso el 2026-09-22 reportó
éxito con `fuente=prefectura` sin tener un dato de ese día — y por eso, tal como
estaba, **un tercer eslabón nunca se habría alcanzado**: Prefectura siempre
"funcionaba".

La cadena se reescribió como un recorrido donde cada fuente se acepta sólo si
trae una lectura de las últimas 24 h. El historial viejo se guarda igual en cada
paso, porque sirve para el gráfico aunque no pueda responder "cómo está el río
hoy". Si ninguna tiene dato fresco, se registra y se sigue: nunca se finge.

### El check de la base rechazaba 'caru'

`alturas` tenía `CheckConstraint("fuente IN ('ina', 'prefectura')")`. La unicidad
ya era sobre `(fecha_hora, fuente)`, así que dos fuentes pueden convivir en el
mismo instante sin tocarla — sólo hubo que ampliar el check, en la migración
**0004** (nueva, sin editar ninguna existente, §2). El `downgrade` borra las
filas de CARU antes de restaurar el check viejo: son datos de respaldo
reconstruibles desde la fuente, no historia única.

### Validación cruzada del cero del hidrómetro

CARU y el INA guardaron **la misma lectura del 2026-09-21 03:00, ambas en
4,29 m**, una al lado de la otra. Eso confirma en datos que CARU publica sobre el
mismo cero y que no hay que convertir nada. Si en algún momento aparece una
diferencia sistemática, es una spec aparte: el §5 prohíbe tocar el cero por
cuenta propia.

### Lo que no se resolvió

Esta spec agrega un respaldo, **no arregla la fuente principal**. Que el INA
pase más de 24 h sin publicar sigue siendo un problema de fondo: CARU tapa el
agujero cada 12 h, pero la app queda hasta medio día sin refrescar cuando el
INA falla. Vale una spec que investigue por qué el INA se atrasa.

## Resumen final

CARU entra como tercer eslabón de la cadena de alturas, detrás del INA y de Prefectura, con parser propio sobre la página por estación (Colón es la 12): 12,5 KB, tres columnas y siete días de historial, así que una corrida perdida se recupera sola.
Al implementarlo apareció el defecto de fondo: la cadena sólo chequeaba la frescura del INA y después confiaba en Prefectura apenas respondía, así que un tercer eslabón nunca se habría alcanzado. Ahora cada fuente se acepta sólo si trae una lectura de las últimas 24 h.
Migración 0004 para ampliar el check de `fuente`; la unicidad ya era por `(fecha_hora, fuente)` y no hizo falta tocarla.
Verificado contra las tres fuentes en vivo el 2026-09-22: INA y Prefectura sin dato de ese día, CARU con 753 lecturas insertadas y `fuente=caru`.
CARU y el INA guardaron la misma lectura del 21 en 4,29 m, lo que confirma en datos que publican sobre el mismo cero del hidrómetro.
