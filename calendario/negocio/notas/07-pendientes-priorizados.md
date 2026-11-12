# Lista de pendientes priorizada (estimación propia a partir de PLAN.md, README y el código; 12 nov 2026)

## A. Imprescindible para un piloto pagado (5-20 familias, ~2-3 meses)
1. Alta multi-familia: reemplazar "sólo la primera familia" (api-familia.mts, registro/primera) por códigos de activación por tablet; datos ya están separados por familia.
2. Cuenta del adulto responsable (correo con enlace mágico o "Iniciar sesión con Google"): recuperación si se pierde la tablet, facturación, derechos de datos. Hoy sólo hay tokens de equipo y PIN ("no es seguridad").
3. Google Calendar sin consola para el cliente: una cuenta de servicio DEL NEGOCIO para muchas familias (quitar CLAVE_DUENO_GOOGLE único; validar dueño por ACL) — el cliente sólo crea "Familia", lo comparte con un correo y pega el ID. iCloud fuera del piloto (contraseña de app = riesgo).
4. Gemini con clave del negocio en plan PAGADO (el gratis usa el contenido para mejorar productos), cupo por familia (p. ej. 10 dictados/mes), ≈ CLP 15-30 por receta.
5. Clima: Open-Meteo gratis es no comercial -> plan comercial o otra fuente, con caché por ciudad en el servidor.
6. Costos y límites: /api/cambios a Edge Function o sondeo más lento, función programada que reparta por familia (hoy 24 s para todas), alarmas de créditos (si se acaban, Netlify PAUSA el sitio de TODOS los clientes).
7. Textos de cliente final: sacar de la UI "Netlify", "GOOGLE_CUENTA_SERVICIO", "GEMINI_API_KEY", "aistudio" (CalendarioGoogle.tsx, CalendarioICloud.tsx, lib/dictados/textos.ts); asistente de primera configuración.
8. Legal mínimo: términos (suscripción opcional, cancelación por el mismo medio, garantía de la tablet), política de privacidad (datos de niños, voz de la abuela, encargados en EE.UU., IA), consentimiento del adulto, canal de derechos; boleta electrónica.
9. Cobro: Flow (o Mercado Pago) suscripciones + webhook que active/desactive los extras por familia; el plan gratis nunca se corta.
10. Tablets: Android + Fully Kiosk PLUS (pago único ~CLP 9.700) con arranque al encender; guion de preparación de cada equipo.
11. Soporte: panel de administración propio (familias, versión, última sincronización, errores), WhatsApp, respaldo automático diario.
12. Producto que el cliente notará (de PLAN.md): "cambiar sólo un día" de un evento repetido (pedido real); vista del celular (en curso); hacer visible "borrar sólo un día"; probar Google y el dictado con cuentas reales en iPhone; quitar en enero 2027 las protecciones de equipos viejos.

## B. Necesario para escalar (100+ familias)
1. OAuth de Google verificado (sensible, sin CASA; dominio + privacidad + video; ~10 días + marca), refresh token cifrado por familia, crear "Familia" con calendar.app.created si su categoría lo permite; push (watch) + syncToken en vez de sondeo cada 5 min.
2. Infraestructura más barata o reestructurada: Cloudflare Workers + Durable Objects (WebSocket con hibernación) ≈ USD 0,05/familia vs ≈ USD 0,27-0,80 en Netlify; o base relacional (Supabase/D1) para administración y métricas.
3. Planes y funciones por suscripción (flags), catálogo de recetas chilenas descargables (contenido con derechos, formato schema.org/Recipe), compartir recetas (enlace, PDF, importar entre familias).
4. Gestión remota de flota (Fully Cloud ~CLP 1.290/mes/equipo o Android Management API), publicaciones escalonadas, monitoreo de errores.
5. Cumplimiento Ley 21.719 completo (rige 1-dic-2026 salvo que se publique la postergación a 15-oct-2027): registro de tratamientos, contratos con encargados, procedimiento de brechas, plazos de respuesta, modelo de prevención voluntario.
6. Facturación electrónica automática y conciliación de pagos; recuperación de pagos fallidos.
7. Correo dedicado (Fase 3) con correo entrante bajo dominio propio en vez de IMAP por familia.
8. Limpieza de audios huérfanos y cuotas de almacenamiento por familia.

## C. Deseable
- Fotos en la pared / protector de pantalla (Fase 5); Web Push de quehaceres; Atajos de Siri.
- iCloud bidireccional sin contraseñas (app nativa con EventKit) u Outlook (verificación de editor Microsoft, gratis).
- Casos raros de Google ya documentados (fantasmas >40 rezagadas, notas con "<b>", regla G1, borrar serie con carrera de segundos).
- Exportar el calendario como ICS de sólo lectura (plan B gratis).
