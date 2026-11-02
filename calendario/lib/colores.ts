// Colores de las personas: pasteles (como Skylight), pensados para rellenos suaves con texto oscuro.

export const COLORES_MIEMBRO = [
  "#F4A27E", // coral
  "#7FD1AE", // menta
  "#F5C26B", // amarillo
  "#B79CF2", // lavanda
  "#F59AB5", // rosa
  "#8FB2F5", // celeste
  "#B2D47E", // pistacho
  "#D9B48F", // arena
];

/** Paleta anterior (más saturada) → su pastel equivalente, para los integrantes ya guardados. */
const ANTERIORES = ["#E76F51", "#2A9D8F", "#E9B03B", "#7C6CF2", "#E86A92", "#3D8BD9", "#5FAE4E", "#9C6B4E"];

export function colorPastel(color: string): string {
  const i = ANTERIORES.indexOf(color.toUpperCase());
  return i >= 0 ? COLORES_MIEMBRO[i] : color;
}
