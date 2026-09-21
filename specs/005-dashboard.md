# 005 — Dashboard web: estado, pronóstico y gráfico

- **Estado:** lista
- **Rama:** feat/005-dashboard
- **Depende de:** 001
- **Puede ir en paralelo con:** 002, 003, 006 (usa mocks del contrato mientras 002/003 no estén mergeadas)

## Objetivo

Que un vecino abra la web en el celular y entienda en 5 segundos cómo está el río hoy, qué se espera para los próximos días y qué tan cerca está de la alerta.

## Alcance

Página única, mobile-first (360 px), en este orden de arriba hacia abajo:

1. **Tarjeta "Hoy"**: altura actual grande (`3,67 m`), badge de estado (Normal / Evacuación en seco / Alerta / Evacuación) con texto y color, tendencia 24 h ("Sube 12 cm", "Baja 5 cm", "Estable" si |Δ| < 5 cm), y "Actualizado hace X" (con alerta visual si el dato tiene más de 6 h).
2. **Tarjeta "Próximos días"**:
   - Nivel de aviso (Sin aviso / Atención / Alerta probable) en lenguaje simple.
   - Frase generada: "El río podría llegar a entre 4,7 y 6,7 m el sábado 27". Usar el día de altura máxima estimada, siempre como rango.
   - Mini lista de 7 días: día, flecha de tendencia y rango de altura.
3. **Gráfico**:
   - Altura real (línea) de los últimos 90 días (selector 30 / 90 / 365 días).
   - Pronóstico vigente como **banda** (min–max) más línea central.
   - Líneas horizontales de Evacuación en seco (6,80), Alerta (7,10) y Evacuación (7,90) con etiqueta.
   - Opcional con toggle: "pronóstico a 3 días que se hizo en su momento" (de `/api/pronostico/historico`) para mostrar qué tan bien acierta.
4. **Contenedor del mapa**: reservar el bloque. El mapa lo implementa la spec 006 como módulo; esta spec solo lo monta y le pasa la altura máxima estimada llamando `setNivelPronosticado(h)` si el módulo existe.
5. **Pie**: disclaimer obligatorio y atribuciones (sección 7 del `CLAUDE.md`), con links a Prefectura, CARU e INA.

Estados:
- Cargando (skeletons), error por endpoint (cada tarjeta falla sola, sin tumbar la página), dato viejo.
- Si `/api/pronostico` devuelve 503: tarjeta "Pronóstico no disponible" y el resto funciona.

## Contrato que consume

Tomalo de las specs 002 y 003:
- `GET /api/alturas/ultima`, `GET /api/alturas?desde&hasta`
- `GET /api/pronostico`, `GET /api/pronostico/historico?lead=3&desde`

Mientras no estén mergeadas, usá mocks en `frontend/src/mocks/` con datos realistas (los del notebook: hoy ~3,7 m subiendo, pronóstico hasta ~9.100 m³/s ≈ 5,7 m, sin aviso) y un flag `VITE_USE_MOCKS=true`.

## Fuera de alcance

- Capas de inundación y slider (spec 006).
- "Mi casa" (spec posterior).
- Alertas por Telegram.
- Backend.

## Diseño / decisiones

- Sin framework de UI: TypeScript + DOM, con componentes simples por archivo en `frontend/src/components/`.
- Gráfico: se permite agregar **una** dependencia, `uplot` (liviano). Nada más.
- Estilo sobrio y legible: tipografía del sistema, alto contraste, modo oscuro por `prefers-color-scheme`.
- Números con coma decimal y fechas en español (`Intl`, `es-AR`).
- Nada de "m³/s", "lead" ni "hybas" como dato principal; el caudal puede ir en un detalle desplegable.
- Accesibilidad: estados con texto, no solo color; contraste AA.

## Archivos compartidos que puede tocar

- `frontend/src/main.ts`, `frontend/index.html`, `frontend/src/styles*`.
- NO tocar `frontend/src/map.ts` (es de la spec 006) salvo para montarlo.
- `frontend/package.json` solo para agregar `uplot`.

## Criterios de aceptación

- [ ] Con mocks, la página completa se ve bien a 360 px y en desktop (capturas en la spec).
- [ ] Cada tarjeta maneja cargando / error / dato viejo de forma independiente (tests con Vitest).
- [ ] La frase del pronóstico siempre muestra un rango, nunca un número exacto (test).
- [ ] Formato numérico y de fechas en es-AR (test).
- [ ] Disclaimer y atribuciones presentes.
- [ ] `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan.

## Cómo verificar

(Completar.)

## Hallazgos

(Completar.)

## Resumen final

(Completar, máximo 5 líneas.)
