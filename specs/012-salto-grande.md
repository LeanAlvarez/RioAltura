# 012 — Salto Grande: caudal erogado y lluvia aguas arriba

- **Estado:** lista
- **Rama:** feat/012-salto-grande
- **Depende de:** 003 (pronóstico), 009 (cadena de alturas) — mergeadas
- **Puede ir en paralelo con:** 011 (canal de Telegram)

## Objetivo

Traer el dato que nuestro propio FAQ dice que nos falta. La app explica hoy que el pronóstico puede
fallar **por las descargas de la represa de Salto Grande** — y la represa publica esas descargas
todos los días, en abierto.

## La fuente, verificada entrando

`https://www.saltogrande.org/datos_hidrologicos.php` linkea cuatro PDFs públicos, sin
autenticación, actualizados a diario. **Los cuatro bajan con HTTP 200 y se parsean** (verificado el
2026-09-22):

| Archivo | Qué trae |
|---|---|
| `docs/hidrologia/Comunicado.pdf` | Aporte últimas 24 h, **caudal evacuado**, nivel de embalse, **proyección del evacuado a 24-36 h**, estado del vertedero, y **cotas máxima y mínima proyectadas para los puertos de Concordia y Salto** |
| `docs/hidrologia/CaudalesNiveles.pdf` | Caudales medios diarios de toda la cascada aguas arriba: Machadinho, Itá, Foz do Chapecó, El Soberbio, San Javier, Garruchos, Santo Tomé, Alvear, Paso de los Libres |
| `docs/hidrologia/Precipitaciones.pdf` | Lluvia observada de los últimos 8 días por subcuenca |
| `docs/hidrologia/PronosticosP.pdf` | **Pronóstico de lluvia a 7 días** (modelo GFS) por subcuenca |

Muestra real del comunicado del 22/09/2026:

> Aporte últimas 24 hs: **7553** m³/s · Evacuado a la hora 08:00: **7821** m³/s · Nivel del embalse:
> **34.81** m · Vertedero **Cerrado**
> *"Hasta la hora 15:00 de mañana, el caudal medio diario evacuado variará entre 8.000 y 7.000 m³/s.
> Cotas máxima y mínima referidas al puerto de Concordia: 7,00 y 5,30 metros."*

Y la señal que justifica todo esto, en los datos de esta misma semana:

| Fecha | Lluvia en El Soberbio | Caudal Machadinho |
|---|---|---|
| 19/09 | 13 mm | 967 m³/s |
| **20/09** | **58 mm** | 1.135 |
| 21/09 | 1 mm | 1.145 |
| 22/09 | 10 mm | **2.441** |

Llovió fuerte río arriba el 20 y dos días después los caudales se duplicaron. Esa anticipación hoy
la app no la ve.

## Alcance

- **S1 — Cliente y parser** de los cuatro PDFs en `worker/jobs/salto_grande.py`, con timeout,
  reintentos con backoff y `User-Agent` identificable (§6).
- **S2 — Job diario**, no horario: los PDFs se actualizan una vez por día.
- **S3 — Persistencia**: tablas nuevas para caudal erogado / embalse, caudales de la cascada, y
  lluvia observada y pronosticada por subcuenca. Migración nueva (§2).
- **S4 — Endpoint** `GET /api/salto-grande` con lo último de cada cosa.
- **S5 — Tarjeta en la app** (ver "Qué ve el vecino").
- **S6 — Tests con fixtures grabadas** de los cuatro PDFs. Nunca llaman a la fuente (§6).

## Qué ve el vecino

El valor de este dato es que **anticipa**. Pero `m³/s` no puede ser el dato principal (§7), así que
la tarjeta cuenta la historia, no los números:

- **Lo que suelta la represa, en lenguaje llano**: "La represa está soltando más agua que ayer" /
  "menos" / "igual", con el número como detalle secundario.
- **Lo que la represa misma proyecta**: el comunicado dice a cuánto va a variar el evacuado en las
  próximas 24-36 h. Es una proyección **de ellos**, oficial, y se muestra citada como tal.
