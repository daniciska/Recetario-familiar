# HW-04 Modo kiosco, MDM y actualización remota (consultado 12-nov-2026)

## Fully Kiosk Browser (Fully Factory GmbH)
- Licencia PLUS: 8,90 EUR o 10,99 USD por equipo + impuestos, pago ÚNICO, vitalicia, ligada al ID del equipo (se puede mover a otro equipo). Volumen para 10+ equipos (comercial) con cotización. Incluye funciones PLUS (sin marca de agua) + Fully Cloud Basic gratis. https://www.fully-kiosk.com/docs/en/legal/fully-plus-license -> confianza alta.
  -> CLP ~10.800 por equipo (10,99 USD x 980). Más IVA si corresponde.
- Fully Cloud Advanced (push remoto de configuración, encender/apagar pantalla, reiniciar, instalar APK, programar acciones, acciones masivas, API): máx. 1,18 EUR/equipo/mes + IVA; 15% dcto pago anual; ~0,95 EUR/mes con 100 equipos anual. Basic (gratis con PLUS): ver equipos, grupos, crear configuraciones, aprovisionar. 1 mes de prueba gratis por equipo. https://www.fully-kiosk.com/docs/en/management/fully-cloud-emm
  -> CLP ~1.100-1.350/equipo/mes (ESTIMACIÓN con EUR=1.130).
- Funciones: pantalla completa, bloqueo de otras apps (Kiosk Mode), detección de movimiento (encender pantalla al acercarse), administración remota, inicio automático. https://www.fully-kiosk.com/docs/en/

## MDM comerciales (USD por equipo/mes)
| MDM | Plan más barato con kiosco | Precio | Mínimo | Fuente |
|---|---|---|---|---|
| Scalefusion | Essential (kiosco Android/iOS, Android Enterprise, instalación silenciosa) | US$2 (sólo anual, US$24/año) | 10 equipos | https://www.scalefusion.com/pricing |
| Hexnode | Pro (kiosco, gestión de apps) | US$2,20 (anual -10%) | "desde 15 equipos" | https://www.hexnode.com/mobile-device-management/pricing/ |
| Esper | Genesis (kiosco y multi-app) | US$2 | 25 equipos por contrato | https://www.esper.io/pricing |
| Samsung Knox Configure (sólo Samsung) | Dynamic Edition (kiosco, push) | US$12,50-25 por licencia (lista MSRP dic-2025; plazo no claro) | - | https://image-us.samsung.com/SamsungUS/business/solutions/industries/government/msrp-price-sheets/01152026/Samsung_Knox_MSRP_Price_File_(December_2025).pdf (snippet) confianza media |
| Knox Suite Essentials | | US$30/equipo/año (FitGap, terciario) | | https://us.fitgap.com/products/017929/samsung-knox-suite (baja) |
| Android Management API (Google) | gratis, pero sólo para desarrolladores EMM comerciales; cuota inicial 500 equipos con justificación | US$0 | | https://developers.google.com/android/management/permissible-usage |
-> Con 100 equipos: US$200-220/mes = CLP ~200-215 mil/mes sólo en MDM. Incompatible con "costo mensual 0" salvo que lo pague la suscripción.

## Lectura (análisis propio)
- La app es web (Next.js exportado en Netlify): la "actualización" ocurre en el servidor; la tablet sólo carga la URL. No hace falta MDM para empujar versiones nuevas: cada recarga trae la última versión (cuidar cache/service worker).
- Opción mínima ($0/mes): Fully Kiosk PLUS (pago único ~CLP 11 mil) configurado en taller con la URL de la familia, arranque automático, pantalla siempre encendida/horario nocturno, bloqueo de ajustes con PIN. Fully Cloud Basic sirve para inventario. Actualizar Android/Chrome/WebView lo hace Google Play solo (en tablets con GMS).
- Opción gratis sin licencia: "Fijar pantalla" (screen pinning) de Android + PWA instalada desde Chrome. Frágil: un niño la saca con 2 botones si no hay PIN; no reinicia sola.
- Soporte remoto: Fully Cloud Advanced sólo para clientes con suscripción (costo ~CLP 1.200/mes cubierto por la suscripción). Alternativa: ayuda por WhatsApp + videollamada.
- Riesgo: Fully Kiosk es software de un tercero (Alemania). Si deja de existir, la app web sigue funcionando en Chrome.
