# 022 — El pronóstico llegaba siempre un día tarde

- **Estado:** lista
- **Rama:** fix/022-ventana-pronostico
- **Depende de:** 003 (pronósticos de Google), mergeada

## El defecto

Producción tenía como última emisión la del **22/09 a las 20:43 de Colón**, con casi 23 horas de
atraso, mientras Google ya había publicado dos veces ese día. El job **no fallaba**: corría, traía
datos y no insertaba nada.

Del log del worker en el VPS:

```
22:21:19  GET ...issuedTimeStart=2026-09-20&issuedTimeEnd=2026-09-23
22:21:19  pronosticos: fetched 64, inserted 0
```

Causa, en dos líneas de `worker/jobs/google.py`:

```python
hasta = now.date()  # -> viaja como "2026-09-23"
desde = hasta - timedelta(days=_ACTUALIZAR_WINDOW_DIAS)
```

`hasta` es un `date`, así que `isoformat()` da `"2026-09-23"` y Google lo interpreta como
**`2026-09-23T00:00:00Z`**. Todo lo emitido *durante* el día de hoy queda fuera de la ventana.

Comprobado contra la API real, cambiando un solo carácter:

```
issuedTimeEnd=2026-09-23  ->  4 emisiones, la última 22/09 23:43 UTC
issuedTimeEnd=2026-09-24  ->  5 emisiones, la última 23/09 22:27 UTC
```

**El mismo error está en `backfill`**, que también usa `datetime.now(UTC).date()` como tope: por eso
un backfill nunca trae las emisiones del propio día en que se corre.

## Por qué importa

No se pierde nada de forma permanente —al día siguiente la ventana rota y lo levanta—, pero el
pronóstico que ve un vecino está **siempre entre 0 y 24 horas viejo**.

Y ese pronóstico no es decorativo: de él salen el nivel de aviso (§5), el anclaje contra la medición
de hoy, y los avisos del canal. Una crecida que Google anuncia a las 10 de la mañana no aparece en
la app hasta el día siguiente.

Es, además, el tipo de falla más difícil de ver: el job informa éxito, los logs no tienen ninguna
excepción, y `inserted 0` es exactamente lo que se espera cuando de verdad no hay nada nuevo.

## Alcance

### D1 — La ventana tiene que incluir el día de hoy entero

El tope pasa a ser el día siguiente. Una sola función con el motivo escrito una vez, usada por el
job periódico y por el backfill, para que no vuelvan a separarse.

### D2 — Un test que lo agarre

El defecto es que un valor de borde se calcula mal, así que el test mira **los parámetros con los
que se llama a Google**, no el resultado: se verifica que `issuedTimeEnd` sea posterior al día en
curso. Comprobando sólo "trajo filas" no se detecta nada, porque el job traía filas igual.

## Fuera de alcance

- No se cambia la duración de la ventana (3 días) ni la frecuencia del job (6 h).
- No se toca el contrato, ni el anclaje, ni los umbrales.

## Criterios de aceptación

- [x] `actualizar_pronosticos` pide hasta el día siguiente, con test sobre los parámetros.
- [x] `backfill` usa la misma función, con su propio test.
- [x] **Verificado que los tres tests fallan al revertir** la función a `now.date()`.
- [ ] Verificado en producción tras el deploy (ver abajo).
- [x] `ruff` y `pytest` (354 + 4 skipped) pasan. El frontend no se toca.

## Cómo verificar

```bash
uv run ruff check . && uv run pytest -q
```

Contra la API real, con la key del worker:

```bash
for fin in 2026-09-23 2026-09-24; do
  curl -s ".../gauges:queryGaugeForecasts?key=***&gaugeIds=hybas_6121320620\
&issuedTimeStart=2026-09-20&issuedTimeEnd=$fin"
done
# 2026-09-23 -> 4 emisiones, la última 2026-09-22T23:43Z
# 2026-09-24 -> 5 emisiones, la última 2026-09-23T22:27Z
```

En producción, tras el deploy: `GET /api/pronostico` y mirar que `emitido` sea del día en curso.

## Hallazgos

- **El job informaba éxito.** `fetched 64, inserted 0` es exactamente lo que se ve cuando de verdad
  no hay nada nuevo, así que ni los logs ni una alerta de errores lo habrían mostrado. Se encontró
  comparando lo que tiene producción contra lo que la fuente dice tener — que es la única
  verificación que no se puede engañar a sí misma.
- **El mismo bug estaba en `backfill`**, con la misma línea repetida. Ahora los dos usan la misma
  función: cuando la razón vive en un solo lugar, no se pueden separar.
- **Las horas en UTC confundieron el diagnóstico**, y fue culpa del que escribe. Al reportar las
  emisiones puse `21:57` sin aclarar que era UTC, y el usuario —con razón— señaló que era
  imposible porque eran las 19:27 en Colón. Eran las 18:57 locales. La app entera convierte a hora
  de Buenos Aires antes de mostrar nada; el informe tiene que hacer lo mismo.

## Resumen final

`hasta = now.date()` viajaba como `"2026-09-23"` y Google lo lee como la medianoche de ese día, así
que todo lo emitido *durante* el día quedaba fuera de la ventana. El job informaba éxito —traía
filas e insertaba cero— mientras el pronóstico en pantalla tenía hasta 24 horas de atraso, con el
nivel de aviso y el anclaje saliendo de ahí. El mismo error estaba en el backfill; ahora los dos
usan una función con el motivo escrito, y tres tests sobre los parámetros enviados lo defienden.
