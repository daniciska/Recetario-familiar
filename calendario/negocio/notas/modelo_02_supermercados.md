# Modelo-02 Lista de compras conectada a supermercados (notas crudas, 12-nov-2026)

## Jumbo / Santa Isabel (Cencosud) — HECHO VERIFICADO (probado con curl el 12-11-2026)
- https://jumbo.cl/llms.txt lista: OpenAPI 3.1 pública https://www.jumbo.cl/openapi.json y manifiesto https://www.jumbo.cl/.well-known/ai-plugin.json ("auth": none).
- Endpoints: POST /api/catalog (búsqueda por texto, categoría, marca, orden por precio), GET /api/search-suggestions, GET /api/popular-search, GET /api/cart/url?sku=..&qty=.. -> devuelve un enlace que AL VISITARLO agrega los productos al carro del usuario.
- Prueba: POST /api/catalog {"fullText":"porotos"} -> 200, "Porotos Blancos Banquete 1 kg" $4.320 con stock; GET /api/cart/url?sku=5872&qty=2 -> {"url":"https://www.jumbo.cl/?sku=5872&qty=2"}.
- Santa Isabel tiene el mismo openapi.json (https://www.santaisabel.cl/openapi.json, 200, 6.376 bytes).
- Términos de uso de la API para terceros comerciales: NO encontrados. No hay programa de afiliados de Jumbo visible (llms.txt no lo menciona). Jumbo Prime = membresía de clientes (despacho ilimitado, doble Puntos Cencosud).
- Jumbo tiene recetas propias (https://jumbo.cl/recetas: "al agregar los ingredientes al carro...").
=> Se puede hacer HOY "Enviar lista al carro de Jumbo/Santa Isabel" sin acuerdo (riesgo: cambien la API). Para cobrar comisión hay que negociar (retail media / alianza), no hay programa público.

## Líder (Walmart Chile)
- https://www.lider.cl/llms.txt (sin fecha): sin API pública; supermercado en super.lider.cl; Mi Club = fidelización (cashback ~1% según prensa). openapi.json -> 404.
- Sólo enlaces de búsqueda (deep link). Sin programa de afiliados encontrado.

## Unimarc (SMU) / Tottus (Falabella)
- unimarc.cl/llms.txt -> 403 (bloqueo de bots); tottus.cl -> 526. Sin API ni afiliados encontrados. Club Unimarc (fidelización, Chócale oct-2023). Falabella reemplazó CMR Puntos por Fpuntos (The Clinic 23-oct-2026).

## Mercado Libre — programa de afiliados (existe en Chile)
- Chócale 8-may-2025: lanzado en Chile (3er país tras Brasil y México); "hasta 24%" por venta; requisitos: >18 años, cuenta ML y MP, 10 mil seguidores sólo para pagos por visualizaciones; no linkear carritos/categorías generales; pago mínimo $4.500 (3 transacciones de 3 compradores distintos), a Mercado Pago en ≤30 días. https://chocale.cl/2025/05/mercado-libre-lanzamiento-programa-de-afiliados-en-chile/
- Página oficial https://www.mercadolibre.cl/l/afiliados: "Gana comisiones de hasta 8% por cada venta" (citado por buscador; WebFetch 403). Cifras difieren por fuente -> confianza media.
- Programa >200.000 afiliados entre BR/MX/CL (prensa). SII resolución 2025 sobre IVA de comisiones (https://www.sii.cl/normativa_legislacion/resoluciones/2025/reso135.pdf).
- Útil para: vender accesorios (soporte de pared, cargador) o despensa no perecible; poco útil para la compra semanal.

## Cornershop / Uber Eats / Rappi
- Cornershop dejó de existir como marca en oct-2023; pasó a Uber Eats (Chócale/The Clinic oct-2023). Uber One creció 40% (La Tercera, fecha no clara). Precio Uber One Chile: NO encontrado.
- Rappi Chile: sin programa de afiliados público encontrado. Tiene servicio B2B para empresas (DF) y Rappi Pro (membresía).
=> Ninguno ofrece API/afiliados públicos para "enviar lista" en Chile (no verificado a fondo).

## Lectura
- La lista de compras conectada es un buen GANCHO del plan pagado o incluso gratis (Jumbo/Santa Isabel en 1 clic), pero hoy no es una fuente de ingresos por comisiones: no hay programa de afiliados de supermercados en Chile. El ingreso vendría de una alianza comercial negociada (retail media de Cencosud/Walmart) cuando haya miles de pantallas.
