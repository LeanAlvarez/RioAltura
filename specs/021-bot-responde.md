# 021 — Que se pueda escribir una altura desde el celular

- **Estado:** lista
- **Rama:** fix/021-bot-responde
- **Depende de:** 011 (canal de Telegram), mergeada

## El defecto, reportado desde un teléfono real

> *"la coma en el telefono no funciona y no me deja escribir numeros enteros como 712"*

El campo del umbral era **`type="number"`**. Eso tiene dos consecuencias en un celular:

1. El navegador **descarta la coma en silencio** si su locale usa punto. El vecino aprieta la tecla
   y no aparece nada, sin ningún aviso.
2. Cuando el valor no le parece válido, `input.value` devuelve **cadena vacía**. O sea que el
   código lee `""`, calcula `Number("") = 0`, y responde "altura inválida" a alguien que **sí**
   escribió algo y no vio nada raro.

Sin coma disponible, la salida natural es escribir `712` queriendo decir `7,12`. Y ahí el mensaje
de error decía *"Ingresá una altura entre 0.01 y 15"*, que no explica nada: son 712 metros, claro
que está fuera de rango, pero eso no es lo que la persona quiso decir.

## Alcance

### D1 — Un campo que acepte lo que el teclado puede producir

`type="text"` con `inputmode="decimal"`: sigue mostrando el teclado numérico en el celular, pero el
texto crudo llega entero y podemos aceptar **coma y punto por igual**.

### D2 — Un error que diga qué hacer

En vez de un rango abstracto, el mensaje reconoce el caso real:

```
"712"   → El río nunca llegó a 712 m. Poné una altura de hasta 15 m. ¿Quisiste decir 7,12?
""      → Escribí la altura del río a la que querés que te avisemos. Ej: 7,12
"hola"  → "hola" no es un número. Escribí la altura en metros, ej: 7,12
```

Función pura, testeada con los casos reales.

### D3 — Riesgo latente: el interruptor callaba también las respuestas

**Esto NO era la causa del síntoma reportado** — el bot responde bien desde la app del teléfono,
y la pantalla en blanco era de `web.telegram.org`. Se arregla igual porque es un peligro real:

`TELEGRAM_PUBLICACION_ACTIVA=false` cortaba **todas** las salidas, incluidas las respuestas a un
comando directo. El día que alguien apague el interruptor, quien le escriba al bot va a quedar sin
respuesta y su umbral **sí** va a quedar guardado: el silencio de "guardado" es idéntico al de
"roto".

S4 existe para frenar lo que el bot manda **por iniciativa propia** — canal, avisos por umbral —, no
la otra mitad de una conversación que la persona empezó. Y con el acople, probar el bot obligaba a
encender las publicaciones: para verificar sin riesgo había que asumir el riesgo.

Las respuestas siguen respetando todo lo demás: sin token no se envía, el tope diario se aplica
igual, y un fallo de Telegram se loguea sin tumbar el worker (S3, S5).

## Fuera de alcance

- No se toca el rango aceptado (0,01 a 15 m) ni el contenido de los mensajes del bot.
- No se agregan variables de entorno.

## Criterios de aceptación

- [x] Verificado en un contexto de **celular real** (`hasTouch`, 390 px): escribiendo `7,12` el
      campo devuelve `"7,12"` y el link sale `?start=712`.
- [x] Con `712`: *"El río nunca llegó a 712 m. Poné una altura de hasta 15 m. ¿Quisiste decir
      7,12?"*
- [x] Con el interruptor en `false`, un comando directo recibe respuesta. **Verificado que el test
      falla al revertir.**
- [x] Con el interruptor en `false`, el canal y los avisos siguen sin publicar, con su test.
- [x] El tope diario se aplica igual a las respuestas (test con tope 1: la segunda no sale).
- [x] `ruff`, `pytest` (351 + 4 skipped), `pnpm build` y `pnpm test` (330) pasan.

## Cómo verificar

```bash
uv run ruff check . && uv run pytest -q
cd frontend && pnpm test && pnpm build
URL=http://localhost:<WEB_PORT>/ node scripts/verificar-umbral-telegram.mjs
```

El script corre en un contexto de celular (`hasTouch`, `isMobile`, 390 px), que es donde apareció
el bug. Salida real:

```
✓ el campo es type="text", no "number"
✓ inputmode="decimal": sigue dando teclado numérico
✓ la coma sobrevive en el campo (leído: "7,12")
✓ 7,12 -> ?start=712
    error mostrado: "El río nunca llegó a 712 m. Poné una altura de hasta 15 m. ¿Quisiste decir 7,12?"
✓ con 712 el error sugiere 7,12 en vez de repetir el rango
```

## Hallazgos

- **Diagnostiqué mal el síntoma inicial.** Cuando el usuario reportó que el bot no le mandaba nada,
  lo atribuí al interruptor S4 **sin verificar qué valor tenía esa variable en producción** — lo
  asumí porque yo mismo se la había recomendado. El bot respondía bien desde la app del teléfono; lo
  que fallaba era `web.telegram.org`, que deja la pantalla en blanco con los deep links
  `tg://resolve`. El desacople de S4 se hace igual, por lo que dice D3, pero **no era la causa**.
- **Mi propio assert en el doble de test encontró dos llamadas sin marcar.** Al exigir
  `es_respuesta is True` en el stub, saltaron dos `enviar_mensaje_seguro` que el reemplazo
  automático no había alcanzado — porque el argumento tenía paréntesis anidados
  (`mensaje_umbral_fijado(umbral_m)`) y el patrón cortaba antes. Eran **las dos confirmaciones de
  "listo, te vamos a avisar"**: justo el mensaje que más importa del flujo.
- **Correr un solo archivo de test no alcanza.** Los tests de `telegram_avisos` pasaban en
  aislamiento mientras siete de `telegram_comandos` estaban rotos por el parámetro nuevo en el
  doble. La suite completa es la que manda.

## Resumen final

El campo del umbral era `type="number"`, que en un celular descarta la coma en silencio y devuelve
cadena vacía cuando el valor no le gusta: se escribía `7,12`, no se veía nada raro, y la app decía
"inválido". Ahora es `type="text"` con `inputmode="decimal"` —mismo teclado numérico, texto crudo
intacto— y el error reconoce el caso real: con `712` sugiere `7,12`. De paso, el interruptor S4 deja
de callar las respuestas del bot: frenar las publicaciones no debería dejar mudo a quien escribió.
