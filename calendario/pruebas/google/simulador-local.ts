// Simulador de Google Calendar para probar el panel a mano, sin cuenta de Google (no es una suite: correr.sh
// no lo corre). Levanta el simulador de pruebas/google/mock-google.mts en 127.0.0.1 (puerto al azar), con una
// clave de PRUEBA nueva (par RSA generado aquí, nunca una clave real) y un calendario «Familia» del Gmail
// dueno@gmail.com, compartido con la cuenta de servicio del panel.
//
// Desde calendario/, después de `npm run build`:
//
//   node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs \
//     pruebas/google/simulador-local.ts -- npx netlify-cli dev --offline --dir out --functions netlify/functions
//
// corre el comando con GOOGLE_API_URL, GOOGLE_TOKEN_URL y GOOGLE_CUENTA_SERVICIO apuntando al simulador (sin
// ICLOUD_* ni NODE_OPTIONS) y apaga el simulador cuando el comando termina. Sin comando, muestra las variables
// y espera Ctrl+C. En el panel: Familia → 📅 Calendario del iPhone (Google Calendar), ID c_familia@group.calendar.google.com.
//
//   SIM_ROL=writer       comparte «Familia» sin «administrar el uso compartido» (las invitaciones quedan manuales)
//   SIM_ZONA=UTC         otra zona horaria del calendario (Probar avisa)
//   SIM_VER=1            muestra cada pedido a la API y cada invitación que «manda» Google
import { spawn } from "node:child_process";
import { iniciarSimulador, type Rol } from "./mock-google.mts";
import { clavePrueba } from "./clave-prueba.ts";

const CAL = "c_familia@group.calendar.google.com";
const DUENO = "dueno@gmail.com";
const ROLES_PANEL: Rol[] = ["owner", "writer", "writerWithoutPrivateAccess", "reader", "freeBusyReader"];

const rol = (process.env.SIM_ROL ?? "owner") as Rol;
if (!ROLES_PANEL.includes(rol)) {
  console.error(`SIM_ROL tiene que ser uno de: ${ROLES_PANEL.join(", ")}`);
  process.exit(2);
}

const clave = clavePrueba();
const sim = await iniciarSimulador({ cuentas: new Map([[clave.correo, clave.publica]]) });
sim.crearCalendario(CAL, { zona: process.env.SIM_ZONA || "America/Santiago", resumen: "Familia", dueno: DUENO });
sim.compartir(CAL, clave.correo, rol);

const variables = {
  GOOGLE_API_URL: sim.apiUrl,
  GOOGLE_TOKEN_URL: sim.tokenUrl,
  GOOGLE_CUENTA_SERVICIO: clave.base64, // clave de prueba de este proceso: sólo sirve contra este simulador
};

console.log(`Simulador de Google Calendar en ${sim.url}`);
console.log(`  calendario «Familia»: ${CAL} (de ${DUENO}), compartido con ${clave.correo} como ${rol}`);

// Con SIM_VER: cada pedido nuevo del registro y cada invitación, una vez por segundo.
let vistos = 0;
let avisadas = 0;
function mostrar(): void {
  for (const p of sim.registro.slice(vistos)) console.log(`  [google] ${p.status} ${p.metodo} ${p.tipo} ${p.ruta}`);
  vistos = sim.registro.length;
  for (const n of sim.notificaciones.slice(avisadas)) console.log(`  [google] ${n.metodo}: ${n.correo} como ${n.rol}${n.enviada ? " (con correo)" : ""}`);
  avisadas = sim.notificaciones.length;
}
const ver = process.env.SIM_VER ? setInterval(mostrar, 1000) : null;

async function cerrar(codigo: number): Promise<never> {
  if (ver) {
    clearInterval(ver);
    mostrar();
  }
  await sim.cerrar();
  process.exit(codigo);
}

const separador = process.argv.indexOf("--");
const comando = separador >= 0 ? process.argv.slice(separador + 1) : [];

if (!comando.length) {
  console.log("Variables para el otro terminal (o pasa el comando después de --):");
  for (const [k, v] of Object.entries(variables)) console.log(`export ${k}='${v}'`);
  console.log("Ctrl+C para apagarlo.");
  process.on("SIGINT", () => void cerrar(0));
  process.on("SIGTERM", () => void cerrar(0));
} else {
  const env: Record<string, string | undefined> = { ...process.env, ...variables, NODE_OPTIONS: "" };
  delete env.ICLOUD_USUARIO;
  delete env.ICLOUD_CLAVE_APP;
  delete env.ICLOUD_CALDAV_URL;
  const hijo = spawn(comando[0], comando.slice(1), { env, stdio: "inherit" });
  const pasar = (s: NodeJS.Signals) => hijo.kill(s);
  process.on("SIGINT", pasar);
  process.on("SIGTERM", pasar);
  hijo.on("error", (e) => {
    console.error(`No se pudo correr «${comando.join(" ")}»: ${e.message}`);
    void cerrar(1);
  });
  hijo.on("exit", (c, s) => void cerrar(c ?? (s ? 1 : 0)));
}
