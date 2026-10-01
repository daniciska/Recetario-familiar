// Candado familiar: pide la contraseña antes de mostrar cualquier parte del recetario
// (páginas, recetas y audios). La contraseña está en la variable de entorno CLAVE_FAMILIA
// de Netlify, nunca en el código. Quien la escribe bien queda recordado por un año.
import type { Config, Context } from "@netlify/edge-functions";

const COOKIE = "recetario_llave";

export default async (req: Request, context: Context) => {
  const clave = Netlify.env.get("CLAVE_FAMILIA");
  if (!clave) {
    return new Response("Falta configurar la contraseña del recetario (CLAVE_FAMILIA).", { status: 503 });
  }
  const llave = await huella(clave);

  if (leerCookie(req, COOKIE) === llave) return context.next();

  const url = new URL(req.url);
  if (req.method === "POST" && url.pathname === "/entrar") {
    const datos = await req.formData();
    const volver = destinoSeguro(String(datos.get("volver") ?? "/"));
    if ((await huella(String(datos.get("clave") ?? ""))) === llave) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: volver,
          "Set-Cookie": `${COOKIE}=${llave}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }
    return pantalla(volver, true);
  }

  return pantalla(url.pathname + url.hash, false);
};

// Acepta la contraseña sin importar mayúsculas, espacios o tildes ("Recetasñaña" = "recetas nana").
function normalizar(texto: string) {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "").toLowerCase();
}

async function huella(texto: string) {
  const datos = new TextEncoder().encode("recetario-familiar:" + normalizar(texto));
  const hash = await crypto.subtle.digest("SHA-256", datos);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

function leerCookie(req: Request, nombre: string) {
  const cookies = req.headers.get("cookie") ?? "";
  const par = cookies.split(";").map((c) => c.trim()).find((c) => c.startsWith(nombre + "="));
  return par?.slice(nombre.length + 1);
}

// Solo se vuelve a direcciones dentro del recetario.
function destinoSeguro(ruta: string) {
  return ruta.startsWith("/") && !ruta.startsWith("//") ? ruta : "/";
}

function pantalla(volver: string, error: boolean) {
  const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#fbf7ee">
<title>Las recetas de la Ñaña</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Kalam:wght@400;700&display=swap" rel="stylesheet">
<style>
  :root { --papel: #fbf7ee; --tinta: #1f4d3a; --suave: #5d6b5f; --acento: #b5452f; --destacador: #ffdcbf; --cuadro: #ebe2cf; --linea: #ddd2bb; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; color: var(--tinta);
    font: 18px/1.5 "Atkinson Hyperlegible", system-ui, sans-serif; background-color: var(--papel);
    background-image: linear-gradient(var(--cuadro) 1px, transparent 1px), linear-gradient(90deg, var(--cuadro) 1px, transparent 1px);
    background-size: 24px 24px; }
  form { width: 100%; max-width: 380px; background: #fffdf8; border: 1px solid var(--linea); border-radius: 3px;
    padding: 28px 24px; box-shadow: 0 2px 0 var(--linea); position: relative; }
  form::before { content: ""; position: absolute; top: -9px; left: 24px; width: 72px; height: 18px; background: rgba(201, 222, 196, .85); transform: rotate(-4deg); }
  .rotulo { font-family: "Kalam", cursive; color: var(--acento); margin: 0; }
  h1 { font-family: "Kalam", cursive; font-size: 2rem; line-height: 1.2; margin: 4px 0 16px; }
  h1 span { background: linear-gradient(transparent 58%, var(--destacador) 58%); }
  label { display: block; color: var(--suave); font-size: .95rem; margin-bottom: 6px; }
  input { width: 100%; font: inherit; padding: 12px 14px; border: 1.5px solid var(--linea); border-radius: 4px; background: #fff; color: var(--tinta); }
  input:focus { outline: 2px solid var(--tinta); outline-offset: 1px; }
  button { margin-top: 14px; width: 100%; font: 700 1.05rem "Kalam", cursive; padding: 10px; border: 0; border-radius: 4px; background: var(--tinta); color: var(--papel); cursor: pointer; }
  .error { color: var(--acento); font-size: .95rem; margin: 10px 0 0; }
</style>
</head>
<body>
<form method="post" action="/entrar">
  <p class="rotulo">Cuaderno de cocina</p>
  <h1><span>Las recetas de la Ñaña</span></h1>
  <label for="clave">Contraseña de la familia</label>
  <input id="clave" name="clave" type="password" autocomplete="current-password" autofocus required>
  <input type="hidden" name="volver" value="${esc(volver)}">
  <button type="submit">Entrar</button>
  ${error ? '<p class="error" role="alert">Esa no es la contraseña. Inténtalo de nuevo.</p>' : ""}
</form>
<script>
  // El "#/receta/..." no llega al servidor: se agrega aquí para volver a la misma receta.
  const v = document.querySelector('input[name="volver"]');
  if (location.hash && !v.value.includes("#")) v.value += location.hash;
</script>
</body>
</html>`;
  return new Response(html, {
    status: error ? 401 : 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}

export const config: Config = {
  path: "/*",
};
