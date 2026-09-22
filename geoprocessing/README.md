# geoprocessing

Genera las capas de inundación de Colón que usa el mapa (`frontend/public/capas/`).
Es un proyecto Python independiente, fuera del workspace de la app, con sus propias
dependencias pesadas (`rasterio`, `scipy`, `shapely`).

## Qué hace

`generar_capas.py`:

1. Recorta una ventana del DEM Copernicus GLO-30 (30 m) alrededor de Colón, leyendo
   solo el BBOX necesario directamente de los tiles COG en S3 (sin descargar el tile
   completo).
2. La remuestrea ×3 con interpolación bilineal para suavizar los bordes.
3. Para cada altura de puerto de 3,00 a 20,00 m (paso 0,25 m hasta 10,50 m, 0,5 m
   entre 10,50 y 13,00 m, 1,0 m entre 13,00 y 20,00 m — un paso fijo, que **no**
   cambia para entrar en el presupuesto de tamaño), calcula qué celdas
   quedan bajo el agua **y conectadas al río** (relleno por conectividad de 8 vecinos,
   no solo por cota), le resta el río normal (nivel base) y clasifica la profundidad
   en 3 clases.
   - El río normal es la mancha conectada a la semilla con cota ≤ nivel base
     (`máx(2,2 + CERO_IGN, cota del río en el DEM + 0,3)`) **más las mesetas planas
     del DEM pegadas al río**. Copernicus aplana los cuerpos de agua a un valor
     constante por segmento de edición: en el puerto el río vale 2,0 m, pero aguas
     arriba de las islas vale 2,5 m. Sin ese paso, la meseta de 2,5 m (≈590 ha)
     aparecía como agua nueva "de más de 1,5 m" desde los 3,00 m. Se absorben las
     mesetas con vecindario 3×3 perfectamente plano, a menos de 1,5 m sobre el nivel
     base, de al menos 5 ha y a ≤ 2 celdas del río ya detectado (iterativo). El
     resultado queda en `index.json` (`rio_base`: nivel, hectáreas y mesetas
     absorbidas).
   - Al unir tiles con `bounds` exactamente en el borde de un tile, `rasterio.merge`
     puede dejar una columna extra en 0; el script recorta filas/columnas de borde
     vacías y trata cualquier 0 restante como sin dato (nunca se inunda).
4. Limpia la máscara de agua nueva antes de vectorizar: saca componentes conectados
   más chicos que `--min-area-ha` (ruido de un par de píxeles) y rellena huecos
   interiores más chicos que `--min-hole-ha`. Sin esto, `rasterio.features.shapes`
   con su conectividad de 4 por defecto explota una mancha 8-conectada en miles de
   polígonos diagonales sueltos (se probó: una sola capa llegó a ~18.000 polígonos y
   8 MB). El script vectoriza con `connectivity=8` para que coincida con el relleno,
   y además filtra partes/huecos diminutos ya vectorizados como resguardo extra.
5. Vectoriza cada clase, simplifica la geometría y escribe un GeoJSON compacto por
   altura, más un `index.json` con metadatos (hectáreas, tamaño, bordes tocados,
   fuente del DEM, parámetros de limpieza, etc.).

## Cómo regenerar las capas

```bash
uv run --project geoprocessing python geoprocessing/generar_capas.py -v
```

Esto escribe los `.geojson` y el `index.json` en `frontend/public/capas/`. Se
commitean esos archivos; el DEM crudo y el recorte cacheado **no** (viven en
`geoprocessing/data/`, que está en `.gitignore`).

Flags útiles:

- `--dem <archivo.tif>`: usa un DEM local en vez de bajarlo de S3 (para iterar sin red).
- `--tolerance <grados>`: tolerancia de simplificación inicial (default `0.0002`, ≈
  1,5-2 veces el tamaño de píxel tras el remuestreo ×3 a esta latitud; una tolerancia
  mucho más chica que el píxel casi no reduce los vértices de "escalera" del borde
  rasterizado, que es lo que más pesa una vez limpiada la máscara).
- `--max-mb <n>`: presupuesto de tamaño total (default `25`).
- `--min-area-ha <n>`: saca componentes de agua nueva más chicos que esto, en
  hectáreas (default `0.1`). Subilo si todavía sobra tamaño por ruido.
- `--min-hole-ha <n>`: rellena huecos interiores más chicos que esto, en hectáreas
  (default `0.2`).
- `--no-expand`: desactiva la expansión automática este/oeste del BBOX (útil en tests
  o para depurar un recorte fijo).
- `--out <dir>`: directorio de salida (default `frontend/public/capas`). Útil para
  generar un juego de prueba fuera del repo sin pisar las capas versionadas.
- `--levels 3.0,4.0,5.0`: genera solo esos niveles en vez del barrido completo. Sirve
  como "dry run" barato: corré con un puñado de niveles representativos primero y
  mirá los bytes/polígonos/vértices que loguea cada uno antes de tirar la corrida
  completa de 41 capas.
- `-v`: logging en nivel DEBUG (solo de este script; el DEBUG de GDAL/rasterio queda
  siempre apagado porque es enormemente verboso y no aporta nada acá).

Si ni con la limpieza el barrido completo entra en el presupuesto, subí
`--min-area-ha` a 0,25 y `--min-hole-ha` a 0,5: se pierde algo de detalle en zonas
muy fragmentadas (charcos aislados chicos, huecos secos chicos dentro de una mancha
grande no se ven), a cambio de un tamaño manejable. Es un compromiso a documentar en
el resumen de la spec si hace falta usarlo, no algo para subir en silencio.

