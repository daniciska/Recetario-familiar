# HW-01 Tablets retail en Chile (consultado 12-nov-2026)
Fuente principal: API pública de SoloTodo (https://publicapi.solotodo.com, categoría 14 Tablets) y https://www.solotodo.cl/tablets
- SoloTodo usa ~CLP 984/USD (implícito: 159.990 / 162,61 USD).
- Precios = precio oferta más bajo vigente el 12-nov-2026 (puede ser con tarjeta de la tienda). Datos crudos: raw_solotodo/tablets_list.txt y avail.json

## Candidatas para pantalla de pared (precio oferta más bajo / tienda)
| Modelo | Pantalla | RAM/GB | Precio CLP | Tienda más barata (otras) |
|---|---|---|---|---|
| Samsung Galaxy Tab A11 (X133) | 8,7" | 4/64 | 114.990 | Tecnomas; Claro 119.990; Samsung.cl 139.990 -> muy chica para pared |
| Xiaomi Redmi Pad 2 9,7" | 9,7" | 4/128 | 129.990 | |
| Acer Iconia Tab M10 | 10,1" | 4/128 | 131.990 | |
| Xiaomi Redmi Pad 2 (11") | 11" 2.5K 90Hz | 4/128 | 159.990 | Ripley; Movistar 169.990; Paris 179.990; PC Factory 199.990 |
| TCL Tab A1 | 11" | 6/128 | 159.990 | |
| TCL Tab A1 Plus | 12,2" 2.4K 120Hz | 6/128 | 191.810-199.990 | MercadoLibre 199.810; Paris 199.990; Ripley 206.990; Falabella 209.990; Lider 219.990 |
| Samsung Galaxy Tab A11+ (X230) | 11" | 6/128 | 199.990 | Lider (normal 219.990); Claro 209.990; Samsung.cl 229.990; Falabella 229.990 |
| Lenovo Idea Tab (+lápiz y estuche) | 11" 2.5K 90Hz | 8/128 | 209.990 | Movistar; Paris/Ripley 249.990; Falabella 269.990 |
| Samsung Galaxy Tab A9+ (X210) | 11" | 4/64 | 213.990 | Falabella (modelo 2023, en salida; reemplazado por A11+) |
| Lenovo Tab Plus | 11,5" (parlantes JBL, atril integrado) | 8/256 | 249.990 | Falabella; ABC 269.990; PC Factory 281.290 |
| Xiaomi Redmi Pad 2 Pro | 12,1" | 6/128 | 289.990 | Ripley; Paris/Falabella 329.990 |
| Samsung Galaxy Tab S10 Lite | 10,9" | 6/128 | 299.990 | |
| TCL NxtPaper 14 | 14,3" | 8/256 | 328.990-329.990 | Paris; Falabella 339.990 |
| Honor Pad X9b Max | 13" | | 436.843 | |
| Samsung Galaxy Tab S10 FE+ | 13,1" | 8/128 | 489.990 | |
| Lenovo Tab (10,1" 2024, ZAEH0083CL) | 10,1" | 4/64 | 109.990 | ABC (normal 159.990) |
| Lenovo Tab M11 (4/128 con lápiz) | 11" | 4/128 | 99.990 (oferta Paris, normal 229.990) | snippet de búsqueda, sin fecha -> confianza baja; modelo 2024 en liquidación |

## Notas
- Redmi Pad SE ya no aparece en SoloTodo (reemplazada por Redmi Pad 2). Tab A9+ en salida (sólo Falabella), reemplazada por Tab A11+.
- Amazon Fire (Fire HD 10 / Max 11) NO aparece en SoloTodo: no se vende oficialmente en Chile; sólo importado (MercadoLibre/Lider marketplace "envío desde EE.UU."). Además Fire OS no trae Google Play (Fully Kiosk se instala por APK). -> No recomendable para reventa (garantía y repuestos).
- Pantallas de 13-15" de marca son caras (>CLP 330 mil). Lo más barato con 12"+ y buena pantalla: TCL Tab A1 Plus 12,2" (~CLP 192-200 mil) y Mlab Studio Suite Pro 12 (CLP 151.291, marca local de baja gama).
- Precio retail ≠ precio mayorista. Comprar 10-50 unidades a distribuidor (Samsung/Lenovo/Xiaomi tienen distribuidores B2B en Chile) podría bajar 5-15% (ESTIMACIÓN, no verificado). Factura con IVA: la empresa recupera el IVA crédito fiscal (19%) -> costo neto = precio/1,19.

## Amazon Fire en Chile (búsqueda 12-nov-2026)
- Fire HD 10 (2023, 32 GB) vendida por terceros en Paris.cl (Daletecno) a $169.990 (antes $189.990), garantía técnica 6 meses; Megatone "Producto Internacional" agotado. https://www.paris.cl/tablet-amazon-fire-hd-10-modelo-2023-32gb-lila-MKN0Q7NGVP.html (snippet, sin fecha).
- Más cara que Redmi Pad 2 11" ($159.990), sin Google Play, sin servicio oficial -> descartada.
