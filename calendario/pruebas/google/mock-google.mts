// Simulador fiel de la Google Calendar API v3 (más el endpoint de token) para las pruebas.
//
// Escrito contra la DOCUMENTACIÓN de Google (copias en el scratchpad: auth/ev_list.txt, ev_insert.txt,
// errors.txt, acl.txt, pages/performance.txt (fields y PATCH), pages/version_resources.txt (If-Match),
// pages/recurringevents.txt, pages/concepts_sharing.txt y pages/discovery.json rev. 20261102), NO contra
// el transporte servidor/google/transporte.ts. Lo que Google no documenta queda detrás de un
// interruptor (ver INTERRUPTORES_POR_OMISION) con un valor por omisión explícito.
//
// Un solo node:http en 127.0.0.1, puerto al azar:
//   POST {url}token                  → el simulador de token (pruebas/google/mock-token.mts, montado aquí)
//   {url}calendar/v3/…               → la API (GOOGLE_API_URL = sim.apiUrl, GOOGLE_TOKEN_URL = sim.tokenUrl)
//
// ─── Uso ───────────────────────────────────────────────────────────────────────────────────────────
//   const sim = await iniciarSimulador({ cuentas: new Map([[correoSA, clavePublica]]) });
//   process.env.GOOGLE_API_URL = sim.apiUrl; process.env.GOOGLE_TOKEN_URL = sim.tokenUrl;
//   sim.crearCalendario("c_fam@group.calendar.google.com", { zona: "America/Santiago", resumen: "Familia", dueno: "mama@gmail.com" });
//   sim.compartir("c_fam@group.calendar.google.com", correoSA, "owner");
//   … pedidos HTTP (con el token de /token, o sim.tokenPara(correo)) …
//   await sim.cerrar();
//
// ─── API de iniciarSimulador(opciones?: OpcionesSimulador) → Promise<Simulador> ───────────────────
//   OpcionesSimulador:
//     cuentas       Map client_email → clave pública (KeyObject o PEM) que acepta /token
//     token         otras OpcionesToken del mock de token (desfaseSeg, falla5xx, demoraMs, deshabilitadas…)
//     interruptores Partial<Interruptores> (lo no documentado; ver abajo)
//     paginacion    Partial<Paginacion>
//     semilla       número para el azar (páginas, fantasmas). Por omisión 1: todo es repetible.
//     reloj         ms fijo inicial para created/updated (por omisión, la hora real)
//     gzip          comprimir respuestas si el cliente acepta gzip (true, como Google)
//
//   Simulador:
//     url, apiUrl, tokenUrl               "http://127.0.0.1:P/", "…/calendar/v3/", "…/token"
//     token                               el MockToken (pedidos, historial, revocar(), vencer(), opciones…)
//     agregarCuenta(correo, clave)        registra otra cuenta de servicio en /token
//     tokenPara(correo, alcances?)        un Bearer válido sin pasar por /token (alcance por omisión: calendar)
//     revocarTokens()                     todos los Bearer dejan de valer (→ 401 authError)
//     crearCalendario(calId, {zona?, resumen?, dueno?, descripcion?})
//                                         zona "America/Santiago", resumen "Familia", dueno "dueno@gmail.com"
//                                         (el dueño de los datos queda en la ACL como owner)
//     compartir(calId, correo, rol)       regla user:correo con ese rol (Rol)
//     quitar(calId, correo)               borra la regla (sus pedidos siguientes → 404 notFound)
//     rolDe(calId, correo)                el accessRole efectivo
//     eventos(calId, {lapidas?})          vista cruda (copias) de lo guardado: principales, sueltos y excepciones;
//                                         lapidas:false omite lo cancelado. Los dateTime con el desfase de su zona.
//     evento(calId, id)                   copia cruda de un guardado (null si no existe)
//     poner(calId, recurso)               guarda un recurso tal cual (sin validar), para estados raros
//     instancias(calId, id, desdeMs?, hastaMs?)  instancias de una serie (virtuales + excepciones vivas)
//     acl(calId)                          las reglas (copias), con las borradas (role "none")
//     notificaciones                      [{metodo, calId, regla, correo, rol, enviada}] de acl insert/patch/update
//     actor(nombre, calId?)               "web" | "iPhone" | "invitación" | "cumpleaños" → Actor (ver abajo)
//     inyectar(predicado, respuesta, veces=1) → {quitar(), disparos}   fallas por pedido (ver abajo)
//     limpiarInyecciones()
//     latenciaMs                          demora de cada pedido a la API (respeta que el cliente se vaya)
//     interruptores                       objeto mutable (Interruptores)
//     paginacion                          objeto mutable (Paginacion)
//     vencerPaginas()                     todos los pageToken emitidos → 400
//     invalidarSync(calId)                los syncToken emitidos → 410 fullSyncRequired
//     contadores                          {api, token, porTipo{"events.list":n,…}, escrituras, escriturasAcl, inyectadas, status{}}
//     registro                            [{n, metodo, tipo, ruta, query, status, inyectada}] de cada pedido a la API
//     reiniciarContadores()
//     reloj                               {ahora(), fijar(ms), avanzar(ms), real()}: created/updated de lo que se escribe
//     azar()                              el generador con semilla (0 ≤ x < 1)
//     cerrar()                            Promise<void>
//
//   inyectar(predicado, respuesta, veces):
//     predicado(p: PedidoVisto) → boolean, con p = {n, metodo, tipo, ruta, calId, eventoId, reglaId, query,
//       cuerpo, cabeceras, correo}. tipo: "events.list" | "events.get" | "events.insert" | "events.patch" |
//       "events.update" | "events.delete" | "events.instances" | "acl.list" | "acl.get" | "acl.insert" |
//       "acl.patch" | "acl.update" | "acl.delete" | "calendars.get" | "?". (El /token tiene su propio
//       gancho: sim.token.opciones.falla / falla5xx / demoraMs.)
//     respuesta (usar los ayudantes `respuestas.*`):
//       {status, cuerpo?, cabeceras?}         se responde eso, sin aplicar nada
//       {demora: ms, luego?}                  espera (si el cliente se va, no se aplica) y sigue normal o responde `luego`
//       {aplicarYLuego: {status,…} | "cortar"} se aplica el pedido y después se responde el error o se corta
//       {cortar: true}                        se corta la conexión sin aplicar nada
//     respuestas.error(tipo) arma el cuerpo real de Google para: "authError", "required",
//       "insufficientPermissions", "rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded",
//       "dailyLimitExceeded", "accessNotConfigured", "SERVICE_DISABLED" (motivo genérico + details),
//       "requiredAccessLevel", "forbiddenForNonOrganizer", "forbiddenForServiceAccounts", "desconocido",
//       "rateLimit429", "backendError", "unavailable", "notFound", "deleted", "duplicate",
//       "conditionNotMet", "fullSyncRequired", "timeRangeEmpty".
//
//   Actor (cambia el simulador como lo haría ese cliente; no pasa por HTTP ni cuenta en `contadores.api`):
//     crear(datos) · editar(id, cambios) (mezcla tipo PATCH; null borra) · borrar(id)
//     borrarDia(idSerie, dia) · moverDia(idSerie, dia, start, end) · editarDia(idSerie, dia, cambios)
//     esteYLosSiguientes(idSerie, dia, cambios?) · restaurar(id) · editarTitulo(id, titulo) · obtener(id)
//     `dia`: "YYYY-MM-DD" (la ocurrencia de ese día, en la zona de la serie) o el inicio original RFC 3339.
//     "web":        borrarDia → excepción cancelada (sin EXDATE); description en HTML ("\n" → "<br>", entidades);
//                   esteYLosSiguientes → serie nueva `<id>_R<inicio UTC>` con iCalUID nuevo y la original con UNTIL
//                   (y marcada como dividida); restaurar → la lápida (y sus excepciones) vuelve a estar viva.
//     "iPhone":     (CalDAV de Google) crear con iCalUID tipo UUID; borrarDia → EXDATE;TZID=<zona>:… (junta los
//                   valores en una sola línea con comas); editar/editarTitulo/borrarDia/moverDia pierden las
//                   extendedProperties si interruptores.extendedPropsSeConservan = false.
//     "invitación": crear(datos, organizador?) → organizer {email: otra persona, self: false} + attendees.
//     "cumpleaños": crear({summary, fecha}) → eventType "birthday", día completo, RRULE:FREQ=YEARLY.
//
//   Interruptores (lo no documentado; valor por omisión entre paréntesis; detalle en la interfaz):
//     lapidaOcupaId (true) · finIgualInicio ("ok" | "400") · endTimeUnspecifiedAceptado (true) ·
//     exdateAExcepcionCancelada (false) · propagarTituloAExcepciones (false) ·
//     cambioReglaExcepciones ("conservar" | "borrar") · untilIgnoradoTrasDivision (false) · normalizar (false) ·
//     fantasmasAlLeer (false) + probFantasma (0.3) · instanciaIfMatch ("acepta" | "412" | "ignora") ·
//     extendedPropsSeConservan (true) · reglasRechazadas ([]) · aclLecturaSoloOwner (false) ·
//     aclInsertExistente ("409" | "actualiza") · motivoAclSinOwner ("forbidden" | "requiredAccessLevel") ·
//     inicioCuentaSiempre (false).
//
//   Otras exportaciones: INTERRUPTORES_POR_OMISION, ERRORES, respuestas, es (predicados), ROLES, ESQUEMA,
//     idInstancia(idPrincipal, originalStartTime), fusionar(base, cambios) (la mezcla de PATCH),
//     leerMascara(fields, "Events" | "Event" | "Acl" | "AclRule" | "Calendar"), formatear(ms, zona),
//     instanteEn(zona, y, m, d, h, mi, s), basicoUTC(ms), zonaValida(z).
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// Reglas documentadas que se imitan (resumen; los detalles están junto a cada función):
//   - Autenticación: sin Authorization → 401 required; Bearer desconocido/vencido → 401 authError. El alcance del
//     token tiene que cubrir el método según discovery.json (eventos: calendar | calendar.events (| *.readonly
//     al leer); ACL: calendar | calendar.acls (| calendar.acls.readonly al leer)) → si no, 403 insufficientPermissions.
//   - ACL: el accessRole sale de la regla user:<correo> (o domain:/default). Sin regla → 404 notFound en todo.
//     Solo owner escribe la ACL; writer la puede LEER (AclRule.role y concepts_sharing: "This role can also see
//     ACLs"). Ver interruptor aclLecturaSoloOwner.
//   - events.list: singleEvents=false trae sueltos, principales y todas las excepciones (también las
//     canceladas); sin showDeleted nunca trae principales ni sueltos borrados, ni excepciones de un principal
//     borrado. freeBusyReader → como singleEvents=true y sin detalles. reader y writerWithoutPrivateAccess →
//     los privados sin detalles. syncToken + (timeMin|timeMax|q|iCalUID|orderBy|updatedMin|*ExtendedProperty)
//     → 400. maxResults ≥ 1 (por omisión 250) y nunca más de 2500 por página; páginas cortas o vacías con
//     nextPageToken; nextSyncToken solo en la última. Respuesta con kind, etag, summary, updated, timeZone (la
//     del calendario), accessRole, defaultReminders. Los dateTime salen con el desfase del parámetro timeZone
//     (por omisión la zona del calendario).
//   - fields: sintaxis de performance.txt (",", "/", "( )", "*"). Un nombre que no está en el recurso
//     documentado → 400 invalidParameter "Invalid field selection <nombre>". La respuesta se proyecta.
//   - insert: id /^[a-v0-9]{5,1024}$/ o 400; id ocupado → 409 duplicate; iCalUID = id@google.com, organizer =
//     {email: calId, self: true}, creator = quien escribe; created/updated del reloj; etag nuevo entre comillas.
//     Rechazos: attendees de una cuenta de servicio → 403 forbiddenForServiceAccounts; serie con dateTime sin
//     timeZone → 400 "Missing time zone definition for start time."; date mezclado con dateTime → 400; end <
//     start → 400 timeRangeEmpty; recurrence que no se entiende (o en reglasRechazadas) → 400; sequence menor →
//     400 "Invalid sequence value…".
//   - get devuelve también lo cancelado. Ids de instancia `<id>_<YYYYMMDDTHHMMSS>Z` / `<id>_<YYYYMMDD>`: se
//     resuelven aunque la excepción no exista, si el día es de la regla.
//   - PATCH: mezcla objetos, null borra la clave, los arreglos se reemplazan. If-Match distinto → 412
//     conditionNotMet ("*" siempre calza). Sobre una instancia virtual la materializa como excepción.
//     Copia ajena (organizer.self ≠ true) o locked + campos compartidos → 403 forbiddenForNonOrganizer.
//     PUT reemplaza el recurso entero. DELETE: 204 y deja una lápida; ya borrado → 410 deleted; nunca existió
//     → 404; el principal se lleva sus excepciones. reader/freeBusyReader → 403 requiredAccessLevel.
//
// Decisiones sobre lo no documentado que NO tienen interruptor (por si una prueba depende de ellas):
//   - La instancia virtual tiene el etag de su principal (lo que acepta instanciaIfMatch="acepta").
//   - Una instancia sacada por EXDATE: get → {status:"cancelled"} mínima; delete → 410; patch → 404.
//   - PATCH sobre una lápida se aplica (con status:"confirmed" la revive). El panel no lo usa (plan §0).
//   - Las excepciones creadas por PATCH/DELETE de una instancia tienen id `<id>_<original UTC>Z`.
//   - updated nunca se repite (si dos escrituras caen en el mismo ms, la segunda va 1 ms después).
//   - Un pageToken sirve mientras su instantánea viva (las 600 más recientes): la página 2 muestra el
//     calendario como estaba al pedir la página 1.
//   - El orden "estable y no especificado" de events.list es el de creación.
//   - En ACL: la regla de la dueña de los datos no se cambia (403 cannotChangeOwnerAcl, motivo supuesto) y
//     nadie cambia su propia regla (403 cannotChangeOwnAcl). acl.delete de una regla que no existe → 404.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";
import { randomBytes, randomUUID, type KeyObject } from "node:crypto";
import ICAL from "ical.js";
import { crearMockToken, type MockToken, type OpcionesToken } from "./mock-token.mts";

// deno-lint-ignore no-explicit-any
type Json = any;

// ═══════════════════════════════ Tipos públicos ═══════════════════════════════

export type Rol = "none" | "freeBusyReader" | "reader" | "writerWithoutPrivateAccess" | "writer" | "owner";
export const ROLES: readonly Rol[] = ["none", "freeBusyReader", "reader", "writerWithoutPrivateAccess", "writer", "owner"];
const nivel = (r: Rol) => ROLES.indexOf(r);

/** Lo que Google no documenta. Cada uno con su valor por omisión (INTERRUPTORES_POR_OMISION). */
export interface Interruptores {
  /** Una lápida (evento borrado) sigue ocupando su id: insert con ese id → 409. (true) */
  lapidaOcupaId: boolean;
  /** Evento con fin igual al inicio: "ok" lo acepta, "400" responde timeRangeEmpty. ("ok") */
  finIgualInicio: "ok" | "400";
  /** endTimeUnspecified:true sin end se acepta (end = start). Si es false → 400 "Missing end time.". (true) */
  endTimeUnspecifiedAceptado: boolean;
  /** Los EXDATE que se escriben en recurrence se guardan como excepciones canceladas (y salen de recurrence). (false) */
  exdateAExcepcionCancelada: boolean;
  /** Cambiar el summary del principal también cambia las excepciones que tenían el summary viejo. (false) */
  propagarTituloAExcepciones: boolean;
  /** Al cambiar start/end/recurrence del principal: "conservar" las excepciones, o "borrar" las que la regla nueva ya no genera. ("conservar") */
  cambioReglaExcepciones: "conservar" | "borrar";
  /** En una serie dividida con "este y los siguientes", un cambio de recurrence responde 200 pero no se aplica. (false) */
  untilIgnoradoTrasDivision: boolean;
  /** Google reescribe lo que guarda: reordena las partes de RRULE (y quita WKST=MO) y pasa los EXDATE/RDATE con TZID a UTC, uno por línea. (false) */
  normalizar: boolean;
  /** Al listar, a veces materializa una excepción idéntica a la instancia ("fantasma"), con probFantasma. (false) */
  fantasmasAlLeer: boolean;
  /** Probabilidad de un fantasma por listado si fantasmasAlLeer. (0.3) */
  probFantasma: number;
  /** If-Match sobre una instancia virtual: "acepta" (el etag del principal, que es el que tiene la instancia), "412" (siempre falla) o "ignora". ("acepta") */
  instanciaIfMatch: "acepta" | "412" | "ignora";
  /** Las ediciones del actor "iPhone" (CalDAV) conservan las extendedProperties. (true) */
  extendedPropsSeConservan: boolean;
  /** Líneas de recurrence que este Google rechaza con 400 (texto contenido o RegExp). ([]) */
  reglasRechazadas: (string | RegExp)[];
  // ── Extras encontrados al escribir el simulador ──
  /** Solo owner puede LEER la ACL. La documentación dice que writer también la lee (AclRule.role, concepts_sharing). (false) */
  aclLecturaSoloOwner: boolean;
  /** acl.insert de una regla que ya existe: "409" duplicate (lo que supone el addendum) o "actualiza" el rol. ("409") */
  aclInsertExistente: "409" | "actualiza";
  /** Motivo del 403 cuando alguien que no es owner escribe (o no puede leer) la ACL. ("forbidden") */
  motivoAclSinOwner: "forbidden" | "requiredAccessLevel";
  /** DTSTART cuenta siempre como primera ocurrencia aunque no calce con la regla (RFC 5545). false = como ical.js. (false) */
  inicioCuentaSiempre: boolean;
}

