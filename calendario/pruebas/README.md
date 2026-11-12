# Pruebas del servidor

Pruebas de lo que corre en Netlify Functions (`servidor/`, `netlify/functions/`), con Node 22 y sin compilar: Node quita los tipos al vuelo. Esta carpeta está excluida de `tsconfig.json`, así que no afecta `tsc` ni `npm run build`. No usa la red: los simuladores escuchan en 127.0.0.1.

## Correr

Siempre desde `calendario/`:

```sh
bash pruebas/correr.sh              # todas las suites (*.test.ts y *.test.mts)
bash pruebas/correr.sh google       # sólo las que tienen "google" en la ruta
VER=1 bash pruebas/correr.sh        # con la salida completa de cada una
```

Una sola suite:

```sh
node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/google/cuenta.test.ts
```

Cada suite imprime una línea `OK …` o `MAL …` por comprobación y termina con código 1 si hubo algún `MAL`. `correr.sh` resume por suite y también falla si una suite no imprimió ningún resultado o se cayó.

## Piezas

- `registrar.mjs` y `hooks.mjs`: ganchos de módulos. `@netlify/blobs` va a `blobs-mock.mjs`, `@/…` a la raíz de `calendario/`, y los imports sin extensión prueban `.ts`, `.tsx`, `.mts` y `/index.ts`. Las rutas salen de `import.meta.url` (no hay rutas de una máquina en particular).
- `blobs-mock.mjs`: Netlify Blobs en memoria, con ETag (`onlyIfNew`, `onlyIfMatch`), `get` / `getWithMetadata` / `getMetadata` / `set` / `setJSON` / `delete` / `list`. Ganchos: `globalThis.__blobsHook = async (operacion, clave, valor, almacen) => …` se espera antes de cada operación (para demorar, contar o lanzar), y `globalThis.__blobsSinEtag = true` imita al simulador local de Netlify, que no entrega ETag. `reiniciarBlobs()` borra todo.
- `google/clave-prueba.ts`: arma el JSON de una cuenta de servicio **de prueba** (par RSA nuevo con `generateKeyPairSync`, nunca una clave real), en crudo y en base64, con un `token_uri` trampa que el código tiene que ignorar.
- `google/mock-token.mts`: simulador del endpoint de token de Google (verifica la firma RS256 con la clave pública registrada, `iss`, `aud`, `scope`, `iat`/`exp`; desfase de reloj, cuentas deshabilitadas o borradas, 503, demoras y fallas inyectables; cuenta los POST). Se monta dentro de otro servidor `node:http` con `mock.atender(req, res)`, y `mock.verificar("Bearer …")` dice si un token lo emitió él (la firma completa está al inicio del archivo).
- `google/mock-google.mts`: simulador fiel de la Calendar API v3 (eventos, instancias y ACL) más el `/token`, en un solo `node:http` en 127.0.0.1 y puerto al azar. Escrito contra la documentación de Google, no contra el transporte; lo que Google no documenta queda detrás de un interruptor con su valor por omisión. Trae fallas inyectables por pedido, actores que cambian el calendario como lo haría cada cliente («web», «iPhone», «invitación», «cumpleaños») y un registro de pedidos (la API completa está al inicio del archivo).
- `h.ts`: arnés de punta a punta del motor con Google: motor real (`servidor/sincronizar.ts`) + transporte real + simulador + Blobs en memoria (`arrancar`, `familia`, `conexionGoogle`, `sync`, `proyeccion`, `comparar`…).
- `google/arnes-api.ts`: arnés de las pruebas de la API (`api-calendario.mts` llamada como la llama Netlify, con el simulador y la clave de prueba).
- `google/simulador-local.ts`: no es una suite. Levanta el simulador con un calendario «Familia» para probar el panel a mano con `netlify dev` (ver README → Calendario de Google → Probar en local).

## Suites

- `infra.test.ts`: los ganchos, el mock de Blobs y el simulador de token montado en otro servidor.
- `equipo/aviso.test.ts`: la franja de equipo sin unir, sin navegador: `esFamiliaDeEjemplo` (`lib/ejemplo.ts`, con sus casos de familia propia) y que «Usar sólo en este equipo» se olvide al unirse o crear la familia (`lib/datos/nube.ts`, con un `localStorage` en memoria).
- `google/cuenta.test.ts`: `servidor/google/cuenta.ts` (lectura de `GOOGLE_CUENTA_SERVICIO`, JWT, caché y pedidos simultáneos, renovación, desfase de reloj, tabla de errores, plazos y que la aserción nunca salga hacia otro sitio).
- `google/mock.test.ts`: el simulador de Google contra lo documentado (cada regla importante tiene un caso).
- `google/ids.test.ts`: `servidor/google/ids.ts` (id reversible a partir del UID, generaciones, ids ajenos y de prueba).
- `google/serie.test.ts`: `servidor/google/serie.ts` (del listado a series y .ics, leído con `leerRecurso` como el motor; marca `cfh`).
- `google/escritura.test.ts`: `servidor/google/escritura.ts` (`planear` como función pura, cuerpos de hora, insert, días cambiados al recrear).
- `google/transporte.test.ts`: `servidor/google/transporte.ts` contra el simulador (contrato del motor, listado completo o error, tabla de errores por motivo, `If-Match`, 401, plazos, crear/actualizar/borrar), `servidor/proveedores.ts` y la revisión de repeticiones con BYSETPOS.
- `google/compartir.test.ts`: `servidor/google/compartir.ts` (ACL: permisos por rol, invitar, cambiar permiso, quitar, guardas, caso «manual»).
- `google/motor.test.ts`: punta a punta con `h.ts` (subir, traer, cambios de los dos lados, borrados, lápidas, avisos, sin hora de término, días cambiados…), unos 25 s.
- `google/fuzz.test.ts`: cambios al azar en la pared, la web y el iPhone; después de cada paso la pared y Google tienen que verse igual. Por omisión 6 semillas × 40 pasos (≈1 min); `FUZZ_SEMILLAS=3,7` (separadas por coma), `FUZZ_PASOS=80`, `FUZZ_CONFIG=n` (una combinación fija de interruptores, para repetir un MAL) y `FUZZ_VER=1` (muestra las escrituras y las piezas de Google que difieren).
- `google/api.test.ts`: `api-calendario.mts` con Google (GET, `/probar` con cada caso, `/conectar`, `/desconectar`) y la función programada.
- `google/compartir-api.test.ts`: `/personas`, `/invitar`, `/permiso`, `/quitar` y `/dueno`.

## Reglas para suites nuevas

- Nombre `*.test.ts` o `*.test.mts`, con `import` (módulo ES; se puede usar `await` arriba).
- Nada de claves reales ni de red: `GOOGLE_TOKEN_URL`, `GOOGLE_API_URL` e `ICLOUD_CALDAV_URL` apuntan a simuladores en 127.0.0.1 (el código ignora las de Google si no son `http://127.0.0.1` o `localhost`).
- Imprimir `OK …` / `MAL …` y terminar con `process.exit(malas ? 1 : 0)`; cerrar los servidores al final.
