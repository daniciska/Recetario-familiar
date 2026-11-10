// Arnés para las pruebas de la API del calendario con Google (api.test.ts, compartir-api.test.ts):
// simulador de Google + clave de prueba + Blobs en memoria, y la función de Netlify llamada como la
// llama Netlify: `default(new Request(…), {params: {accion}})`.
//
//   const a = await prepararArnes();          // simulador listo, GOOGLE_* apuntando a él, clave puesta
//   const fam = await a.familia({eventos, miembros, calendarios?});
//   const r = await a.pedir(fam, "POST", "conectar", {...});   // → {status, datos}
//   a.calendario("c_x@group.calendar.google.com", "owner");     // calendario nuevo compartido con la cuenta de servicio
//   a.ok(nombre, condicion, detalle?) · a.seccion(t) · await a.caso(nombre, fn) · a.fin()
//
// Nada sale de 127.0.0.1: GOOGLE_API_URL y GOOGLE_TOKEN_URL son las del simulador.
import { createHash } from "node:crypto";
import { iniciarSimulador, type Rol, type Simulador } from "./mock-google.mts";
import { clavePrueba, usarClave, type ClavePrueba } from "./clave-prueba.ts";

export const DUENA = "mama@gmail.com";
export const PAPA = "papa@gmail.com";
export const miembros = [
  { id: "mama", nombre: "Carolina", emoji: "🌻", color: "#F7D488" },
  { id: "papa", nombre: "Rodrigo", emoji: "🚲", color: "#B5D8F0" },
  { id: "sofi", nombre: "Sofía", emoji: "🦄", color: "#F4B6C2" },
];
export const ev = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  titulo: "Evento " + id,
  miembros: ["sofi"],
  fecha: "2026-11-20",
  todoElDia: false,
  horaInicio: "10:00",
  horaFin: "11:00",
  repeticion: "nunca",
  ...extra,
});

export interface Arnes {
  sim: Simulador;
  clave: ClavePrueba;
  SA: string;
  C: typeof import("../../servidor/comun.ts");
  S: typeof import("../../servidor/sincronizar.ts");
  api: (req: Request, ctx: unknown) => Promise<Response>;
  programado: () => Promise<Response>;
  familia(op?: { eventos?: unknown[]; calendarios?: unknown[] }): Promise<string>;
  pedir(fam: string, metodo: "GET" | "POST", accion: string, cuerpo?: unknown): Promise<{ status: number; datos: any }>;
  calendario(calId: string, rol?: Rol, op?: { zona?: string; resumen?: string; dueno?: string }): string;
  eventos(fam: string): Promise<any[]>;
  acceso(fam: string): Promise<any>;
  ok(nombre: string, cond: unknown, detalle?: unknown): void;
  seccion(t: string): void;
  caso(nombre: string, fn: () => Promise<void>): Promise<void>;
  fin(): Promise<never>;
}

export async function prepararArnes(): Promise<Arnes> {
  const clave = clavePrueba();
  const sim = await iniciarSimulador({ cuentas: new Map([[clave.correo, clave.publica]]), semilla: 7 });
  process.env.GOOGLE_API_URL = sim.apiUrl;
  process.env.GOOGLE_TOKEN_URL = sim.tokenUrl;
  delete process.env.ICLOUD_USUARIO;
  delete process.env.ICLOUD_CLAVE_APP;
  delete process.env.ICLOUD_CALDAV_URL;
  usarClave(clave);
  const C = await import("../../servidor/comun.ts");
  const S = await import("../../servidor/sincronizar.ts");
  const api = (await import("../../netlify/functions/api-calendario.mts")).default as unknown as Arnes["api"];
  const programado = (await import("../../netlify/functions/calendario-programado.mts")).default as unknown as Arnes["programado"];
  const h = (s: string) => createHash("sha256").update(s).digest("hex");

  let buenas = 0;
  let malas = 0;
  const ok = (nombre: string, cond: unknown, detalle: unknown = "") => {
    if (cond) buenas++;
    else malas++;
    const d = detalle === "" ? "" : ` · ${(typeof detalle === "string" ? detalle : JSON.stringify(detalle)).slice(0, 900)}`;
    console.log(`${cond ? "OK " : "MAL"} ${nombre}${cond ? "" : d}`);
  };

  return {
    sim,
    clave,
    SA: clave.correo,
    C,
    S,
    api,
    programado,
    async familia(op = {}) {
      const fam = "f" + Math.random().toString(36).slice(2, 10);
      const st = C.almacen();
      await st.setJSON(`acceso/${fam}`, {
        familia: { id: fam, nombre: "Familia de prueba" },
        equipos: { pared: { nombre: "Pared", huella: h("s1"), creado: new Date().toISOString() } },
        versiones: {},
        ...(op.calendarios ? { calendarios: op.calendarios } : {}),
      });
      await st.setJSON(`datos/${fam}/eventos`, { datos: op.eventos ?? [], version: 1 });
      await st.setJSON(`datos/${fam}/miembros`, { datos: miembros, version: 1 });
      return fam;
    },
    async pedir(fam, metodo, accion, cuerpo) {
      const url = `http://localhost/api/calendario${accion ? `/${accion}` : ""}`;
      const req = new Request(url, {
        method: metodo,
        headers: { authorization: `Bearer ${fam}.pared.s1`, ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}) },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      });
      const r = await api(req, { params: accion ? { accion } : {} });
      const texto = await r.text();
      let datos: any = texto;
      try {
        datos = JSON.parse(texto);
      } catch {
        /* texto */
      }
      return { status: r.status, datos };
    },
    calendario(calId, rol = "owner", op = {}) {
      sim.crearCalendario(calId, { zona: op.zona ?? "America/Santiago", resumen: op.resumen ?? "Familia", dueno: op.dueno ?? DUENA });
      if (rol !== "none") sim.compartir(calId, clave.correo, rol);
      return calId;
    },
    async eventos(fam) {
      return ((await C.leerColeccion(fam, "eventos"))?.datos ?? []) as any[];
    },
    async acceso(fam) {
      return C.leerAcceso(fam);
    },
    ok,
    seccion: (t: string) => console.log(`\n# ${t}`),
    async caso(nombre, fn) {
      try {
        await fn();
      } catch (e) {
        ok(`${nombre} (lanzó)`, false, `${(e as Error)?.name}: ${(e as Error)?.message}\n${(e as Error)?.stack?.split("\n").slice(1, 5).join("\n")}`);
      }
    },
    async fin() {
      await sim.cerrar();
      console.log(`\n${buenas} OK, ${malas} MAL`);
      process.exit(malas ? 1 : 0);
    },
  };
}
