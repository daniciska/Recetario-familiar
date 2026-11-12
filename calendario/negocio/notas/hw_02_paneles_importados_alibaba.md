# HW-02 Paneles / tablets de pared genéricos (Alibaba / AliExpress / Made-in-China) — consultado 12-nov-2026
Tipo de cambio usado en todo el frente: USD 1 = CLP 980 (Emol: cierre 6-nov-2026 $977,70/978,00; 10-nov-2026 ~$985). https://www.emol.com/noticias/Economia/2026/11/10/1216673/dolar-se-dispara-inflacion-eeuu.html
EUR: no verificado hoy; uso EUR 1 = CLP 1.130 (ESTIMACIÓN, verificar).

## Datos encontrados (precios FOB/EXW de lista, sin flete ni impuestos)
- UTouch Tech Group (marca WOGO), 15,6" FHD capacitiva 10 pts, Android 11 "all-in-one", montaje pared: US$240 (1-99 u), US$230 (100-499), US$215 (>=500). MOQ 1. Lead time 3 días (1-5 u), 8 días (6-100 u). Proveedor 2 años en Alibaba. Fuente: https://www.alibaba.com/product-detail/_1601690900391.html (descargada 12-nov-2026) -> confianza ALTA para el dato de lista.
- Shenzhen Top-Willing 15,6" RK3566 2GB/16GB pared: US$146 (1-99) -> US$137,80 (300+). https://www.alibaba.com/product-detail/Black-White-Quad-Core-Wall-Mount_1600307362627.html (vía snippet de búsqueda; confianza media)
- Aiyos (Made-in-China) 15,6" RK3566 2/32GB: US$119 (pocas u) -> US$89 (1000+). https://aiyostech.en.made-in-china.com/product/OfgrZGUVXikM/ (snippet; media)
- Calendarios digitales 15,6" de fábrica (showroom Alibaba "electronics calendars"): Shenzhen Jintaiyi US$99-125 (3GB/32GB, Android 15); otro US$60-90 con MOQ 99 (4/32, Android 13). https://www.alibaba.com/showroom/electronics-calendars.html (snippet; la página hoy da 410) -> confianza BAJA-MEDIA.
- Calendario 15,6" con menú/quehaceres US$125,10-135,60; otro MOQ 5 a US$139-279 (snippet de búsqueda, sin URL directa) -> baja.
- 10,1" pared Android (electronics.alibaba.com/product/wall-mount-android-tablet, consultado 12-nov-2026):
  - PENPOS 10,1" RK3566 Android 11 PoE, LED: US$130,50-136,50, MOQ 1
  - Shenzhen Abeloe 10,1" RK3568 Android 11: US$107-110, MOQ 1 (snippet)
  - Allwinner 10,1" Android 10 PoE: US$99-118, MOQ 100 (snippet)
  - Aiyos 10,1"/15,6" PoE 2/32GB: US$95-159, MOQ 5
  - Hopestar 14"/15,6" PoE Android 10: US$109-113, MOQ 2
- AliExpress: no se pudo leer (exige login). Retail de referencia de calendarios 15,6" genéricos fuera de Chile: Tabwee P15 164 EUR (PcComponentes, España); varios en EE.UU. US$130-320 (Walmart/Staples/Slickdeals). En Chile: "Calendario digital inteligente Anyuse 16''" en Lider.cl $278.990 (dato de otra nota del equipo, snippet).

## Advertencias técnicas (análisis propio)
- Muchos paneles genéricos (Rockchip RK3566/RK3568, Allwinner) traen Android 10-11 SIN Google Play certificado (sin GMS). La app es web (Next.js): necesita un WebView/Chrome moderno. Sin Play Store, el WebView no se actualiza solo -> riesgo de que la app se vea mal o falle en 1-2 años. Exigir al proveedor: Android 13+ con GMS o al menos WebView actualizable; probar muestra.
- Pantallas "1920x1080" de 15,6" (~141 ppi) se ven bien a distancia de pared; brillo típico 250-300 nits.
- Garantía del fabricante chino = devolución a China (impracticable). La vendedora asume la garantía legal de 6 meses en Chile -> hay que comprar ~3-5% de unidades de repuesto (ESTIMACIÓN).
- Para revender equipos Wi-Fi importados directamente hay que obtener certificado Subtel por modelo (ver hw_03). Cargador: sello SEC obligatorio (ver hw_03). Esto hace que importar genéricos tenga sentido sólo con volumen (>= 100 u) y un modelo fijo.
