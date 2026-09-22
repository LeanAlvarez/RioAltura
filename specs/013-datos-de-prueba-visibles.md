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

- [ ] Con `import.meta.env.PROD`, `USE_MOCKS` es `false` aunque la variable diga `true`.
- [ ] `VITE_USE_MOCKS=true pnpm build` **falla** con un mensaje claro.
- [ ] El bundle de producción **no incluye** `mocks/`, verificado inspeccionando `dist/`.
- [ ] Con mocks activos, la banda "DATOS DE PRUEBA" se ve en todas las pantallas, a 360 y a 1920 px,
      en ambos temas, y no se puede cerrar.
- [ ] El `<title>` y la consola lo avisan.
- [ ] Un test falla si se rompe D1; otro verifica que la banda se renderiza.
- [ ] `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan.

## Cómo verificar

(La completa el agente.)

## Hallazgos

(La completa el agente.)

## Resumen final

(La completa el agente, máximo 5 líneas.)