**El paso (0,25 / 0,5 / 1,0 m) nunca cambia para entrar en el presupuesto** (spec
008, S1/S2): sólo escalan automáticamente la tolerancia de simplificación (hasta
`MAX_TOLERANCE_ATTEMPTS` veces) y, a mano si hace falta, `--min-area-ha` /
`--min-hole-ha`. El rango de alturas (3,00 a 20,00 m) tampoco se recorta nunca.

Correr los tests del propio proyecto (numpy puro, sin red ni I/O de rasterio):

```bash
uv run --project geoprocessing pytest geoprocessing/tests -q
```

## Caché del DEM

El recorte del DEM (antes de remuestrear) se cachea en
`geoprocessing/data/dem_<bbox>.tif`. Si ya existe, no se vuelve a bajar de S3; para
forzar una descarga nueva (por ejemplo tras cambiar el BBOX) borrá el archivo de caché
correspondiente o todo `geoprocessing/data/`.

## BBOX, margen y expansión automática

- El BBOX inicial es `(-58.25, -32.30, -58.05, -32.15)` (oeste, sur, este, norte).
- Antes de generar nada se le aplica **una sola vez** un margen fijo de 0,05° al norte
  y al sur (queda `sur=-32.35`, `norte=-32.10`). Ese margen no se repite en las
  expansiones automáticas.
- Si el agua nueva (sin contar el río normal) toca el borde este u oeste del recorte
  en algún nivel por debajo de 20,00 m (el máximo), el script expande el BBOX 0,05°
  de ese lado y vuelve a correr todo el pipeline (hasta 4 expansiones por lado). El
  conteo final queda en `index.json` (`expansiones`). El nivel máximo en sí (20,00 m)
  nunca dispara una expansión: a esa altura es probable que el recorte toque borde
  igual porque el río no cabe; se registra en `toca_borde`/`bordes` de esa capa en vez
  de esconderlo (spec 008, S3).
- El contacto con el borde **norte o sur nunca expande el BBOX**: el río cruza la
  ciudad de norte a sur, así que esos lados van a tocar borde en casi cualquier
  altura modelada. Es esperado y solo se registra como advertencia en el log y en
  `index.json` (`bordes` de cada capa). No es un error.

## Calibrar `CERO_IGN`

El DEM Copernicus usa el datum vertical EGM2008 (superficie, incluye techos y
árboles); el cero del hidrómetro del puerto está referido al datum IGN. El desfase
entre ambos no está resuelto de forma independiente: se absorbe calibrando
`CERO_IGN` para que la mancha de inundación generada coincida con un evento real
conocido.

Para recalibrar:

1. Elegí un evento de referencia con altura de puerto y extensión conocidas, por
   ejemplo 4,44 m (costanera inundada, jul 2026) o 9,06 m (máximo diario INA, may
   2024).
2. Generá la capa de esa altura (o la más cercana al paso de 0,25 m) con distintos
   valores de `--cero-ign` y compará la mancha contra fotos o relevamientos del
   evento.
3. Ajustá `--cero-ign` hasta que la extensión coincida razonablemente.
4. **No cambies el valor por defecto en este script ni en
   `backend/app/config/dominio.py` sin pasar por una spec nueva** (ver
   `CLAUDE.md`, sección 5): es un dato de dominio, no un detalle de implementación.

## Presupuesto de tamaño

El total de los `.geojson` debe ser ≤ 25 MB (configurable con `--max-mb`). El barrido
completo (43 capas: paso 0,25 m hasta 10,50 m, 0,5 m hasta 13,00 m, 1,0 m hasta
20,00 m) se genera siempre con ese paso fijo; **el paso y el rango de alturas nunca
cambian para entrar en el presupuesto** (spec 008, S1/S2). Si el resultado se pasa del
presupuesto, el script:

1. Aumenta la tolerancia de simplificación ×1,5, hasta 3 veces, registrando cada
   intento en el log.
2. Si ni así entra, termina con código de salida distinto de cero y un mensaje claro
   en vez de generar capas fuera de presupuesto en silencio. En ese caso, la salida
   manual documentada más arriba (subir `--min-area-ha` y `--min-hole-ha`) es el
   siguiente paso, a mano y documentado en la spec — nunca en silencio.

La política de paso (`paso`, con las claves `hasta_1050`, `sobre_1050` y `sobre_13`)
y la tolerancia final (`tolerancia_simplificacion`) quedan documentadas en
`index.json`.

## Validar a ojo

Antes de confiar en las hectáreas, mirá la mancha: un artefacto del DEM puede sumar
cientos de hectáreas sin que ningún número lo delate. La forma más rápida es
rasterizar una capa sobre el recorte cacheado del DEM con `rasterio.features.rasterize`
y escribir un PNG (driver `PNG` de GDAL, sin dependencias nuevas), o cargar el
`.geojson` en QGIS sobre la imagen satelital. Chequeos mínimos: a 4,44-4,50 m tiene
que aparecer agua en la costanera del puerto; a 3,00 m casi no tiene que haber agua
nueva fuera del cauce; las hectáreas tienen que crecer con la altura.

## Licencia y atribución

Copernicus DEM © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018,
provisto bajo COPERNICUS por la Unión Europea y la ESA. La atribución completa
(incluidos los demás datos usados por la app) va en el pie de la web, según
`CLAUDE.md` sección 7.
