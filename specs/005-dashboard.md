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

- [x] Con mocks, la página completa se ve bien a 360 px y en desktop (capturas en la spec).
- [x] Cada tarjeta maneja cargando / error / dato viejo de forma independiente (tests con Vitest).
- [x] La frase del pronóstico siempre muestra un rango, nunca un número exacto (test).
- [x] Formato numérico y de fechas en es-AR (test).
- [x] Disclaimer y atribuciones presentes.
- [x] `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan.

## Cómo verificar

```bash
cd /Users/leandroalvarez/orca/workspaces/RioAltura/dashboard
uv run ruff check .
uv run ruff format --check .
uv run pytest
pnpm -C frontend install
pnpm -C frontend build     # corre tsc --noEmit (estricto) + vite build
pnpm -C frontend test      # 48 tests, Vitest
```

Para ver la página con datos mock (sin backend ni base):

```bash
VITE_USE_MOCKS=true pnpm -C frontend dev
# abrir http://localhost:$WEB_PORT/ (WEB_PORT en .env.local del worktree, acá 5271)
```

Capturas (Playwright, Chromium) en `specs/assets/005/`:
- `movil-360-claro.png` / `movil-360-oscuro.png`: 360 px, modo claro y oscuro.
- `desktop-1280.png`: 1280 px.
- `movil-360-interacciones.png`: selector 365 días + toggle "pronóstico a 3 días histórico" + "Ver como texto" abiertos.
- `movil-360-pronostico-no-disponible.png`: con `/api/pronostico` devolviendo 503 (forzado temporalmente en el mock para la captura), verificando que el resto de la página sigue funcionando.

## Hallazgos

Cosas fuera de alcance de esta spec que encontré en el camino (no las toqué):

- El indicador de salud de la API (`#health`, de la spec 001) seguía apuntando a `/api/health`, que no tiene mock — con `VITE_USE_MOCKS=true` y sin backend corriendo siempre muestra "API no disponible". Es el comportamiento correcto (no hay backend), pero si en algún momento se agrega un mock general de `/health` convendría respetar el mismo flag.
- `contracts/openapi.yaml` no define un endpoint para "Mi casa" ni para capas de inundación (spec 006 lo resuelve); el contenedor del mapa está listo para que `map.ts` exponga `setNivelPronosticado`.
- Los datos mock de altura real a 365 días quedan visualmente "ruidosos" (ruido aleatorio ±10 cm por día) — es solo para desarrollo offline, no afecta a producción, pero si se usa mucho el selector de 365 días en demos podría convenir suavizarlo.

## Resumen final

Armé el dashboard completo (Hoy, Próximos días, gráfico con uplot, contenedor de mapa montado defensivamente, pie con disclaimer/atribuciones), con mocks realistas bajo `VITE_USE_MOCKS=true` y sin tocar `map.ts`. Separé lógica pura (formateo es-AR, derivación de estado por tarjeta) de renderizado DOM, con 48 tests Vitest que cubren carga/error/dato viejo por tarjeta, rango obligatorio en la frase de pronóstico, caveat de extrapolación, degradación del mapa y aislamiento del 503 de `/pronostico`. Verifiqué visualmente a 360 px y 1280 px, en claro y oscuro, con Playwright/Chromium (capturas en `specs/assets/005/`); corregí un bug real que encontré ahí (línea de altura real invisible en modo oscuro por color fijo). `ruff`, `pytest`, `pnpm build` (tsc estricto) y `pnpm test` pasan todos.
