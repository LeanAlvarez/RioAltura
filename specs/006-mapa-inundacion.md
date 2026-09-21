# 006 — Capas de inundación y mapa interactivo

- **Estado:** lista
- **Rama:** feat/006-mapa-inundacion
- **Depende de:** 001
- **Puede ir en paralelo con:** 002, 003, 005

## Objetivo

Llevar a la app el mapa de inundación que validamos en el notebook: zonas que se inundan en Colón según la altura del puerto, con slider, escenarios reales y la altura pronosticada.

## Alcance

### A. Geoprocessing (offline, `geoprocessing/`)

1. Script `geoprocessing/generar_capas.py` (dependencias propias en `geoprocessing/pyproject.toml`, fuera del workspace de la app: `rasterio`, `numpy`, `scipy`, `shapely`, `affine`).
2. Método (el mismo del notebook):
   - DEM Copernicus GLO-30: `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S33_00_W059_00_DEM/Copernicus_DSM_COG_10_S33_00_W059_00_DEM.tif`, recorte `BBOX = (-58.25, -32.30, -58.05, -32.15)`.
   - Remuestreo ×3 (bilineal) para suavizar bordes.
   - Cota del agua = altura del puerto + `CERO_IGN` (−0,26 m, parámetro).
   - Inundado = celdas ≤ cota **conectadas al río**, con semilla en el punto más bajo cerca de `(-58.11, -32.22)`.
   - Se descuenta el río normal: nivel base = máx(`2,2 + CERO_IGN`, cota del río en el DEM + 0,3).
   - Profundidad en 3 clases: ≤ 0,5 m / 0,5–1,5 m / > 1,5 m.
3. Salida en `frontend/public/capas/`:
   - Un GeoJSON por altura de 3,00 a 10,50 m cada 0,25 m (`h_0450.geojson`, etc.), polígonos simplificados (tolerancia ~0,00004°) y coordenadas con 5 decimales.
   - `index.json` con `[{h, archivo, hectareas}]` y metadatos (`cero_ign`, fecha de generación, fuente del DEM).
   - Tamaño total ≤ 15 MB. Si se pasa, aumentar la simplificación y documentarlo.
4. README en `geoprocessing/` con cómo regenerar y cómo calibrar `CERO_IGN`.

### B. Módulo de mapa (`frontend/src/map.ts` y `frontend/src/capas.ts`)

1. Base satelital Esri + capa "Calles" OSM (como está hoy), más etiquetas si hay un proveedor sin key.
2. Capa de inundación cargada **bajo demanda** (fetch del GeoJSON de la altura elegida, con caché en memoria). Colores por profundidad y leyenda.
3. **Slider** de altura (3,00 a 10,50 m, paso 0,25) con la altura, la cota y las hectáreas.
4. **Botones de escenarios**: Hoy (altura actual), Pronóstico máx., 4,44 m costanera (jul 2026), 6,80 evacuación en seco, 7,10 alerta, 7,60 crecida jun 2025, 7,90 evacuación, 9,06 máximo mayo 2024.
5. **API pública del módulo** (la usa la spec 005):
   - `setNivelActual(h: number)` y `setNivelPronosticado(h: number)`: habilitan esos botones y, si el usuario no tocó nada, el mapa arranca en el pronosticado.
   - Redondeo al paso de 0,25 más cercano, informado en la UI ("mostrando 5,75 m").
6. Marcador del hidrómetro del puerto en `(-32.2147, -58.1370)`.
7. Aviso dentro del mapa: "Modelo simplificado sobre elevación satelital. Orientativo."

## Fuera de alcance

- "Mi casa" (altura a la que se moja cada punto): spec posterior, usando la misma base.
- Tarjetas de estado y gráfico (spec 005).
- Backend.

## Diseño / decisiones

- El DEM crudo y temporales van a `geoprocessing/data/` (en `.gitignore`). Solo se versionan las capas finales.
- Las capas se generan a mano y se commitean; la app no procesa el DEM.
- Sin dependencias nuevas en el frontend (Leaflet ya está).

## Archivos compartidos que puede tocar

- `frontend/src/map.ts` (es de esta spec), nuevo `frontend/src/capas.ts`, `frontend/public/capas/`.
- `.gitignore` solo si falta `geoprocessing/data/`.
- NO tocar `frontend/src/main.ts` salvo lo mínimo para exportar el módulo; el layout es de la spec 005.

## Criterios de aceptación

- [ ] `generar_capas.py` corre de punta a punta y genera 31 capas + `index.json`.
- [ ] Sanidad: las hectáreas crecen de forma monótona con la altura; a 4,44 m aparece agua en la zona costera del puerto (captura en la spec para validar a ojo).
- [ ] Tamaño total de capas ≤ 15 MB.
- [ ] El slider cambia de capa en < 300 ms con la capa en caché.
- [ ] `setNivelPronosticado` y `setNivelActual` testeados (Vitest).
- [ ] Se ve y se usa bien a 360 px (captura en la spec).
- [ ] `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan.

## Cómo verificar

(Completar.)

## Hallazgos

(Completar.)

## Resumen final

(Completar, máximo 5 líneas.)
