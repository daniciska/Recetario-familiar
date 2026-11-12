# Modelo-01 Costos de operar por familia (notas crudas, 12-nov-2026)
Tipo de cambio usado: CLP 980/USD (Emol 6-nov-2026 cierre 977,70-978; 10-nov-2026 $985). https://www.emol.com/noticias/Economia/2026/11/10/1216673/dolar-se-dispara-inflacion-eeuu.html

## Netlify (credit-based) — HECHO VERIFICADO
- https://www.netlify.com/pricing/ (12-11-2026): Free 0 USD/300 créditos; Personal 9 USD/1.000; Pro 20 USD/3.000 (miembros ilimitados). Packs: Personal 500 cr = 5 USD (0,01/cr); Pro 1.500 cr = 10 USD (0,00667/cr).
- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/ (12-11-2026):
  compute 10 cr/GB-hora (serverless, scheduled y background); web requests 2 cr/10.000; ancho de banda 20 cr/GB; deploy producción 15 cr; AI Gateway 180 cr por USD; Blobs: no indicado en la página.
  Si se acaban los créditos: TODOS los sitios de la cuenta quedan en pausa ("Site not available"). Free = límite duro.
- Terceros (usagepricing.com, 14-jul-2026, NO verificado en oficial): Pro hasta 126 USD/20.000 créditos.

## Lo que hace la app hoy (leído del código, calendario/)
- lib/datos/repositorioNube.ts: cada equipo visible consulta /api/cambios cada 20 s (CADA = 20_000) y todo cada 30 min.
- netlify/functions/calendario-programado.mts: schedule "*/5 * * * *" (sincroniza Google/iCloud cada 5 min).
- Modelos Gemini por omisión: gemini-3.8-flash, 3.6-flash, 3.5-flash-lite, 3.1-flash-lite (servidor/gemini.ts).

## ESTIMACIÓN propia: consumo Netlify por familia (1 tablet siempre encendida + 2 celulares que abren la app a ratos)
- Tablet: 3 req/min x 60 x 24 x 30 = 129.600 pedidos/mes a /api/cambios -> 26 cr por requests.
  Compute: si cada invocación dura ~0,1 s con 1 GB -> 3,6 GB-h -> 36 cr. (duración/memoria reales NO medidas)
- Celulares: ~10% del tiempo visibles -> ~+13.000 req -> ~6 cr.
- Sincronización cada 5 min: 8.640 corridas/mes; si cuesta ~1-2 s por familia a 1 GB -> 2,4-4,8 GB-h -> 24-48 cr.
- Ancho de banda: bajo (respuestas JSON pequeñas, fotos aparte) -> ~0,1-0,3 GB -> 2-6 cr.
- TOTAL ~95-120 cr/familia/mes ≈ USD 0,63-0,80 (Pro) ≈ CLP 620-790/mes ≈ CLP 7.400-9.400/año por familia.
  => con plan Pro (3.000 cr) caben sólo ~25-30 familias; 1.000 familias ≈ 100.000-120.000 cr/mes ≈ USD 650-800/mes.
- Conclusión: con "0 mensual", el costo de nube debe salir del margen del hardware o bajar con arquitectura:
  intervalo de 60-120 s en la tablet + pedir sólo cuando hay cambios (push/WebSocket), sincronizar calendario cada 15 min o por aviso (Google push notifications), o mover la API a una plataforma con requests más baratas (ESTIMACIÓN: <USD 0,05-0,10/familia/mes es alcanzable; no verificado precio de alternativas en esta nota).

## Gemini API — HECHO VERIFICADO
- https://aistudio.google.com/docs/pricing (redirige desde ai.google.dev/gemini-api/docs/pricing; 12-11-2026):
  gemini-3.8-flash y 3.6-flash: entrada 0,75 USD/1M hasta 31-dic-2026; 1,50 desde 1-ene-2027. Salida 3,75 -> 7,50.
  gemini-3.5-flash-lite: entrada 0,30 (texto/imagen/video/audio); salida 2,50.
  gemini-2.5-flash: entrada texto 0,30, audio 1,00, salida 2,50 (desde 1-dic-2026 se enruta a 3.5-flash-lite).
  gemini-2.5-flash-lite: texto 0,10, audio 0,30, salida 0,40.
  Plan gratis: "Content used to improve our products" = Sí en todos esos modelos.
- README del proyecto: 1 minuto de audio ≈ 1.900 tokens.

## ESTIMACIÓN: costo por receta dictada (audio 5 min)
- Entrada: 5 x 1.900 = 9.500 + ~3.000 de instrucciones = 12.500 tokens. Salida (receta JSON + razonamiento) ~4.000 tokens.
- 3.8 Flash 2026: 12.500x0,75/1M + 4.000x3,75/1M = 0,0094 + 0,015 = USD 0,024 (CLP ~24).
- 3.8 Flash 2027: USD 0,049 (CLP ~48).
- 3.5 Flash-Lite: 0,00375 + 0,010 = USD 0,014 (CLP ~14).
- Audio de 15 min: ~USD 0,06-0,11 con 3.8 Flash 2027.
- Una familia que dicta 4 recetas/mes: USD 0,06-0,20/mes. => el dictado NO es un costo relevante; el plan gratis NO sirve para vender (privacidad: Google usa el contenido + revisores humanos; ley 21.719).

## Google Calendar API
- Gratis (cuotas por proyecto). Ver nota de cuotas si se verifica.
