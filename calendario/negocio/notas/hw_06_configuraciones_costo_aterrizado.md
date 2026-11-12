# HW-06 Configuraciones propuestas y costo unitario aterrizado en Chile (12-nov-2026)
Cálculo reproducible: /tmp/claude-0/-home-user-Recetario-familiar/94bcc22e-699d-51c3-b4ee-57a1ad5cd0ee/scratchpad/calc/configs.py (salida en raw_calc_configs.txt)
TC USD = CLP 980. Precios retail con IVA (oferta más baja SoloTodo 12-nov-2026). "Neto" = recuperando IVA como crédito fiscal (empresa con inicio de actividades).
Ítems marcados ESTIM son estimación propia.

## Accesorios (datos)
- Cargador Samsung 25W USB-C (con sello SEC, vendido por Samsung Electronics Chile en Falabella): $18.990. https://www.falabella.com/falabella-cl/product/131958624/Samsung-Travel-Adapter-25W-White/131958625 (snippet, sin fecha) -> media.
- Tab A11+ NO trae adaptador ("NO se incluye el adaptador de viaje", Samsung Chile). https://www.samsung.com/cl/tablets/galaxy-tab-a/galaxy-tab-a11-plus-gray-128gb-sm-x230nzaacho/
- Cable USB-C 3 m Hoco "certificado": $4.990 (normal $7.990), Paris. https://www.paris.cl/cable-usb-tipo-c-hoco-3-metros-certificado-carga-rapida-MKTR7MQDMC.html
- Soportes: iTodos universal pared $33.990 (Lider); Elago P2 atril aluminio $46.990 (Lider); IKEA MÖJLIGHET soporte tablet $7.990 (IKEA Chile, leído); Nillkin FlexWing Pro magnético 11-13" US$35,99; Xvida magnético US$25. https://www.ikea.com/cl/es/p/moejlighet-soporte-tablet-audifonos-negro-00434277 ; https://www.lider.cl/ip/audifonos-y-accesorios/soporte-de-pared-itodos-universal-para-tableta-y-telefono/00074987769207 ; https://www.nillkin.com/products/flexwing-pro-magnetic-tablet-stand
- Marco de madera / impresión 3D a medida: SIN dato de mercado -> ESTIM CLP 10-25 mil por unidad en series cortas.
- Batería: tablet enchufada 24/7 puede hincharse (casos reportados en comunidades SmartThings/openHAB). Samsung trae "Proteger batería" (tope 85% / 80% según versión). https://community.smartthings.com/t/do-you-leave-your-smart-home-tablet-plugged-in-24-7/246866 ; https://us.community.samsung.com/t5/Tablets/Device-care-battery-warning/m-p/2556241 -> criterio de compra: exigir límite de carga.

## Resultados (CLP por unidad)
| Config | Equipo | Pagado c/IVA | Neto |
|---|---|---|---|
| A Económica | Xiaomi Redmi Pad 2 11" 4/128 ($159.990) + cargador SEC + cable 3 m + soporte genérico + Fully Kiosk + caja + config + reserva 3% + envío | 230.570 | 195.321 |
| B Estándar | Samsung Galaxy Tab A11+ 11" 6/128 ($199.990) + cargador + cable + soporte de calidad con marco + Fully + ... | 292.770 | 247.782 |
| B' Estándar 12" | TCL Tab A1 Plus 12,2" 2.4K 120Hz ($199.990) mismo kit | 292.770 | 247.782 |
| C1 Premium retail | TCL NxtPaper 14 14,3" mate 8/256 ($329.990) + kit reforzado | 433.670 | 366.808 |
| C2 Premium importado | Panel 15,6" Android 11 UTouch/WOGO US$230 (tramo 100-499), LCL, Form F 0%, agente, Subtel ESTIM, adaptador SEC local, reserva 5% | 340.827 | 291.295 |
| C2 sin Form F | idem + arancel 6% | 354.714 | 305.182 |
| C3 importado barato | calendario 15,6" de fábrica ~US$110 (dato NO verificado) | 194.284 | 167.207 |
| C3 con sólo 10 u aéreo | US$125 + US$20 flete/u, Subtel prorrateado en 10 u | 331.844 | 299.154 |
Capital para un lote de 100 u: C2 ~CLP 29 millones neto; C3 ~CLP 17 millones neto (+ IVA de importación que se adelanta y luego se recupera).

## Lectura
- Retail (A/B) no requiere importar, ni Subtel, ni SEC (salvo comprar cargador con sello), y tiene servicio técnico de marca en Chile. Margen de hardware delgado: con referencia de precio de góndola (calendario Anyuse 16" $278.990 en Lider; Echo Show 8 ~$215-220 mil) un kit A a $249.990-299.990 deja CLP ~15-57 mil neto por unidad.
- Importar 15,6" sólo conviene con lote >= 100 u y proveedor de ~US$100-130 FOB con Android 13+ y Google Play; a US$230 no es más barato que comprar retail un 14" de marca.
- Primer piloto recomendado: B (Samsung A11+) o A (Redmi Pad 2), compradas de a 5-10 unidades en Cyber/ofertas, con factura para recuperar IVA.
