// Pruebas de servidor/google/ids.ts (plan de pruebas C1.1): id de Google reversible a partir del UID.
//
//   cd calendario && node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/google/ids.test.ts
import { NoSePuedeEscribir } from "../../servidor/ics";
import { GEN_MAX, PREFIJO_ID, esIdDePrueba, idDePrueba, idGoogleDe, uidDesdeId } from "../../servidor/google/ids";

const resultados: string[] = [];
const ok = (nombre: string, cond: unknown, detalle: unknown = "") => {
  const d = detalle === "" ? "" : ` · ${(typeof detalle === "string" ? detalle : JSON.stringify(detalle)).slice(0, 400)}`;
  resultados.push(`${cond ? "OK " : "MAL"} ${nombre}${d}`);
};
function caso(nombre: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    ok(`${nombre} (lanzó)`, false, `${(e as Error)?.name}: ${(e as Error)?.message}`);
  }
}
/** Generador al azar con semilla (mulberry32): la prueba da siempre lo mismo. */
function azar(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const B32 = "0123456789abcdefghijklmnopqrstuv";
const GOOGLE_ID = /^[0-9a-v]{5,1024}$/;

caso("ida y vuelta", () => {
  const uids = [
    "ev_natacion1@calendario-familiar",
    "k3m9xq2p7aa4tz8b@calendario-familiar",
    "ic_0123456789abcdef@calendario-familiar",
    "k3m9xq2p7aa4tz8b.x7y2kq@calendario-familiar", // el que inventa el motor si el UID ya existía
    "7n6f7a9g8a483r95t8en23rf@google.com", // serie de Google recreada desde la pared
    "a@calendario-familiar",
  ];
  for (const uid of uids) {
    for (const gen of [0, 1, 3, 9]) {
      const id = idGoogleDe(uid, gen);
      const r = uidDesdeId(id);
      ok(`ida y vuelta ${uid} gen ${gen}`, GOOGLE_ID.test(id) && id.startsWith(PREFIJO_ID) && r?.uid === uid && r.gen === gen, { id, r });
    }
  }
  ok("gen 0 es el UID sin nada más", idGoogleDe("x@calendario-familiar") === idGoogleDe("x@calendario-familiar", 0));
  ok("cada generación da otro id", new Set([0, 1, 2, 3, 9].map((g) => idGoogleDe("x@calendario-familiar", g))).size === 5);
  const largo = idGoogleDe("ev_natacion1@calendario-familiar");
  ok("un UID típico del panel da un id de unos 54 caracteres", largo.length === 54, largo.length);
});

caso("no se confunde con ids ajenos", () => {
  const r = azar(20261109);
  let falsos = 0;
  let ejemplo = "";
  for (let i = 0; i < 200_000; i++) {
    // Como los ids que pone Google Calendar web (26 caracteres de base32hex), con "cf" adelante, y de largos al azar.
    const n = i % 2 ? 24 : 3 + Math.floor(r() * 60);
    let id = "cf";
    for (let j = 0; j < n; j++) id += B32[Math.floor(r() * 32)];
    if (uidDesdeId(id)) {
      falsos++;
      ejemplo ||= id;
    }
  }
  ok("200.000 ids al azar con prefijo cf → 0 falsos positivos", falsos === 0, { falsos, ejemplo });
  ok("id de una división 'este y los siguientes' (_R…) → null", uidDesdeId(`${idGoogleDe("a@calendario-familiar")}_R20261105T120000`) === null);
  ok("id de una instancia (_2026…Z) → null", uidDesdeId(`${idGoogleDe("a@calendario-familiar")}_20261118T120000Z`) === null);
  ok("id sin el prefijo cf → null", uidDesdeId(idGoogleDe("a@calendario-familiar").replace(/^cf/, "ab")) === null);
  ok("id con mayúsculas → null", uidDesdeId(idGoogleDe("a@calendario-familiar").toUpperCase()) === null);
  ok("id vacío o sólo el prefijo → null", uidDesdeId("") === null && uidDesdeId("cf") === null);
});

caso("UID sin un sufijo conocido", () => {
  ok("UID de otro sistema (…@ejemplo.com) → null", uidDesdeId(idGoogleDe("abc@ejemplo.com")) === null);
  ok("UID sin @ → null", uidDesdeId(idGoogleDe("abc-calendario-familiar")) === null);
  ok("UID con espacio → null", uidDesdeId(idGoogleDe("a b@calendario-familiar")) === null);
  ok("UID con eñe → null (sólo ASCII)", uidDesdeId(idGoogleDe("ñandú@calendario-familiar")) === null);
  ok("UID que contiene el sufijo pero no termina en él → null", uidDesdeId(idGoogleDe("a@calendario-familiar.x")) === null);
});

caso("forma canónica y generaciones", () => {
  const base = idGoogleDe("ev1@calendario-familiar");
  ok("un caracter de más al final → null", uidDesdeId(base + "0") === null);
  // Cambiar el último caracter sin cambiar los bytes (sólo los bits de relleno) no es canónico.
  const ultimo = base[base.length - 1];
  const otro = B32[(B32.indexOf(ultimo) ^ 1) & 31];
  const r = uidDesdeId(base.slice(0, -1) + otro);
  ok("bits de relleno distintos → null o el mismo UID nunca (no canónico)", r === null, r);
  const conGen = (texto: string) => "cf" + idGoogleDe(texto).slice(2);
  ok("generación 0 escrita → null", uidDesdeId(conGen("ev1@calendario-familiar\n0")) === null);
  ok("generación 10 → null", uidDesdeId(conGen("ev1@calendario-familiar\n10")) === null);
  ok("generación con letra → null", uidDesdeId(conGen("ev1@calendario-familiar\nx")) === null);
  ok("dos saltos de línea → null", uidDesdeId(conGen("ev1@calendario-familiar\n1\n2")) === null);
  let lanzo = false;
  try {
    idGoogleDe("ev1@calendario-familiar", GEN_MAX + 1);
  } catch {
    lanzo = true;
  }
  ok("idGoogleDe con generación fuera de rango lanza", lanzo);
  // UTF-8 inválido: bytes 0xff.
  let id = "cf";
  for (let i = 0; i < 8; i++) id += "vv";
  ok("UTF-8 inválido → null", uidDesdeId(id) === null);
});

caso("largo máximo", () => {
  const uidLargo = `${"x".repeat(618)}@calendario-familiar`; // 638 bytes → 1021 caracteres + "cf"
  const id = idGoogleDe(uidLargo);
  ok("UID de 638 bytes cabe (1023 caracteres)", id.length === 1023 && uidDesdeId(id)?.uid === uidLargo, id.length);
  let error: unknown = null;
  try {
    idGoogleDe(`${"x".repeat(619)}@calendario-familiar`); // 639 bytes → 1025 caracteres
  } catch (e) {
    error = e;
  }
  ok("más de 1024 caracteres → NoSePuedeEscribir", error instanceof NoSePuedeEscribir, String(error));
  ok("un id de más de 1024 caracteres no se decodifica", uidDesdeId(id + "00") === null);
});

caso("eventos de prueba (Probar)", () => {
  const p = idDePrueba("q7k2m9x4h1c8v0b3n6r5");
  ok("id de prueba válido para Google (base32hex, sin w-z)", GOOGLE_ID.test(p), p);
  ok("id de prueba no es un UID del panel", uidDesdeId(p) === null);
  ok("esIdDePrueba lo reconoce", esIdDePrueba(p));
  ok("esIdDePrueba no confunde los del panel ni los ajenos", !esIdDePrueba(idGoogleDe("a@calendario-familiar")) && !esIdDePrueba("7n6f7a9g8a483r95t8en23rf") && !esIdDePrueba("pz0123"));
});

for (const r of resultados) console.log(r);
const malas = resultados.filter((r) => r.startsWith("MAL")).length;
console.log(`\n${resultados.length - malas} OK, ${malas} MAL`);
process.exit(malas ? 1 : 0);
