// Utilidades de fecha en zona America/Santiago, semana de lunes a domingo, 24 h.
// Se trabaja con fechas "AAAA-MM-DD" y aritmética en UTC para evitar líos con el cambio de hora.

export const ZONA = "America/Santiago";

const fmtPartes = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export interface Ahora {
  fecha: string; // AAAA-MM-DD
  hora: string; // HH:mm
  segundos: number;
  minutosDelDia: number;
}

export function ahoraEnSantiago(d: Date = new Date()): Ahora {
  const p: Record<string, string> = {};
  for (const x of fmtPartes.formatToParts(d)) p[x.type] = x.value;
  const hh = p.hour === "24" ? "00" : p.hour;
  return {
    fecha: `${p.year}-${p.month}-${p.day}`,
    hora: `${hh}:${p.minute}`,
    segundos: Number(p.second),
    minutosDelDia: Number(hh) * 60 + Number(p.minute),
  };
}

export const hoy = () => ahoraEnSantiago().fecha;

function aUTC(f: string): Date {
  const [a, m, d] = f.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

function deUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function sumarDias(f: string, n: number): string {
  const d = aUTC(f);
  d.setUTCDate(d.getUTCDate() + n);
  return deUTC(d);
}

/** Último día (28–31) del mes de la fecha. */
export function ultimoDiaDelMes(f: string): number {
  const [a, m] = f.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

export function sumarMeses(f: string, n: number): string {
  const d = aUTC(f);
  const dia = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  d.setUTCDate(Math.min(dia, ultimoDiaDelMes(deUTC(d))));
  return deUTC(d);
}

/** 0 = lunes … 6 = domingo */
export function diaSemana(f: string): number {
  return (aUTC(f).getUTCDay() + 6) % 7;
}

export function lunesDe(f: string): string {
  return sumarDias(f, -diaSemana(f));
}

export function diasDeSemana(lunes: string): string[] {
  return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
}

export function diferenciaDias(a: string, b: string): number {
  return Math.round((aUTC(b).getTime() - aUTC(a).getTime()) / 86400000);
}

export function primeroDelMes(f: string): string {
  return f.slice(0, 8) + "01";
}

/** Grilla del mes: 6 semanas desde el lunes anterior al día 1. */
export function grillaMes(f: string): string[] {
  const inicio = lunesDe(primeroDelMes(f));
  return Array.from({ length: 42 }, (_, i) => sumarDias(inicio, i));
}

export const DIAS_CORTOS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
export const DIAS_LARGOS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
export const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export function partes(f: string) {
  const [a, m, d] = f.split("-").map(Number);
  return { anio: a, mes: m, dia: d };
}

/** "lunes 2 de noviembre" */
export function fechaLarga(f: string, conAnio = false): string {
  const { anio, mes, dia } = partes(f);
  const txt = `${DIAS_LARGOS[diaSemana(f)].toLowerCase()} ${dia} de ${MESES[mes - 1]}`;
  return conAnio ? `${txt} de ${anio}` : txt;
}

/** "02-11-2026" (formato chileno) */
export function fechaCorta(f: string): string {
  const { anio, mes, dia } = partes(f);
  return `${String(dia).padStart(2, "0")}-${String(mes).padStart(2, "0")}-${anio}`;
}

export function mesAnio(f: string): string {
  const { anio, mes } = partes(f);
  return `${MESES[mes - 1][0].toUpperCase()}${MESES[mes - 1].slice(1)} ${anio}`;
}

/** "2 – 8 de noviembre" */
export function rangoSemana(lunes: string): string {
  const dom = sumarDias(lunes, 6);
  const a = partes(lunes);
  const b = partes(dom);
  if (a.mes === b.mes) return `${a.dia} – ${b.dia} de ${MESES[b.mes - 1]}`;
  return `${a.dia} de ${MESES[a.mes - 1]} – ${b.dia} de ${MESES[b.mes - 1]}`;
}

/** Rango corto: "2–8 nov" o "30 nov–6 dic". */
export function semanaCorta(lunes: string): string {
  const a = partes(lunes);
  const b = partes(sumarDias(lunes, 6));
  const mes = (n: number) => MESES[n - 1].slice(0, 3);
  return a.mes === b.mes ? `${a.dia}–${b.dia} ${mes(b.mes)}` : `${a.dia} ${mes(a.mes)}–${b.dia} ${mes(b.mes)}`;
}

export function horaAMinutos(h: string): number {
  const [hh, mm] = h.split(":").map(Number);
  return hh * 60 + mm;
}