export const INTERRUPTORES_POR_OMISION: Readonly<Interruptores> = Object.freeze({
  lapidaOcupaId: true,
  finIgualInicio: "ok",
  endTimeUnspecifiedAceptado: true,
  exdateAExcepcionCancelada: false,
  propagarTituloAExcepciones: false,
  cambioReglaExcepciones: "conservar",
  untilIgnoradoTrasDivision: false,
  normalizar: false,
  fantasmasAlLeer: false,
  probFantasma: 0.3,
  instanciaIfMatch: "acepta",
  extendedPropsSeConservan: true,
  reglasRechazadas: [],
  aclLecturaSoloOwner: false,
  aclInsertExistente: "409",
  motivoAclSinOwner: "forbidden",
  inicioCuentaSiempre: false,
} as Interruptores);

export interface Paginacion {
  /** "normal": páginas de maxResults; "azar": tamaños al azar entre 0 y maxResults; number[]: esos tamaños en orden (después, normal). */
  modo: "normal" | "azar" | number[];
  /** En "azar": probabilidad de una página vacía (nunca más de 2 seguidas). */
  probVacia: number;
  /** Un pageToken más viejo que esto (ms reales) → 400. */
  vencimientoMs: number;
  /** pageToken con otros parámetros que la primera página → 400 (sync.txt: "the exact same list query"). */
  exigirMismaConsulta: boolean;
}

export interface Reloj {
  ahora(): number;
  fijar(ms: number): void;
  avanzar(ms: number): void;
  real(): void;
}

export interface Contadores {
  api: number;
  token: number;
  porTipo: Record<string, number>;
  escrituras: number;
  escriturasAcl: number;
  inyectadas: number;
  status: Record<string, number>;
}

export interface PedidoVisto {
  n: number;
  metodo: string;
  tipo: string;
  ruta: string;
  calId: string | null;
  eventoId: string | null;
  reglaId: string | null;
  query: URLSearchParams;
  cuerpo: Json;
  cabeceras: IncomingMessage["headers"];
  correo: string | null;
}

export type RespuestaCruda = { status: number; cuerpo?: unknown; cabeceras?: Record<string, string> };
export type RespuestaInyectada =
  | RespuestaCruda
  | { demora: number; luego?: RespuestaCruda }
  | { aplicarYLuego: RespuestaCruda | "cortar" }
  | { cortar: true };

export interface Inyeccion {
  quitar(): void;
  readonly disparos: number;
}

export interface Notificacion {
  metodo: "insert" | "patch" | "update";
  calId: string;
  regla: string;
  correo: string;
  rol: string;
  enviada: boolean;
}

export interface OpcionesCalendario {
  zona?: string;
  resumen?: string;
  dueno?: string;
  descripcion?: string;
}

export interface Actor {
  crear(datos: Json, organizador?: string): Json;
  editar(id: string, cambios: Json): Json;
  borrar(id: string): void;
  borrarDia(idSerie: string, dia: string): Json;
  moverDia(idSerie: string, dia: string, start: Json, end: Json): Json;
  editarDia(idSerie: string, dia: string, cambios: Json): Json;
  esteYLosSiguientes(idSerie: string, dia: string, cambios?: Json): Json;
  restaurar(id: string): Json;
  editarTitulo(id: string, titulo: string): Json;
  obtener(id: string): Json | null;
}

export interface OpcionesSimulador {
  cuentas?: Map<string, KeyObject | string>;
  token?: Partial<Omit<OpcionesToken, "cuentas">>;
  interruptores?: Partial<Interruptores>;
  paginacion?: Partial<Paginacion>;
  semilla?: number;
  reloj?: number;
  gzip?: boolean;
}

export interface Simulador {
  url: string;
  apiUrl: string;
  tokenUrl: string;
  token: MockToken;
  interruptores: Interruptores;
  paginacion: Paginacion;
  reloj: Reloj;
  contadores: Contadores;
  registro: { n: number; metodo: string; tipo: string; ruta: string; query: string; status: number; inyectada: boolean }[];
  notificaciones: Notificacion[];
  latenciaMs: number;
  agregarCuenta(correo: string, clave: KeyObject | string): void;
  tokenPara(correo: string, alcances?: string[]): string;
  revocarTokens(): void;
  crearCalendario(calId: string, op?: OpcionesCalendario): void;
  compartir(calId: string, correo: string, rol: Rol): void;
  quitar(calId: string, correo: string): void;
  rolDe(calId: string, correo: string): Rol;
  eventos(calId: string, op?: { lapidas?: boolean }): Json[];
  evento(calId: string, id: string): Json | null;
  poner(calId: string, recurso: Json): Json;
  instancias(calId: string, id: string, desdeMs?: number, hastaMs?: number): Json[];
  acl(calId: string): Json[];
  actor(nombre: "web" | "iPhone" | "invitación" | "cumpleaños", calId?: string): Actor;
  inyectar(predicado: (p: PedidoVisto) => boolean, respuesta: RespuestaInyectada, veces?: number): Inyeccion;
  limpiarInyecciones(): void;
  vencerPaginas(): void;
  invalidarSync(calId: string): void;
  reiniciarContadores(): void;
  azar(): number;
  cerrar(): Promise<void>;
}

// ═══════════════════════════════ Esquema (para `fields`) ═══════════════════════════════
// Generado de pages/discovery.json (revisión 20261102): 0 = valor simple, "*" = mapa (cualquier clave, valor
// simple), "@X" = otro esquema, objeto = subcampos. Los arreglos son transparentes (items/id).
type Desc = 0 | string | { [k: string]: Desc };
export const ESQUEMA: Record<string, Record<string, Desc>> = JSON.parse(
  '{"Acl":{"etag":0,"items":"@AclRule","kind":0,"nextPageToken":0,"nextSyncToken":0},"AclRule":{"etag":0,"id":0,"kind":0,"role":0,"scope":{"type":0,"value":0}},"Calendar":{"autoAcceptInvitations":0,"conferenceProperties":"@ConferenceProperties","dataOwner":0,"description":0,"etag":0,"id":0,"kind":0,"labelProperties":"@LabelProperties","location":0,"summary":0,"timeZone":0,"workingHours":{"availableTimes":{"dayOfWeek":0,"periodEnd":0,"periodStart":0},"workingHoursEnabled":0}},"ConferenceData":{"conferenceId":0,"conferenceSolution":"@ConferenceSolution","createRequest":"@CreateConferenceRequest","entryPoints":"@EntryPoint","notes":0,"parameters":"@ConferenceParameters","signature":0},"ConferenceParameters":{"addOnParameters":"@ConferenceParametersAddOnParameters"},"ConferenceParametersAddOnParameters":{"parameters":"*"},"ConferenceProperties":{"allowedConferenceSolutionTypes":0},"ConferenceRequestStatus":{"statusCode":0},"ConferenceSolution":{"iconUri":0,"key":"@ConferenceSolutionKey","name":0},"ConferenceSolutionKey":{"type":0},"CreateConferenceRequest":{"conferenceSolutionKey":"@ConferenceSolutionKey","requestId":0,"status":"@ConferenceRequestStatus"},"EntryPoint":{"accessCode":0,"entryPointFeatures":0,"entryPointType":0,"label":0,"meetingCode":0,"passcode":0,"password":0,"pin":0,"regionCode":0,"uri":0},"Event":{"anyoneCanAddSelf":0,"attachments":"@EventAttachment","attendees":"@EventAttendee","attendeesOmitted":0,"birthdayProperties":"@EventBirthdayProperties","colorId":0,"conferenceData":"@ConferenceData","created":0,"creator":{"displayName":0,"email":0,"id":0,"self":0},"description":0,"end":"@EventDateTime","endTimeUnspecified":0,"etag":0,"eventLabelId":0,"eventType":0,"extendedProperties":{"private":"*","shared":"*"},"focusTimeProperties":"@EventFocusTimeProperties","gadget":{"display":0,"height":0,"iconLink":0,"link":0,"preferences":"*","title":0,"type":0,"width":0},"guestsCanInviteOthers":0,"guestsCanModify":0,"guestsCanSeeOtherGuests":0,"hangoutLink":0,"htmlLink":0,"iCalUID":0,"id":0,"kind":0,"location":0,"locked":0,"organizer":{"displayName":0,"email":0,"id":0,"self":0},"originalStartTime":"@EventDateTime","outOfOfficeProperties":"@EventOutOfOfficeProperties","privateCopy":0,"recurrence":0,"recurringEventId":0,"reminders":{"overrides":"@EventReminder","useDefault":0},"sequence":0,"source":{"title":0,"url":0},"start":"@EventDateTime","status":0,"summary":0,"transparency":0,"updated":0,"visibility":0,"workingLocationProperties":"@EventWorkingLocationProperties"},"EventAttachment":{"fileId":0,"fileUrl":0,"iconLink":0,"mimeType":0,"title":0},"EventAttendee":{"additionalGuests":0,"asyncOperation":0,"comment":0,"displayName":0,"email":0,"id":0,"optional":0,"organizer":0,"resource":0,"responseStatus":0,"self":0},"EventBirthdayProperties":{"contact":0,"customTypeName":0,"type":0},"EventDateTime":{"date":0,"dateTime":0,"timeZone":0},"EventFocusTimeProperties":{"autoDeclineMode":0,"chatStatus":0,"declineMessage":0},"EventLabel":{"backgroundColor":0,"id":0,"name":0},"EventOutOfOfficeProperties":{"autoDeclineMode":0,"declineMessage":0},"EventReminder":{"method":0,"minutes":0},"EventWorkingLocationProperties":{"customLocation":{"label":0},"homeOffice":0,"officeLocation":{"buildingId":0,"deskId":0,"floorId":0,"floorSectionId":0,"label":0},"type":0},"Events":{"accessRole":0,"defaultReminders":"@EventReminder","description":0,"etag":0,"items":"@Event","kind":0,"nextPageToken":0,"nextSyncToken":0,"summary":0,"timeZone":0,"updated":0},"LabelProperties":{"eventLabels":"@EventLabel"}}',
);

// ═══════════════════════════════ Errores (formas reales de errors.txt) ═══════════════════════════════

class ErrorApi extends Error {
  status: number;
  cuerpo: Json;
  constructor(status: number, cuerpo: Json) {
    super(cuerpo?.error?.message ?? String(status));
    this.status = status;
    this.cuerpo = cuerpo;
  }
}

function cuerpoError(status: number, domain: string, reason: string, message: string, extra: Json = {}, sobre: Json = {}): Json {
  return { error: { errors: [{ domain, reason, message, ...extra }], code: status, message, ...sobre } };
}
const fallo = (status: number, domain: string, reason: string, message: string, extra: Json = {}, sobre: Json = {}) =>
  new ErrorApi(status, cuerpoError(status, domain, reason, message, extra, sobre));

const e400 = (reason: string, message: string, extra: Json = {}) => fallo(400, "global", reason, message, extra);
const MSG_SECUENCIA =
  "Invalid sequence value. The specified sequence number is below the current sequence number of the resource. Re-fetch the resource and use its sequence number on the following request.";
const MSG_REGLA = "Invalid recurrence rule.";
const errNoEncontrado = () => fallo(404, "global", "notFound", "Not Found");
const errBorrado = () => fallo(410, "global", "deleted", "Resource has been deleted");
const errDuplicado = () => fallo(409, "global", "duplicate", "The requested identifier already exists.");
const errCondicion = () => fallo(412, "global", "conditionNotMet", "Precondition Failed", { locationType: "header", location: "If-Match" });
const errRango = (donde = "end") => fallo(400, "calendar", "timeRangeEmpty", "The specified time range is empty.", { locationType: "parameter", location: donde });
const errEscritura = () => fallo(403, "calendar", "requiredAccessLevel", "You need to have writer access to this calendar.");
const errNoOrganizador = () => fallo(403, "calendar", "forbiddenForNonOrganizer", "Shared properties can only be changed by the organizer of the event.");
const errMascara = (n: string) => e400("invalidParameter", `Invalid field selection ${n}`, { locationType: "parameter", location: "fields" });
const errParametro = (nombre: string, valor: string) => e400("invalid", `Invalid value '${valor}' for parameter ${nombre}.`, { locationType: "parameter", location: nombre });

const INFO_SERVICIO = { service: "calendar-json.googleapis.com", consumer: "projects/123456789012" };
const MSG_DESHABILITADA =
  "Google Calendar API has not been used in project 123456789012 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=123456789012 then retry. If you enabled this API recently, wait a few minutes for the action to propagate to our systems and retry.";

/** Cuerpos de error tal como los manda Google (errors.txt; los de alcance y API deshabilitada, observados). */
export const ERRORES: Record<string, () => RespuestaCruda> = {
  authError: () => ({
    status: 401,
    cuerpo: cuerpoError(401, "global", "authError", "Invalid Credentials", { locationType: "header", location: "Authorization" }, { status: "UNAUTHENTICATED" }),
    cabeceras: { "www-authenticate": 'Bearer realm="https://accounts.google.com/", error="invalid_token"' },
  }),
  required: () => ({
    status: 401,
    cuerpo: cuerpoError(401, "global", "required", "Login Required.", { locationType: "header", location: "Authorization" }, { status: "UNAUTHENTICATED" }),
    cabeceras: { "www-authenticate": 'Bearer realm="https://accounts.google.com/"' },
  }),
  insufficientPermissions: () => ({
    status: 403,
    cuerpo: {
      error: {
        code: 403,
        message: "Request had insufficient authentication scopes.",
        errors: [{ message: "Insufficient Permission", domain: "global", reason: "insufficientPermissions" }],
        status: "PERMISSION_DENIED",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT", domain: "googleapis.com", metadata: { service: "calendar-json.googleapis.com" } }],
      },
    },
  }),
  rateLimitExceeded: () => ({ status: 403, cuerpo: cuerpoError(403, "usageLimits", "rateLimitExceeded", "Rate Limit Exceeded") }),
  userRateLimitExceeded: () => ({ status: 403, cuerpo: cuerpoError(403, "usageLimits", "userRateLimitExceeded", "User Rate Limit Exceeded") }),
  quotaExceeded: () => ({ status: 403, cuerpo: cuerpoError(403, "usageLimits", "quotaExceeded", "Calendar usage limits exceeded.") }),
  dailyLimitExceeded: () => ({ status: 403, cuerpo: cuerpoError(403, "usageLimits", "dailyLimitExceeded", "Daily Limit Exceeded") }),
  // Ojo: accessNotConfigured viene con domain "usageLimits" (no es un límite de uso).
  accessNotConfigured: () => ({
    status: 403,
    cuerpo: {
      error: {
        code: 403,
        message: MSG_DESHABILITADA,
        errors: [{ message: MSG_DESHABILITADA, domain: "usageLimits", reason: "accessNotConfigured", extendedHelp: "https://console.developers.google.com" }],
        status: "PERMISSION_DENIED",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", domain: "googleapis.com", metadata: INFO_SERVICIO }],
      },
    },
  }),
  // Variante: el motivo de errors[] es genérico y SERVICE_DISABLED solo está en details.
  SERVICE_DISABLED: () => ({
    status: 403,
    cuerpo: {
      error: {
        code: 403,
        message: MSG_DESHABILITADA,
        errors: [{ message: MSG_DESHABILITADA, domain: "global", reason: "forbidden" }],
        status: "PERMISSION_DENIED",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", domain: "googleapis.com", metadata: INFO_SERVICIO }],
      },
    },
  }),
  requiredAccessLevel: () => ({ status: 403, cuerpo: errEscritura().cuerpo }),
  forbiddenForNonOrganizer: () => ({ status: 403, cuerpo: errNoOrganizador().cuerpo }),
  forbiddenForServiceAccounts: () => ({
    status: 403,
    cuerpo: cuerpoError(403, "calendar", "forbiddenForServiceAccounts", "Service accounts cannot invite attendees without Domain-Wide Delegation of Authority."),
  }),
  desconocido: () => ({ status: 403, cuerpo: cuerpoError(403, "calendar", "motivoQueNadieConoce", "Something unusual happened.") }),
  rateLimit429: () => ({ status: 429, cuerpo: cuerpoError(429, "usageLimits", "rateLimitExceeded", "Rate Limit Exceeded") }),
  backendError: () => ({ status: 500, cuerpo: cuerpoError(500, "global", "backendError", "Backend Error") }),
  unavailable: () => ({ status: 503, cuerpo: cuerpoError(503, "global", "backendError", "The service is currently unavailable.", {}, { status: "UNAVAILABLE" }) }),
  notFound: () => ({ status: 404, cuerpo: errNoEncontrado().cuerpo }),
  deleted: () => ({ status: 410, cuerpo: errBorrado().cuerpo }),
  duplicate: () => ({ status: 409, cuerpo: errDuplicado().cuerpo }),
  conditionNotMet: () => ({ status: 412, cuerpo: errCondicion().cuerpo }),
  fullSyncRequired: () => ({
    status: 410,
    cuerpo: cuerpoError(410, "calendar", "fullSyncRequired", "Sync token is no longer valid, a full sync is required.", { locationType: "parameter", location: "syncToken" }),
  }),
  timeRangeEmpty: () => ({ status: 400, cuerpo: errRango("timeMax").cuerpo }),
};

