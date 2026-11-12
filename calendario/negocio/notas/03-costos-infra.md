# Costos de operar (consultado 12 nov 2026). Tipo de cambio: USD 1 = CLP 981 (open.er-api.com, 12-nov-2026); EUR 1 ≈ CLP 1.090.

## Netlify (HECHO)
- Planes: Free USD 0 / 300 créditos; Personal USD 9 / 1.000; Pro USD 20 / 3.000; Enterprise a medida. https://www.netlify.com/pricing/
- Tarifas: cómputo 10 créditos/GB-hora (Functions, Scheduled, Background); web requests 2 créditos/10.000; ancho de banda 20 créditos/GB; deploy de producción 15 créditos; IA 180 créditos/USD. Edge Functions no cuentan como cómputo, sólo como web requests. Al acabarse los créditos se PAUSAN todos los sitios ("Site not available"); Free no puede comprar más; recarga Personal 500 créditos/USD 5, Pro 1.500/USD 10 (≈ USD 0,0067/crédito). https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/ (actualizada 12-ago-2026)
- Memoria por omisión 1.024 MB; scheduled 30 s; síncronas 60 s; background 15 min. https://docs.netlify.com/build/functions/usage-and-billing/

## Estimación propia por familia/mes con la arquitectura actual (supuestos: 30 días, 1 GB, duración facturada ≈ latencia medida)
- Sincronización programada: 8.640 corridas × 0,86 s = 2,06 GB-h -> ~21 créditos.
- Pared sondeando 24/7 cada 20 s: 129.600 pedidos × 0,18 s = 6,5 GB-h -> ~65 créditos + 129.600 web requests -> ~26 créditos.
- Teléfonos (2 × 30 min/día) + resto de la API + ancho de banda: ~10 créditos.
- TOTAL ≈ 120 créditos ≈ USD 0,80 ≈ CLP 790 por familia/mes. Pro (3.000 créditos) ≈ 25 familias; 1.000 familias ≈ 120.000 créditos ≈ USD 800/mes ≈ CLP 785.000/mes.
- Con /api/cambios en Edge Function (sólo web requests) y sondeo cada 60 s en la pared: ≈ 21 + 9 + 10 ≈ 40 créditos ≈ USD 0,27 ≈ CLP 260/familia/mes.
- Riesgo: la función programada tiene 30 s para TODAS las familias; con más de un puñado hay que repartir en colas/background.

## Cloudflare (HECHO) https://developers.cloudflare.com/workers/platform/pricing/ (actualizada 2-oct-2026)
- Workers Paid USD 5/mes: 10 M requests + 30 M ms CPU; luego USD 0,30/M requests y USD 0,02/M ms CPU. Assets estáticos gratis e ilimitados.
- Durable Objects: 1 M requests incluidos (+USD 0,15/M), 400.000 GB-s (+USD 12,50/M GB-s); objetos en hibernación con WebSocket no pagan duración; mensajes WebSocket salientes gratis.
- D1: 25.000 M filas leídas, 50 M escritas, 5 GB incluidos. R2: USD 0,015/GB-mes, egreso gratis.
- Estimación propia: 1.000 familias con sondeo equivalente ≈ 140 M requests -> ≈ USD 39 + CPU ≈ USD 5-10 + base 5 ≈ USD 50-60/mes ≈ USD 0,05-0,06/familia (CLP ~50). Con WebSocket en Durable Objects (empuje en vez de sondeo) aún menos. Costo: reescribir servidor/comun.ts (Blobs) y las funciones a Workers.

## Vercel (HECHO) https://vercel.com/pricing
- Hobby "para uso personal, no comercial" -> no sirve para vender. Pro USD 20/mes con USD 20 de crédito; invocaciones USD 0,60/M; CPU activa USD 0,128/h; memoria USD 0,0106/GB-h; 10 M requests CDN incluidos y luego USD 2/M.

## Supabase (HECHO) https://supabase.com/pricing
- Free: pausa tras 1 semana sin actividad, 2 proyectos. Pro desde USD 25/mes: 100.000 MAU, 8 GB, Realtime 500 conexiones y 5 M mensajes incluidos (+USD 10/1.000 conexiones, USD 2,50/M mensajes), 2 M invocaciones de Edge Functions.
- La familia descartó Supabase (PLAN.md). Para escalar es opción válida si se quiere base relacional + auth + realtime.

## Gemini (HECHO) https://aistudio.google.com/docs/pricing (consultada 12-nov-2026)
- gemini-3.8-flash: entrada USD 0,75/M tokens (hasta 31-dic-2026; USD 1,50 desde 1-ene-2027); salida USD 3,75/M (USD 7,50 desde 2027).
- gemini-3.5-flash-lite: entrada USD 0,30/M; salida USD 2,50/M.
- Plan gratis: "Content used to improve our products"; pagado: "not used".
- Estimación propia por receta dictada de 5 min (≈ 9.600 tokens de audio, README: ≈1.900/min) + ~2.000 de salida: 3.8 Flash ≈ USD 0,015 (2026) / 0,03 (2027) ≈ CLP 15-30; Flash-Lite ≈ USD 0,008 ≈ CLP 8.

## Clima (HECHO) https://open-meteo.com/en/pricing
- API gratis de Open-Meteo: sólo uso NO comercial (10.000 llamadas/día). Planes comerciales Standard (1 M/mes), Professional (5 M), Enterprise: precio no publicado en la página. El panel usa api.open-meteo.com (lib/hooks.ts) -> hay que contratar o cambiar de fuente antes de vender, y cachear por ciudad.
