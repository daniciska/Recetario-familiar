import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // La app vive entera en el navegador (datos en localStorage): se publica como archivos
  // estáticos en "out/", sin servidor. Netlify sólo los sirve.
  output: "export",
};

export default nextConfig;
