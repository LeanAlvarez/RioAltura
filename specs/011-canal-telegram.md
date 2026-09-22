# 011 — Canal de Telegram y avisos por umbral propio

- **Estado:** lista
- **Rama:** feat/011-canal-telegram
- **Depende de:** 003 (aviso por pronóstico), 009 (cadena de alturas) — mergeadas
- **Puede ir en paralelo con:** specs de frontend (esta es worker + config)

## Objetivo

Que el vecino se entere de que cambió el nivel de aviso **sin tener que abrir la app**. Hoy el
sistema calcula el aviso y no se lo dice a nadie.

## Estado actual, verificado

El `CLAUDE.md` lista las alertas por Telegram en la visión del proyecto (§1) y en el diagrama de
arquitectura (§3), pero **no existe una sola línea de código**: `rg -i telegram` no encuentra nada
fuera de los `.md`. `backend/app/services/avisos.py` sí calcula el nivel
(`sin_aviso` / `atencion` / `alerta_probable`) y nadie lo publica.

## Alcance

### Dos niveles: canal abierto y aviso por umbral propio

**Nivel 1 — Canal público.** Para cualquiera que quiera enterarse. Se suscribe con un link, se va
cuando quiere, y **no guardamos absolutamente nada**: la lista la maneja Telegram. Su historial
público es rendición de cuentas gratis, porque cualquiera puede revisar qué avisamos y cuándo.

**Nivel 2 — Aviso por umbral propio.** Para quien quiere que le avisen a *su* altura, no a la
oficial. El que vive en la costanera necesita saberlo a los 4,44; el de la zona alta, recién a los
7,90. Un solo umbral para todos no le sirve a nadie del todo.

### El formulario no nos manda nada

El vecino elige su umbral en la web, y el botón **abre Telegram con ese valor codificado en el
link** (`https://t.me/<bot>?start=<umbral>`). El bot lo recibe como `/start 720`, y registra el
`chat_id` que Telegram le entrega junto con el umbral.

Consecuencia: **el formulario no hace POST a nuestro servidor y nunca vemos un mail ni un nombre.**
El único dato personal que guardamos es un `chat_id` opaco, que llega por el canal de Telegram y no
por nuestra web.

### Qué significa esto para la promesa de privacidad

El FAQ dice hoy: *"sin cookies de seguimiento ni analytics; sólo la preferencia de tema en tu
navegador"*. Eso sigue siendo cierto **para la web**, y hay que dejarlo así de explícito:

- Quien sólo usa la web o el canal: no guardamos nada suyo.
- Quien activa el aviso por umbral: guardamos su `chat_id` y su umbral, nada más. Sin mail, sin
  nombre, sin ubicación.
- **Baja en un comando**, que borra la fila. No queda nada.

La respuesta del FAQ tiene que decir las tres cosas, sin letra chica.

### Qué se publica

- **A1 — Cambio de nivel de aviso.** Cuando `calcular_aviso` pasa de un nivel a otro. Es el mensaje
  que justifica el canal.
- **A2 — Estado diario.** Un mensaje corto una vez por día con la altura y el estado, aunque no
  pase nada. Un canal que sólo habla cuando hay peligro se silencia meses, la gente lo silencia o
  se va, y el día que diga "Atención" ya nadie lo lee. El estado diario construye el hábito.
- **A3 — Vuelta a la normalidad.** Cuando el nivel baja, se avisa igual. Un canal que avisa el
  peligro y no avisa que pasó deja a la gente en vilo.

### Qué se manda por umbral propio (nivel 2)

- **B1 — Aviso al cruzar el umbral elegido**, con la altura y la fecha del dato.
- **B2 — Aviso cuando baja** de ese umbral.
- **B3 — Comandos mínimos**: fijar umbral, ver el actual, y baja. La baja borra la fila.
- **B4 — Un aviso por cruce, no por corrida**: mismas salvaguardas de antirrebote y deduplicación
  que el canal, por suscriptor.

### Envío automático, con salvaguardas

El envío es **automático**, sin intervención humana (decisión del usuario). Como el envío es
irreversible y va a todo el pueblo, lleva salvaguardas que no dependen de que alguien esté mirando:

- **S1 — Antirrebote.** Un nivel que oscila alrededor del umbral no puede disparar un mensaje por
  cada cruce. Se exige que el nivel nuevo se sostenga un mínimo de corridas consecutivas antes de
  publicar.
- **S2 — Deduplicación.** El mismo aviso no se publica dos veces. El último nivel publicado se
  guarda en la base, no en memoria: reiniciar el worker no puede reenviar.
- **S3 — Tope de mensajes por día.** Un techo duro. Si se alcanza, se registra y no se publica más
  ese día: un bug de nuestro lado no puede convertirse en spam a un pueblo entero.
- **S4 — Interruptor de corte.** Una variable de entorno apaga la publicación sin tocar código ni
  parar el worker. El resto del sistema sigue funcionando.
