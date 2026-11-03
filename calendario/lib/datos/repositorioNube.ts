// Datos compartidos por toda la familia (Netlify Functions + Blobs a través de /api/*).
//
// - Cada colección tiene una versión. Un guardado sólo se acepta si parte de la última versión;
//   si otro equipo la cambió antes, el servidor devuelve lo último (ConflictoVersion) y el store
//   vuelve a aplicar el cambio encima, así no se pisan.
// - Cada ~20 s (y al volver a la app) se pregunta qué versiones cambiaron (sólo lee Blobs, la base
//   puede dormir) y se traen sólo esas colecciones.
// - Una copia queda en el equipo (localStorage) para abrir sin internet.

import type { CalendarioConectado, Repositorio } from "./repositorio";
import { ConflictoVersion } from "./repositorio";
import { RepositorioLocal } from "./repositorioLocal";
import { CLAVES } from "./claves";
import type { ClaveColeccion, EstadoApp } from "./tipos";
import { AccesoRevocado, SinConexion, api, borrarSesion, dejarAviso, guardarSesion, subirFoto, type SesionNube } from "./nube";

type Versiones = Partial<Record<ClaveColeccion, number>>;
type Colecciones = Record<string, { datos: unknown; version: number }>;

const CADA = 20_000;
const COMPLETO_CADA = 30 * 60_000;

export class RepositorioNube implements Repositorio {
  private copia = new RepositorioLocal();
  private estado: Record<string, unknown> = {};
  private versiones: Versiones;
  private enVuelo = 0;
  private oyentesConexion = new Set<(conectado: boolean) => void>();
  private conectado = true;
  private calendarios: CalendarioConectado[] = [];
  private oyentesCalendarios = new Set<(c: CalendarioConectado[]) => void>();
  /** Revisa cambios ya (lo deja listo `suscribir`): después de sincronizar con iCloud. */
  private revisarAhora?: () => void;
  private sincronizarPendiente?: ReturnType<typeof setTimeout>;

  constructor(private sesion: SesionNube) {
    this.versiones = { ...(sesion.versiones ?? {}) };
  }

  get familia() {
    return this.sesion.familia;
  }

  alCambiarConexion(f: (conectado: boolean) => void) {
    this.oyentesConexion.add(f);
    f(this.conectado);
    return () => this.oyentesConexion.delete(f);
  }

  revisar() {
    this.revisarAhora?.();
  }

  alCambiarCalendarios(f: (c: CalendarioConectado[]) => void) {
    this.oyentesCalendarios.add(f);
    f(this.calendarios);
    return () => this.oyentesCalendarios.delete(f);
  }

  private anotarCalendarios(c: unknown) {
    if (!Array.isArray(c)) return;
    const lista = c.filter((x): x is CalendarioConectado => !!x && typeof x.id === "string" && typeof x.nombre === "string");
    if (JSON.stringify(lista) === JSON.stringify(this.calendarios)) return;
    this.calendarios = lista;
    this.oyentesCalendarios.forEach((f) => f(lista));
  }

  /**
   * Después de cambiar eventos, se pide al servidor que los pase a iCloud (agrupando los cambios
   * seguidos). Si falla no importa: la sincronización programada lo hace a los pocos minutos.
   */
  private pedirSincronizacion() {
    if (!this.calendarios.length) return;
    clearTimeout(this.sincronizarPendiente);
    this.sincronizarPendiente = setTimeout(async () => {
      try {
        const { status } = await api("/api/calendario/sincronizar", { metodo: "POST", cuerpo: {}, token: this.sesion.token, espera: 15_000 });
        if (status === 200) this.revisarAhora?.();
      } catch {
        /* lo hará la sincronización programada */
      }
    }, 1500);
  }

  private marcarConexion(c: boolean) {
    if (c === this.conectado) return;
    this.conectado = c;
    this.oyentesConexion.forEach((f) => f(c));
  }

  /** Este equipo perdió el acceso: se desconecta y vuelve a abrir con la copia local. */
  private revocado(e: AccesoRevocado) {
    if (this.desconectando) return;
    this.desconectando = true;
    borrarSesion();
    dejarAviso(`${e.message}. Se desconectó de la nube: lo que ves es la copia que quedó en este equipo.`);
    location.reload();
  }
  private desconectando = false;

  private recordarVersiones() {
    this.sesion = { ...this.sesion, versiones: this.versiones };
    try {
      guardarSesion(this.sesion);
    } catch {
      /* sin almacenamiento: sólo se pierde la caché */
    }
  }

  private async guardarCopia<K extends ClaveColeccion>(clave: K, valor: EstadoApp[K]) {
    await this.copia.guardar(clave, valor).catch(() => {});
  }

  private aplicar(colecciones: Colecciones) {
    for (const [c, { datos, version }] of Object.entries(colecciones)) {
      this.estado[c] = datos;
      this.versiones[c as ClaveColeccion] = version;
      void this.guardarCopia(c as ClaveColeccion, datos as never);
    }
    this.recordarVersiones();
  }

  /** Primera vez en la nube: sube lo que ya había en este equipo (las fotos van aparte). */
  private async subirLocal() {
    const local = await this.copia.cargar();
    if (local) {
      const recetas = Array.isArray(local.recetas) ? local.recetas : [];
      for (const r of recetas) {
        if (r && typeof r.foto === "string" && r.foto.startsWith("data:")) {
          try {
            r.foto = await subirFoto(r.foto, this.sesion.token);
          } catch {
            r.foto = undefined; // una foto que no sube no impide subir lo demás
          }
        }
      }
      await this.reemplazarTodo(local);
    }
    this.sesion = { ...this.sesion, pendienteSubir: false };
    this.recordarVersiones();
  }

