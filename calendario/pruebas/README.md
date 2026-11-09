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

## Suites

- `infra.test.ts`: los ganchos, el mock de Blobs y el simulador de token montado en otro servidor.
- `google/cuenta.test.ts`: `servidor/google/cuenta.ts` (lectura de `GOOGLE_CUENTA_SERVICIO`, JWT, caché y pedidos simultáneos, renovación, desfase de reloj, tabla de errores, plazos y que la aserción nunca salga hacia otro sitio).

## Reglas para suites nuevas

- Nombre `*.test.ts` o `*.test.mts`, con `import` (módulo ES; se puede usar `await` arriba).
- Nada de claves reales ni de red: `GOOGLE_TOKEN_URL`, `GOOGLE_API_URL` e `ICLOUD_CALDAV_URL` apuntan a simuladores en 127.0.0.1 (el código ignora las de Google si no son `http://127.0.0.1` o `localhost`).
- Imprimir `OK …` / `MAL …` y terminar con `process.exit(malas ? 1 : 0)`; cerrar los servidores al final.