- **La lluvia río arriba**: "Llovió 58 mm río arriba hace 2 días" y el pronóstico de lluvia de la
  cuenca a 7 días. Es lo que explica, en criollo, por qué el río va a subir.
- **Vertedero abierto o cerrado**, que es la señal más gruesa y más fácil de entender.
- Fecha del comunicado siempre visible (§6), y atribución a CTM Salto Grande (§7).

## Fuera de alcance

**No se deriva una altura de Colón a partir de estos datos.** El comunicado proyecta cotas para los
puertos de **Concordia y Salto**, que están aguas arriba. Convertir eso en una altura para Colón es
inventar una regla de dominio, y el §5 y el §9 lo prohíben sin calibración. Se muestran los datos de
la represa como lo que son: contexto que anticipa, no un pronóstico nuestro.

Tampoco entra:

- Modificar la curva caudal→altura ni los umbrales (§5, §9).
- Meter el caudal erogado como variable del pronóstico. Sería lo más valioso, pero exige calibrar
  contra eventos reales; es una spec propia, posterior, y con datos históricos suficientes.
- Radar meteorológico: **Colón no tiene cobertura confiable**. Ninguno de los 21 radares SINARAME
  está en Entre Ríos, el del INTA en Paraná no es SINARAME y se cae seguido, y el siguiente está a
  330 km. La API no oficial del SMN está bloqueada por Cloudflare. Se investigó y se descarta.

## Diseño / decisiones

### Son PDFs, no una API

No hay contrato: hay una plantilla TCPDF. Eso obliga a tratarlo como scraping, igual que Prefectura
y CARU (§6):

- Si el PDF cambia de formato, el job **registra el fallo y la app sigue con lo último que tenía**,
  con su fecha a la vista. Nunca una excepción sin atrapar ni un dato inventado.
- Se validan rangos antes de guardar: un caudal negativo o absurdo se descarta y se registra.
- Si un PDF falla, los otros tres se procesan igual. No es todo o nada.

### Dependencia nueva autorizada

**`pdfplumber`** como dependencia del worker, para parsear las tablas. Es la única nueva de esta
spec y no entra al bundle del frontend. Extraer el texto a mano con `zlib` funciona para estos
archivos, pero se rompe con cualquier stream que no sea flate: no es base para algo que tiene que
correr sin supervisión.

### Frecuencia

Diaria. El comunicado se emite una vez por día. Pedirlo más seguido es maltratar una fuente
pública gratuita sin ganar nada (§6).

## Archivos compartidos que puede tocar

- `contracts/openapi.yaml` — el endpoint nuevo.
- `backend/app/config/dominio.py` — **sólo** para agregar las URLs y la lista de subcuencas, con la
  fuente documentada.
- `pyproject.toml` del worker — `pdfplumber`.
- Migración nueva.

## Criterios de aceptación

- [ ] Los cuatro PDFs se parsean y persisten: caudal erogado, aporte, nivel de embalse, estado del
      vertedero, caudales de la cascada, lluvia observada y pronosticada por subcuenca.
- [ ] Si un PDF cambia de formato, ese job registra el fallo, **los otros tres siguen**, y la app
      muestra lo último conocido con su fecha.
- [ ] Valores fuera de rango se descartan y se registran.
- [ ] La tarjeta cuenta la historia en lenguaje llano; `m³/s` aparece como detalle secundario (§7).
- [ ] La proyección del evacuado se muestra **citada como proyección de CTM**, no como nuestra.
- [ ] **No se deriva ninguna altura de Colón** de estos datos.
- [ ] Atribución a CTM Salto Grande visible (§7), y fecha del comunicado siempre a la vista (§6).
- [ ] Tests con fixtures grabadas de los cuatro PDFs; ninguno llama a la fuente (§6).
- [ ] `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan.

## Cómo verificar

(La completa el agente.)

## Hallazgos

(La completa el agente.)

## Resumen final

(La completa el agente, máximo 5 líneas.)
