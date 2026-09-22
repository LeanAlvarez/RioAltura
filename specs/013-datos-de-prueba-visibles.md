# 013 — Que los datos de prueba nunca se confundan con los reales

- **Estado:** lista
- **Rama:** feat/013-datos-de-prueba-visibles
- **Depende de:** nada
- **Puede ir en paralelo con:** todas

## Objetivo

Que sea **imposible** que la app muestre datos inventados como si fueran la altura real del río, y que
cuando corra con datos de prueba **se note a simple vista**.

## Por qué, con el caso concreto

El 2026-09-22 la app estuvo mostrando **3,67 m** y "sube 12 cm en las últimas 24 h" mientras la API
devolvía **4,29 m** al lado. Esos números son literales de `frontend/src/mocks/data.ts`
(`altura_m: 3.67`, `tendencia_24h_m: 0.12`). El usuario lo detectó porque los gráficos "se veían
mal"; nada en la pantalla decía que eran datos de prueba.

**La causa no fue la configuración, fue la caché.** Verificado: arrancar Vite sin la variable da
`USE_MOCKS: false`. Lo que había pasado es que alguien corrió `VITE_USE_MOCKS=true vite` una vez, y
Vite —que reemplaza `import.meta.env.VITE_USE_MOCKS` por su valor **literal** al transformar el
módulo— dejó ese `true` incrustado en `node_modules/.vite`. Los arranques siguientes reusaron esa
caché. Lo que lo destrabó fue borrar la caché, no apagar la variable.

O sea: **un artefacto cacheado sobrevivió al entorno que lo produjo**, y nadie se enteró.

En una app de alerta de inundación eso es lo peor que puede pasar. Una altura inventada de 3,67 m
mostrada a un pueblo, con el mismo aspecto que un dato real, es precisamente el daño que esta app
existe para evitar.

## Alcance

- **D1 — Imposible en producción.** Con `import.meta.env.PROD`, `USE_MOCKS` es `false` sin importar
  qué diga la variable ni qué haya en ninguna caché. Un build de producción **no puede** contener el
  despachador de mocks.
- **D2 — El build falla si alguien lo intenta.** Si `VITE_USE_MOCKS=true` está presente al construir
  para producción, el build **aborta con un error explícito**. No es una advertencia que se pierde
  en el log.
- **D3 — Visible en pantalla.** Cuando corre con mocks, una banda fija y de alto contraste dice
  **"DATOS DE PRUEBA — no son mediciones reales del río"**, en todas las pantallas, imposible de
  confundir y que no se pueda cerrar.
- **D4 — Visible en el título.** El `<title>` lleva un prefijo, para distinguirlo entre pestañas.
- **D5 — Visible en la consola.** Un aviso al arrancar, para quien esté depurando.
- **D6 — Test que lo defiende.** Un test que falle si `USE_MOCKS` puede ser `true` con `PROD`, y
  otro que verifique que la banda se renderiza cuando los mocks están activos.

## Fuera de alcance

- **No se eliminan los mocks.** Sirven para trabajar sin backend y para diseñar. El problema no es
  que existan, es que sean indistinguibles.
- No se cambian los datos de las fixtures. Se evaluó hacerlos obviamente falsos (por ejemplo,
  alturas imposibles) y se descarta: se usan para revisar el diseño de los gráficos, y con datos
  absurdos dejan de servir para eso. La banda resuelve el problema sin romper su utilidad.
- No se toca el contrato ni el dominio.

## Diseño / decisiones

### La defensa va en capas, porque la caché ya demostró que puede saltearse una

1. **En el código** (D1): `PROD` gana siempre, sin importar la variable.
2. **En el build** (D2): falla ruidosamente antes de producir un artefacto contaminado.
3. **En la pantalla** (D3-D5): si igual llegara a pasar, se ve.

Cualquiera de las tres sola es insuficiente. La primera no habría evitado el caso del 22/09, porque
fue en desarrollo; la tercera sí.

### La banda es fija y no se cierra

Un aviso que se puede cerrar se cierra, y a los cinco minutos nadie se acuerda de que está en modo
prueba. Es exactamente el error que se busca prevenir.

## Archivos compartidos que puede tocar

- `frontend/vite.config.ts` — la verificación del build (D2).
- `frontend/src/env.ts`, `frontend/index.html`, `frontend/src/style.css`.

## Criterios de aceptación

