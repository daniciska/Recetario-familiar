# Calendarios multi-familia: Google OAuth, iCloud, ICS, Outlook (consultado 12 nov 2026)

## Google Calendar con "Iniciar sesión con Google" (OAuth)
- HECHO: Google pone como ejemplo de alcance SENSIBLE "leer eventos guardados en Google Calendar"; los alcances sensibles se revisan antes de que cualquier cuenta pueda dar acceso.
  https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification (©2026, consultada 12-nov-2026)
- HECHO: requisitos de verificación sensible: verificación de marca, dominio verificado en Search Console, página de inicio pública, política de privacidad en el mismo dominio (cómo se accede/usa/guarda/comparte datos de Google), justificación por alcance, video demo en YouTube (no listado) en inglés con flujo de consentimiento y client ID. Revisión sensible: "hasta 10 días"; marca automática en minutos (página restringida dice 2-3 días hábiles). Sin cobro mencionado.
- HECHO: evaluación de seguridad anual (CASA) sólo para alcances RESTRINGIDOS ("annual security assessment"): https://support.google.com/cloud/answer/13464321 y https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification (reevaluación cada 12 meses; "varias semanas").
- NO VERIFICADO con fuente oficial: que ningún alcance de Calendar sea restringido (las páginas oficiales no listan; conocimiento previo: restringidos = Gmail, Drive y pocos más). Confianza media-alta.
- HECHO: lista de alcances de Calendar (página actualizada 2026-09-03): calendar, calendar.events, calendar.events.owned, calendar.app.created ("Make secondary Google calendars, and see, create, change, and delete events on them"), calendar.acls ("See and change the sharing permissions of Google calendars you own"), calendar.calendarlist.readonly, etc. La página NO dice cuál es sensible. https://developers.google.com/workspace/calendar/api/auth
  -> calendar.app.created calza perfecto con el producto (el panel crea "Familia" en el Gmail del dueño). Su categoría (sensible/no) NO se pudo confirmar: la consola de Google Cloud la muestra al armar la pantalla de consentimiento.
- HECHO: app no verificada: tope de 100 usuarios nuevos tras la pantalla "app no verificada". https://support.google.com/cloud/answer/7454865
- HECHO: proyecto en "Testing" con usuarios externos -> refresh token vence en 7 días (inservible para una pared). Límite 100 refresh tokens por cuenta Google por client ID (cuentas de servicio exentas). https://developers.google.com/identity/protocols/oauth2
- HECHO: excepciones a la verificación: uso personal (<100 usuarios), desarrollo/pruebas, cuenta de servicio sin datos de usuario, uso interno de Workspace, apps de confianza del admin. https://support.google.com/cloud/answer/13464323
- Costo CASA (sólo si algún día se piden alcances restringidos): TAC Security lista Tier 2 USD 540/app/año (USD 720 premium); Leviathan USD 3.000. Fuente terceros: https://tacsecurity.com/esof/ , https://leviathansecurity.com/programs/google-casa-cloud-application-security-assessment (sin fecha clara). NO aplica a Calendar.
- HECHO: Push de Google Calendar (watch): POST HTTPS sin cuerpo; canales no se renuevan solos; "se pierde un pequeño porcentaje de mensajes" -> igual hay que sincronizar de respaldo. https://developers.google.com/workspace/calendar/api/guides/push

### Idea pragmática para el piloto (estimación propia)
- Una SOLA cuenta de servicio del negocio puede atender muchas familias: cada familia comparte su calendario "Familia" con el correo …@….iam.gserviceaccount.com del negocio (pasos D-E-F del PLAN, sin Google Cloud Console para el cliente). El límite "una familia por cuenta de servicio" es del código (CLAVE_DUENO_GOOGLE), no de Google.
- No hay pantalla de consentimiento OAuth -> no hay verificación. Riesgo: una clave da acceso a los calendarios de todos los clientes (proteger, rotar, separar por lotes); hay que comprobar que quien pega un ID de calendario es su dueño (comparar la regla owner de la ACL con el correo del adulto registrado).
- Para escalar y para que el cliente no copie IDs: OAuth con verificación sensible (sin CASA), refresh token cifrado por familia, el transporte actual (API v3) se reutiliza cambiando sólo de dónde sale el token.

## iCloud
- HECHO: apps de terceros que acceden a Mail/Calendario/Contactos de iCloud necesitan contraseña de app; requiere 2FA; máx. 25 activas; se revocan TODAS al cambiar la contraseña del Apple ID. La página menciona que "en apps compatibles" se puede autorizar con la cuenta Apple (sin detalle). https://support.apple.com/en-us/102654 (publicada 8-oct-2025)
- Implicancia: para clientes, guardar contraseñas de app de iCloud = credencial que abre correo/contactos/calendario -> riesgo alto (Ley 21.719 seguridad). Recomendación: piloto sólo con Google (también en iPhone, como hace hoy la familia), iCloud como opción avanzada o vía ICS de sólo lectura. App nativa con EventKit = otra vía (App Store, no evaluada).

## ICS (calendario propio + suscripción)
- Google refresca calendarios suscritos por URL cada varias horas (hasta ~12-24 h) y no se puede forzar: fuentes de terceros, sin confirmación oficial. https://usecarly.com/blog/google-calendar-ics-refresh-rate/ , https://til.simonwillison.net/ics/google-calendar-ics-subscribe-link
- iPhone: los calendarios suscritos siguen "Obtener datos" (sin push); terceros, no Apple. https://nocal.app/help/ics-and-subscriptions/why-subscribed-calendars-dont-update-instantly
- Sólo lectura en el teléfono. Sirve como plan B gratis y sin verificación, no como reemplazo bidireccional.

## Microsoft / Outlook
- HECHO: verificación de editor gratis, requiere cuenta Microsoft AI Cloud Partner Program verificada, app registrada con cuenta Entra de trabajo y dominio propio; sin ella, con step-up consent activado los usuarios de otros tenants no pueden consentir apps multi-tenant nuevas. https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview (actualizada 2026-06-15)
- Terceros: política de consentimiento gestionada por Microsoft bloquea Calendars.ReadWrite para consentimiento de usuario en tenants de trabajo (Topedia, 2026, sin fecha exacta). https://blog-en.topedia.com/?p=58770
- Prioridad baja para familias chilenas (estimación propia: predominan Gmail e iCloud).
