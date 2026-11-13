import type { Metadata, Viewport } from "next";
import { Fredoka, Nunito } from "next/font/google";
import "./globals.css";
import { ZOOM_SOLO_CELULAR } from "@/lib/pantalla";

const texto = Nunito({ subsets: ["latin"], variable: "--fuente-texto", display: "swap" });
// Títulos y reloj en una letra redondeada y amable (estilo Skylight).
const titulo = Fredoka({ subsets: ["latin"], variable: "--fuente-titulo", display: "swap" });

export const metadata: Metadata = {
  title: "Calendario familiar",
  description: "Calendario, menú de la semana, recetas, compras y tareas de la casa.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Familia", statusBarStyle: "black-translucent" },
  icons: { icon: "/icono.svg", apple: "/icono-180.png" },
  robots: { index: false, follow: false },
};

/**
 * Sin zoom con dos dedos: es lo que quiere la pared y el tablet. En el celular el guion ZOOM_SOLO_CELULAR
 * (lib/pantalla.ts) quita maximum-scale y user-scalable antes de pintar, y ahí sí se puede acercar.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#f6f5fb",
};

/**
 * Pone el tema (claro / noche) antes de pintar nada, para que la recarga nocturna no
 * destelle en claro. Repite la regla de `esDeNoche` (lib/hooks.ts) con los ajustes guardados.
 */
const TEMA_INICIAL = `(function(){try{
var a={};try{a=JSON.parse(localStorage.getItem("calendario-familiar:v1:ajustes")||"{}")||{}}catch(e){}
var t=a.tema||"auto",d=a.nocheDesde||"20:30",h=a.nocheHasta||"07:00";
var o={};new Intl.DateTimeFormat("en-GB",{timeZone:"America/Santiago",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()).forEach(function(x){o[x.type]=x.value});
var m=(+o.hour%24)*60+(+o.minute);function n(s){var q=String(s).split(":");return +q[0]*60+ +q[1]}var D=n(d),H=n(h);
var noche=t==="noche"||(t==="auto"&&(D>H?(m>=D||m<H):(m>=D&&m<H)));
document.documentElement.dataset.tema=noche?"noche":"claro";
if(noche){var mt=document.querySelector('meta[name="theme-color"]');if(mt)mt.setAttribute("content","#13121b")}
}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CL" data-tema="claro" className={`${texto.variable} ${titulo.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEMA_INICIAL + ZOOM_SOLO_CELULAR }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
