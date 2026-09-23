# 017 — Que Traefik encuentre la app (red de Dokploy)

- **Estado:** lista
- **Rama:** fix/017-dokploy-network
- **Depende de:** 016 (mergeada)

## Objetivo

Que el subdominio sirva la app. Hoy devuelve el 404 de Traefik.

## El defecto

Con la 016 desplegada en un VPS real y el dominio configurado en Dokploy (servicio `web`, puerto 80,
DNS ya apuntado), `http://rio.miraisoftware.net` devuelve:

```
HTTP/1.1 404 Not Found
Content-Type: text/plain; charset=utf-8
Content-Length: 19

404 page not found
```

Ese es el backend por defecto de **Traefik**, no de nginx (nginx devuelve HTML). O sea: Traefik no
registró **ninguna ruta** para el host. Y HTTPS ni siquiera conecta, porque sin ruta tampoco se
emite el certificado.

**Causa:** Traefik descubre y alcanza los servicios por la red `dokploy-network`. El compose de la
016 no la declaraba, así que `web` quedaba sólo en la red interna del proyecto — invisible para el
proxy.

**Por qué no lo agarró la verificación de la 016:** sus 12 chequeos corren el stack en local y le
pegan directo al puerto publicado. Nunca hubo un Traefik en el medio. La verificación probaba que el
stack funciona, no que **se pueda enrutar** — que es justo lo que hacía falta para servir a alguien.
Es, otra vez, un defecto que sólo aparece en el entorno real.

## Alcance

- `web` se conecta a **dos** redes: `default` (la interna, sin la cual nginx no puede proxear `/api`
  a `api:8000`) y `dokploy-network` (por donde Traefik lo encuentra). Declarar sólo la segunda
  rompería el proxy interno, así que van las dos explícitas.
- `dokploy-network` va como `external: true`: en el VPS la crea Dokploy. Para que la verificación
  siga corriendo en local, el script la crea si no existe y **sólo la borra si la creó él** (en una
  máquina con Dokploy encima esa red no es nuestra).
- El puerto de `web` pasa a atarse a `127.0.0.1`. Con Traefik enrutando por la red, publicarlo en
  `0.0.0.0` sólo servía para exponer la app **sin cifrar** en la IP pública del VPS, al lado del
  HTTPS. Atado a loopback, la verificación local sigue andando y desde afuera no existe.

## Fuera de alcance

- No se toca el compose de desarrollo, ni el dominio, ni los umbrales, ni la curva.

## Criterios de aceptación

- [x] `web` está en `dokploy-network` **y** en la red interna del proyecto, verificado con
      `docker inspect` sobre el contenedor real.
- [x] Con **control positivo**: `/api/health` responde a través de nginx, o sea que la red interna
      sigue funcionando y el chequeo anterior no pasa por casualidad.
- [x] El puerto de `web` no queda publicado en `0.0.0.0`.
- [x] Los 12 chequeos de la 016 siguen verdes.

## Cómo verificar

```bash
bash scripts/verificar-deploy.sh    # 16 chequeos (12 de la 016 + 4 nuevos)
```

Salida real de los nuevos:

```
    redes de web: dokploy-network rioaltura-verif-deploy_default
✓ D7: web está en dokploy-network (sin esto Traefik no registra la ruta y da su propio 404)
✓ D7: web sigue en la red interna (sin esto nginx no puede proxear /api a api:8000)
✓ D7: control positivo -- /api responde a través de nginx, o sea la red interna funciona
✓ D7: el puerto de web queda atado a 127.0.0.1, no a la IP pública del VPS
```

En el VPS, después de redesplegar: `curl -s https://<subdominio>/api/health` debe dar
`{"status":"ok","db":"ok"}` en vez del 404 de Traefik.

## Hallazgos

- La verificación de la 016 era correcta pero **incompleta en una dimensión que no habíamos
  nombrado**: probaba el stack, no su enrutabilidad. Un `curl` al puerto publicado nunca iba a
  detectar que Traefik no puede ver el servicio. La lección no es "faltó un test", es que **el
  entorno de verificación tiene que parecerse al de producción en la dimensión que importa**.
- No se pudo reproducir el 404 en local (no hay Traefik acá), así que el arreglo se verifica por su
  causa —la pertenencia a la red, con `docker inspect`— y no por su síntoma. Queda pendiente
  confirmarlo contra el VPS real.

## Resumen final

El subdominio devolvía el 404 de Traefik porque `web` no estaba en `dokploy-network` y el proxy no
podía verlo. Ahora se conecta a esa red **y** a la interna (sin la segunda, nginx no puede proxear
`/api`), y el puerto publicado pasa a `127.0.0.1` para no dejar la app sin cifrar en la IP pública.
16 chequeos verdes, con control positivo de que la red interna sigue andando. El defecto se le
escapó a la 016 porque su verificación probaba que el stack funciona, no que se pueda enrutar.