- **S5 — Fallar callado.** Si Telegram no responde, se registra y se sigue. Una caída de Telegram
  nunca puede tumbar el job de avisos ni el de alturas.

### Los textos

- Lenguaje llano, igual que la app: "El río sube", "Atención", nada de `m³/s` ni `lead` (§7).
- **Disclaimer en todo mensaje de aviso**: orientativo, no reemplaza a Prefectura ni a Defensa Civil
  (§7).
- Fecha y hora del dato, y su fuente (§6).
- Link a la app.
- **No se inventan textos de riesgo nuevos** (§9): se reutilizan los de `domain/umbrales.ts`, ya
  aprobados y marcados como pendientes de confirmación municipal.

## Fuera de alcance

- **"Tu casa está en riesgo".** Necesita "Mi casa", que todavía no existe. Cuando exista, se
  engancha a este mismo bot.
- **SMS y WhatsApp.** La API de WhatsApp Business y los SMS tienen costo a escala, y el §9 prohíbe
  sumar servicios pagos. Si se quieren, hay que evaluarlos explícitamente contra esa regla.
- **Avisos meteorológicos de corto plazo** (radar, tormentas). Se está investigando si existe
  fuente pública para Colón; va en su propia spec y este canal la publicará cuando exista.
- No se cambian los umbrales ni la curva (§5, §9).

## Diseño / decisiones

### Los umbrales que disparan esto son provisorios

El `CLAUDE.md` §5 marca los umbrales de aviso como **"Calibrado con 2 eventos: provisorio"**. Este
canal los convierte en mensajes a un pueblo entero. Eso no se resuelve en esta spec, pero sí obliga
a dos cosas:

- Cada mensaje de aviso dice que es **orientativo** y remite a Prefectura y Defensa Civil.
- El interruptor de corte (S4) existe justamente para el día que los umbrales demuestren estar mal.

### Configuración

- `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CANAL_ID` como variables de entorno, **sólo en el worker**, nunca
  en el frontend ni en logs ni en fixtures (§6). Igual tratamiento que `FLOODS_API_KEY`.
- **El canal ya existe y está probado** (2026-09-22): `@RioUruguayNotifica`
  ("Rio Uruguay Notificaciones"), público, con el bot como administrador y permiso de publicar.
  Verificado con un `sendMessage` real que devolvió `ok: true`.
  `TELEGRAM_CANAL_ID` es literalmente `@RioUruguayNotifica`: al ser canal público no hace falta el
  id numérico. El nombre de usuario **no es secreto** y puede vivir en `.env.example` y en los
  links de la app; el token no.
- Si falta el token, el worker arranca igual y no publica, registrando el motivo. Un entorno de
  desarrollo sin token tiene que funcionar.

### Persistencia del último aviso publicado

Tabla nueva (migración nueva, sin editar ninguna existente, §2) con el último nivel publicado, su
fecha y el id del mensaje. Es lo que hace posible S2 y S3 a través de reinicios.

## Archivos compartidos que puede tocar

- `docker-compose.yml` — sólo para pasar las dos variables nuevas al servicio `worker`.
- `.env.example` — las dos variables, vacías.
- Migración nueva para la tabla de estado del canal.

## Criterios de aceptación

- [ ] Al cambiar el nivel de aviso se publica un mensaje, y sólo uno.
- [ ] Reiniciar el worker **no** reenvía el último aviso (S2 persistido en base).
- [ ] Un nivel que oscila alrededor del umbral no dispara un mensaje por cruce (S1), verificado con
      una serie sintética.
- [ ] Alcanzado el tope diario (S3) se registra y no se publica más.
- [ ] Con el interruptor apagado (S4) no se publica nada y el resto del worker sigue igual.
- [ ] Telegram caído no rompe el job de avisos ni el de alturas (S5).
- [ ] Sin token configurado el worker arranca y no publica.
- [ ] El token **no aparece** en logs, fixtures ni mensajes de error.
- [ ] Todo mensaje de aviso lleva disclaimer, fecha/hora del dato y su fuente.
- [ ] El formulario web genera el link con el umbral y **no hace ningún POST a nuestra API**.
- [ ] Fijar umbral, consultarlo y darse de baja funcionan; la baja **borra** la fila.
- [ ] Un suscriptor recibe un aviso por cruce de su umbral, no uno por corrida del worker.
- [ ] El FAQ explica sin letra chica qué se guarda en cada caso y cómo darse de baja.
- [ ] Los tests **nunca** llaman a la API de Telegram (§6): cliente mockeado.
- [ ] `ruff`, `pytest`, `pnpm build` y `pnpm test` pasan.

## Cómo verificar

(La completa el agente.)

## Hallazgos

(La completa el agente.)

## Resumen final

(La completa el agente, máximo 5 líneas.)