/** Ayudantes para armar lo que se pasa a sim.inyectar(…). */
export const respuestas = {
  error: (tipo: keyof typeof ERRORES | string): RespuestaCruda => {
    const f = ERRORES[tipo];
    if (!f) throw new Error(`respuestas.error: no conozco "${tipo}"`);
    return f();
  },
  status: (status: number, cuerpo?: unknown, cabeceras?: Record<string, string>): RespuestaCruda => ({ status, cuerpo, cabeceras }),
  demora: (ms: number, luego?: RespuestaCruda): RespuestaInyectada => ({ demora: ms, luego }),
  aplicarYLuego: (r: RespuestaCruda | "cortar"): RespuestaInyectada => ({ aplicarYLuego: r }),
  aplicarYCortar: (): RespuestaInyectada => ({ aplicarYLuego: "cortar" }),
  cortar: (): RespuestaInyectada => ({ cortar: true }),
};

/** Predicados frecuentes para sim.inyectar. */
export const es = {
  tipo: (...tipos: string[]) => (p: PedidoVisto) => tipos.includes(p.tipo),
  metodo: (...metodos: string[]) => (p: PedidoVisto) => metodos.includes(p.metodo),
  evento: (id: string) => (p: PedidoVisto) => p.eventoId === id,
  escritura: () => (p: PedidoVisto) => p.metodo !== "GET",
  todo: () => () => true,
};

// ═══════════════════════════════ Fechas y zonas ═══════════════════════════════

const dos = (n: number) => String(n).padStart(2, "0");
const cuatro = (n: number) => String(n).padStart(4, "0");
const formatos = new Map<string, Intl.DateTimeFormat | null>();
function formato(zona: string): Intl.DateTimeFormat | null {
  if (!formatos.has(zona)) {
    let f: Intl.DateTimeFormat | null = null;
    if (!/^[+-]/.test(zona)) {
      try {
        f = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
      } catch {
        f = null;
      }
    }
    formatos.set(zona, f);
  }
  return formatos.get(zona) ?? null;
}
/** ¿Es una zona IANA que Intl conoce? (Google exige nombres IANA). */
export const zonaValida = (z: unknown): z is string => typeof z === "string" && z.length > 0 && formato(z) !== null;

interface Partes {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}
function enZona(zona: string, ms: number): Partes {
  const p: Record<string, string> = {};
  for (const x of formato(zona)!.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: p.hour === "24" ? 0 : +p.hour, mi: +p.minute, s: +p.second };
}
const relojDe = (p: Partes) => Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
const desfaseMs = (zona: string, ms: number) => relojDe(enZona(zona, ms)) - Math.floor(ms / 1000) * 1000;

/** Instante de una hora de reloj en una zona. Hora repetida → la primera; hora que no existe → se corre hacia adelante (RFC 5545). */
export function instanteEn(zona: string, y: number, m: number, d: number, h = 0, mi = 0, s = 0): number {
  const reloj = Date.UTC(y, m - 1, d, h, mi, s);
  const a = desfaseMs(zona, reloj - 86_400_000);
  const b = desfaseMs(zona, reloj + 86_400_000);
  const calza = (t: number) => relojDe(enZona(zona, t)) === reloj;
  const ta = reloj - a;
  const tb = reloj - b;
  const va = calza(ta);
  const vb = calza(tb);
  if (va && vb) return Math.min(ta, tb);
  if (va) return ta;
  if (vb) return tb;
  return reloj - a;
}

/** RFC 3339 como lo escribe Google: "2026-11-03T17:00:00-03:00" (o "…Z" si el desfase es 0). */
export function formatear(ms: number, zona: string): string {
  const t = Math.floor(ms / 1000) * 1000;
  const p = enZona(zona, t);
  const off = Math.round(desfaseMs(zona, t) / 60000);
  const base = `${cuatro(p.y)}-${dos(p.m)}-${dos(p.d)}T${dos(p.h)}:${dos(p.mi)}:${dos(p.s)}`;
  if (off === 0) return base + "Z";
  const a = Math.abs(off);
  return `${base}${off < 0 ? "-" : "+"}${dos(Math.floor(a / 60))}:${dos(a % 60)}`;
}
const isoUTC = (ms: number) => new Date(ms).toISOString();
/** "20261118T120000Z" */
export const basicoUTC = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function fechaValida(y: number, m: number, d: number) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return y >= 1 && y <= 9999 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const leerFecha = (s: unknown): string | null => {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m && fechaValida(+m[1], +m[2], +m[3]) ? s : null;
};
const msFecha = (f: string) => Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10));
const fechaDeMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const sumarDias = (f: string, n: number) => fechaDeMs(msFecha(f) + n * 86_400_000);

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?$/i;
/** Instante de un dateTime RFC 3339; "sinZona" si no trae desfase y no hay zona; null si no se entiende. */
function leerFechaHora(s: unknown, zona: string | null): number | "sinZona" | null {
  if (typeof s !== "string") return null;
  const m = RFC3339.exec(s.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, se] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number);
  if (!fechaValida(y, mo, d) || h > 23 || mi > 59 || se > 59) return null;
  if (m[7]) {
    if (/z/i.test(m[7])) return Date.UTC(y, mo - 1, d, h, mi, se);
    const sg = m[7][0] === "-" ? -1 : 1;
    return Date.UTC(y, mo - 1, d, h, mi, se) - sg * (+m[7].slice(1, 3) * 60 + +m[7].slice(4, 6)) * 60_000;
  }
  if (!zona) return "sinZona";
  return instanteEn(zona, y, mo, d, h, mi, se);
}

// ═══════════════════════════════ Utilidades de datos ═══════════════════════════════

const clonar = <T,>(x: T): T => (x === undefined ? x : structuredClone(x));
const esObjeto = (x: unknown): x is Record<string, Json> => typeof x === "object" && x !== null && !Array.isArray(x);
const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function limpio<T extends Record<string, Json>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}
function sinNulos(x: Json): Json {
  if (Array.isArray(x)) return x.map(sinNulos);
  if (!esObjeto(x)) return x;
  const r: Json = {};
  for (const [k, v] of Object.entries(x)) if (v !== null && v !== undefined) r[k] = sinNulos(v);
  return r;
}
/** Mezcla de PATCH (performance.txt): los objetos se mezclan, null borra la clave, los arreglos se reemplazan. */
export function fusionar(base: Json, cambios: Json): Json {
  if (!esObjeto(cambios)) return clonar(cambios);
  const r: Json = esObjeto(base) ? clonar(base) : {};
  for (const [k, v] of Object.entries(cambios)) {
    if (v === null) delete r[k];
    else if (esObjeto(v)) r[k] = fusionar(r[k], v);
    else r[k] = clonar(v);
  }
  return r;
}
const B32 = "0123456789abcdefghijklmnopqrstuv";

/** Id de instancia como los de Google: `<id>_20261118T120000Z` (con hora) o `<id>_20261118` (día completo). */
export function idInstancia(idPrincipal: string, original: { date?: string; dateTime?: string }): string {
  if (original.date) return `${idPrincipal}_${original.date.replace(/-/g, "")}`;
  return `${idPrincipal}_${basicoUTC(Date.parse(String(original.dateTime)))}`;
}

const ORDEN_EVENTO = [
  "kind", "etag", "id", "status", "htmlLink", "created", "updated", "summary", "description", "location", "colorId", "creator", "organizer",
  "start", "end", "endTimeUnspecified", "recurrence", "recurringEventId", "originalStartTime", "transparency", "visibility", "iCalUID", "sequence",
  "attendees", "extendedProperties", "reminders", "eventType",
];
function ordenar(r: Json): Json {
  const o: Json = {};
  for (const k of ORDEN_EVENTO) if (r[k] !== undefined) o[k] = r[k];
  for (const k of Object.keys(r)) if (!(k in o) && r[k] !== undefined) o[k] = r[k];
  return o;
}

// ═══════════════════════════════ Máscara `fields` ═══════════════════════════════

type Mascara = { [k: string]: Mascara | true };

/** Analiza `fields` (performance.txt) y lo valida contra el esquema del recurso `raiz`. */
export function leerMascara(texto: string, raiz: string): Mascara {
  let i = 0;
  const s = texto;
  const nombre = (): string => {
    const m = /^(\*|[A-Za-z0-9_$@.-]+)/.exec(s.slice(i));
    if (!m) throw errMascara(s.slice(i) || s);
    i += m[1].length;
    return m[1];
  };
  const lista = (): Mascara => {
    const r: Mascara = {};
    for (;;) {
      const camino = [nombre()];
      while (s[i] === "/") {
        i++;
        camino.push(nombre());
      }
      let sub: Mascara | true = true;
      if (s[i] === "(") {
        i++;
        sub = lista();
        if (s[i] !== ")") throw errMascara(s);
        i++;
      }
      poner(r, camino, sub);
      if (s[i] === ",") {
        i++;
        continue;
      }
      return r;
    }
  };
  const poner = (r: Mascara, camino: string[], sub: Mascara | true) => {
    let nodo = r;
    for (let k = 0; k < camino.length; k++) {
      const n = camino[k];
      const ultimo = k === camino.length - 1;
      if (ultimo) {
        const previo = nodo[n];
        if (previo === true || sub === true) nodo[n] = true;
        else nodo[n] = previo ? mezclarMascaras(previo, sub) : sub;
      } else {
        const previo = nodo[n];
        if (previo === true) return;
        if (!previo) nodo[n] = {};
        nodo = nodo[n] as Mascara;
      }
    }
  };
  const m = lista();
  if (i !== s.length) throw errMascara(s.slice(i));
  validarMascara(m, `@${raiz}`);
  return m;
}
function mezclarMascaras(a: Mascara, b: Mascara): Mascara {
  const r: Mascara = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const p = r[k];
    r[k] = p === undefined ? v : p === true || v === true ? true : mezclarMascaras(p, v);
  }
  return r;
}
function resolverDesc(d: Desc): Desc {
  return typeof d === "string" && d.startsWith("@") ? (ESQUEMA[d.slice(1)] as Desc) : d;
}
function validarMascara(m: Mascara, desc: Desc) {
  const d = resolverDesc(desc);
  for (const [n, sub] of Object.entries(m)) {
    if (d === 0) throw errMascara(n);
    if (d === "*") {
      // mapa: cualquier clave; sus valores son simples
      if (sub !== true && n !== "*") throw errMascara(Object.keys(sub)[0]);
      continue;
    }
    if (typeof d !== "object") throw errMascara(n);
    if (n === "*") {
      if (sub !== true) for (const hijo of Object.values(d)) validarComodin(sub, hijo);
      continue;
    }
    if (!(n in d)) throw errMascara(n);
    if (sub !== true) validarMascara(sub, d[n]);
  }
}
/** Bajo un "*", cada nombre tiene que existir en al menos uno de los hijos. */
function validarComodin(sub: Mascara, hijo: Desc) {
  const d = resolverDesc(hijo);
  if (typeof d !== "object") return;
  for (const n of Object.keys(sub)) if (n !== "*" && !(n in d)) return;
}
function proyectar(v: Json, m: Mascara | true): Json {
  if (m === true || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => (x !== null && typeof x === "object" ? proyectar(x, m) ?? {} : x));
  // En el orden del recurso (como Google), no en el de la máscara.
  const r: Json = {};
  const todo = m["*"];
  for (const k of Object.keys(v)) {
    const propio = m[k];
    const sub = propio === undefined ? todo : todo === undefined ? propio : propio === true || todo === true ? true : mezclarMascaras(propio, todo);
    if (sub === undefined) continue;
    const p = proyectar(v[k], sub);
    if (p === undefined) continue;
    if (sub !== true && esObjeto(p) && Object.keys(p).length === 0) continue;
    r[k] = p;
  }
  return r;
}

// ═══════════════════════════════ Repeticiones (con ical.js) ═══════════════════════════════

const PARTES_REGLA = new Set(["FREQ", "UNTIL", "COUNT", "INTERVAL", "BYSECOND", "BYMINUTE", "BYHOUR", "BYDAY", "BYMONTHDAY", "BYYEARDAY", "BYWEEKNO", "BYMONTH", "BYSETPOS", "WKST"]);
const ORDEN_PARTES = ["FREQ", "WKST", "UNTIL", "COUNT", "INTERVAL", "BYSECOND", "BYMINUTE", "BYHOUR", "BYDAY", "BYMONTHDAY", "BYYEARDAY", "BYWEEKNO", "BYMONTH", "BYSETPOS"];

interface Linea {
  nombre: "RRULE" | "EXRULE" | "RDATE" | "EXDATE";
  params: Record<string, string>;
  valor: string;
}
function partirLinea(l: string): Linea | null {
  const i = l.indexOf(":");
  if (i <= 0) return null;
  const [nombre, ...ps] = l.slice(0, i).split(";");
  const N = nombre.trim().toUpperCase();
  if (N !== "RRULE" && N !== "EXRULE" && N !== "RDATE" && N !== "EXDATE") return null;
  const params: Record<string, string> = {};
  for (const p of ps) {
    const j = p.indexOf("=");
    if (j <= 0) return null;
    params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"(.*)"$/, "$1");
  }
  return { nombre: N, params, valor: l.slice(i + 1).trim() };
}

type Hasta = { tipo: "utc"; ms: number } | { tipo: "local"; reloj: number } | { tipo: "fecha"; fecha: string };
interface Regla {
  recur: Json; // ICAL.Recur sin UNTIL (se revisa a mano: ical.js compara UNTIL contra horas "flotantes")
  hasta: Hasta | null;
  // BYSETPOS lo aplica el simulador (ical.js 2.2 no lo hace bien: MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1 da
  // 28, 29 y 30 en marzo). Entonces recur va sin BYSETPOS ni COUNT, y COUNT se cuenta después de elegir.
  setpos?: number[];
  count?: number | null;
}
interface Oc {
  clave: string; // String(ms) con hora; "YYYY-MM-DD" en día completo
  orden: number; // ms (con hora) o Date.UTC de la fecha
  ms?: number;
  fecha?: string;
}
interface Exclusion {
  clave?: string;
  soloFecha?: string; // EXDATE;VALUE=DATE en una serie con hora: saca la ocurrencia de ese día
}
interface Serie {
  diaCompleto: boolean;
  zona: string;
  dtstart: Json; // ICAL.Time flotante
  inicio: Oc;
  durMs: number;
  durDias: number;
  rrules: Regla[];
  exrules: Regla[];
  rdates: Oc[];
  exdates: Exclusion[];
}

const errRegla = () => e400("invalid", MSG_REGLA);

function leerRegla(valor: string): Regla {
  const vistos = new Set<string>();
  for (const p of valor.split(";")) {
    const j = p.indexOf("=");
    const k = (j > 0 ? p.slice(0, j) : p).toUpperCase();
    if (j <= 0 || !p.slice(j + 1) || !PARTES_REGLA.has(k) || vistos.has(k)) throw errRegla();
    vistos.add(k);
  }
  if (!vistos.has("FREQ") || (vistos.has("COUNT") && vistos.has("UNTIL"))) throw errRegla();
  let recur: Json;
  try {
    recur = ICAL.Recur.fromString(valor);
  } catch {
    throw errRegla();
  }
  if ((recur.count !== null && recur.count !== undefined && !(recur.count >= 1)) || !(recur.interval >= 1)) throw errRegla();
  let setpos: number[] | undefined;
  let count: number | null = null;
  if (vistos.has("BYSETPOS")) {
    const v = /(?:^|;)BYSETPOS=([^;]+)/i.exec(valor)![1].split(",").map(Number);
    if (v.some((n) => !Number.isInteger(n) || n === 0 || Math.abs(n) > 366)) throw errRegla();
    setpos = v;
    count = recur.count ?? null;
    try {
      recur = ICAL.Recur.fromString(valor.split(";").filter((p) => !/^(BYSETPOS|COUNT)=/i.test(p)).join(";"));
    } catch {
      throw errRegla();
    }
  }
  let hasta: Hasta | null = null;
  const u = /(?:^|;)UNTIL=([^;]+)/i.exec(valor)?.[1];
  if (u) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/i.exec(u);
    if (!m || !fechaValida(+m[1], +m[2], +m[3])) throw errRegla();
    if (!m[4]) hasta = { tipo: "fecha", fecha: `${m[1]}-${m[2]}-${m[3]}` };
    else {
      const reloj = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      hasta = m[7] ? { tipo: "utc", ms: reloj } : { tipo: "local", reloj };
    }
  }
  recur.until = null;
  return { recur, hasta, setpos, count };
}