- [x] Con `import.meta.env.PROD`, `USE_MOCKS` es `false` aunque la variable diga `true`.
- [x] `VITE_USE_MOCKS=true pnpm build` **falla** con un mensaje claro.
- [x] El bundle de producción **no incluye** `mocks/`, verificado inspeccionando `dist/`.
- [x] Con mocks activos, la banda "DATOS DE PRUEBA" se ve en todas las pantallas, a 360 y a 1920 px,
      en ambos temas, y no se puede cerrar.
- [x] El `<title>` y la consola lo avisan.
- [x] Un test falla si se rompe D1; otro verifica que la banda se renderiza.
- [x] `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan.

## Cómo verificar

```bash
cd frontend
pnpm exec tsc --noEmit          # sin errores
pnpm test                       # 24 archivos, 247 tests, incluye env.test.ts y mockBanner.test.ts
pnpm build                      # dist/ limpio
VITE_USE_MOCKS=true pnpm build  # TIENE que fallar (exit code 1, mensaje explícito en vite.config.ts)

# dist/ no contiene el despachador de mocks ni las fixtures:
rg -i "mockFetch|mockUltimaAltura|mockPronostico|jsonResponse|hybas_6121320620" dist/assets/*.js
# sin matches (exit 1 de rg)

cd ..
set -a; . ./.env.local; set +a
uv run ruff check . && uv run pytest -q   # sin tocar backend/worker, sigue en verde
```

Verificación visual con Playwright (`frontend/scripts/verificar-banda-mock.mjs`):

```bash
VITE_USE_MOCKS=true pnpm -C frontend dev &   # puerto de WEB_PORT en .env.local
node frontend/scripts/verificar-banda-mock.mjs http://localhost:<WEB_PORT>/ si
# y, levantando el server sin la variable:
node frontend/scripts/verificar-banda-mock.mjs http://localhost:<WEB_PORT>/ no
```
Chequea, en 360×900 y 1920×900, en `light` y `dark`: visibilidad de `#mock-banner`, texto
"DATOS DE PRUEBA" y prefijo `[DATOS DE PRUEBA]` en `<title>`. También se confirmó a mano con
capturas y un scroll de 2000px que la banda queda pegada arriba (`position: sticky`).

## Hallazgos

- **El bundle "limpio" (sin `VITE_USE_MOCKS`) igual incluía todo `mocks/data.ts` y `mocks/fetch.ts`
  antes de este cambio.** La causa: `src/api/fetch-default.ts` decidía `mockFetch` vs. `fetch` con
  `USE_MOCKS ? mockFetch : fetch`, donde `USE_MOCKS` era un *binding* importado desde `env.ts`.
  Vite/Rollup no propagan el valor constante de un export entre módulos, así que aunque `USE_MOCKS`
  siempre valiera `false` en producción, el import de `mockFetch` (y transitivamente de las 400+
  líneas de fixtures) no se podía eliminar por tree-shaking. Se verificó con `rg` sobre el bundle
  antes y después del fix: antes aparecían `mockFetch`, `jsonResponse`, `hybas_6121320620` (gauge id
  que solo vive en la fixture) y todas las funciones `mock*`; después, ninguno. El fix: mover el
  chequeo a `import.meta.env.PROD` **inline, en el mismo archivo donde se importa `mockFetch`**
  (`fetch-default.ts`), para que el reemplazo literal que hace Vite de `import.meta.env.PROD` permita
  a Rollup plegar el ternario y descartar la rama entera (y con ella el import). Esto no estaba en el
  alcance original de la spec pero es necesario para cumplir el criterio de aceptación "el bundle de
  producción no incluye `mocks/`", así que se corrigió como parte de D1.
- No se tocó `contracts/openapi.yaml` ni `backend/app/config/dominio.py`.
- No se agregaron dependencias (se corrió `pnpm install` porque `node_modules/` no existía en el
  worktree; el lockfile no cambió).

## Resumen final

Defensa en tres capas contra confundir datos de prueba con mediciones reales: `USE_MOCKS` ahora es
una función pura testeada donde `PROD` siempre gana; `vite build` aborta si `VITE_USE_MOCKS=true`;
y una banda fija negro/amarillo, sin botón de cierre, avisa en pantalla, título y consola. Además se
encontró y corrigió un bug real preexistente: el despachador de mocks sobrevivía en el bundle de
producción por una indirección entre módulos que impedía el tree-shaking; ahora `dist/` está limpio,
verificado por grep. Los 6 criterios de aceptación y los 4 comandos de verificación pasan en verde.
