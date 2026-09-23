# 015 — "Mi casa": a qué altura se moja un punto

- **Estado:** lista
- **Rama:** feat/015-mi-casa
- **Depende de:** 006 (capas de inundación), 011 (avisos por umbral) — mergeadas
- **Puede ir en paralelo con:** specs de worker

## Objetivo

Responder la pregunta que el vecino realmente tiene: **"¿a qué altura del río se moja mi casa?"**.
Todo lo demás que muestra la app es contexto; esto es la respuesta.

## Estado actual

El `CLAUDE.md` lista "Mi casa" en la visión (§1) y describe un ráster de "altura a la que se moja
cada píxel" (§3). **Ninguno de los dos existe**: `generar_capas.py` sólo produce los 43 GeoJSON y su
`index.json`. Mismo patrón que el canal de Telegram y la PWA: está en la visión, no en el código.

## Alcance

### C1 — Marcar un punto en el mapa

El vecino toca su casa en el mapa (o usa su ubicación, si la da). Aparece un marcador y la respuesta.

### C2 — La respuesta se calcula en el navegador, sin mandarnos el punto

**La coordenada de la casa no sale del dispositivo.** No hay endpoint al que se le pregunte, ni
ráster que se descargue entero: el navegador busca la respuesta en **las capas que ya usa el mapa**.

Como las capas están ordenadas por altura, alcanza una **búsqueda binaria**: probar si el punto cae
dentro del agua de la capa del medio, y según el resultado subir o bajar. Sobre 43 capas son ~6
consultas en vez de 43, y varias ya están en la caché del mapa.

Esto no es sólo una optimización: es lo que mantiene intacta la promesa del FAQ. La ubicación de una
casa es dato personal sensible —dice dónde vive alguien—, y la forma más segura de tratarla es no
recibirla nunca.

### C3 — El punto se guarda sólo en el navegador

`localStorage`, con `try/catch`, igual que la preferencia de tema. Si falla o se limpia, la app
funciona y el vecino vuelve a marcar. **No se guarda nada en el servidor y no hace falta cuenta.**

### C4 — Engancha con los avisos por umbral

Una vez calculada la altura, el botón de avisos arma el link de Telegram **con ese valor ya
cargado** (spec 011). El vecino pasa de "mi casa se moja a 7,40 m" a "avisame cuando el río llegue a
7,40" en un toque, sin escribir un número.

### C5 — El disclaimer, que acá es lo más importante

Ningún referente grande da una altura exacta por propiedad. El servicio del Reino Unido
([gov.uk/check-long-term-flood-risk](https://www.gov.uk/check-long-term-flood-risk)) busca por código
postal y dice textualmente:

> *"This service does not tell you how likely it is that an individual property will flood"*

Aclaran que el umbral de la puerta, el nivel del piso y las rejillas de aire son factores que el
mapa no puede conocer. FEMA usa zonas con porcentaje anual; First Street, un score. **Nuestro
enfoque es más específico que el de cualquiera de ellos**, y eso lo hace más útil y más peligroso.

El dato que lo alimenta tiene límites duros:

- El DEM es **Copernicus GLO-30: píxeles de 30 m**, y es de superficie — **incluye techos y
  árboles**, no el suelo.
- Los polígonos están simplificados a ~20 m de tolerancia.
- El modelo **no conoce defensas, desagües, bombeo ni lluvia local**.
- El desfase de datum EGM2008 ↔ IGN sigue sin resolverse de forma independiente (§5).

Por eso, junto a la respuesta, **siempre y sin poder cerrarse**:

> **Es un cálculo aproximado, no una medición de tu casa.**
> Usa una imagen satelital de 30 metros que incluye techos y árboles, y no conoce el umbral de tu
> puerta, el nivel del piso, las defensas ni los desagües. Puede errar por metros.
> Ante una crecida, seguí a Prefectura y a Defensa Civil.

La altura se muestra **redondeada al escalón de las capas** (0,25 m), nunca con más precisión de la
que el dato tiene.

## Fuera de alcance

- **No se guarda nada en el servidor** y **no hay login**. Decisión del usuario: el punto vive en el
  navegador. Si algún día se quiere sincronizar entre dispositivos, es una spec propia con su
  infraestructura de cuentas y su política de privacidad.
- No se genera el ráster por píxel del §3: la búsqueda binaria sobre las capas existentes responde lo
  mismo sin un artefacto nuevo que versionar ni descargar. Si en el futuro hiciera falta más
  precisión, ahí sí conviene.
- No se cambian las capas, los umbrales ni la curva (§5, §9).
- No se agregan dependencias.

## Diseño / decisiones

### Por qué la búsqueda binaria y no el ráster

| | Búsqueda binaria sobre las capas | Ráster por píxel |
|---|---|---|
| La coordenada sale del dispositivo | **no** | sí, o se baja el ráster entero |
| Artefacto nuevo que versionar | no | sí, y pesado |
| Descarga en 3G | ~6 capas, varias ya en caché | el ráster completo, o un endpoint |
| Precisión | la del DEM, igual | la del DEM, igual |

La precisión es la misma porque **las dos salen del mismo DEM de 30 m**. Lo que cambia es el costo y
la privacidad.

### Casos que hay que resolver bien

- **Punto fuera del área modelada**: decirlo, no inventar una altura.
- **Punto que ya está bajo agua** a la altura mínima de las capas (3,00 m): decir que está en zona
  que se inunda con el río en su nivel habitual.
- **Punto que no se moja ni a 20 m**: decir eso, que es la buena noticia, sin sugerir que es
  imposible que se inunde — la lluvia local y los desagües no están en el modelo.

## Criterios de aceptación

- [ ] El vecino puede marcar un punto tocando el mapa, y ve la altura a la que se moja.
- [ ] **La coordenada nunca se envía al servidor**, verificado inspeccionando el tráfico de red.
- [ ] La búsqueda usa a lo sumo ~6 capas, no las 43.
- [ ] El punto sobrevive a recargar la página, y la app funciona si `localStorage` falla.
- [ ] El botón de avisos arma el link de Telegram con la altura ya cargada.
- [ ] El disclaimer se ve junto a la respuesta, **siempre**, y no se puede cerrar.
- [ ] La altura se muestra redondeada al escalón de las capas.
- [ ] Los tres casos de borde (fuera del área, ya inundado a 3 m, seco a 20 m) tienen su texto y su
      test.
- [ ] El FAQ explica que el punto se guarda sólo en el navegador y que no se envía a ningún lado.
- [ ] Funciona a 360 px, en ambos temas.
- [ ] `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan.

## Cómo verificar

(La completa el agente.)

## Hallazgos

(La completa el agente.)

## Resumen final

(La completa el agente, máximo 5 líneas.)