/** Valores de RDATE/EXDATE → claves de la serie. */
function valoresDe(l: Linea, s: { diaCompleto: boolean; zona: string }): Exclusion[] {
  const tz = l.params.TZID;
  if (tz !== undefined && !zonaValida(tz)) throw errRegla();
  const r: Exclusion[] = [];
  for (const crudo of l.valor.split(",")) {
    const v = crudo.split("/")[0].trim(); // PERIOD → su inicio
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/i.exec(v);
    if (!m || !fechaValida(+m[1], +m[2], +m[3])) throw errRegla();
    const fecha = `${m[1]}-${m[2]}-${m[3]}`;
    if (!m[4]) {
      r.push(s.diaCompleto ? { clave: fecha } : { soloFecha: fecha });
      continue;
    }
    const ms = m[7] ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : instanteEn(tz ?? s.zona, +m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
    if (s.diaCompleto) {
      const p = enZona(s.zona, ms);
      r.push({ clave: `${cuatro(p.y)}-${dos(p.m)}-${dos(p.d)}` });
    } else r.push({ clave: String(ms) });
  }
  return r;
}

const cacheSeries = new Map<string, Serie>();
/** Arma la serie de un principal ya validado (start/end canónicos). Lanza 400 si recurrence no se entiende. */
function leerSerie(r: Json, zonaCal: string): Serie {
  const llave = JSON.stringify([r.start, r.end, r.recurrence, zonaCal]);
  const enCache = cacheSeries.get(llave);
  if (enCache) return enCache;
  const diaCompleto = !!r.start?.date;
  const zona = zonaValida(r.start?.timeZone) ? r.start.timeZone : zonaCal;
  let dtstart: Json;
  let inicio: Oc;
  let durMs = 0;
  let durDias = 1;
  if (diaCompleto) {
    const f = r.start.date as string;
    dtstart = ICAL.Time.fromData({ year: +f.slice(0, 4), month: +f.slice(5, 7), day: +f.slice(8, 10), isDate: true });
    inicio = { clave: f, orden: msFecha(f), fecha: f };
    durDias = Math.max(0, Math.round((msFecha(r.end.date) - msFecha(f)) / 86_400_000));
  } else {
    const ms = Date.parse(r.start.dateTime);
    const p = enZona(zona, ms);
    dtstart = ICAL.Time.fromData({ year: p.y, month: p.m, day: p.d, hour: p.h, minute: p.mi, second: p.s, isDate: false });
    inicio = { clave: String(ms), orden: ms, ms };
    durMs = Date.parse(r.end.dateTime) - ms;
  }
  const s: Serie = { diaCompleto, zona, dtstart, inicio, durMs, durDias, rrules: [], exrules: [], rdates: [], exdates: [] };
  for (const linea of r.recurrence ?? []) {
    const l = typeof linea === "string" ? partirLinea(linea) : null;
    if (!l) throw errRegla();
    if (l.nombre === "RRULE" || l.nombre === "EXRULE") {
      const regla = leerRegla(l.valor);
      try {
        regla.recur.iterator(dtstart.clone()).next();
      } catch {
        throw errRegla();
      }
      (l.nombre === "RRULE" ? s.rrules : s.exrules).push(regla);
    } else if (l.nombre === "RDATE") {
      for (const e of valoresDe(l, s)) if (e.clave) s.rdates.push(ocDeClave(s, e.clave));
    } else s.exdates.push(...valoresDe(l, s));
  }
  if (cacheSeries.size > 5000) cacheSeries.clear();
  cacheSeries.set(llave, s);
  return s;
}
function ocDeClave(s: { diaCompleto: boolean }, clave: string): Oc {
  return s.diaCompleto ? { clave, orden: msFecha(clave), fecha: clave } : { clave, orden: Number(clave), ms: Number(clave) };
}
function ocDeReloj(s: Serie, t: Json): Oc {
  if (s.diaCompleto) {
    const f = `${cuatro(t.year)}-${dos(t.month)}-${dos(t.day)}`;
    return { clave: f, orden: msFecha(f), fecha: f };
  }
  const ms = instanteEn(s.zona, t.year, t.month, t.day, t.hour, t.minute, t.second);
  return { clave: String(ms), orden: ms, ms };
}
function pasoHasta(s: Serie, h: Hasta, t: Json, oc: Oc): boolean {
  if (s.diaCompleto) {
    const fh = h.tipo === "fecha" ? h.fecha : h.tipo === "utc" ? fechaDeMs(relojDe(enZona(s.zona, h.ms))) : fechaDeMs(h.reloj);
    return oc.orden > msFecha(fh);
  }
  if (h.tipo === "utc") return oc.orden > h.ms;
  const reloj = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  if (h.tipo === "local") return reloj > h.reloj;
  return Date.UTC(t.year, t.month - 1, t.day) > msFecha(h.fecha);
}
/** Período de FREQ al que pertenece una hora de reloj (para BYSETPOS). */
function periodoDe(r: Regla, t: Json): number {
  const f = r.recur.freq;
  const dia = Date.UTC(t.year, t.month - 1, t.day);
  if (f === "YEARLY") return t.year;
  if (f === "MONTHLY") return t.year * 12 + t.month;
  if (f === "WEEKLY") {
    // ical.js guarda WKST como número (1 = domingo … 7 = sábado); por omisión lunes.
    const wkst = typeof r.recur.wkst === "number" ? r.recur.wkst - 1 : 1;
    const dow = new Date(dia).getUTCDay();
    return dia - ((dow - wkst + 7) % 7) * 86_400_000;
  }
  if (f === "DAILY") return dia;
  if (f === "HOURLY") return dia + t.hour * 3_600_000;
  if (f === "MINUTELY") return dia + t.hour * 3_600_000 + t.minute * 60_000;
  return dia + t.hour * 3_600_000 + t.minute * 60_000 + t.second * 1000;
}
/** Desde dónde recorrer para ver el período completo de DTSTART (las posiciones de BYSETPOS cuentan desde el inicio del período). */
function inicioDelPeriodo(r: Regla, d: Json): Json {
  const p = r.recur.parts ?? {};
  const f = r.recur.freq;
  const conDias = !!(p.BYDAY || p.BYMONTHDAY || p.BYYEARDAY || p.BYWEEKNO);
  const base = { year: d.year, month: d.month, day: d.day, hour: d.hour, minute: d.minute, second: d.second, isDate: d.isDate };
  if (f === "MONTHLY" && conDias) return ICAL.Time.fromData({ ...base, day: 1 });
  if (f === "YEARLY" && (conDias || p.BYMONTH)) return ICAL.Time.fromData({ ...base, month: 1, day: 1 });
  if (f === "WEEKLY" && p.BYDAY) {
    const ini = new Date(periodoDe(r, d));
    return ICAL.Time.fromData({ ...base, year: ini.getUTCFullYear(), month: ini.getUTCMonth() + 1, day: ini.getUTCDate() });
  }
  return d.clone();
}
function recorrerConSetpos(s: Serie, r: Regla, tope: number, max: number, cb: (oc: Oc) => void) {
  const it = r.recur.iterator(inicioDelPeriodo(r, s.dtstart));
  let grupo: { t: Json; oc: Oc }[] = [];
  let periodo: number | null = null;
  let emitidas = 0;
  // false = ya no hay que seguir
  const vaciar = (): boolean => {
    const ordenado = grupo.sort((a, b) => a.oc.orden - b.oc.orden);
    const elegidos = new Map<string, { t: Json; oc: Oc }>();
    for (const pos of r.setpos!) {
      const i = pos > 0 ? pos - 1 : ordenado.length + pos;
      if (i >= 0 && i < ordenado.length) elegidos.set(ordenado[i].oc.clave, ordenado[i]);
    }
    grupo = [];
    for (const x of [...elegidos.values()].sort((a, b) => a.oc.orden - b.oc.orden)) {
      if (x.oc.orden < s.inicio.orden) continue;
      if (r.hasta && pasoHasta(s, r.hasta, x.t, x.oc)) return false;
      if (x.oc.orden > tope) return false;
      if (r.count && emitidas >= r.count) return false;
      emitidas++;
      cb(x.oc);
    }
    return true;
  };
  for (let i = 0; i < max * 4; i++) {
    let t: Json;
    try {
      t = it.next();
    } catch {
      break;
    }
    if (!t) break;
    const k = periodoDe(r, t);
    if (periodo !== null && k !== periodo && !vaciar()) return;
    periodo = k;
    const oc = ocDeReloj(s, t);
    if (!grupo.length && oc.orden > tope && oc.orden > s.inicio.orden) return;
    grupo.push({ t, oc });
  }
  vaciar();
}
function recorrer(s: Serie, r: Regla, tope: number, max: number, cb: (oc: Oc) => void) {
  if (r.setpos) return recorrerConSetpos(s, r, tope, max, cb);
  const it = r.recur.iterator(s.dtstart.clone());
  for (let i = 0; i < max; i++) {
    let t: Json;
    try {
      t = it.next();
    } catch {
      return;
    }
    if (!t) return;
    const oc = ocDeReloj(s, t);
    if (r.hasta && pasoHasta(s, r.hasta, t, oc)) return;
    if (oc.orden > tope) return;
    cb(oc);
  }
}
const fechaLocalDe = (s: Serie, oc: Oc) => (oc.fecha ? oc.fecha : fechaDeMs(relojDe(enZona(s.zona, oc.ms!))));

/** Ocurrencias de la serie hasta `tope` (incluido). Con conExcluidas también las que sacan EXDATE/EXRULE (marcadas). */
function ocurrencias(s: Serie, tope: number, interruptores: Interruptores, max = 20_000): (Oc & { excluida?: boolean })[] {
  const vistas = new Map<string, Oc>();
  const agregar = (oc: Oc) => {
    if (oc.orden <= tope) vistas.set(oc.clave, oc);
  };
  for (const r of s.rrules) recorrer(s, r, tope, max, agregar);
  for (const oc of s.rdates) agregar(oc);
  if (interruptores.inicioCuentaSiempre || (!s.rrules.length && !s.rdates.length)) agregar(s.inicio);
  const fuera = new Set<string>();
  const fechasFuera = new Set<string>();
  for (const r of s.exrules) recorrer(s, r, tope, max, (oc) => fuera.add(oc.clave));
  for (const e of s.exdates) {
    if (e.clave) fuera.add(e.clave);
    else if (e.soloFecha) fechasFuera.add(e.soloFecha);
  }
  return [...vistas.values()]
    .map((oc) => (fuera.has(oc.clave) || (fechasFuera.size && fechasFuera.has(fechaLocalDe(s, oc))) ? { ...oc, excluida: true } : oc))
    .sort((a, b) => a.orden - b.orden);
}

/** Normalización que hace Google si interruptores.normalizar (supuesto): RRULE reordenada sin WKST=MO; EXDATE/RDATE con TZID → UTC, uno por línea. */
function normalizarRecurrencia(lineas: string[], zonaSerie: string): string[] {
  const r: string[] = [];
  for (const linea of lineas) {
    const l = partirLinea(linea);
    if (!l) {
      r.push(linea);
      continue;
    }
    if (l.nombre === "RRULE" || l.nombre === "EXRULE") {
      const partes = l.valor.split(";").map((p) => [p.slice(0, p.indexOf("=")).toUpperCase(), p.slice(p.indexOf("=") + 1)] as [string, string]);
      const orden = partes.filter(([k, v]) => !(k === "WKST" && v.toUpperCase() === "MO")).sort((a, b) => ORDEN_PARTES.indexOf(a[0]) - ORDEN_PARTES.indexOf(b[0]));
      r.push(`${l.nombre}:${orden.map(([k, v]) => `${k}=${v}`).join(";")}`);
    } else if (l.params.TZID || !/VALUE=DATE/i.test(linea)) {
      const tz = l.params.TZID ?? zonaSerie;
      for (const crudo of l.valor.split(",")) {
        const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/i.exec(crudo.trim());
        if (!m) {
          r.push(`${l.nombre}:${crudo.trim()}`);
          continue;
        }
        const ms = m[7] ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : instanteEn(tz, +m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
        r.push(`${l.nombre}:${basicoUTC(ms)}`);
      }
    } else r.push(linea);
  }
  return r;
}

// ═══════════════════════════════ El simulador ═══════════════════════════════

interface Guardado {
  r: Json; // el recurso como lo devuelve Google (dateTime con el desfase de su zona; created/updated en UTC)
  mod: number; // marca para syncToken
  conPrincipal?: boolean; // excepción cancelada junto con su principal
  previo?: string; // su status antes de eso (para restaurar)
  dividida?: boolean; // serie cortada por "este y los siguientes"
  fantasma?: boolean;
}
interface ReglaG {
  r: Json; // {kind, etag, id, scope, role}
  mod: number;
}
interface Calendario {
  id: string;
  resumen: string;
  zona: string;
  descripcion: string;
  dueno: string;
  eventos: Map<string, Guardado>;
  acl: Map<string, ReglaG>;
  mod: number;
  aclMod: number;
  actualizado: number;
  syncMin: number;
  aclSyncMin: number;
}

const A = "https://www.googleapis.com/auth/";
// Alcances aceptados por método (discovery.json). Los alcances "owned", "app.created", "freebusy" y
// "public.readonly" tienen reglas propias que el simulador no imita: se tratan como insuficientes.
const ALCANCES = {
  eventosLeer: ["calendar", "calendar.readonly", "calendar.events", "calendar.events.readonly"].map((x) => A + x),
  eventosEscribir: ["calendar", "calendar.events"].map((x) => A + x),
  aclLeer: ["calendar", "calendar.acls", "calendar.acls.readonly"].map((x) => A + x),
  aclGet: ["calendar", "calendar.acls", "calendar.acls.readonly", "calendar.readonly"].map((x) => A + x),
  aclEscribir: ["calendar", "calendar.acls"].map((x) => A + x),
  calLeer: ["calendar", "calendar.readonly", "calendar.calendars", "calendar.calendars.readonly"].map((x) => A + x),
};
const ALCANCE_TIPO: Record<string, string[]> = {
  "events.list": ALCANCES.eventosLeer,
  "events.get": ALCANCES.eventosLeer,
  "events.instances": ALCANCES.eventosLeer,
  "events.insert": ALCANCES.eventosEscribir,
  "events.patch": ALCANCES.eventosEscribir,
  "events.update": ALCANCES.eventosEscribir,
  "events.delete": ALCANCES.eventosEscribir,
  "acl.list": ALCANCES.aclLeer,
  "acl.get": ALCANCES.aclGet,
  "acl.insert": ALCANCES.aclEscribir,
  "acl.patch": ALCANCES.aclEscribir,
  "acl.update": ALCANCES.aclEscribir,
  "acl.delete": ALCANCES.aclEscribir,
  "calendars.get": ALCANCES.calLeer,
};
const RAIZ_TIPO: Record<string, string> = {
  "events.list": "Events",
  "events.instances": "Events",
  "events.get": "Event",
  "events.insert": "Event",
  "events.patch": "Event",
  "events.update": "Event",
  "acl.list": "Acl",
  "acl.get": "AclRule",
  "acl.insert": "AclRule",
  "acl.patch": "AclRule",
  "acl.update": "AclRule",
  "calendars.get": "Calendar",
};

const CAMPOS_ESCRIBIBLES = [
  "anyoneCanAddSelf", "attachments", "attendees", "birthdayProperties", "colorId", "conferenceData", "description", "end", "endTimeUnspecified",
  "eventType", "extendedProperties", "focusTimeProperties", "gadget", "guestsCanInviteOthers", "guestsCanModify", "guestsCanSeeOtherGuests",
  "location", "outOfOfficeProperties", "privateCopy", "recurrence", "reminders", "sequence", "source", "start", "status", "summary",
  "transparency", "visibility", "workingLocationProperties",
];
const SOLO_LECTURA = ["kind", "etag", "id", "htmlLink", "created", "updated", "creator", "organizer", "iCalUID", "recurringEventId", "originalStartTime", "hangoutLink", "attendeesOmitted", "locked", "privateCopy"];
/** Campos que solo cambia el organizador (errors.txt: forbiddenForNonOrganizer; "locked": summary, description, location, start, end, recurrence). */
const CAMPOS_COMPARTIDOS = ["summary", "description", "location", "start", "end", "endTimeUnspecified", "recurrence", "attendees", "guestsCanInviteOthers", "guestsCanModify", "guestsCanSeeOtherGuests", "anyoneCanAddSelf", "conferenceData", "attachments", "sequence"];
const CAMPOS_BLOQUEADOS = ["summary", "description", "location", "start", "end", "recurrence"];
const CAMPOS_PRIVADO = ["kind", "etag", "id", "status", "htmlLink", "created", "updated", "start", "end", "endTimeUnspecified", "recurrence", "recurringEventId", "originalStartTime", "transparency", "visibility", "iCalUID", "sequence", "eventType"];

function mulberry32(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function leerCuerpo(req: IncomingMessage): Promise<string> {
  const partes: Buffer[] = [];
  for await (const c of req) partes.push(c as Buffer);
  return Buffer.concat(partes).toString("utf8");
}

export async function iniciarSimulador(opciones: OpcionesSimulador = {}): Promise<Simulador> {
  const interruptores: Interruptores = { ...INTERRUPTORES_POR_OMISION, reglasRechazadas: [], ...(opciones.interruptores ?? {}) };
  const paginacion: Paginacion = { modo: "normal", probVacia: 0.25, vencimientoMs: Infinity, exigirMismaConsulta: true, ...(opciones.paginacion ?? {}) };
  const azar = mulberry32(opciones.semilla ?? 1);
  const cuentas = opciones.cuentas ?? new Map<string, KeyObject | string>();
  const token = crearMockToken({ ...(opciones.token ?? {}), cuentas });
  const rutaToken = opciones.token?.ruta ?? "/token";
  const gzip = opciones.gzip ?? true;

  // ── Reloj (created/updated). updated nunca se repite dentro del simulador.
  let fijo: number | null = opciones.reloj ?? null;
  let corrido = 0;
  let ultimaMarca = 0;
  const reloj: Reloj = {
    ahora: () => (fijo !== null ? fijo : Date.now() + corrido),
    fijar: (ms) => void ((fijo = ms), (ultimaMarca = ms - 1)),
    avanzar: (ms) => void (fijo !== null ? (fijo += ms) : (corrido += ms)),
    real: () => void ((fijo = null), (corrido = 0)),
  };
  const marca = () => (ultimaMarca = Math.max(reloj.ahora(), ultimaMarca + 1));

  let etagN = 0;
  const nuevoEtag = () => `"${3_500_000_000_000_000 + ++etagN * 1000}"`;
  const idAzar = (n = 26) => Array.from(randomBytes(n), (b) => B32[b & 31]).join("");

  const calendarios = new Map<string, Calendario>();
  const contadores: Contadores = { api: 0, token: 0, porTipo: {}, escrituras: 0, escriturasAcl: 0, inyectadas: 0, status: {} };
  const registro: Simulador["registro"] = [];
  const notificaciones: Notificacion[] = [];
  const directos = new Map<string, { correo: string; alcances: string[] }>();
  const inyecciones: { predicado: (p: PedidoVisto) => boolean; respuesta: RespuestaInyectada; veces: number; disparos: number }[] = [];
  const paginas = new Map<string, { ins: Instantanea; pos: number }>();
  let paginasValidasDesde = 0;

  interface Instantanea {
    items: Json[];
    consulta: string;
    creada: number;
    cabecera: Json;
    fin: Json;
    max: number;
    cola?: number[];
    vacias: number;
  }

  // ── Calendarios y ACL
  function calOError(calId: string): Calendario {
    const c = calendarios.get(calId);
    if (!c) throw new Error(`simulador: no existe el calendario ${calId}`);
    return c;
  }
  const idRegla = (scope: Json) => (scope?.type === "default" ? "default" : `${scope.type}:${String(scope.value).toLowerCase()}`);
  function rolEn(c: Calendario, correo: string | null): Rol {
    if (!correo) return "none";
    const k = correo.toLowerCase();
    let mejor: Rol = "none";
    const ver = (id: string) => {
      const rr = c.acl.get(id);
      if (rr && nivel(rr.r.role) > nivel(mejor)) mejor = rr.r.role;
    };
    ver(`user:${k}`);
    ver(`domain:${k.split("@")[1] ?? ""}`);
    ver("default");
    return mejor;
  }
  function ponerRegla(c: Calendario, scope: Json, role: Rol): ReglaG {
    const id = idRegla(scope);
    const existe = c.acl.get(id);
    const r = { kind: "calendar#aclRule", etag: nuevoEtag(), id, scope: scope.type === "default" ? { type: "default" } : { type: scope.type, value: String(scope.value).toLowerCase() }, role };
    const mod = ++c.aclMod;
    if (existe) {
      existe.r = r;
      existe.mod = mod;
      return existe;
    }
    const g: ReglaG = { r, mod };
    c.acl.set(id, g);
    return g;
  }

  // ── Eventos guardados
  function cambio(c: Calendario, g: Guardado) {
    g.r.etag = nuevoEtag();
    const t = marca();
    g.r.updated = isoUTC(t);
    g.mod = ++c.mod;
    c.actualizado = t;
  }
  const excepcionesDe = (c: Calendario, idP: string) => [...c.eventos.values()].filter((g) => g.r.recurringEventId === idP);
  const esPrincipal = (g: Guardado) => !g.r.recurringEventId && Array.isArray(g.r.recurrence) && g.r.recurrence.length > 0;
  const serieDe = (c: Calendario, g: Guardado) => leerSerie(g.r, c.zona);
  function claveOriginal(s: Serie, ost: Json): string | null {
    if (!ost) return null;
    if (s.diaCompleto) return ost.date ?? null;
    if (!ost.dateTime) return null;
    const ms = Date.parse(ost.dateTime);
    return Number.isNaN(ms) ? null : String(ms);
  }
  function excepcionEn(c: Calendario, m: Guardado, clave: string): Guardado | null {
    const s = serieDe(c, m);
    for (const g of excepcionesDe(c, m.r.id)) if (claveOriginal(s, g.r.originalStartTime) === clave) return g;
    return null;
  }
  function horasDe(c: Calendario, m: Guardado, oc: Oc) {
    const s = serieDe(c, m);
    if (s.diaCompleto) {
      const st = limpio({ date: oc.fecha!, timeZone: m.r.start.timeZone });
      return { start: st, end: limpio({ date: sumarDias(oc.fecha!, s.durDias), timeZone: m.r.end?.timeZone }), originalStartTime: clonar(st) };
    }
    const st = limpio({ dateTime: formatear(oc.ms!, s.zona), timeZone: m.r.start.timeZone });
    const zf = zonaValida(m.r.end?.timeZone) ? m.r.end.timeZone : s.zona;
    return { start: st, end: limpio({ dateTime: formatear(oc.ms! + s.durMs, zf), timeZone: m.r.end?.timeZone }), originalStartTime: clonar(st) };
  }
  /** La instancia virtual (sin excepción guardada), como la devuelve instances(): con su id, el etag del principal y sus campos. */
  function virtual(c: Calendario, m: Guardado, oc: Oc): Json {
    const r = clonar(m.r);
    delete r.recurrence;
    const h = horasDe(c, m, oc);
    Object.assign(r, h, { id: idInstancia(m.r.id, h.originalStartTime), recurringEventId: m.r.id });
    return ordenar(r);
  }
  function materializar(c: Calendario, m: Guardado, oc: Oc): Guardado {
    const previa = excepcionEn(c, m, oc.clave);
    if (previa) return previa;
    const r = virtual(c, m, oc);
    return { r, mod: 0 };
  }
  type Resuelto = { tipo: "guardado"; g: Guardado } | { tipo: "virtual"; m: Guardado; oc: Oc; excluida: boolean };
  function resolver(c: Calendario, id: string): Resuelto | null {
    const g = c.eventos.get(id);
    if (g) return { tipo: "guardado", g };
    const mm = /^(.+)_(\d{8})(?:T(\d{6})Z)?$/.exec(id);
    if (!mm) return null;
    const m = c.eventos.get(mm[1]);
    if (!m || m.r.status === "cancelled" || !esPrincipal(m)) return null;
    const s = serieDe(c, m);
    const d = mm[2];
    let clave: string;
    if (s.diaCompleto) {
      if (mm[3]) return null;
      clave = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    } else {
      if (!mm[3]) return null;
      const t = mm[3];
      clave = String(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6)));
    }
    const previa = excepcionEn(c, m, clave);
    if (previa) return { tipo: "guardado", g: previa };
    const oc = ocurrencias(s, ocDeClave(s, clave).orden, interruptores, 400_000).find((o) => o.clave === clave);
    if (!oc) return null;
    return { tipo: "virtual", m, oc, excluida: !!oc.excluida };
  }

  /** Instancias de una serie (virtuales y excepciones), con el filtro de instances()/singleEvents. */
  function instanciasDe(c: Calendario, m: Guardado, op: { desde?: number; hasta?: number; inclusivo?: boolean; showDeleted?: boolean; originalStart?: string | null }): Json[] {
    const s = serieDe(c, m);
    const tope = op.hasta ?? Math.max(reloj.ahora(), s.inicio.orden) + 2 * 365 * 86_400_000;
    const exc = new Map<string, Guardado>();
    const huerfanas: Guardado[] = [];
    for (const g of excepcionesDe(c, m.r.id)) {
      if (g.conPrincipal) continue;
      const k = claveOriginal(s, g.r.originalStartTime);
      if (k) exc.set(k, g);
    }
    const r: Json[] = [];
    const usadas = new Set<string>();
    for (const oc of ocurrencias(s, tope, interruptores, 5000)) {
      const g = exc.get(oc.clave);
      if (g) {
        usadas.add(oc.clave);
        if (g.r.status !== "cancelled" || op.showDeleted) r.push(g.r);
        continue;
      }
      if (!oc.excluida) r.push(virtual(c, m, oc));
    }
    for (const [k, g] of exc) if (!usadas.has(k)) huerfanas.push(g);
    for (const g of huerfanas) if (g.r.status !== "cancelled" || op.showDeleted) r.push(g.r);
    const dentro = (x: Json) => {
      const ini = inicioMs(x.start ?? x.originalStartTime);
      const fin = x.end ? inicioMs(x.end) : ini;
      if (op.hasta !== undefined && !(ini < op.hasta)) return false;
      if (op.desde !== undefined && !(op.inclusivo ? fin >= op.desde : fin > op.desde)) return false;
      if (op.originalStart && claveOriginal(s, x.originalStartTime) !== op.originalStart) return false;
      return true;
    };
    return r.filter(dentro).sort((a, b) => inicioMs(a.start ?? a.originalStartTime) - inicioMs(b.start ?? b.originalStartTime));
  }
  const inicioMs = (t: Json): number => (t?.date ? msFecha(t.date) : t?.dateTime ? Date.parse(t.dateTime) : 0);

  // ── Validación común (insert, patch, update)
  function hora(c: Calendario, t: Json, nombre: string, esSerie: boolean): { tipo: "fecha" | "hora"; orden: number; canon: Json } {
    if (!esObjeto(t)) throw e400("invalid", `Invalid ${nombre} time.`);
    const tieneD = t.date !== undefined && t.date !== null;
    const tieneT = t.dateTime !== undefined && t.dateTime !== null;
    if (tieneD === tieneT) throw e400("invalid", `Invalid ${nombre} time.`);
    if (t.timeZone !== undefined && t.timeZone !== null && !zonaValida(t.timeZone)) throw e400("invalid", `Invalid time zone definition for ${nombre} time.`);
    const tz = t.timeZone ?? undefined;
    if (tieneD) {
      const f = leerFecha(t.date);
      if (!f) throw e400("invalid", `Invalid ${nombre} time.`);
      return { tipo: "fecha", orden: msFecha(f), canon: limpio({ date: f, timeZone: tz }) };
    }
    if (esSerie && !tz) throw e400("invalid", `Missing time zone definition for ${nombre} time.`);
    const ms = leerFechaHora(t.dateTime, tz ?? null);
    if (ms === "sinZona") throw e400("invalid", `Missing time zone definition for ${nombre} time.`);
    if (ms === null) throw e400("invalid", `Invalid ${nombre} time.`);
    return { tipo: "hora", orden: ms, canon: limpio({ dateTime: formatear(ms, tz ?? c.zona), timeZone: tz }) };
  }
  function validarTiempos(c: Calendario, r: Json) {
    const esSerie = !r.recurringEventId && Array.isArray(r.recurrence) && r.recurrence.length > 0;
    if (r.start === undefined || r.start === null) throw e400("required", "Missing start time.");
    if (r.end === undefined || r.end === null) {
      if (r.endTimeUnspecified === true && interruptores.endTimeUnspecifiedAceptado && esObjeto(r.start)) r.end = r.start.date ? { date: sumarDias(String(r.start.date), 1) } : clonar(r.start);
      else throw e400("required", "Missing end time.");
    }
    const ini = hora(c, r.start, "start", esSerie);
    const fin = hora(c, r.end, "end", esSerie);
    if (ini.tipo !== fin.tipo) throw e400("invalid", "Start and end times must either both be date or both be dateTime.");
    if (fin.orden < ini.orden) throw errRango();
    if (fin.orden === ini.orden && r.endTimeUnspecified !== true && interruptores.finIgualInicio === "400") throw errRango();
    r.start = ini.canon;
    r.end = fin.canon;
    if (r.originalStartTime && esObjeto(r.originalStartTime)) r.originalStartTime = hora(c, r.originalStartTime, "originalStart", false).canon;
  }
  function validarRecurrencia(c: Calendario, r: Json) {
    if (r.recurringEventId) {
      delete r.recurrence;
      return;
    }
    if (r.recurrence === undefined || r.recurrence === null) {
      delete r.recurrence;
      return;
    }
    if (!Array.isArray(r.recurrence) || r.recurrence.some((l: unknown) => typeof l !== "string")) throw errRegla();
    if (!r.recurrence.length) {
      delete r.recurrence;
      return;
    }
    for (const l of r.recurrence as string[]) {
      if (/^\s*(DTSTART|DTEND)/i.test(l)) throw errRegla();
      for (const p of interruptores.reglasRechazadas) if (typeof p === "string" ? l.includes(p) : p.test(l)) throw errRegla();
    }
    leerSerie(r, c.zona);
  }
  /** Lo que Google hace con recurrence después de guardarla (interruptores normalizar y exdateAExcepcionCancelada). */
  function postRecurrencia(c: Calendario, g: Guardado) {
    if (!esPrincipal(g)) return;
    const zonaS = zonaValida(g.r.start?.timeZone) ? g.r.start.timeZone : c.zona;
    if (interruptores.exdateAExcepcionCancelada) {
      const s = serieDe(c, g);
      const quedan: string[] = [];
      const claves: string[] = [];
      for (const linea of g.r.recurrence as string[]) {
        const l = partirLinea(linea);
        if (l?.nombre !== "EXDATE") {
          quedan.push(linea);
          continue;
        }
        const vals = valoresDe(l, s);
        if (vals.some((v) => !v.clave)) {
          quedan.push(linea);
          continue;
        }
        for (const v of vals) claves.push(v.clave!);
      }
      if (claves.length) {
        g.r.recurrence = quedan;
        if (!quedan.length) delete g.r.recurrence;
        for (const k of claves) {
          const oc = ocDeClave(s, k);
          const e = excepcionEn(c, g, k) ?? { r: limpio({ kind: "calendar#event", id: idInstancia(g.r.id, horasDe(c, g, oc).originalStartTime), status: "cancelled", recurringEventId: g.r.id, originalStartTime: horasDe(c, g, oc).originalStartTime }), mod: 0 };
          e.r.status = "cancelled";
          cambio(c, e);
          c.eventos.set(e.r.id, e);
        }
      }
    }
    if (interruptores.normalizar && g.r.recurrence) g.r.recurrence = normalizarRecurrencia(g.r.recurrence, zonaS);
  }
  function exigirEscritura(rol: Rol) {
    if (nivel(rol) < nivel("writerWithoutPrivateAccess")) throw errEscritura();
  }
  const esCuentaServicio = (correo: string) => /\.gserviceaccount\.com$/i.test(correo);

  // ── insert
  function insertar(c: Calendario, cuerpo: Json, correo: string): Json {
    if (!esObjeto(cuerpo)) throw e400("parseError", "Parse Error");
    const b = sinNulos(cuerpo);
    let id = b.id;
    if (id !== undefined) {
      if (typeof id !== "string" || !/^[a-v0-9]{5,1024}$/.test(id)) throw e400("invalid", "Invalid resource id value.");
    } else id = idAzar();
    const previo = c.eventos.get(id);
    if (previo && (previo.r.status !== "cancelled" || interruptores.lapidaOcupaId)) throw errDuplicado();
    if (Array.isArray(b.attendees) && b.attendees.length && esCuentaServicio(correo)) throw ERRORES_API.forbiddenForServiceAccounts();
    if (b.eventType !== undefined && b.eventType !== "default") throw e400("invalid", "Invalid event type.");
    if (b.status !== undefined && !["confirmed", "tentative", "cancelled"].includes(b.status)) throw e400("invalid", "Invalid value for: status");
    const r: Json = { kind: "calendar#event", id };
    for (const k of CAMPOS_ESCRIBIBLES) if (b[k] !== undefined) r[k] = clonar(b[k]);
    validarTiempos(c, r);
    validarRecurrencia(c, r);
    const t = marca();
    Object.assign(r, {
      etag: nuevoEtag(),
      status: r.status ?? "confirmed",
      htmlLink: `https://www.google.com/calendar/event?eid=${Buffer.from(`${id} ${c.id}`).toString("base64url")}`,
      created: isoUTC(t),
      updated: isoUTC(t),
      creator: { email: correo },
      organizer: { email: c.id, displayName: c.resumen, self: true },
      iCalUID: typeof b.iCalUID === "string" && b.iCalUID ? b.iCalUID : `${id}@google.com`,
      sequence: Number.isInteger(r.sequence) ? r.sequence : 0,
      reminders: r.reminders ?? { useDefault: true },
      eventType: "default",
    });
    if (previo) {
      for (const e of excepcionesDe(c, id)) c.eventos.delete(e.r.id);
      c.eventos.delete(id);
    }
    const g: Guardado = { r: ordenar(r), mod: ++c.mod };
    c.actualizado = t;
    c.eventos.set(id, g);
    postRecurrencia(c, g);
    return g.r;
  }

  // ── patch / update
  function cambiar(c: Calendario, id: string, cuerpo: Json, ifMatch: string | null, reemplazar: boolean): Json {
    if (!esObjeto(cuerpo)) throw e400("parseError", "Parse Error");
    const res = resolver(c, id);
    if (!res) throw errNoEncontrado();
    let g: Guardado;
    let nueva = false;
    if (res.tipo === "virtual") {
      if (res.excluida) throw errNoEncontrado();
      if (ifMatch !== null && interruptores.instanciaIfMatch !== "ignora") {
        if (interruptores.instanciaIfMatch === "412") throw errCondicion();
        if (ifMatch !== "*" && ifMatch !== res.m.r.etag) throw errCondicion();
      }
      g = materializar(c, res.m, res.oc);
      nueva = !c.eventos.has(g.r.id);
      ifMatch = null;
    } else g = res.g;
    if (ifMatch !== null && ifMatch !== "*" && ifMatch !== g.r.etag) throw errCondicion();
    const antes = g.r;
    const b: Json = {};
    for (const [k, v] of Object.entries(cuerpo)) if (!SOLO_LECTURA.includes(k)) b[k] = v;
    let nuevo: Json;
    if (reemplazar) {
      nuevo = {};
      for (const k of SOLO_LECTURA) if (antes[k] !== undefined) nuevo[k] = clonar(antes[k]);
      nuevo.eventType = antes.eventType;
      for (const [k, v] of Object.entries(sinNulos(b))) if (CAMPOS_ESCRIBIBLES.includes(k)) nuevo[k] = clonar(v);
      if (nuevo.eventType !== antes.eventType) throw e400("invalid", "Event type cannot be changed.");
      nuevo.reminders ??= { useDefault: true };
      nuevo.status ??= "confirmed";
    } else nuevo = fusionar(antes, b);
    const ajena = antes.organizer && antes.organizer.self !== true;
    if (ajena || antes.locked) {
      for (const k of ajena ? CAMPOS_COMPARTIDOS : CAMPOS_BLOQUEADOS) if (!igual(antes[k], nuevo[k])) throw errNoOrganizador();
    }
    if (b.sequence !== undefined && b.sequence !== null && Number(b.sequence) < (antes.sequence ?? 0)) throw e400("invalid", MSG_SECUENCIA);
    if (nuevo.status !== undefined && !["confirmed", "tentative", "cancelled"].includes(nuevo.status)) throw e400("invalid", "Invalid value for: status");
    if (antes.recurringEventId) {
      nuevo.recurringEventId = antes.recurringEventId;
      nuevo.originalStartTime = clonar(antes.originalStartTime);
    }
    if (!(nuevo.status === "cancelled" && (!nuevo.start || !nuevo.end))) validarTiempos(c, nuevo);
    validarRecurrencia(c, nuevo);
    if (g.dividida && interruptores.untilIgnoradoTrasDivision && !igual(antes.recurrence, nuevo.recurrence)) {
      if (antes.recurrence) nuevo.recurrence = clonar(antes.recurrence);
      else delete nuevo.recurrence;
    }
    const tiempoCambio = !igual(antes.start, nuevo.start) || !igual(antes.end, nuevo.end) || !igual(antes.recurrence, nuevo.recurrence);
    if (b.sequence === undefined || b.sequence === null) nuevo.sequence = (antes.sequence ?? 0) + (tiempoCambio && !antes.recurringEventId ? 1 : 0);
    g.r = ordenar(nuevo);
    cambio(c, g);
    if (nueva) c.eventos.set(g.r.id, g);
    if (!antes.recurringEventId) {
      if (antes.status !== "cancelled" && g.r.status === "cancelled") cancelarExcepciones(c, g);
      else despuesDeCambiarPrincipal(c, g, antes, tiempoCambio);
    }
    return g.r;
  }
  function cancelarExcepciones(c: Calendario, m: Guardado) {
    for (const e of excepcionesDe(c, m.r.id)) {
      if (e.conPrincipal) continue;
      e.previo = e.r.status;
      e.conPrincipal = true;
      e.r.status = "cancelled";
      cambio(c, e);
    }
  }
  function despuesDeCambiarPrincipal(c: Calendario, g: Guardado, antes: Json, tiempoCambio: boolean) {
    if (interruptores.propagarTituloAExcepciones && !igual(antes.summary, g.r.summary)) {
      for (const e of excepcionesDe(c, g.r.id)) {
        if (e.r.status === "cancelled" || !igual(e.r.summary, antes.summary)) continue;
        if (g.r.summary === undefined) delete e.r.summary;
        else e.r.summary = g.r.summary;
        cambio(c, e);
      }
    }
    if (tiempoCambio && interruptores.cambioReglaExcepciones === "borrar") {
      if (!esPrincipal(g)) for (const e of excepcionesDe(c, g.r.id)) c.eventos.delete(e.r.id);
      else {
        const s = serieDe(c, g);
        const exc = excepcionesDe(c, g.r.id);
        const tope = Math.max(...exc.map((e) => inicioMs(e.r.originalStartTime)), s.inicio.orden);
        const validas = new Set(ocurrencias(s, tope, interruptores, 400_000).map((o) => o.clave));
        for (const e of exc) if (!validas.has(claveOriginal(s, e.r.originalStartTime) ?? "")) c.eventos.delete(e.r.id);
      }
    }
    postRecurrencia(c, g);
  }

  // ── delete
  function eliminar(c: Calendario, id: string, ifMatch: string | null) {
    const res = resolver(c, id);
    if (!res) throw errNoEncontrado();
    if (res.tipo === "virtual") {
      if (res.excluida) throw errBorrado();
      if (ifMatch !== null && interruptores.instanciaIfMatch !== "ignora") {
        if (interruptores.instanciaIfMatch === "412") throw errCondicion();
        if (ifMatch !== "*" && ifMatch !== res.m.r.etag) throw errCondicion();
      }
      const g = materializar(c, res.m, res.oc);
      g.r.status = "cancelled";
      cambio(c, g);
      c.eventos.set(g.r.id, g);
      return;
    }
    const g = res.g;
    if (ifMatch !== null && ifMatch !== "*" && ifMatch !== g.r.etag) throw errCondicion();
    if (g.r.status === "cancelled") throw errBorrado();
    g.r.status = "cancelled";
    cambio(c, g);
    if (!g.r.recurringEventId) cancelarExcepciones(c, g);
  }

  // ── Vista para la respuesta: dateTime con el desfase de la zona pedida y detalles según el rol
  function vista(r: Json, zonaResp: string, rol: Rol): Json {
    const x = clonar(r);
    for (const k of ["start", "end", "originalStartTime"]) if (x[k]?.dateTime) x[k] = { ...x[k], dateTime: formatear(Date.parse(x[k].dateTime), zonaResp) };
    if (rol === "freeBusyReader") return limpio({ kind: x.kind, etag: x.etag, id: x.id, status: x.status, start: x.start, end: x.end });
    if ((rol === "reader" || rol === "writerWithoutPrivateAccess") && (x.visibility === "private" || x.visibility === "confidential")) {
      const p: Json = {};
      for (const k of CAMPOS_PRIVADO) if (x[k] !== undefined) p[k] = x[k];
      return p;
    }
    return x;
  }

  // ── Listados con páginas
  function tamanoPagina(ins: Instantanea): number {
    const modo = paginacion.modo;
    if (Array.isArray(modo)) {
      ins.cola ??= [...modo];
      const n = ins.cola.shift();
      return n === undefined ? ins.max : Math.min(Math.max(0, Math.floor(n)), ins.max);
    }
    if (modo === "azar") {
      if (ins.vacias < 2 && azar() < paginacion.probVacia) {
        ins.vacias++;
        return 0;
      }
      ins.vacias = 0;
      return 1 + Math.floor(azar() * ins.max);
    }
    return ins.max;
  }
  function paginar(consulta: string, pageToken: string | null, armar: () => Omit<Instantanea, "consulta" | "creada" | "vacias">): Json {
    let ins: Instantanea;
    let pos: number;
    if (pageToken !== null) {
      const p = paginas.get(pageToken);
      if (!p || p.ins.creada < paginasValidasDesde || Date.now() - p.ins.creada > paginacion.vencimientoMs || (paginacion.exigirMismaConsulta && p.ins.consulta !== consulta)) {
        throw e400("invalid", "Invalid Value", { locationType: "parameter", location: "pageToken" });
      }
      ins = p.ins;
      pos = p.pos;
    } else {
      ins = { ...armar(), consulta, creada: Date.now(), vacias: 0 };
      pos = 0;
    }
    const n = tamanoPagina(ins);
    const r: Json = clonar(ins.cabecera);
    const fin = Math.min(pos + n, ins.items.length);
    if (fin < ins.items.length) {
      const t = "CiAKGjBpNDd2Nmp2Zml" + idAzar(20);
      if (paginas.size >= 600) for (const k of [...paginas.keys()].slice(0, 100)) paginas.delete(k); // las más viejas
      paginas.set(t, { ins, pos: fin });
      r.nextPageToken = t;
    } else Object.assign(r, clonar(ins.fin));
    r.items = ins.items.slice(pos, fin);
    return r;
  }
  const consultaSin = (q: URLSearchParams, ...fuera: string[]) =>
    [...q.entries()].filter(([k]) => !fuera.includes(k)).map(([k, v]) => `${k}=${v}`).sort().join("&");
  const tokenSync = (c: Calendario, m: number, tipo: "e" | "a") => "CP" + Buffer.from(JSON.stringify({ c: c.id, m, t: tipo })).toString("base64url");
  function leerSync(c: Calendario, s: string, tipo: "e" | "a"): number {
    let d: Json = null;
    try {
      d = JSON.parse(Buffer.from(s.slice(2), "base64url").toString("utf8"));
    } catch {
      d = null;
    }
    if (!s.startsWith("CP") || !esObjeto(d) || d.c !== c.id || d.t !== tipo || typeof d.m !== "number") throw e400("invalid", "Invalid sync token value.", { locationType: "parameter", location: "syncToken" });
    if (d.m < (tipo === "e" ? c.syncMin : c.aclSyncMin)) throw new ErrorApi(410, ERRORES.fullSyncRequired().cuerpo);
    return d.m;
  }
  const bool = (q: URLSearchParams, k: string): boolean => {
    const v = q.get(k);
    if (v === null) return false;
    if (v === "true") return true;
    if (v === "false") return false;
    throw errParametro(k, v);
  };
  function maxResultados(q: URLSearchParams, porOmision: number, tope: number): number {
    const v = q.get("maxResults");
    if (v === null) return porOmision;
    if (!/^-?\d+$/.test(v) || Number(v) < 1) throw errParametro("maxResults", v);
    return Math.min(Number(v), tope);
  }
  function limiteTiempo(q: URLSearchParams, k: string): number | undefined {
    const v = q.get(k);
    if (v === null) return undefined;
    const ms = leerFechaHora(v, null);
    if (typeof ms !== "number") throw e400("badRequest", `Bad Request`, { locationType: "parameter", location: k });
    return ms;
  }
  function zonaRespuesta(c: Calendario, q: URLSearchParams): string {
    const z = q.get("timeZone");
    if (z === null) return c.zona;
    if (!zonaValida(z)) throw e400("invalid", "Invalid time zone definition.", { locationType: "parameter", location: "timeZone" });
    return z;
  }
  function quizasFantasma(c: Calendario) {
    if (!interruptores.fantasmasAlLeer || azar() >= interruptores.probFantasma) return;
    const ms = [...c.eventos.values()].filter((g) => esPrincipal(g) && g.r.status !== "cancelled" && (g.r.eventType ?? "default") === "default");
    if (!ms.length) return;
    const m = ms[Math.floor(azar() * ms.length)];
    const s = serieDe(c, m);
    const libres = ocurrencias(s, s.inicio.orden + 3 * 365 * 86_400_000, interruptores, 60)
      .slice(0, 30)
      .filter((o) => !o.excluida && !excepcionEn(c, m, o.clave));
    if (!libres.length) return;
    const g = materializar(c, m, libres[Math.floor(azar() * libres.length)]);
    g.fantasma = true;
    cambio(c, g);
    c.eventos.set(g.r.id, g);
  }

  function listarEventos(c: Calendario, rol: Rol, q: URLSearchParams): Json {
    const zona = zonaRespuesta(c, q);
    const syncToken = q.get("syncToken");
    let singleEvents = bool(q, "singleEvents");
    const showDeleted = bool(q, "showDeleted");
    const max = maxResultados(q, 250, 2500);
    const timeMin = limiteTiempo(q, "timeMin");
    const timeMax = limiteTiempo(q, "timeMax");
    const updatedMin = limiteTiempo(q, "updatedMin");
    const orderBy = q.get("orderBy");
    if (syncToken !== null) {
      for (const k of ["iCalUID", "orderBy", "privateExtendedProperty", "q", "sharedExtendedProperty", "timeMin", "timeMax", "updatedMin"]) {
        if (q.has(k)) throw e400("invalid", "Sync token cannot be used with other request restrictions.", { locationType: "parameter", location: k });
      }
    }
    if (timeMin !== undefined && timeMax !== undefined && timeMax <= timeMin) throw errRango("timeMax");
    if (orderBy !== null && orderBy !== "startTime" && orderBy !== "updated") throw errParametro("orderBy", orderBy);
    if (rol === "freeBusyReader") singleEvents = true;
    if (orderBy === "startTime" && !singleEvents) throw e400("badRequest", "The requested ordering is not available for the particular query.", { locationType: "parameter", location: "orderBy" });
    const pageToken = q.get("pageToken");
    return paginar(consultaSin(q, "pageToken", "fields"), pageToken, () => {
      quizasFantasma(c);
      let crudos: Json[] = [];
      if (syncToken !== null) {
        const desde = leerSync(c, syncToken, "e");
        crudos = [...c.eventos.values()].filter((g) => g.mod > desde).map((g) => g.r);
      } else {
        const conBorrados = (g: Guardado) => showDeleted || (updatedMin !== undefined && Date.parse(g.r.updated) >= updatedMin);
        for (const g of c.eventos.values()) {
          if (g.r.recurringEventId) {
            // Sin principal en este calendario (p. ej. invitación a una sola instancia de una serie ajena):
            // se lista como cualquier pieza. Con principal, sale con él (singleEvents) o al lado.
            const m = c.eventos.get(g.r.recurringEventId);
            if (singleEvents && m) continue;
            if (singleEvents && g.r.status === "cancelled" && !conBorrados(g)) continue;
            if ((g.conPrincipal || (m && m.r.status === "cancelled")) && !conBorrados(g)) continue;
            crudos.push(g.r);
          } else if (singleEvents && esPrincipal(g)) {
            if (g.r.status === "cancelled") {
              if (conBorrados(g)) crudos.push(g.r);
              continue;
            }
            crudos.push(...instanciasDe(c, g, { desde: timeMin, hasta: timeMax, showDeleted }));
          } else {
            if (g.r.status === "cancelled" && !conBorrados(g)) continue;
            crudos.push(g.r);
          }
        }
        const iCalUID = q.get("iCalUID");
        const texto = q.get("q")?.toLowerCase() ?? null;
        const tipos = q.getAll("eventTypes");
        const priv = q.getAll("privateExtendedProperty");
        const comp = q.getAll("sharedExtendedProperty");
        crudos = crudos.filter((r) => {
          if (iCalUID !== null && r.iCalUID !== iCalUID) return false;
          if (tipos.length && !tipos.includes(r.eventType ?? "default")) return false;
          if (updatedMin !== undefined && !(Date.parse(r.updated) >= updatedMin)) return false;
          for (const [lista, cual] of [[priv, "private"], [comp, "shared"]] as const) {
            for (const p of lista) {
              const j = p.indexOf("=");
              if (r.extendedProperties?.[cual]?.[p.slice(0, j)] !== p.slice(j + 1)) return false;
            }
          }
          if (texto !== null) {
            const donde = [r.summary, r.description, r.location, r.organizer?.email, r.organizer?.displayName, ...(r.attendees ?? []).flatMap((a: Json) => [a.email, a.displayName])];
            if (!donde.some((x) => typeof x === "string" && x.toLowerCase().includes(texto))) return false;
          }
          if (!singleEvents && (timeMin !== undefined || timeMax !== undefined)) {
            const ini = inicioMs(r.start ?? r.originalStartTime);
            let fin = r.end ? inicioMs(r.end) : ini;
            if (!r.recurringEventId && Array.isArray(r.recurrence) && r.recurrence.length) {
              const g = c.eventos.get(r.id)!;
              const s = serieDe(c, g);
              const finita = s.rrules.every((x) => x.hasta || x.recur.count);
              fin = finita ? Math.max(fin, ...ocurrencias(s, 8.64e15, interruptores, 20_000).map((o) => o.orden + (s.diaCompleto ? s.durDias * 86_400_000 : s.durMs))) : Infinity;
            }
            if (timeMax !== undefined && !(ini < timeMax)) return false;
            if (timeMin !== undefined && !(fin > timeMin)) return false;
          }
          return true;
        });
      }
      if (orderBy === "updated") crudos.sort((a, b) => Date.parse(a.updated) - Date.parse(b.updated));
      if (orderBy === "startTime") crudos.sort((a, b) => inicioMs(a.start) - inicioMs(b.start));
      return {
        items: crudos.map((r) => vista(r, zona, rol)),
        max,
        cabecera: limpio({
          kind: "calendar#events",
          etag: `"p${c.mod}0${c.aclMod}"`,
          summary: c.resumen,
          description: c.descripcion || undefined,
          updated: isoUTC(c.actualizado),
          timeZone: c.zona,
          accessRole: rol,
          defaultReminders: [],
        }),
        fin: { nextSyncToken: tokenSync(c, c.mod, "e") },
      };
    });
  }

  function listarInstancias(c: Calendario, rol: Rol, id: string, q: URLSearchParams): Json {
    const zona = zonaRespuesta(c, q);
    const showDeleted = bool(q, "showDeleted");
    const max = maxResultados(q, 250, 2500);
    const timeMin = limiteTiempo(q, "timeMin");
    const timeMax = limiteTiempo(q, "timeMax");
    const os = q.get("originalStart");
    const g = c.eventos.get(id);
    if (!g) throw errNoEncontrado();
    if (g.r.status === "cancelled") throw errBorrado();
    let original: string | null = null;
    if (os !== null) {
      if (!esPrincipal(g)) original = null;
      else {
        const s = serieDe(c, g);
        const f = leerFecha(os);
        const ms = f ? null : leerFechaHora(os, null);
        if (!f && typeof ms !== "number") throw errParametro("originalStart", os);
        original = s.diaCompleto ? (f ?? fechaDeMs(relojDe(enZona(s.zona, ms as number)))) : f ? "-" : String(ms);
      }
    }
    return paginar(consultaSin(q, "pageToken", "fields"), q.get("pageToken"), () => ({
      items: (esPrincipal(g) ? instanciasDe(c, g, { desde: timeMin, hasta: timeMax, inclusivo: true, showDeleted, originalStart: original }) : []).map((r) => vista(r, zona, rol)),
      max,
      cabecera: { kind: "calendar#events", etag: `"p${c.mod}"`, summary: c.resumen, updated: isoUTC(c.actualizado), timeZone: c.zona, accessRole: rol, defaultReminders: [] },
      fin: {},
    }));
  }

  // ── ACL
  const errAclSinOwner = () =>
    interruptores.motivoAclSinOwner === "forbidden"
      ? fallo(403, "global", "forbidden", "Forbidden")
      : fallo(403, "calendar", "requiredAccessLevel", "You need to have owner access to this calendar.");
  function exigirLecturaAcl(rol: Rol) {
    if (rol === "owner") return;
    if (rol === "writer" && !interruptores.aclLecturaSoloOwner) return;
    throw errAclSinOwner();
  }
  const vistaRegla = (rr: ReglaG) => clonar(rr.r);
  function validarRegla(cuerpo: Json, existente: Json | null): { scope: Json; role: Rol } {
    if (!esObjeto(cuerpo)) throw e400("parseError", "Parse Error");
    const role = cuerpo.role ?? existente?.role;
    if (!ROLES.includes(role)) throw e400("invalid", "Invalid role.", { locationType: "other", location: "role" });
    const scope = cuerpo.scope ?? existente?.scope;
    if (!esObjeto(scope) || !["default", "user", "group", "domain"].includes(scope.type)) throw e400("invalid", "Invalid scope type.", { locationType: "other", location: "scope.type" });
    if (scope.type !== "default") {
      const v = String(scope.value ?? "");
      if (scope.type === "domain" ? !/^[^\s@]+\.[^\s@]+$/.test(v) : !/^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(v)) throw e400("invalid", "Invalid scope value.", { locationType: "other", location: "scope.value" });
    }
    if (existente && idRegla(scope) !== existente.id) throw e400("invalid", "The scope of an ACL rule cannot be changed.");
    return { scope, role };
  }
  function protegerRegla(c: Calendario, ruleId: string, correo: string) {
    if (ruleId === `user:${c.dueno.toLowerCase()}`) throw fallo(403, "calendar", "cannotChangeOwnerAcl", "Cannot change the access level of the calendar's data owner.");
    if (ruleId === `user:${correo.toLowerCase()}`) throw fallo(403, "calendar", "cannotChangeOwnAcl", "Cannot change your own access level.");
  }
  function notificar(c: Calendario, metodo: Notificacion["metodo"], rr: Json, q: URLSearchParams) {
    if (rr.scope.type !== "user" && rr.scope.type !== "group") return;
    notificaciones.push({ metodo, calId: c.id, regla: rr.id, correo: rr.scope.value, rol: rr.role, enviada: q.get("sendNotifications") !== "false" });
  }
  function listarAcl(c: Calendario, q: URLSearchParams): Json {
    const syncToken = q.get("syncToken");
    const showDeleted = bool(q, "showDeleted") || syncToken !== null;
    const max = maxResultados(q, 100, 250);
    return paginar(consultaSin(q, "pageToken", "fields"), q.get("pageToken"), () => {
      const desde = syncToken !== null ? leerSync(c, syncToken, "a") : -1;
      const items = [...c.acl.values()].filter((rr) => rr.mod > desde && (showDeleted || rr.r.role !== "none")).map(vistaRegla);
      return { items, max, cabecera: { kind: "calendar#acl", etag: `"a${c.aclMod}"` }, fin: { nextSyncToken: tokenSync(c, c.aclMod, "a") } };
    });
  }
  const reglaViva = (c: Calendario, ruleId: string) => {
    const rr = c.acl.get(/^(user|group|domain):/i.test(ruleId) ? ruleId.toLowerCase() : ruleId);
    if (!rr || rr.r.role === "none") throw errNoEncontrado();
    return rr;
  };

  // ── Pedido → respuesta (aplica el cambio)
  function reconocer(metodo: string, segs: string[]): { tipo: string; calId: string | null; eventoId: string | null; reglaId: string | null } {
    const nada = { tipo: "?", calId: null, eventoId: null, reglaId: null };
    if (segs[0] !== "calendars" || segs.length < 2) return nada;
    const calId = segs[1];
    const base = { calId, eventoId: null, reglaId: null };
    if (segs.length === 2) return metodo === "GET" ? { ...base, tipo: "calendars.get" } : { ...nada, calId };
    if (segs[2] === "events") {
      if (segs.length === 3) return { ...base, tipo: metodo === "GET" ? "events.list" : metodo === "POST" ? "events.insert" : "?" };
      const eventoId = segs[3];
      if (segs.length === 4) {
        if (metodo === "POST" && ["import", "quickAdd", "watch"].includes(eventoId)) return { ...base, tipo: `events.${eventoId}` };
        const t = { GET: "events.get", PATCH: "events.patch", PUT: "events.update", DELETE: "events.delete" }[metodo];
        return { ...base, eventoId, tipo: t ?? "?" };
      }
      if (segs.length === 5 && segs[4] === "instances" && metodo === "GET") return { ...base, eventoId, tipo: "events.instances" };
      if (segs.length === 5 && segs[4] === "move") return { ...base, eventoId, tipo: "events.move" };
      return { ...nada, calId };
    }
    if (segs[2] === "acl") {
      if (segs.length === 3) return { ...base, tipo: metodo === "GET" ? "acl.list" : metodo === "POST" ? "acl.insert" : "?" };
      if (segs.length === 4) {
        const t = { GET: "acl.get", PATCH: "acl.patch", PUT: "acl.update", DELETE: "acl.delete" }[metodo];
        return { ...base, reglaId: segs[3], tipo: t ?? "?" };
      }
    }
    return { ...nada, calId };
  }

  function procesar(p: PedidoVisto, alcances: string[]): RespuestaCruda {
    if (p.tipo === "?") throw errNoEncontrado();
    const permitidos = ALCANCE_TIPO[p.tipo];
    if (!permitidos) throw fallo(501, "global", "notImplemented", `El simulador no implementa ${p.tipo}.`);
    if (!alcances.some((a) => permitidos.includes(a))) throw new ErrorApi(403, ERRORES.insufficientPermissions().cuerpo);
    const raiz = RAIZ_TIPO[p.tipo];
    const fields = p.query.get("fields");
    const mascara = raiz && fields ? leerMascara(fields, raiz) : null;
    const c = p.calId ? calendarios.get(p.calId) : undefined;
    const correo = p.correo!;
    const rol = c ? rolEn(c, correo) : "none";
    if (!c || rol === "none") throw errNoEncontrado();
    const ifMatchCab = p.cabeceras["if-match"];
    const ifMatch = typeof ifMatchCab === "string" ? ifMatchCab.trim() : null;
    let cuerpo: Json;
    let status = 200;
    switch (p.tipo) {
      case "calendars.get":
        cuerpo = { kind: "calendar#calendar", etag: `"c${c.mod}"`, id: c.id, summary: c.resumen, ...(c.descripcion ? { description: c.descripcion } : {}), timeZone: c.zona, conferenceProperties: { allowedConferenceSolutionTypes: ["hangoutsMeet"] }, ...(rol === "owner" ? { dataOwner: c.dueno } : {}) };
        break;
      case "events.list":
        cuerpo = listarEventos(c, rol, p.query);
        break;
      case "events.instances":
        cuerpo = listarInstancias(c, rol, p.eventoId!, p.query);
        break;
      case "events.get": {
        const res = resolver(c, p.eventoId!);
        if (!res) throw errNoEncontrado();
        const r =
          res.tipo === "guardado"
            ? res.g.r
            : res.excluida
              ? limpio({ kind: "calendar#event", etag: res.m.r.etag, id: idInstancia(res.m.r.id, horasDe(c, res.m, res.oc).originalStartTime), status: "cancelled", recurringEventId: res.m.r.id, originalStartTime: horasDe(c, res.m, res.oc).originalStartTime })
              : virtual(c, res.m, res.oc);
        cuerpo = vista(r, zonaRespuesta(c, p.query), rol);
        break;
      }
      case "events.insert":
        exigirEscritura(rol);
        cuerpo = vista(insertar(c, p.cuerpo, correo), c.zona, rol);
        contadores.escrituras++;
        break;
      case "events.patch":
      case "events.update":
        exigirEscritura(rol);
        cuerpo = vista(cambiar(c, p.eventoId!, p.cuerpo, ifMatch, p.tipo === "events.update"), c.zona, rol);
        contadores.escrituras++;
        break;
      case "events.delete":
        exigirEscritura(rol);
        eliminar(c, p.eventoId!, ifMatch);
        contadores.escrituras++;
        status = 204;
        break;
      case "acl.list":
        exigirLecturaAcl(rol);
        cuerpo = listarAcl(c, p.query);
        break;
      case "acl.get":
        exigirLecturaAcl(rol);
        cuerpo = vistaRegla(reglaViva(c, p.reglaId!));
        break;
      case "acl.insert": {
        if (rol !== "owner") throw errAclSinOwner();
        const { scope, role } = validarRegla(p.cuerpo, null);
        const id = idRegla(scope);
        const ya = c.acl.get(id);
        if (ya && ya.r.role !== "none") {
          if (interruptores.aclInsertExistente === "409") throw errDuplicado();
          protegerRegla(c, id, correo);
        }
        const rr = ponerRegla(c, scope, role);
        notificar(c, "insert", rr.r, p.query);
        contadores.escriturasAcl++;
        cuerpo = vistaRegla(rr);
        break;
      }
      case "acl.patch":
      case "acl.update": {
        if (rol !== "owner") throw errAclSinOwner();
        const rr = reglaViva(c, p.reglaId!);
        protegerRegla(c, rr.r.id, correo);
        const cuerpoR = p.tipo === "acl.update" ? p.cuerpo : esObjeto(p.cuerpo) ? fusionar(rr.r, p.cuerpo) : p.cuerpo;
        const { role } = validarRegla(cuerpoR, rr.r);
        const nuevo = ponerRegla(c, rr.r.scope, role);
        notificar(c, p.tipo === "acl.update" ? "update" : "patch", nuevo.r, p.query);
        contadores.escriturasAcl++;
        cuerpo = vistaRegla(nuevo);
        break;
      }
      case "acl.delete": {
        if (rol !== "owner") throw errAclSinOwner();
        const rr = reglaViva(c, p.reglaId!);
        protegerRegla(c, rr.r.id, correo);
        ponerRegla(c, rr.r.scope, "none");
        contadores.escriturasAcl++;
        status = 204;
        break;
      }
      default:
        throw errNoEncontrado();
    }
    if (status === 204) return { status };
    const proyectado = mascara ? proyectar(cuerpo, mascara) : cuerpo;
    const cab: Record<string, string> = {};
    if (typeof cuerpo?.etag === "string" && !p.tipo.endsWith(".list") && p.tipo !== "events.instances") cab.etag = cuerpo.etag;
    return { status, cuerpo: proyectado, cabeceras: cab };
  }

  // ── Autenticación
  function quien(auth: string | undefined): { correo: string; alcances: string[] } | "falta" | "invalido" {
    if (!auth) return "falta";
    if (!/^Bearer\s+\S/i.test(auth)) return "invalido";
    const t = auth.replace(/^Bearer\s+/i, "").trim();
    const d = directos.get(t);
    if (d) return d;
    const info = token.verificar(auth);
    return info ? { correo: info.correo, alcances: info.alcances } : "invalido";
  }

  // ── HTTP
  function enviar(req: IncomingMessage, res: ServerResponse, r: RespuestaCruda) {
    if (res.destroyed || res.writableEnded) return;
    const h: Record<string, string> = { date: new Date().toUTCString(), vary: "Origin, X-Origin, Referer", server: "ESF", "cache-control": "private, max-age=0", ...(r.cabeceras ?? {}) };
    if (r.status === 204 || r.cuerpo === undefined) {
      res.writeHead(r.status, h);
      res.end();
      return;
    }
    let datos: Buffer = Buffer.from(typeof r.cuerpo === "string" ? r.cuerpo : JSON.stringify(r.cuerpo, null, 1));
    h["content-type"] ??= "application/json; charset=UTF-8";
    if (gzip && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) {
      datos = gzipSync(datos);
      h["content-encoding"] = "gzip";
    }
    h["content-length"] = String(datos.length);
    res.writeHead(r.status, h);
    res.end(datos);
  }
  const esperar = (ms: number, res: ServerResponse) =>
    new Promise<boolean>((ok) => {
      if (ms <= 0) return ok(!res.destroyed);
      const t = setTimeout(() => ok(!res.destroyed), ms);
      res.once("close", () => {
        clearTimeout(t);
        ok(false);
      });
    });

  let nPedido = 0;
  async function atender(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const texto = await leerCuerpo(req);
    if (url.pathname === rutaToken) {
      contadores.token++;
      if (await token.atender(req, res, texto)) return;
    }
    const PREFIJO = "/calendar/v3/";
    const crudo = (req.url ?? "/").split("?")[0];
    if (!crudo.startsWith(PREFIJO)) return enviar(req, res, { status: 404, cuerpo: errNoEncontrado().cuerpo });
    contadores.api++;
    const metodo = (req.method ?? "GET").toUpperCase();
    let segs: string[];
    try {
      segs = crudo.slice(PREFIJO.length).split("/").filter((x, i, a) => x !== "" || i < a.length - 1).map((x) => decodeURIComponent(x));
    } catch {
      segs = ["?"];
    }
    const rec = reconocer(metodo, segs);
    let cuerpo: Json = null;
    let cuerpoMalo = false;
    if (texto.trim()) {
      try {
        cuerpo = JSON.parse(texto);
      } catch {
        cuerpoMalo = true;
      }
    }
    const yo = quien(typeof req.headers.authorization === "string" ? req.headers.authorization : undefined);
    const p: PedidoVisto = {
      n: ++nPedido,
      metodo,
      tipo: rec.tipo,
      ruta: segs.join("/"),
      calId: rec.calId,
      eventoId: rec.eventoId,
      reglaId: rec.reglaId,
      query: url.searchParams,
      cuerpo,
      cabeceras: req.headers,
      correo: typeof yo === "object" ? yo.correo : null,
    };
    contadores.porTipo[p.tipo] = (contadores.porTipo[p.tipo] ?? 0) + 1;
    const anotar = (status: number, inyectada: boolean) => {
      contadores.status[status] = (contadores.status[status] ?? 0) + 1;
      registro.push({ n: p.n, metodo, tipo: p.tipo, ruta: p.ruta, query: url.search, status, inyectada });
    };
    const ejecutar = (): RespuestaCruda => {
      if (yo === "falta") return ERRORES.required();
      if (yo === "invalido") return ERRORES.authError();
      if (cuerpoMalo) return { status: 400, cuerpo: e400("parseError", "Parse Error").cuerpo };
      const antesEsc = contadores.escrituras;
      try {
        return procesar(p, yo.alcances);
      } catch (e) {
        contadores.escrituras = antesEsc;
        if (e instanceof ErrorApi) return { status: e.status, cuerpo: e.cuerpo };
        return { status: 500, cuerpo: cuerpoError(500, "global", "backendError", `Backend Error (simulador: ${(e as Error)?.stack ?? e})`) };
      }
    };

    if (sim.latenciaMs > 0 && !(await esperar(sim.latenciaMs, res))) return anotar(0, false);
    const iny = inyecciones.find((x) => x.veces > 0 && x.predicado(p));
    if (iny) {
      iny.veces--;
      iny.disparos++;
      contadores.inyectadas++;
      const r = iny.respuesta;
      if ("cortar" in r) {
        anotar(0, true);
        req.socket.destroy();
        return;
      }
      if ("demora" in r) {
        if (!(await esperar(r.demora, res))) return anotar(0, true);
        if (r.luego) {
          anotar(r.luego.status, true);
          return enviar(req, res, r.luego);
        }
      } else if ("aplicarYLuego" in r) {
        ejecutar();
        if (r.aplicarYLuego === "cortar") {
          anotar(0, true);
          req.socket.destroy();
          return;
        }
        anotar(r.aplicarYLuego.status, true);
        return enviar(req, res, r.aplicarYLuego);
      } else {
        anotar(r.status, true);
        return enviar(req, res, r);
      }
    }
    const r = ejecutar();
    anotar(r.status, false);
    enviar(req, res, r);
  }

  // ── Actores
  function hacerActor(nombre: "web" | "iPhone" | "invitación" | "cumpleaños", calId?: string): Actor {
    const c = calId ? calOError(calId) : [...calendarios.values()][0];
    if (!c) throw new Error("simulador: no hay calendarios");
    const web = nombre === "web";
    const iphone = nombre === "iPhone";
    const html = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>");
    const ajustar = (cambios: Json): Json => {
      const x = clonar(cambios ?? {});
      if (web && typeof x.description === "string") x.description = html(x.description);
      return x;
    };
    const perderExt = (g: Guardado) => {
      if (iphone && !interruptores.extendedPropsSeConservan) delete g.r.extendedProperties;
    };
    const vivo = (id: string): Guardado => {
      const g = c.eventos.get(id);
      if (!g) throw new Error(`actor ${nombre}: no existe ${id}`);
      return g;
    };
    const ocDe = (m: Guardado, dia: string): Oc => {
      const s = serieDe(c, m);
      const f = leerFecha(dia);
      const lista = ocurrencias(s, f ? msFecha(f) + 3 * 86_400_000 : Date.parse(dia) + 86_400_000, interruptores, 400_000);
      const oc = f ? lista.find((o) => fechaLocalDe(s, o) === f) : lista.find((o) => o.orden === Date.parse(dia) || o.clave === leerFecha(dia.slice(0, 10)));
      if (!oc) throw new Error(`actor ${nombre}: ${dia} no es un día de la serie ${m.r.id}`);
      return oc;
    };
    const guardarNuevo = (r: Json): Json => {
      validarTiempos(c, r);
      validarRecurrencia(c, r);
      const t = marca();
      const completo = ordenar({
        kind: "calendar#event",
        etag: nuevoEtag(),
        status: "confirmed",
        htmlLink: `https://www.google.com/calendar/event?eid=${Buffer.from(`${r.id} ${c.id}`).toString("base64url")}`,
        created: isoUTC(t),
        updated: isoUTC(t),
        creator: { email: c.dueno },
        organizer: { email: c.id, displayName: c.resumen, self: true },
        iCalUID: `${r.id}@google.com`,
        sequence: 0,
        reminders: { useDefault: true },
        eventType: "default",
        ...r,
      });
      const g: Guardado = { r: completo, mod: ++c.mod };
      c.actualizado = t;
      c.eventos.set(completo.id, g);
      return clonar(completo);
    };
    const editarGuardado = (g: Guardado, cambios: Json) => {
      const antes = g.r;
      const nuevo = fusionar(antes, ajustar(cambios));
      if (!(nuevo.status === "cancelled" && (!nuevo.start || !nuevo.end))) validarTiempos(c, nuevo);
      validarRecurrencia(c, nuevo);
      const tiempo = !igual(antes.start, nuevo.start) || !igual(antes.end, nuevo.end) || !igual(antes.recurrence, nuevo.recurrence);
      if (tiempo) nuevo.sequence = (antes.sequence ?? 0) + 1;
      g.r = ordenar(nuevo);
      perderExt(g);
      cambio(c, g);
      if (!antes.recurringEventId && esPrincipal(g)) despuesDeCambiarPrincipal(c, g, antes, tiempo);
      return clonar(g.r);
    };
    const dia = (idSerie: string, d: string, cambios: Json): Json => {
      const m = vivo(idSerie);
      const oc = ocDe(m, d);
      const g = materializar(c, m, oc);
      const nueva = !c.eventos.has(g.r.id);
      const nuevo = fusionar(g.r, ajustar(cambios));
      if (!(nuevo.status === "cancelled" && (!nuevo.start || !nuevo.end))) validarTiempos(c, nuevo);
      g.r = ordenar(nuevo);
      if (iphone && !interruptores.extendedPropsSeConservan) {
        delete g.r.extendedProperties;
        delete m.r.extendedProperties;
        cambio(c, m);
      }
      cambio(c, g);
      if (nueva) c.eventos.set(g.r.id, g);
      return clonar(g.r);
    };
    const actor: Actor = {
      crear(datos: Json, organizador = "otra.persona@gmail.com") {
        const r: Json = { ...ajustar(datos), id: datos.id ?? idAzar() };
        delete r.fecha;
        if (nombre === "cumpleaños") {
          const f = leerFecha(datos.fecha ?? datos.start?.date);
          if (!f) throw new Error("cumpleaños: falta fecha");
          return guardarNuevo({
            id: r.id,
            summary: datos.summary ?? "Cumpleaños",
            start: { date: f },
            end: { date: sumarDias(f, 1) },
            recurrence: ["RRULE:FREQ=YEARLY"],
            eventType: "birthday",
            birthdayProperties: { type: "birthday", contact: "people/c1234567890" },
            visibility: "private",
            transparency: "transparent",
          });
        }
        if (iphone) r.iCalUID = datos.iCalUID ?? randomUUID().toUpperCase();
        if (nombre === "invitación") {
          r.organizer = { email: organizador, self: false };
          r.creator = { email: organizador };
          r.attendees = datos.attendees ?? [
            { email: organizador, organizer: true, responseStatus: "accepted" },
            { email: c.id, self: true, responseStatus: "needsAction" },
          ];
          r.iCalUID = datos.iCalUID ?? `${idAzar()}@google.com`;
        }
        return guardarNuevo(r);
      },
      editar: (id, cambios) => editarGuardado(vivo(id), cambios),
      editarTitulo: (id, titulo) => editarGuardado(vivo(id), { summary: titulo }),
      borrar(id) {
        const g = vivo(id);
        if (g.r.status === "cancelled") return;
        g.r.status = "cancelled";
        cambio(c, g);
        if (!g.r.recurringEventId) cancelarExcepciones(c, g);
      },
      borrarDia(idSerie, d) {
        if (!iphone) return dia(idSerie, d, { status: "cancelled" });
        const m = vivo(idSerie);
        const s = serieDe(c, m);
        const oc = ocDe(m, d);
        const z = zonaValida(m.r.start.timeZone) ? m.r.start.timeZone : "America/Santiago";
        let valor: string;
        let cab: string;
        if (s.diaCompleto) {
          valor = oc.fecha!.replace(/-/g, "");
          cab = "EXDATE;VALUE=DATE:";
        } else {
          const p = enZona(z, oc.ms!);
          valor = `${cuatro(p.y)}${dos(p.m)}${dos(p.d)}T${dos(p.h)}${dos(p.mi)}${dos(p.s)}`;
          cab = `EXDATE;TZID=${z}:`;
        }
        const lineas = [...(m.r.recurrence as string[])];
        const i = lineas.findIndex((l) => l.startsWith(cab));
        if (i >= 0) lineas[i] = cab + [...new Set([...lineas[i].slice(cab.length).split(","), valor])].sort().join(",");
        else lineas.push(cab + valor);
        const e = excepcionEn(c, m, oc.clave);
        if (e && e.r.status !== "cancelled") {
          e.r.status = "cancelled";
          cambio(c, e);
        }
        return editarGuardado(m, { recurrence: lineas });
      },
      moverDia: (idSerie, d, start, end) => dia(idSerie, d, { start, end }),
      editarDia: (idSerie, d, cambios) => dia(idSerie, d, cambios),
      esteYLosSiguientes(idSerie, d, cambios = {}) {
        const m = vivo(idSerie);
        const s = serieDe(c, m);
        const oc = ocDe(m, d);
        const antes = ocurrencias(s, oc.orden - 1, interruptores, 400_000).filter((o) => !o.excluida);
        if (!antes.length) return editarGuardado(m, cambios);
        const z = s.zona;
        let until: string;
        let sufijo: string;
        if (s.diaCompleto) {
          until = sumarDias(oc.fecha!, -1).replace(/-/g, "");
          sufijo = oc.fecha!.replace(/-/g, "");
        } else {
          const p = enZona(z, oc.ms!);
          const ayer = new Date(Date.UTC(p.y, p.m - 1, p.d) - 86_400_000);
          until = basicoUTC(instanteEn(z, ayer.getUTCFullYear(), ayer.getUTCMonth() + 1, ayer.getUTCDate(), 23, 59, 59));
          sufijo = basicoUTC(oc.ms!).slice(0, -1);
        }
        const nuevoId = `${idSerie}_R${sufijo}`;
        const cuantasAntes = ocurrencias(s, oc.orden - 1, interruptores, 400_000).length;
        const original = (m.r.recurrence as string[]).map((l) => {
          const x = partirLinea(l);
          if (x?.nombre !== "RRULE") return l;
          return "RRULE:" + [...x.valor.split(";").filter((pp) => !/^(UNTIL|COUNT)=/i.test(pp)), `UNTIL=${until}`].join(";");
        });
        const siguiente = (m.r.recurrence as string[]).map((l) => {
          const x = partirLinea(l);
          if (x?.nombre !== "RRULE") return l;
          return "RRULE:" + x.valor.split(";").map((pp) => (/^COUNT=/i.test(pp) ? `COUNT=${Math.max(1, Number(pp.slice(6)) - cuantasAntes)}` : pp)).join(";");
        });
        const h = horasDe(c, m, oc);
        const nuevo = clonar(m.r);
        Object.assign(nuevo, { id: nuevoId, iCalUID: `${nuevoId}@google.com`, start: h.start, end: h.end, recurrence: siguiente });
        for (const k of ["etag", "created", "updated", "htmlLink", "sequence"]) delete nuevo[k];
        const creado = guardarNuevo(fusionar(nuevo, ajustar(cambios)));
        for (const e of excepcionesDe(c, idSerie)) {
          const k = claveOriginal(s, e.r.originalStartTime);
          if (k === null || ocDeClave(s, k).orden < oc.orden) continue;
          c.eventos.delete(e.r.id);
          e.r.id = `${nuevoId}${e.r.id.slice(idSerie.length)}`;
          e.r.recurringEventId = nuevoId;
          cambio(c, e);
          c.eventos.set(e.r.id, e);
        }
        m.dividida = true;
        editarGuardado(m, { recurrence: original });
        return clonar(c.eventos.get(creado.id)!.r);
      },
      restaurar(id) {
        const g = vivo(id);
        if (g.r.status !== "cancelled") return clonar(g.r);
        g.r.status = "confirmed";
        cambio(c, g);
        for (const e of excepcionesDe(c, id)) {
          if (!e.conPrincipal) continue;
          e.r.status = e.previo ?? "confirmed";
          e.conPrincipal = false;
          cambio(c, e);
        }
        return clonar(g.r);
      },
      obtener: (id) => clonar(c.eventos.get(id)?.r ?? null),
    };
    return actor;
  }

  // ── Objeto público
  let server: Server;
  const sim: Simulador = {
    url: "",
    apiUrl: "",
    tokenUrl: "",
    token,
    interruptores,
    paginacion,
    reloj,
    contadores,
    registro,
    notificaciones,
    latenciaMs: 0,
    agregarCuenta: (correo, clave) => void cuentas.set(correo, clave),
    tokenPara(correo, alcances = [A + "calendar"]) {
      const t = `ya29.directo-${idAzar(24)}`;
      directos.set(t, { correo, alcances });
      return t;
    },
    revocarTokens() {
      directos.clear();
      token.revocar();
    },
    crearCalendario(calId, op = {}) {
      const zona = op.zona ?? "America/Santiago";
      if (!zonaValida(zona)) throw new Error(`zona inválida: ${zona}`);
      const c: Calendario = {
        id: calId,
        resumen: op.resumen ?? "Familia",
        zona,
        descripcion: op.descripcion ?? "",
        dueno: (op.dueno ?? "dueno@gmail.com").toLowerCase(),
        eventos: new Map(),
        acl: new Map(),
        mod: 1,
        aclMod: 0,
        actualizado: marca(),
        syncMin: 0,
        aclSyncMin: 0,
      };
      calendarios.set(calId, c);
      ponerRegla(c, { type: "user", value: c.dueno }, "owner");
    },
    compartir: (calId, correo, rol) => void ponerRegla(calOError(calId), { type: "user", value: correo }, rol),
    quitar: (calId, correo) => void ponerRegla(calOError(calId), { type: "user", value: correo }, "none"),
    rolDe: (calId, correo) => rolEn(calOError(calId), correo),
    eventos(calId, op = {}) {
      return [...calOError(calId).eventos.values()].filter((g) => op.lapidas !== false || g.r.status !== "cancelled").map((g) => clonar(g.r));
    },
    evento: (calId, id) => clonar(calOError(calId).eventos.get(id)?.r ?? null),
    poner(calId, recurso) {
      const c = calOError(calId);
      const t = marca();
      const r = ordenar({
        kind: "calendar#event",
        status: "confirmed",
        created: isoUTC(t),
        iCalUID: `${recurso.id}@google.com`,
        organizer: { email: c.id, self: true },
        sequence: 0,
        eventType: "default",
        ...clonar(recurso),
        etag: recurso.etag ?? nuevoEtag(),
        updated: recurso.updated ?? isoUTC(t),
      });
      c.eventos.set(r.id, { r, mod: ++c.mod });
      return clonar(r);
    },
    instancias(calId, id, desdeMs, hastaMs) {
      const c = calOError(calId);
      const g = c.eventos.get(id);
      if (!g || !esPrincipal(g)) return [];
      return clonar(instanciasDe(c, g, { desde: desdeMs, hasta: hastaMs, inclusivo: true }));
    },
    acl: (calId) => [...calOError(calId).acl.values()].map((rr) => clonar(rr.r)),
    actor: hacerActor,
    inyectar(predicado, respuesta, veces = 1) {
      const x = { predicado, respuesta, veces, disparos: 0 };
      inyecciones.push(x);
      return {
        quitar() {
          const i = inyecciones.indexOf(x);
          if (i >= 0) inyecciones.splice(i, 1);
        },
        get disparos() {
          return x.disparos;
        },
      };
    },
    limpiarInyecciones: () => void (inyecciones.length = 0),
    vencerPaginas: () => void (paginasValidasDesde = Date.now() + 1),
    invalidarSync(calId) {
      const c = calOError(calId);
      c.syncMin = c.mod + 1;
      c.aclSyncMin = c.aclMod + 1;
    },
    reiniciarContadores() {
      contadores.api = 0;
      contadores.token = 0;
      contadores.porTipo = {};
      contadores.escrituras = 0;
      contadores.escriturasAcl = 0;
      contadores.inyectadas = 0;
      contadores.status = {};
      registro.length = 0;
    },
    azar: () => azar(),
    cerrar: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };

  server = createServer((req, res) => {
    atender(req, res).catch((e) => {
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(500, { "content-type": "application/json; charset=UTF-8" });
        res.end(JSON.stringify(cuerpoError(500, "global", "backendError", `simulador: ${(e as Error)?.stack ?? e}`)));
      }
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  const a = server.address();
  const puerto = typeof a === "object" && a ? a.port : 0;
  sim.url = `http://127.0.0.1:${puerto}/`;
  sim.apiUrl = `${sim.url}calendar/v3/`;
  sim.tokenUrl = `${sim.url}${rutaToken.replace(/^\//, "")}`;
  return sim;
}

// Errores de insert que se lanzan (instancias de ErrorApi).
const ERRORES_API = {
  forbiddenForServiceAccounts: () => new ErrorApi(403, ERRORES.forbiddenForServiceAccounts().cuerpo),
};
