import type { Metadata, Viewport } from "next";
import { Fraunces, Nunito } from "next/font/google";
import "./globals.css";

const texto = Nunito({ subsets: ["latin"], variable: "--fuente-texto", display: "swap" });
const titulo = Fraunces({ subsets: ["latin"], variable: "--fuente-titulo", display: "swap" });

export const metadata: Metadata = {
  title: "Calendario familiar",
  description: "Calendario, menú de la semana, recetas, compras y tareas de la casa.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Familia", statusBarStyle: "black-translucent" },
  icons: { icon: "/icono.svg", apple: "/icono-180.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#fbf6ee",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CL" data-tema="claro" className={`${texto.variable} ${titulo.variable}`}>
      <body>{children}</body>
    </html>
  );
}
