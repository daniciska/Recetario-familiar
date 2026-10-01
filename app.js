// Recetario familiar: lee config.json y recetas/*.json y dibuja la página.
(() => {
  const app = document.getElementById("app");
  const estado = { config: {}, indice: [], categoria: "Todas", busqueda: "", cache: {} };

  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sinTildes = (t) => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const pedir = (url) => fetch(url, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(url);
    return r.json();
  });
  const minutos = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");

  async function cargarReceta(slug) {
    if (!estado.cache[slug]) estado.cache[slug] = await pedir(`recetas/${encodeURIComponent(slug)}/receta.json`);
    return estado.cache[slug];
  }

  // ---------- Portada ----------
  function portada() {
    const c = estado.config;
    const cats = ["Todas", ...new Set(estado.indice.map((r) => r.categoria).filter(Boolean))];
    document.title = c.titulo || "Recetario familiar";
    app.innerHTML = `
      <header class="portada">
        <div class="olla" aria-hidden="true">🍲</div>
        <h1>${esc(c.titulo)}</h1>
        <p class="dedicatoria">${esc(c.dedicatoria)}</p>
      </header>
      <div class="buscador">
        <input type="search" placeholder="Buscar una receta o un ingrediente…" aria-label="Buscar" value="${esc(estado.busqueda)}">
        ${cats.length > 2 ? `<div class="chips" role="group" aria-label="Categorías">${cats.map((k) =>
          `<button type="button" aria-pressed="${k === estado.categoria}">${esc(k)}</button>`).join("")}</div>` : ""}
      </div>
      <section class="lista" aria-label="Recetas"></section>`;
    const input = app.querySelector("input");
    input.addEventListener("input", () => { estado.busqueda = input.value; pintarLista(); });
    app.querySelectorAll(".chips button").forEach((b) => b.addEventListener("click", () => {
      estado.categoria = b.textContent;
      app.querySelectorAll(".chips button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      pintarLista();
    }));
    pintarLista();
  }

  async function pintarLista() {
    const lista = app.querySelector(".lista");
    if (!lista) return;
    const q = sinTildes(estado.busqueda.trim());
    let recetas = estado.indice.filter((r) => estado.categoria === "Todas" || r.categoria === estado.categoria);
    if (q) {
      // Busca también en ingredientes: carga las recetas completas (son pocas y livianas).
      const completas = await Promise.all(recetas.map((r) => cargarReceta(r.slug).catch(() => r)));
      recetas = recetas.filter((r, i) => sinTildes(JSON.stringify([r.titulo, r.subtitulo,
        (completas[i].ingredientes || []).map((x) => x.ingrediente)])).includes(q));
    }
    if (!recetas.length) {
      lista.innerHTML = `<p class="vacio">${estado.indice.length ? "No encontramos esa receta." : "Todavía no hay recetas. Sube el primer audio a la carpeta audios_nuevos."}</p>`;
      return;
    }
    lista.innerHTML = recetas.map((r) => `
      <a class="tarjeta" href="#/receta/${encodeURIComponent(r.slug)}">
        <h2>${esc(r.titulo)}</h2>
        ${r.subtitulo ? `<p>${esc(r.subtitulo)}</p>` : ""}
        <div class="etiquetas">
          ${r.categoria ? `<span>${esc(r.categoria)}</span>` : ""}
          ${r.tiempo && r.tiempo !== "—" ? `<span>⏱ ${esc(r.tiempo)}</span>` : ""}
          ${r.con_audio ? "<span>🎙️ con su voz</span>" : ""}
          ${r.estado === "pendiente" ? '<span class="etiqueta-estado">en preparación</span>' : ""}
        </div>
      </a>`).join("");
  }

  // ---------- Receta ----------
  async function receta(slug) {
    let r;
    try { r = await cargarReceta(slug); } catch {
      app.innerHTML = `<a class="volver" href="#/">← Todas las recetas</a><p class="vacio">No encontramos esta receta.</p>`;
      return;
    }
    const quien = estado.config.cocinera || "la mamá";
    document.title = `${r.titulo} · ${estado.config.titulo || "Recetario"}`;
    const lista = (xs) => (xs || []).filter(Boolean);
    const datos = [r.porciones && `🍽 ${r.porciones}`, r.tiempo && `⏱ ${r.tiempo}`, r.dificultad && `👩‍🍳 ${r.dificultad}`]
      .filter((d) => d && !d.endsWith("—"));
    const audios = lista(r.audios);
    const base = `recetas/${encodeURIComponent(r.slug)}/`;

    app.innerHTML = `
      <a class="volver" href="#/">← Todas las recetas</a>
      <header class="cabecera">
        ${r.categoria ? `<div class="categoria">${esc(r.categoria)}</div>` : ""}
        <h1>${esc(r.titulo)}</h1>
        ${r.subtitulo ? `<p class="subtitulo">${esc(r.subtitulo)}</p>` : ""}
      </header>
      ${datos.length ? `<div class="datos">${datos.map((d) => `<span>${esc(d)}</span>`).join("")}</div>` : ""}

      ${r.estado === "pendiente" ? `<p class="aviso">Esta receta todavía se está pasando en limpio. Mientras tanto, puedes escuchar el audio y leer lo que ${esc(quien)} contó.</p>` : ""}

      ${audios.length ? `<section class="caja escuchar">
        <h2>Escúchala contarla</h2>
        ${audios.map((a, i) => `
          ${audios.length > 1 ? `<div class="parte">Parte ${i + 1}${a.segundos ? ` · ${minutos(a.segundos)}` : ""}</div>` : ""}
          <audio controls preload="metadata" src="${base}${esc(a.archivo)}"></audio>
          ${a.original ? `<a class="descargar" href="${base}${esc(a.original)}" download>Descargar audio original</a>` : ""}`).join("")}
      </section>` : ""}

      ${r.historia ? `<p class="historia">${esc(r.historia)}</p>` : ""}

      ${lista(r.ingredientes).length ? `<section class="caja ingredientes">
        <h2>Ingredientes</h2>
        <ul>${r.ingredientes.map((x) => `<li><label><input type="checkbox"><span>
          <span class="cant">${esc(x.cantidad)}</span> ${esc(x.ingrediente)}
          ${x.como_lo_dice_mama ? `<span class="dice">“${esc(x.como_lo_dice_mama)}”</span>` : ""}
        </span></label></li>`).join("")}</ul>
      </section>` : ""}

      ${lista(r.pasos).length ? `<section class="caja pasos">
        <h2>Preparación</h2>
        <p class="ayuda">Toca un paso para marcarlo como hecho.</p>
        <ol>${r.pasos.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>
      </section>` : ""}

      ${lista(r.secretos).length ? `<section class="caja secretos">
        <h2>Los secretos de ${esc(quien)}</h2>
        <ul>${r.secretos.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      </section>` : ""}

      ${lista(r.frases).length ? `<section class="frases">
        ${r.frases.map((f) => `<blockquote>${esc(f.replace(/^["“]|["”]$/g, ""))}</blockquote>`).join("")}
        <p class="quien">— ${esc(quien)}</p>
      </section>` : ""}

      ${lista(r.dudas).length ? `<section class="caja dudas">
        <h2>Para preguntarle</h2>
        <p>Cosas que no quedaron claras en el audio. Buena excusa para llamarla.</p>
        <ul>${r.dudas.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
      </section>` : ""}

      ${r.transcripcion ? `<details class="transcripcion" ${r.estado === "pendiente" ? "open" : ""}>
        <summary>Lo que dijo, palabra por palabra</summary>
        <div>${esc(r.transcripcion)}</div>
      </details>` : ""}

      <div class="acciones">
        <button type="button" data-accion="compartir">Compartir</button>
        <button type="button" data-accion="imprimir">Imprimir</button>
      </div>`;

    app.querySelectorAll(".pasos li").forEach((li) => li.addEventListener("click", () => li.classList.toggle("hecho")));
    app.querySelector('[data-accion="imprimir"]').addEventListener("click", () => window.print());
    app.querySelector('[data-accion="compartir"]').addEventListener("click", async (e) => {
      const datos = { title: r.titulo, url: location.href };
      if (navigator.share) { try { await navigator.share(datos); } catch { /* cancelado */ } return; }
      try { await navigator.clipboard.writeText(location.href); e.target.textContent = "¡Enlace copiado!"; } catch { /* sin permiso */ }
    });
    // Mantener la pantalla encendida mientras se cocina, si el teléfono lo permite.
    try { await navigator.wakeLock?.request("screen"); } catch { /* no soportado */ }
    window.scrollTo(0, 0);
  }

  // ---------- Navegación ----------
  function ruta() {
    const m = location.hash.match(/^#\/receta\/(.+)$/);
    if (m) receta(decodeURIComponent(m[1]));
    else portada();
  }

  // ---------- Colores del cuaderno (cada persona elige los suyos; se guardan en su teléfono) ----------
  const PALETA_PREDETERMINADA = "verde";
  function ponerPaleta(nombre) {
    if (nombre === PALETA_PREDETERMINADA) delete document.documentElement.dataset.paleta;
    else document.documentElement.dataset.paleta = nombre;
    document.querySelectorAll(".paletas button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.paleta === nombre));
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--papel").trim());
  }
  ponerPaleta(document.documentElement.dataset.paleta || PALETA_PREDETERMINADA);
  document.querySelectorAll(".paletas button").forEach((b) => b.addEventListener("click", () => {
    ponerPaleta(b.dataset.paleta);
    try { localStorage.setItem("paleta", b.dataset.paleta); } catch { /* sin almacenamiento */ }
  }));

  Promise.all([pedir("config.json").catch(() => ({})), pedir("recetas/indice.json").catch(() => [])])
    .then(([config, indice]) => {
      estado.config = config;
      estado.indice = indice;
      document.getElementById("firma").textContent = config.firma || "";
      window.addEventListener("hashchange", ruta);
      ruta();
    });
})();