  async cargar(): Promise<EstadoApp | null> {
    try {
      if (this.sesion.pendienteSubir) await this.subirLocal();
      const { status, datos } = await api<{ colecciones: Colecciones; calendarios?: unknown }>("/api/datos", { token: this.sesion.token });
      if (status !== 200) throw new SinConexion();
      this.estado = {};
      this.aplicar(datos.colecciones);
      this.anotarCalendarios(datos.calendarios ?? []);
      this.marcarConexion(true);
      return Object.keys(this.estado).length ? ({ version: 1, ...this.estado } as unknown as EstadoApp) : null;
    } catch (e) {
      if (e instanceof AccesoRevocado) {
        this.revocado(e);
        return new Promise<never>(() => {}); // la página se está recargando
      }
      if (!(e instanceof SinConexion)) throw e;
      // Sin internet: se abre con la copia de este equipo.
      this.marcarConexion(false);
      const local = await this.copia.cargar();
      if (local) this.estado = { ...local };
      return local;
    }
  }

  async guardar<K extends ClaveColeccion>(clave: K, valor: EstadoApp[K]) {
    this.enVuelo++;
    try {
      const { status, datos } = await api<{ version?: number; datos?: unknown; error?: string }>(`/api/datos/${clave}`, {
        metodo: "PUT",
        cuerpo: { datos: valor, versionBase: this.versiones[clave] ?? 0 },
        token: this.sesion.token,
      });
      this.marcarConexion(true);
      if (status === 409) {
        this.aplicar({ [clave]: { datos: datos.datos, version: datos.version ?? 0 } });
        throw new ConflictoVersion(clave, datos.datos);
      }
      if (status !== 200) throw new Error(datos.error ?? "No se pudo guardar");
      this.estado[clave] = valor;
      this.versiones[clave] = datos.version!;
      this.recordarVersiones();
      await this.guardarCopia(clave, valor);
      if (clave === "eventos") this.pedirSincronizacion();
    } catch (e) {
      if (e instanceof AccesoRevocado) {
        this.revocado(e);
        return new Promise<never>(() => {}); // la página se está recargando
      }
      if (e instanceof SinConexion) this.marcarConexion(false);
      throw e;
    } finally {
      this.enVuelo--;
    }
  }

  async reemplazarTodo(estado: EstadoApp) {
    this.enVuelo++;
    try {
      const { status, datos } = await api<{ versiones?: Versiones; error?: string }>("/api/datos", {
        metodo: "PUT",
        cuerpo: { estado },
        token: this.sesion.token,
        espera: 60_000,
      });
      if (status !== 200) throw new Error(datos.error ?? "No se pudo guardar");
      for (const c of CLAVES) this.estado[c] = estado[c];
      this.versiones = { ...this.versiones, ...datos.versiones };
      this.recordarVersiones();
      await this.copia.reemplazarTodo(estado).catch(() => {});
      this.marcarConexion(true);
      this.pedirSincronizacion();
    } catch (e) {
      if (e instanceof AccesoRevocado) {
        this.revocado(e);
        return new Promise<never>(() => {}); // la página se está recargando
      }
      if (e instanceof SinConexion) this.marcarConexion(false);
      throw e;
    } finally {
      this.enVuelo--;
    }
  }

  suscribir(alCambiar: (estado: EstadoApp) => void) {
    let ultimoCompleto = Date.now();
    let revisando = false;

    const revisar = async () => {
      if (revisando || this.enVuelo > 0 || document.hidden) return;
      revisando = true;
      try {
        let claves: ClaveColeccion[];
        if (Date.now() - ultimoCompleto > COMPLETO_CADA) {
          claves = [...CLAVES]; // de vez en cuando se trae todo, por si algún aviso de versión se perdió
          ultimoCompleto = Date.now();
        } else {
          const { datos } = await api<{ versiones: Versiones; calendarios?: unknown }>("/api/cambios", { token: this.sesion.token, espera: 10_000 });
          this.anotarCalendarios(datos.calendarios ?? []);
          claves = CLAVES.filter((c) => (datos.versiones[c] ?? 0) > (this.versiones[c] ?? 0));
        }
        this.marcarConexion(true);
        if (!claves.length) return;
        const { status, datos } = await api<{ colecciones: Colecciones }>(`/api/datos?claves=${claves.join(",")}`, {
          token: this.sesion.token,
        });
        if (status !== 200) return;
        // Si mientras tanto este equipo guardó algo, lo trae la próxima vuelta (no se pisa lo recién hecho).
        if (this.enVuelo > 0) return;
        const nuevas = Object.entries(datos.colecciones).filter(([c, v]) => v.version !== this.versiones[c as ClaveColeccion]);
        if (!nuevas.length) return;
        this.aplicar(Object.fromEntries(nuevas));
        alCambiar({ version: 1, ...this.estado } as unknown as EstadoApp);
      } catch (e) {
        if (e instanceof AccesoRevocado) this.revocado(e);
        if (e instanceof SinConexion) this.marcarConexion(false);
      } finally {
        revisando = false;
      }
    };

    this.revisarAhora = () => void revisar();
    const t = setInterval(revisar, CADA);
    const alVolver = () => {
      if (document.visibilityState === "visible") void revisar();
    };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("online", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      this.revisarAhora = undefined;
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("online", alVolver);
      window.removeEventListener("focus", alVolver);
    };
  }
}
