# Panel familiar de pared para Chile: informe de negocio (versión final)

12 de noviembre de 2026 · Para decidir · Preparado para la fundadora · Corrige la v1 con las observaciones de dos revisoras

**Cómo leer este informe**

- Las cifras con enlace son hechos verificados. Al lado va la fecha de la fuente o de la consulta.
- **[E]** marca una estimación propia: un cálculo o un supuesto nuestro, no un dato publicado.
- **[snippet]** marca un precio que se vio en el resultado del buscador porque la tienda no dejó leer la página. Hay que confirmarlo antes de usarlo.
- **[secundaria]** marca un dato que viene de prensa o de un tercero, no de la fuente oficial.
- Tipo de cambio: USD 1 = CLP 985, el cierre del 10-11-2026 (CLP 985,5 según [Emol](https://www.emol.com/noticias/Economia/2026/11/10/1216673/dolar-se-dispara-inflacion-eeuu.html)). Para el euro usamos CLP 1.130 [E]. Ninguna conversión incluye IVA ni envío, salvo que se diga.
- Todos los cálculos se pueden repetir con `calendario/negocio/calculo_estudio.py`. La salida está en `calendario/negocio/calculo_estudio_salida.txt`. Las notas crudas, un archivo por tema, están en `calendario/negocio/notas/`. Los cambios del modelo están en `10_modelo_final_correcciones.md` de esa carpeta.
- Lo que no se pudo verificar está al final, en la sección 13.

---

## 1. Resumen ejecutivo

**La idea.** Vender en Chile un **panel de pared para la familia, sin mensualidad obligatoria**. Es una tablet Android de 11" que llega configurada, con un soporte-marco que tapa la marca de la tablet, cargador certificado y la app ya instalada, y con atención en Chile. La app ya hace lo que importa:

- agenda familiar sincronizada en ambos sentidos con Google Calendar, que se ve también en los iPhone;
- menú semanal con **desayuno, colación, almuerzo, once y cena**;
- lista del súper que se arma sola a partir del menú;
- quehaceres con estrellas y premios para los niños, y cuentas regresivas;
- **«Dictar receta»**: se graba a la abuela contándola y queda escrita.

Lo básico no tiene mensualidad y queda **garantizado por escrito hasta el 31 de diciembre de 2031**. Quien quiera más paga una suscripción **opcional**.

**Para quién.** La compradora es una mamá de 30 a 45 años que trabaja, de GSE C1a, C1b o C2 (y AB), con hijos de 3 a 12 años. Se parte en el Gran Santiago. Según [ComunidadMujer (jul-2023)](https://comunidadmujer.cl/wp-content/uploads/2023/07/Boletin_53_Carga-mental-domestica_.pdf), el 66,7% de las mujeres planifica la comida diaria y el 79,1% de las madres con hijos escolares atiende el chat del colegio. El mercado alcanzable son unos **679 mil hogares** [E]. Ojo: es un **stock de hogares**, no una demanda anual, porque una tablet se cambia cada 3 a 4 años [E]. El segundo público son los hijos adultos que regalan el panel a sus padres o para guardar las recetas de la abuela.

**Lo que cambió con la revisión (lee esto primero) [E].**

- **Con los precios de la v1, el negocio pierde plata.** En el escenario base, el primer año comercial (marzo 2027 a febrero 2028) **pierde unos CLP 11 millones** antes de tu sueldo y de impuestos. A eso se suman ~CLP 2,5 millones de gastos y piloto antes de marzo. Los años 2 y 3 tampoco mejoran: −11 y −18 millones.
- **Por qué la v1 decía +2,7 millones:**
  - vendía los 400 kits a precio de lista, sin las 100 fundadoras;
  - usaba una tablet a CLP 159.990 que ya no está disponible (hoy cuesta 169.990);
  - no cobraba el recargo de las cuotas sin interés;
  - no contaba la puesta en marcha de cada familia (la videollamada para conectar Google y las dudas del primer mes);
  - suponía 15% de familias en Plus, sin bajas.

  Las revisoras, con una parte de estas correcciones, llegaron a −3 a −5 millones. Con todas, la pérdida es de unos −11 millones. El puente completo está en 6.6.
- **El negocio con tablet sólo funciona si se cumple al menos una de estas condiciones:**
  - (a) subir el precio de lista a **CLP 349.990** y el del Kit Instalado a 419.990;
  - (b) conseguir la tablet a distribuidor, ~10% bajo el precio de tienda;
  - (c) captar a cada clienta por CLP 35 mil o menos;
  - (d) vender a empresas o cajas de compensación, donde captar debería costar menos (no verificado).
- **Con la oferta ajustada (a)**, el primer año base deja **~CLP 1,9 millones** antes de tu sueldo, unos CLP 160 mil al mes. **El año 1 no paga sueldo**: el sueldo mínimo es de ~CLP 539 mil (dato de memoria, por confirmar). Con (a) y (b) juntas deja ~CLP 7,8 millones. Si captar cuesta CLP 50 mil, (a) sola pierde 4,1 millones.
- **Plus no alcanza para pagar la base gratis.** Con bajas reales, quedaría en Plus un 5% a 6% de las familias. Para cubrir lo que cuesta una familia gratis haría falta un **18% a 25%**, o un 23% a 36% mientras no se migre la nube. La base gratis la tiene que pagar cada kit, apartando ~CLP 15 mil por kit.
- **No prometer «gratis para siempre».** La publicidad obliga al proveedor (Ley 19.496). La promesa es «sin mensualidad obligatoria; lo básico garantizado por escrito hasta 2031», con un plan de continuidad (5.3).

**Oferta propuesta (ajustada) [E]:**

- **Kit Pared 11"**: CLP 349.990. Hasta 3 cuotas sin interés; si se quieren más, son cuotas normales del banco, que paga la clienta. Las primeras 100 familias pagan 329.990 (fundadora). El piloto paga 249.990, por transferencia.
- **Kit Pared Instalado** (RM): CLP 419.990, fundadora 399.990. Sólo se cuelga y se conecta a un enchufe que ya existe, con canaleta. Lo hace un maestro con boleta y seguro. **El precio queda por confirmar cuando se cotice la instalación.**
- **«Trae tu tablet»** (sólo software, Android): CLP 79.990, pago único. Probar también 59.990.
- **Plan Gratis**: CLP 0 al mes, garantizado por escrito hasta el 31-12-2031. Incluye 3 dictados y 5 importaciones con IA al mes.
- **Plus** (opcional): CLP 3.990 al mes o 39.990 al año. El precio fundadora es de CLP 2.990 al mes, **garantizado por 3 años** (no «de por vida»).

**Cómo gana plata [E]:**

1. **El margen de cada kit.** A precio de lista, con tablet de tienda, deja ~CLP 63 mil netos (21%). Después de captar a la clienta quedan ~CLP 28 mil, y después de apartar la reserva para la base gratis, ~13 mil. Eso paga la captación, la base gratis y parte de los costos fijos.
2. **Las licencias «Trae tu tablet».** Dejan ~CLP 38 mil netos cada una, sin inventario ni garantía de hardware.
3. **Plus.** Al comienzo aporta poco. Cubre la operación cuando pasa del 18% al 25% de las familias.
4. **Ventas extra de pago único y ventas a empresas:** segunda pantalla para los abuelos, libro impreso y ventas por volumen. No están en el modelo.

**Criterios para seguir o cambiar de rumbo** (se miden en la preventa y en marzo y abril de 2027; detalle en 6.9):

- Si captar a una clienta cuesta **más de CLP 40 mil**, o si el kit deja **menos de CLP 30 mil después de captar**, se pasa al modelo de sólo software («Trae tu tablet» más Plus). Con tablet de tienda, a 349.990 y captando a 35 mil, el kit deja ~28 a 29 mil: **queda justo bajo la línea**. Por eso la cotización de un distribuidor es una condición previa.
- Si con clases menos del 50% de las familias del piloto lo usa 5 días a la semana, se para la publicidad y se corrige el producto.
- Si menos del 5% de las familias del piloto pasa a Plus en abril y mayo, no se contrata contenido fijo.

**Qué hacer primero (próximas 2 semanas):**

1. **Validar con plata de desconocidas, no con la opinión de conocidas.** Abrir reservas reembolsables de CLP 20 mil con anuncios, con la meta de juntar 20 o más antes del 15 de enero. Las entrevistas sirven para entender el problema, no para validar el precio. Preguntar:
   - qué calendario usan hoy (Google, iCloud o ninguno);
   - quién anotaría las cosas en el panel y cuándo.
2. **Hacer los arreglos baratos, que toman días:**
   - pasar Gemini al plan pagado, porque el plan gratis usa el audio de la abuela para mejorar los productos de Google;
   - activar la recarga automática de Netlify y poner alarmas, porque si se acaban los créditos se pausan **todos** los sitios;
   - hacer que la tablet pregunte por cambios cada 60 segundos y no cada 20;
   - contratar un clima con licencia comercial.
3. **Formalizar.** Crear la SpA, que es gratis, y hacer que un abogado revise plantillas de términos, privacidad y consentimientos. **La Ley 21.719 rige el 1-12-2026, salvo que antes se publique la ley que la posterga**, que al 12-11-2026 sigue «En tramitación». La privacidad y los consentimientos deben estar firmados antes de instalar a la primera familia.
4. **Black Friday** (27 al 30 de noviembre): comprar tablets sólo si la SpA ya tiene RUT. Si no, comprar sólo las 5 del piloto o esperar.
5. **Hacer un piloto chico en diciembre**, con 5 familias, para probar la instalación y el soporte. Abrir la **preventa en enero**, con entrega en marzo. Medir el uso real con clases (2 de marzo al 15 de abril) y **decidir en abril**.
6. **Pedir por escrito** la cotización de un distribuidor de tablets y el recargo de cuotas de Flow, antes de fijar los precios.

**Lo que NO conviene ahora:**

- Prometer «gratis para siempre» o Plus «de por vida».
- Ofrecer 6 o más cuotas sin interés: con 12, el margen del kit cae a la mitad.
- Comprar más stock que lo vendido en la preventa antes de tener los datos de abril.
- Importar paneles de 15,6": inmovilizan unos CLP 29 millones, exigen certificar el modelo ante Subtel y no salen más baratos.
- Vender con iPad: sin un sistema de administración de equipos, no vuelve solo a la app después de un corte de luz.
- Guardar contraseñas de iCloud de las clientas, porque también abren su correo.
- Poner publicidad en la app.
- Vender en Mercado Libre al inicio: su comisión se come el margen.

---

## 2. El mercado en Chile

### 2.1 Cifras clave

| Tema | Dato | Fuente (fecha) |
|---|---|---|
| Hogares | 6.596.527 hogares; promedio de 2,8 personas | [INE, Censo 2024](https://www.ine.gob.cl/sala-de-prensa/prensa/general/noticia/2025/03/27/primeros-resultados-del-censo-2024-18.480.432-personas-fueron-censadas-en-chile-manteni%C3%A9ndose-la-tendencia-de-envejecimiento-de-la-poblaci%C3%B3n) (27-03-2025) |
| Hogares con niños | 33,2% tiene al menos una persona de 14 años o menos (en 2017 era 39,9%): unos 2,19 millones de hogares [E] | Ídem |
| Natalidad | 146.446 nacimientos en 2025; 0,99 hijos por mujer | [INE](https://www.ine.gob.cl/sala-de-prensa/prensa/general/noticia/2026/05/27/estad%C3%ADsticas-vitales-cifras-provisionales-2025-confirman-que-los-nacimientos-en-chile-disminuyeron-un-46-9-en-32-a%C3%B1os) (27-05-2026) |
| Grupo socioeconómico | AB 2,1%, C1a 9,1%, C1b 8,4% y C2 14,7% de los hogares del país. ABC1 suma 19,6% en el país y 29,8% en el Gran Santiago | [AIM/ANDA con CASEN 2022](https://anda.cl/wp-content/uploads/2024/10/PRESENTACION_AIM_ANDA-FINAL_V2.pdf) (12-12-2023) |
| Ingreso | Ingreso mediano del hogar: CLP 1.168.760 al mes. Un kit de CLP 350 mil equivale al 30% de ese ingreso [E], así que es un producto para C2 hacia arriba. *En la revisión, la página llegó vacía y no se pudo volver a verificar* | [Banco Central, EFH 2024](https://www.bcentral.cl/documents/d/banco-central/documento-de-resultados-efh-2024) (30-09-2025) |
| Tablets | Sólo el 24,9% de los hogares usa una tablet para conectarse. En el GSE alto llega a 41,6% y en hogares con hijos de 4 años o menos a 34,4%. El smartphone está en el 99,1% y el 96,6% tiene internet | [Subtel 2025](https://www.subtel.gob.cl/wp-content/uploads/2026/02/Presentacion-Subtel-Acceso-y-Uso-Internet-2025_v1.pdf) (nov-2025) |
| Android o iPhone | En el tráfico web móvil, Android tiene 79,3% e iOS 20,7%. En tablets, Apple tiene 51,5%. No hay datos por GSE | [StatCounter](https://gs.statcounter.com/os-market-share/mobile/chile) (oct-2026) |
| Comercio electrónico | En 2025 superó por primera vez los US$10.000 millones (12,6% del retail). Se proyecta un crecimiento de 7% a 10% en 2026 | [Chócale/CCS](https://chocale.cl/2026/04/comercio-electronico-en-chile-supero-por-primera-vez-los-us10-mil-millones-en-ventas/) (13-04-2026) |
| CyberDay 2026 | US$531 millones; ticket promedio de US$104 (más de CLP 92 mil) | [The Clinic](https://www.theclinic.cl/2026/06/04/cyberday-2026-uno-de-cada-cuatro-chilenos-compro-algo-durante-el-evento-y-el-gasto-promedio-supero-los-92-mil/) (04-06-2026) |
| CyberMonday 2026 | Récord de 5,3 millones de compras, pero un ticket de CLP 83 mil, 15% menos (el consumidor está cauto) | [The Clinic](https://www.theclinic.cl/2026/10/08/mas-compras-pero-menos-gasto-cybermonday-cierra-con-record-de-53-millones-de-transacciones-y-ticket-promedio-a-la-baja/) (08-10-2026) |
| Cuotas | En el CyberDay, las compras en 6 cuotas suben de 8% a 12%. El ticket promedio en electrónica es CLP 290 mil | [Radio Agricultura/Mercado Pago](https://www.radioagricultura.cl/noticias/dato-practico/compradores-de-ultimo-minuto-dominan-el-cyberday-este-es-el-comportamiento-de-los-chilenos_20260530/) (30-05-2026) |
| Suscripciones | Spotify Individual cuesta CLP 4.950 (dato de ago-2025; no verificamos si cambió) y Netflix Básico 7.190. El gasto promedio en streaming es CLP 22.809 al mes | [24horas](https://www.24horas.cl/tendencias/tecnologia-y-ciencias/spotify/spotify-confirma-alza-precios-cuando-comienza-cobro) (27-08-2025); [The Clinic/SERNAC](https://www.theclinic.cl/2025/06/12/estudio-revelo-que-el-gasto-promedio-mensual-de-los-chilenos-en-plataformas-de-streaming-alcanza-los-22-809/) (12-06-2025) |
| Trabajo de la casa | Las mujeres dedican 4:57 horas al día al trabajo no remunerado y los hombres 2:52 | [INE, ENUT 2023](https://www.ine.gob.cl/sala-de-prensa/prensa/general/noticia/2025/01/17/las-mujeres-destinan-02-05-horas-m%C3%A1s-que-los-hombres-a-actividades-de-trabajo-no-remunerado) (17-01-2025) |
| Carga mental | Las mujeres en pareja cargan el 74,7% de la carga mental de la casa y el 67,7% es «la que se acuerda» de lo pendiente. La muestra es autoseleccionada (12.755 respuestas) | [ComunidadMujer](https://comunidadmujer.cl/wp-content/uploads/2023/07/Boletin_53_Carga-mental-domestica_.pdf) (jul-2023) |
| Once | El 76% toma once todos los días y sólo el 9% cena | Cadem, citado por prensa (20-10-2025). El PDF dio error al abrirlo |
| Recetas | YouTube es la primera fuente de recetas y las recetas familiares «están desapareciendo» | [The Clinic/Cadem](https://www.theclinic.cl/2026/09/14/solo-un-1-de-veganos-y-menos-recetas-familiares-como-esta-cambiando-la-cocina-de-los-chilenos-en-fiestas-patrias/) (14-09-2026) |
| Abuelos | El 28% de los abuelos cuida intensamente a sus nietos | [La Tercera](https://www.latercera.com/que-pasa/noticia/1-cada-3-abuelos-cuida-intensamente-a-sus-nieto-es-bueno-para-la-salud/HJV2BSBQUZFYFJEGXQC2ZVGWFY/) (2025) |
| Trabajadoras de casa particular | Unas 223 mil, 86% puertas afuera (confianza baja: la página no indica año) | [Dirección del Trabajo](https://dt.gob.cl/portal/1626/w3-propertyvalue-191562.html) |
| Vuelta a clases | Las familias gastan unos CLP 200 a 209 mil en útiles y uniformes («cuesta de marzo») | Sernac/UDLA, notas de canales [secundaria, fechas mixtas] |
| Confianza en influencers | Sólo el 4,6% prefiere las reseñas de influencers; el 81,5% confía en reseñas de usuarios comunes | [El Mostrador/LIPR](https://www.elmostrador.cl/agenda-pais/agenda-digital/2024/12/16/chilenos-son-los-consumidores-digitales-de-latinoamerica-que-confian-menos-en-influencers/) (16-12-2024) |
| Instagram | Llega a 13,5 millones de personas, 52% mujeres | [DataReportal 2026](https://datareportal.com/reports/digital-2026-chile) (08-11-2025) |

**Lo que dicen estos datos:**

- Es un producto para el **segmento medio-alto**. En los GSE D y E no tiene mercado.
- **Pocas casas tienen tablet**: incluso en el GSE alto, el 58% no usa una. Por eso vender la tablet incluida aporta valor. Además, la mitad de las tablets son iPad (Apple tiene 51,5%), que no sirven para el modelo «Trae tu tablet» (5.1).
- **Google es la conexión por defecto**, porque Android domina en celulares. Pero **hay que medir cuántas familias usan iCloud.** En el segmento objetivo la proporción de iPhone es muy probablemente mayor que el 20,7% nacional, aunque no hay datos por GSE. Si más del 40% de las entrevistadas usa iCloud, sube la prioridad de una vía para iCloud sin contraseñas (8.1, punto 3).
- **El mercado se achica**: hay menos hogares con niños y la fecundidad está en 0,99. Conviene abrir pronto otros segmentos (4.3) y el canal de empresas.
- **Hay que ofrecer cuotas, pero sin interés sólo hasta 3** (6.1). Y como el chileno confía poco en influencers, conviene apostar por **reseñas de familias reales**.

### 2.2 TAM, SAM y SOM (tamaño del mercado)

Qué significa cada sigla:

- **TAM**: todas las familias que podrían usarlo.
- **SAM**: las que de verdad podemos atender.
- **SOM**: lo que es realista capturar.

Todos los valores de esta tabla son estimaciones propias con datos del Censo 2024, Subtel 2025 y AIM 2022 (detalle en `08_tam_sam_som.md`). **El TAM y el SAM son un stock de hogares, no ventas por año**: una familia que compra no vuelve a comprar hasta que cambie la tablet, en unos 3 a 4 años [E].

| Nivel | Definición y supuesto | Hogares | Valor a CLP 349.990 por kit |
|---|---|---|---|
| **TAM** | Hogares con niños de 14 años o menos (2,19 millones) × 96,6% con internet | ~2,12 millones | ~CLP 742 mil millones (~US$753 millones) |
| **SAM** | Hogares de GSE AB, C1a, C1b y C2 (34,3%, unos 2,26 millones) × **30% con niños (supuesto: no hay tabulado oficial por GSE)** | ~679 mil (rango de 634 a 751 mil) | ~CLP 238 mil millones (~US$241 millones) |
| **SOM año 1** (calculado desde abajo: presupuesto de marketing ÷ costo por cliente) | Conservador: 150 kits + 50 licencias. Base: 400 + 150. Optimista: 900 + 400 | 200 / 550 / 1.300 | 0,03% / 0,08% / 0,19% del SAM |
| **SOM a 3 años** (escenario base) | 2.100 kits + 950 licencias acumulados | ~3.050 | ~0,45% del SAM |

La investigación de mercado, calculando desde arriba (de 0,05% a 0,25% del SAM), llegó a 340, 815 o 1.700 kits el año 1. Nuestro escenario base queda en la parte baja de ese rango, a propósito, porque lo vende una sola persona. **Ninguna de estas cifras está validada mientras no haya reservas y una preventa pagadas.** Los volúmenes se mantienen iguales con los precios ajustados, aunque **no sabemos cuánto bajan las ventas al subir el precio**. Eso se mide probando dos precios en la preventa.

---

## 3. Competencia

### 3.1 Tabla comparativa

Los precios están convertidos a CLP 985 por dólar, sin IVA ni envío, salvo los precios chilenos.

| Producto | Precio en CLP | Suscripción | ¿En Chile? | Fortalezas | Debilidades |
|---|---|---|---|---|---|
| **Skylight Calendar 2** (15") / **Max** (27") | ~295.500 / ~561.400 (USD 299,99 / 569,99). La de 15" es [secundaria]: la página oficial no la muestra. La de 27" viene del [sitio oficial](https://myskylight.com/products/skylight-calendar-max-classic-white-with-plus-plan) (12-11-2026) | Plus USD 79 al año (~CLP 77.800). **Comidas, recetas, premios con estrellas y fotos son de pago** ([myskylight.com](https://myskylight.com/products/calendar-skylight-plus)). El alza desde USD 39 es [secundaria] | **No vende directo**: sólo a EE.UU., Canadá, Australia y Reino Unido, y sugiere comprar en Amazon.com ([FAQ](https://skylight.zendesk.com/hc/en-us/articles/20421533144219-Skylight-International-Orders-FAQ), act. 11-12-2025). No verificamos si Amazon despacha a Chile ni a qué costo | Es el líder: más de 1,3 millones de familias y es rentable ([TechCrunch](https://techcrunch.com/2026/01/07/skylight-debuts-calendar-2-to-keep-your-family-organized), 07-01-2026). Diseño simple, IA «Sidekick» | El muro de pago es la queja principal («biggest complaint», Wired). **Ya ofrece español (EE.UU.)**, además de inglés y alemán ([ayuda](https://skylight.zendesk.com/hc/en-us/articles/35783081774619-Supported-Languages), act. 19-08-2026; no dice desde cuándo). Compras con Instacart, sólo en EE.UU. |
| **Hearth Display** (27") | ~688.500 (USD 699). Hoy ~550.800 (USD 559,20) por Black Friday ([hearthdisplay.com](https://hearthdisplay.com/products/hearth-display), 12-11-2026) | **Obligatoria para configurarlo**: USD 9 al mes u 86,40 al año (~CLP 85.100) ([hearthdisplay.com](https://hearthdisplay.com/products/family-membership), 12-11-2026) | No encontrado | Pantalla grande, IA, rutinas | Es la crítica más dura de la categoría. Muestra Google y Apple sólo para leer |
| **Cozyla** (15,6" a 32") | Calendar Neo (15,6" y 24") «desde USD 169,99» (~CLP 167.400) según nuestras notas, **no confirmado**: la página oficial no muestra el precio y la URL del producto da error 404. Calendar Plus 2 de 15,6": USD 349,99 (~CLP 344.700). 32": USD 899,99 | Opcional: Super USD 69,99 al año (~CLP 68.900). **Menú, recetario, lista, quehaceres y premios gratis «forever»** ([cozyla.com](https://www.cozyla.com/pages/calendar), 12-11-2026) | No encontrado | Es el modelo más parecido al que buscas, y puede ser más barato que nuestro kit | Tuvo fallas de sincronización ([T3](https://www.t3.com/home-living/smart-home/cozyla-calendar-2)). No encontramos español documentado |
| **Apolosign** (27") | ~590.000 (USD 599) | Sin suscripción ([fabricante](https://www.apolosign.com/blogs/discover/digital-calendar-subscription-vs-one-time-cost)) | No encontrado | iCloud en ambos sentidos | Si se cae la conexión con la cuenta, los eventos desaparecen sin aviso |
| **DAKboard / Mango** (software para tu propia pantalla) | — | DAKboard: USD 6 a 10 al mes (~CLP 5.900–9.900). Mango Pro: USD 5,99 al mes (~CLP 5.900) ([dakboard.com](https://dakboard.com/pricing), [mangodisplay.com](https://mangodisplay.com/pricing/), 12-11-2026) | Se puede usar | Corren en cualquier pantalla | En inglés y con suscripción para lo útil |
| **Cozi / FamilyWall / TimeTree** (apps) | — | Cozi: Gold USD 39 al año y Max USD 79 (~CLP 38.400 / 77.800). El recetario es gratis; **la planificación con IA es pagada** (AI Meal Planner y AI Recipe Creator, en Max) ([cozi.com](https://www.cozi.com/compare-plans/), 12-11-2026). TimeTree: USD 4,49 al mes | Sí, en la tienda de apps | Gratis para empezar | No tienen pantalla de pared |
| **Amazon Echo Show 8 / 15** | 219.990 (Lider) / 399.990 (Paris, con tarjeta Cencosud) [snippet] | Alexa+ no está en Chile (en México cuesta MXN 399 al mes) ([ppc.land](https://ppc.land/amazon-prices-alexa-in-japan-at-y-3-000-a-month-five-times-the-prime-fee/), 29-10-2026) | **Sí, en el retail** | Marca conocida, voz, video | No tiene menú chileno, recetas familiares ni premios. Hoy compite más como parlante con pantalla |
| **Google Nest Hub** | No encontramos precio en Chile | La IA va en Google Home Premium (USD 10 a 20 al mes) | — | — | Google le viene quitando funciones familiares ([9to5Google](https://9to5google.com/2026/01/30/google-nest-hub-apps-have-mostly-disappeared-over-the-years/), 30-01-2026) |
| **Calendario genérico Anyuse 16"** | 278.990 (Lider) [snippet] | ¿? | Sí (probablemente un vendedor del marketplace) | Pantalla grande | Marca desconocida, sin soporte, sin contenido local |
| **Cookidoo** (Thermomix) | USD 65 al año (~CLP 64.000) | Obligatoria para sus recetas | Sí | Más de 140 recetas chilenas ([Chócale](https://chocale.cl/2024/10/cookidoo-lanza-nueva-coleccion-que-incluye-recetas-chilenas/), 06-10-2024) | Exige tener una Thermomix |
| **ComoQuiero / Chef Digitales** (Chile) | Gratis | — | Sí (no verificamos si siguen activas; los datos son de 2020–2021) | Menú y lista de compras locales | Sólo app, sin agenda familiar |
| **Pizarras imantadas** | 6.900 a 82.990 (Falabella) [snippet] | — | Sí | Baratas, simples | No se sincronizan con nada |
| **Nuestra propuesta** | **349.990 con tablet incluida** (fundadora 329.990) | **Sin mensualidad obligatoria; lo básico garantizado hasta 2031. Plus opcional a 3.990 al mes** | **Sí, con soporte local** | Chileno (once, colación), recetas de la abuela por voz, Google en ambos sentidos, menú y premios sin costo | Marca nueva, depende de una sola persona, pantalla de 11" (más chica) |

### 3.2 ¿Cuánto paga una familia chilena en 3 años? [E]

| Opción | Compra inicial | 3 años de funciones de comidas | Total aproximado |
|---|---|---|---|
| **Tablet común + Google Calendar, TimeTree o Cozi gratis** («lo armo yo») | ~CLP 178 mil (Redmi Pad 2 a 169.990 + soporte IKEA a 7.990) | CLP 0 (el recetario de Cozi es gratis) | **~CLP 178 mil**. Sin kiosco, sin menú por espacios chilenos, sin premios integrados, sin soporte |
| Tablet común + nuestra licencia «Trae tu tablet» | ~CLP 258 mil (178 mil + 79.990) | CLP 0 | **~CLP 258 mil** |
| Echo Show 8 | CLP 219.990 [snippet] | No tiene menú chileno ni premios | ~CLP 220 mil |
| Cozyla Neo 15,6" importado (**precio por confirmar**) | ~CLP 199 mil (USD 169,99 + 19% de IVA) + envío, que no cotizamos | Gratis (Super es opcional) | **~CLP 200 mil o más**, sin español documentado ni garantía local |
| Cozyla Calendar Plus 2 15,6" importado | ~CLP 410 mil con IVA + envío | Gratis | ~CLP 410 mil o más |
| Skylight 15" importado | ~CLP 351.600 (USD 299,99 [secundaria] + 19% de IVA) + courier, que no cotizamos | Plus: 3 × ~CLP 77.800 = ~233.400, sin IVA | **~CLP 585 mil o más**, en «español EE.UU.» y sin garantía local |
| Hearth 27" importado | ~CLP 550.800 a 688.500 + IVA + envío | Obligatoria: 3 × ~85.100 = ~255.300 | ~CLP 0,8 a 0,95 millones, más IVA y envío |
| Echo Show 15 | CLP 399.990 [snippet] | No tiene menú chileno ni premios | ~CLP 400 mil |
| **Nuestro Kit Pared** | **CLP 349.990** | **CLP 0** (Plus opcional: 3 × 39.990 = 119.970) | **CLP 350 mil** (o 470 mil con Plus) |

Sobre la importación: que las compras online de hasta US$500 paguen sólo IVA es lo que dice una página de [Aduanas](https://www.aduana.cl/sin-arancel-aduanero-hasta-usd-500/aduana/2025-10-20/174429.html) (20-10-2025) que vimos en el buscador. La revisión no pudo volver a leerla (aduana.cl bloquea la lectura). **Por confirmar.**

**Lectura honesta:**

- **El kit cuesta ~CLP 172 mil más que la versión casera con apps gratis, y ~92 mil (36%) más que la casera con nuestra licencia.** Ésa es la comparación que va a hacer cualquier mamá. Además, la tablet se puede buscar en SoloTodo.
- La diferencia se justifica sólo con lo que la versión casera no da:
  1. **un soporte-marco que tapa la marca de la tablet**, para que se vea como un producto y no como «una tablet en la pared»;
  2. **Google ya conectado por ti** en la videollamada;
  3. **cambio del equipo en 48 horas** dentro de la garantía, con 2 equipos de reemplazo en stock;
  4. **contenido chileno**;
  5. **3 meses de Plus incluidos**.

  Una variante para probar en la preventa es incluir 12 meses de Plus. Cuesta ~CLP 9 mil más por kit y atrasa en un año el dato de cuántas familias pagan Plus.
- **Frente a Cozyla, la ventaja no es el precio.** Si el Neo de 15,6" de verdad cuesta USD 169,99, sale más barato que nuestro kit y trae menú, recetario y premios gratis. La ventaja es que **se vende y se atiende en Chile**, con garantía legal local, contenido chileno y «Dictar receta».
- Por eso «Trae tu tablet» sube a CLP 79.990 (y no 39.990): a 39.990 dejaría el valor del software en 40 mil y la brecha con el kit en ~132 mil.

### 3.3 Los huecos que deja la competencia

1. **Nadie vende oficialmente en Chile un panel familiar con soporte local.** Skylight no vende directo a Chile, aunque su FAQ deriva a Amazon.com. No encontramos a Hearth, Cozyla ni Apolosign en el retail chileno. **No hay que usar «no hay competidor» como argumento principal**: se puede importar, y hay genéricos chinos (3.4).
2. **Nadie habla chileno.** Ninguno tiene once ni colación, feriados ni calendario escolar chileno, ni pensó en la nana o en los abuelos que cuidan.
3. **Nadie convierte la voz de la abuela en receta.** Skylight y Cozi sólo generan recetas genéricas con IA. Hay demanda: el proyecto «Las Güelis» recibió cerca de 3.100 contactos en 24 horas ([The Clinic](https://www.theclinic.cl/2026/07/12/el-recopilador-de-las-recetas-de-las-abuelas-la-cruzada-de-un-periodista-gastronomico-para-hacer-eternas-las-cocinas-de-las-guelis-de-chile/), 12-07-2026).
4. **Cobran por lo que la familia considera básico.** Skylight cobra las comidas, las recetas y los premios. Hearth cobra todo.
5. **La sincronización falla.** Con Skylight, los calendarios de Outlook y del colegio van en un solo sentido y con horas de retraso. Hearth muestra los calendarios sólo para leer ([CalendarBridge](https://calendarbridge.com/es/blog/how-to-fix-sync-issues-on-the-most-popular-digital-family-calendars/), 24-07-2026). La app ya sincroniza con Google en ambos sentidos.
6. **Nadie conecta con el súper chileno.** Jumbo y Santa Isabel tienen una API pública que **llena el carro**. La probamos el 12-11-2026 ([openapi.json](https://www.jumbo.cl/openapi.json)), pero no encontramos sus términos de uso comercial.
7. **Nadie lee los comunicados del colegio.** Lirmi-Papinotas declara más de 2.200 colegios ([DF](https://www.df.cl/df-mas/punto-de-partida/la-edtech-mas-grande-de-chile-opera-desde-la-araucania-y-llega-a-mas-de)). Convertir la circular en eventos con IA sería el equivalente chileno del «Magic Import» de Skylight.

**Ojo:** el idioma por sí solo no es una ventaja duradera. Skylight ya ofrece español (EE.UU.) y Amazon anuncia Alexa+ en más países en 2027. Lo difícil de copiar es lo **local**: las recetas, la once, Jumbo, el colegio, el soporte, la garantía y la comunidad.

### 3.4 Competidores que faltan por analizar (no verificados)

- **El competidor real: WhatsApp más la pizarra del refri.** Es gratis, ya está instalado y todos lo usan. El panel tiene que ganarle en ahorro de trabajo, no en funciones.
- **Las apps escolares** (Papinotas, Lirmi, Napsis) ya llevan el calendario del colegio al celular de los apoderados. Pueden ser una competencia o una alianza.
- **Skylight comprado en Amazon.com**: no cotizamos el costo total de traerlo (precio, IVA y envío).
- **Los calendarios genéricos de 15,6" de AliExpress y Temu**: en España, un TABWEE P15 cuesta EUR 164 (notas de competencia). No cotizamos el precio puesto en Chile.
- **Los refrigeradores Samsung Family Hub con pantalla**, presentes en cocinas ABC1: no verificamos si se venden en Chile.

---

## 4. Propuesta de valor y posicionamiento

### 4.1 Nombre tentativo (opciones)

Antes de elegir, hay que revisar la disponibilidad de la marca en INAPI (clases 9 y 42) y del dominio .cl en NIC Chile. No lo hemos verificado.

| Nombre | A favor | En contra |
|---|---|---|
| **Sobremesa** | Une la familia, la comida y las recetas de la abuela; es cálido y muy chileno | Puede sonar sólo a comida; posiblemente lo usan restaurantes |
| **La Pizarra** | Todos entienden «la pizarra del refri, pero inteligente» | Genérico, difícil de registrar y de encontrar en Google |
| **Agendita** | Cercano y cariñoso, con diminutivo chileno | Suena sólo a calendario y a algo chico |
| **Ruka** | «Casa» en mapudungun; corto y memorable | Muy usado en marcas chilenas; hay que cuidar la sensibilidad cultural |
| **Casa Clara** | Promete orden y claridad | Poco distintivo |

**Recomendación:** probar **Sobremesa** y **La Pizarra** en los anuncios de las reservas y quedarse con la que convierta mejor.

### 4.2 Frase y posicionamiento

> **«Saca la casa de tu cabeza y ponla en la pared.»**
> La agenda del colegio, el menú con colación y once, la lista del súper y las recetas de la abuela, a la vista de toda la familia. Sin mensualidad obligatoria.

**Posicionamiento.** Para las familias chilenas que trabajan y viven a la carrera, [nombre] es el panel de cocina que junta la agenda, el menú y las recetas de la familia. A diferencia de Skylight o de un Echo Show, **habla chileno, no cobra por lo básico y se instala, se cambia y se atiende en Chile.**

La campaña no debe decir «la app de la mamá». Debe decir **«que la carga no esté sólo en tu cabeza»**: la pareja, los niños y la nana ven lo mismo.

**El punto débil de la promesa.** Si en el plan gratis alguien igual tiene que escribir todo en el panel, la carga cambia de lugar pero no desaparece. Ése es el punto débil frente a «WhatsApp + pizarra». Para corregirlo:

- **El plan gratis incluye 5 importaciones con IA al mes**: se le saca una foto o se sube el PDF de la circular del colegio y queda convertida en eventos. Plus las da ilimitadas. Cuesta ~CLP 3 a 12 por importación con los precios de Gemini de 2027 [E].
- En las entrevistas se pregunta **«¿quién anotaría las cosas, y cuándo?»**. Si la respuesta es «yo, como siempre», hay que mostrar que el panel le ahorra trabajo: importar la circular, el menú listo y la lista que se arma sola.

### 4.3 Segmentos prioritarios

1. **Mamás de 30 a 45 años que trabajan**, de GSE C1a, C1b o C2 (y AB), con 2 o más hijos de 3 a 12 años y en el Gran Santiago. Es el segmento principal. Compran por sí mismas y deciden en la vuelta a clases, en el Día de la Madre y en Navidad.
2. **Hijos adultos que hacen un regalo.** Puede ser «guarda las recetas de tu mamá» para el Día de la Madre, o un panel para los abuelos con visitas, fotos y recetas. El 11,6% de los hogares tiene sólo personas de 65 años o más ([INE](https://www.ine.gob.cl/sala-de-prensa/prensa/general/noticia/2025/03/27/primeros-resultados-del-censo-2024-18.480.432-personas-fueron-censadas-en-chile-manteni%C3%A9ndose-la-tendencia-de-envejecimiento-de-la-poblaci%C3%B3n)). Este segmento compensa la caída de la natalidad.
3. **Familias con nana puertas afuera.** El panel le muestra a la nana el menú, la lista y los quehaceres. Es un uso muy chileno que nadie atiende (idea propia, por validar).
4. **Padres separados con cuidado personal compartido** (idea propia, por validar). Son dos casas con dos paneles y el mismo calendario de los niños. Es un uso de alto valor, porque evita conflictos sobre «a quién le toca», y vende dos kits por familia.
5. **Familias con niños con TEA o neurodivergencia** (idea propia, por validar). Usan agendas visuales y rutinas con pictogramas, y el módulo de quehaceres y premios se acerca a eso. El canal son las terapeutas ocupacionales y los centros de terapia, una red que ya conoces por tu trabajo con agendas para centros. Referencia legal: la Ley TEA 21.545 (2023; dato de memoria, por confirmar). Hay que validar con terapeutas qué falta (pictogramas, rutinas por horario).
6. **Adultos mayores que viven solos o con cuidadora** («qué día es hoy, quién viene»). Ojo: si se guardan remedios, son datos de salud, que la ley trata como sensibles.
7. **Empresas y organizaciones** (desde 2027): empresas que lo den como beneficio de conciliación según la [Ley 21.645](https://www.garrigues.com/es_ES/noticia/chile-29-enero-entran-vigencia-nuevas-obligaciones-materia-conciliacion-vida-personal), cajas de compensación que lo vendan en cuotas por planilla, y nutricionistas que envíen menús a sus pacientes.

### 4.4 Por qué ahora

- **Hay una ventana, pero es angosta.** Skylight no vende directo en Chile y Alexa+ no ha llegado. No encontramos un competidor local ni latinoamericano, pero eso es ausencia de evidencia en las búsquedas, no una prueba. Se puede importar y hay genéricos.
- **La competencia está cobrando por lo básico.** Skylight cobra USD 79 al año por Plus (según prensa, antes cobraba USD 39 [secundaria]), Hearth cobra para configurar y Google le está quitando funciones al Nest Hub. «Sin mensualidad obligatoria» es un mensaje que hoy se entiende.
- **La IA se abarató.** Con los precios de Gemini desde el 1-01-2027, dictar una receta de 5 minutos cuesta ~CLP 14 con 3.5 Flash-Lite (USD 0,30 de entrada y 2,50 de salida por millón) y ~CLP 48 con 3.8 Flash (USD 1,50 y 7,50) ([precios de Gemini](https://aistudio.google.com/docs/pricing), 12-11-2026; cálculo [E]).
- **Hay una emoción a la que hablarle**: las recetas familiares se están perdiendo (Cadem, 2026) y existe la demanda que mostró Las Güelis.
- **La app ya existe y la usa una familia real.** El costo de desarrollo ya está pagado.

---

## 5. Oferta

### 5.1 Paquetes

Todos los costos y márgenes de esta tabla son estimaciones propias, con tablet de tienda a CLP 169.990. El margen se mide sobre la venta neta, sin IVA. Se le descuenta:

- la comisión de Flow (3,19% neto) y el recargo de cuotas, suponiendo que la mitad de las clientas paga en 3 cuotas sin interés;
- una reserva de CLP 2.000 por devoluciones;
- 3 meses de Plus incluidos;
- CLP 7.500 de puesta en marcha (la videollamada para conectar Google y las dudas de los primeros 90 días).

No incluye el costo de captar a la clienta ni la reserva para la base gratis (6.1).

| Paquete | Qué incluye | Precio con IVA | Costo neto | Margen bruto | Recomendación |
|---|---|---|---|---|---|
| **«Trae tu tablet»** (sólo software) | Activación de la app, licencia de Fully Kiosk (la app que deja la tablet fija en el panel), videollamada de configuración y 3 meses de Plus | **CLP 79.990** (probar 59.990) | ~15.800 | ~37.900 (56%). A 39.990 dejaba ~5.600 y perdía plata después de captar | Sí. Sirve a quien ya tiene una tablet Android utilizable, **~20% del GSE alto** [E]: 41,6% usa tablet (Subtel) y la mitad son iPad (StatCounter). Validarlo en las entrevistas |
| **Kit Pared 11"** | Xiaomi Redmi Pad 2 11" 4/128, soporte-marco que tapa la marca, cargador con sello SEC, cable de 3 m, todo configurado, despacho y 3 meses de Plus | **CLP 349.990** (fundadora 329.990; piloto 249.990) | ~204.000 | ~62.900 (21%) a lista. Fundadora ~47.000 (17%) | **Producto principal** |
| **Kit Pared Instalado** | Lo mismo, más marco de madera. Un maestro con boleta y seguro lo cuelga y lo conecta a un **enchufe que ya existe**, con canaleta (RM) | **CLP 419.990** (fundadora 399.990). **Por confirmar al cotizar la instalación** | ~255.800 (instalación estimada en CLP 35 mil) | ~67.000 (19%). A 389.990 bajaba a ~43.100 (13%) | Sí, en la RM. Lo eligen quienes no quieren perforar ni configurar |
| *(a pedido)* **Kit Grande 14"** | TCL NxtPaper 14 (14,3" mate), instalado | CLP 549.990 | ~401.800 | ~24.900 (5%) | **No conviene**, salvo a pedido, con abono y a un precio mayor |
| *(etapa 2)* **Panel importado 15,6"** | Panel de pared Android hecho en China, a US$230 FOB en lotes de 100 | CLP 449.990 | ~291.300 | ~55.500 (15%) | **No ahora**. Inmoviliza unos CLP 29 millones y exige certificar el modelo ante Subtel |

**Cómo se arma el costo del Kit Pared** (estimación propia; precios del 12-11-2026):

| Ítem | CLP con IVA | Fuente |
|---|---|---|
| Xiaomi Redmi Pad 2 11" 4/128 | **169.990** (caso de oferta: 159.990; distribuidor: ~153.000, no cotizado) | [SoloTodo](https://www.solotodo.cl/products/280328) (12-11-2026): lo más bajo con cualquier medio de pago es Movistar y ABC; Paris pide 179.990 y Claro 184.990. El 159.990 de Ripley ya no aparece. **Confirmar con factura el día de la compra** |
| Cargador Samsung 25 W con sello SEC | 18.990 | [Falabella](https://www.falabella.com/falabella-cl/product/131958624/) [snippet] |
| Cable USB-C de 3 m | 4.990 | [Paris](https://www.paris.cl/cable-usb-tipo-c-hoco-3-metros-certificado-carga-rapida-MKTR7MQDMC.html) |
| Soporte-marco de pared | 15.000 | [E]. Como referencia, IKEA vende un soporte a CLP 7.990 y uno iTodos cuesta 33.990 en Lider. El marco que tapa la marca hay que prototiparlo |
| Fully Kiosk PLUS (pago único por equipo) | 12.800 | [fully-kiosk.com](https://www.fully-kiosk.com/docs/en/legal/fully-plus-license): «8.90 EUR or 10.99 USD per device plus tax» |
| Fully Cloud Basic (administración de los equipos) | 0 | Viene gratis con PLUS (notas `hw_04`). **No usamos Fully Cloud Advanced en el plan gratis**: cuesta hasta EUR 1,18 por equipo al mes más IVA (≈ CLP 1.590 [E]) y multiplicaría por casi 5 el costo de mantener a una familia gratis. Si se usa, que sea sólo para las clientas de Plus |
| Caja, guía impresa y código QR | 3.000 | [E] |
| Configuración del equipo en taller (30 a 40 min) | 5.000 (neto) | [E] |
| Reserva de garantía (3% de la tablet) | 5.100 (neto) | [E] |
| Envío promedio | 6.000 | [E] (Blue Express y Starken cobran CLP 5.100–5.730 por 2 kg entre Santiago y Valparaíso, según [Tiendanube](https://www.tiendanube.com/blog/empresa-de-encomiendas-mas-barata-en-chile/), 21-08-2026). El seguro por el valor declarado no está cotizado |
| **Total pagado / total neto (recuperando el IVA con factura)** | **240.870 / 204.024** | |
| *Aparte, por cada kit vendido:* puesta en marcha (videollamada de Google de 30 a 60 min y dudas de los primeros 90 días, con 0,3 a 0,5 consultas al mes) | 7.500 (rango 5.000 a 10.000) | [E]. Grabar guías en video antes de la preventa para bajarlo |

**Sobre la tablet:**

- **El precio de la tablet cambia de un día para otro**: el 12-11-2026 pasó de 159.990 a 169.990. Antes de fijar los precios de lista y fundadora hace falta una **cotización por escrito de un distribuidor**. No conviene comprar 100 o más unidades a precio de oferta justo antes de marzo.
- La **Samsung Galaxy Tab A11+** es mejor equipo: tiene servicio técnico de marca y la función «Proteger batería», que limita la carga al 80–85%. Pero cuesta CLP 206.991 en Samsung Shop y 219.990 en Lider sin tarjeta; los 199.990 de Lider exigen la Tarjeta Lider BCI ([SoloTodo](https://www.solotodo.cl/products/362765), 12-11-2026), y una compra de la empresa con factura no usa una tarjeta de tienda personal. Con ese precio, el margen del Kit Pared baja a ~1–5% a 329.990 y a ~7–11% a 349.990 [E]. La revisora, con los costos de la v1, había calculado 8–9%. Sólo conviene si se consigue con factura por menos de unos CLP 170 mil.
- **Hay que verificar si la Redmi Pad 2 permite limitar la carga.** Una tablet enchufada todo el día puede hincharse dentro de la garantía legal de 6 meses. Si no se puede limitar, una alternativa es un enchufe con temporizador (idea propia, por probar).
- **La tablet tiene vida útil**: unos 3 a 4 años de actualizaciones de Android y del navegador, y de batería siempre enchufada [E]. La promesa de que sea gratis corre sobre un equipo que hay que cambiar. Conviene decirlo con transparencia y convertir el cambio en ingreso: **un programa de renovación con descuento a los 3 años**.
- **Consumo eléctrico**: una pantalla de ~6 W siempre encendida gasta ~4,3 kWh al mes, unos **CLP 500 a 1.000 al mes** [E], como una ampolleta LED. Se baja apagando la pantalla cuando no hay nadie, con la detección de movimiento de Fully Kiosk.

### 5.2 Planes

| | **Gratis: CLP 0 al mes, garantizado por escrito hasta el 31-12-2031** | **Plus: CLP 3.990 al mes o 39.990 al año (paga 10 meses y usa 12)** |
|---|---|---|
| Agenda | Calendario familiar y sincronización en ambos sentidos con Google; se ve en Android y en iPhone. **5 importaciones con IA al mes** (la circular del colegio en foto o PDF, convertida en eventos) | Igual, con **importaciones ilimitadas** |
| Comidas | Menú propio por espacios (desayuno, colación, almuerzo, once, cena) y lista del súper automática | **Menú de la semana listo**, por espacios: económico, rápido, colaciones y sin gluten. Lo hace una nutricionista sólo cuando Plus esté validado; antes, recetas propias y de abuelas con su consentimiento. Botón **«Mandar al carro de Jumbo o Santa Isabel»** con el total estimado |
| Recetas | Recetario de la familia ilimitado y **3 dictados al mes** | **Recetario chileno para descargar** (al lanzar, lo que se alcance a reunir; meta de 150 a 200 recetas y unas 8 nuevas al mes) y **dictados ilimitados** (con uso razonable) |
| Niños | Quehaceres, estrellas, premios y cuentas regresivas | «Mesada virtual», que sólo lleva la cuenta y no mueve plata |
| Pantallas | Cada pantalla que compraste funciona sin mensualidad; celulares de la familia ilimitados | Fotos en la pared (cuando exista), avisos por WhatsApp, respaldo y exportación a PDF |
| Soporte | Guías en video, correo y la puesta en marcha | **Soporte prioritario por WhatsApp** |
| Publicidad | **Nunca** | **Nunca** |

- **Precio fundadora de Plus:** CLP 2.990 al mes, **garantizado por 3 años** para las primeras 100 familias (y las del piloto). «De por vida» se lo va comiendo la inflación, y es una promesa que no se puede cambiar.
- **Cuánto pagaría una chilena [E]:** CLP 3.990 queda bajo Spotify Individual (CLP 4.950, dato de ago-2025) y alrededor de 38% bajo Skylight Plus. Está dentro del rango de la categoría, de USD 39 a 86 al año.

### 5.3 Lo que se garantiza por escrito, y qué pasa si la empresa cierra

**Por qué no «gratis para siempre».** En la Ley 19.496 del consumidor, la oferta y la publicidad obligan al proveedor. Si se promete «gratis para siempre» y después hay que cobrar o cerrar, se queda expuesta a reclamos ante el SERNAC y a demandas colectivas. Además, los números no lo sostienen: con 3.070 familias, la base gratis cuesta ~CLP 12,7 millones al año, aunque se dejen de vender kits [E]. Si en 2030 se dejara de vender, mantenerlas hasta fines de 2031 costaría ~CLP 23 millones [E].

**El mensaje:** «Sin mensualidad obligatoria. Lo básico, garantizado por escrito hasta el 31 de diciembre de 2031.»

**Lo que queda garantizado:**

- Calendario, sincronización, menú y lista propios, quehaceres y premios, cuentas regresivas, clima, PIN, modo noche, celulares de la familia, recetas propias, actualizaciones de seguridad y **exportar tus datos**.
- No se pone **publicidad**. Además, la Ley 20.606 prohíbe publicitar alimentos «ALTO EN» en apps dirigidas a menores de 14 años ([BCN](https://www.bcn.cl/leychile/navegar?i=1078836)).
- No se quita una función gratis para pasarla a Plus.
- Si algún día sube el precio de Plus, sube **sólo para clientes nuevos**.

**Cómo se respalda la garantía:**

- **Reserva por kit.** De cada kit y de cada licencia se apartan ~CLP 15 mil en una cuenta aparte, para operar la base en los años siguientes [E]. El rango va de 12 mil (36 meses a CLP 345) a 21 mil (60 meses). Al cierre del año 1 base son ~CLP 8,6 millones.
  - **En el escenario ajustado, la caja del año 1 no alcanza para apartar la reserva completa** (6.8). Si no se puede apartar, la promesa escrita debe ser más corta, por ejemplo de 3 años.
  - La reserva no es un gasto extra en los resultados de los años 1 a 3, porque allí ya se cuenta lo que cuesta operar la base cada año. Pero es plata que no se debe gastar.
- **Plan de continuidad publicado.** Si la empresa cierra o la fundadora no puede seguir:
  - se avisa con 6 meses de anticipación;
  - la pantalla pasa a un **modo local**, que funciona sin la nube, con exportación de los datos;
  - **se libera el código** para que la tablet no quede inservible.

  Esto hay que construirlo (8.1, punto 16). Lo exige tanto la confianza de la clienta como un futuro inversionista.

### 5.4 Ventas extra de pago único (ideas por validar; costos no cotizados)

- **Segunda pantalla para los abuelos** o **para la segunda casa** de padres separados: otro kit, que se sincroniza con la familia.
- **Libro impreso «Recetario de la familia»** con las recetas dictadas, para el Día de la Madre y Navidad. Hay que cotizar la impresión a pedido.
- **Sesión «Graba a la abuela»**: alguien visita para grabar y editar sus recetas.
- **Renovación de la tablet a los 3 años**, con descuento.

---

## 6. Economía por unidad

Todas las cifras de esta sección son estimaciones propias, salvo las que traen enlace.

### 6.1 Cuánto deja cada kit

**Supuestos:**

- IVA de 19%.
- **Comisión de Flow: 3,19% neto.** La tarifa es 3,19% + IVA con abono al día hábil siguiente ([web.flow.cl/tarifas](https://web.flow.cl/tarifas/), 12-11-2026), pero el IVA de la comisión es crédito fiscal.
- **Recargo por cuotas sin interés**, que paga el comercio sobre la tarifa de abono: 2 o 3 cuotas, +1,99% + IVA; de 4 a 6 cuotas, +3,49% + IVA; de 7 a 12 cuotas, +6,99% + IVA (misma fuente). **Las cuotas «normales» no tienen recargo**: el banco le cobra el interés a la clienta. Esto hay que confirmarlo con Flow por escrito.
- Reserva de CLP 2.000 por kit para devoluciones. La Ley 21.398 no deja excluir el retracto en una tablet comprada a distancia, y lo extiende a 90 días si no se envía la confirmación. Cada devolución significa envío de ida y vuelta, reconfigurar el equipo, venderlo como «caja abierta» con descuento y una devolución en Flow de CLP 202 + IVA. Con 3% a 5% de devoluciones, el costo está entre CLP 1.300 y 2.300 por kit. Hay que medirlo en el piloto.
- 3 meses de Plus incluidos, a CLP 1.000 de costo al mes.
- CLP 7.500 de puesta en marcha.

**Margen del Kit Pared según el precio y la forma de pago** (tablet de tienda a 169.990):

| Precio de venta | Contado o cuotas normales | 3 cuotas sin interés | 6 cuotas sin interés | 12 cuotas sin interés |
|---|---|---|---|---|
| CLP 299.990 | 26.000 (10%) | 20.000 (8%) | 15.500 (6%) | 5.000 (2%) |
| CLP 329.990 (v1) | 50.300 (18%) | 43.700 (16%) | 38.700 (14%) | 27.200 (10%) |
| **CLP 349.990 (recomendado)** | **66.400 (23%)** | **59.500 (20%)** | 54.200 (18%) | 42.000 (14%) |
| CLP 369.990 | 82.600 (27%) | 75.200 (24%) | 69.700 (22%) | 56.700 (18%) |

**Política de cuotas recomendada:** ofrecer hasta 3 cuotas sin interés. Quien quiera más paga cuotas normales del banco. En el modelo, la mitad de las clientas usa las 3 cuotas sin interés. Si se quieren ofrecer 6 o más, el precio tiene que ser 349.990 o más.

**Margen con esa política, según lo que cueste la tablet, y lo que queda después de captar y de apartar la reserva:**

| Precio | Tablet | Margen bruto | Después de captar (CLP 35 mil) | Después de captar y de la reserva (CLP 15 mil) |
|---|---|---|---|---|
| CLP 299.990 (fundadora de la v1) | Tienda 169.990 | 23.000 (9%) | −12.000 | −27.000 |
| CLP 329.990 | Tienda 169.990 | 47.000 (17%) | 12.000 | −3.000 |
| CLP 329.990 | Distribuidor (−10%) | 61.800 (22%) | 26.800 | 11.800 |
| **CLP 349.990** | **Tienda 169.990** | **62.900 (21%)** | **27.900** | **12.900** |
| CLP 349.990 | Oferta 159.990 | 71.600 (24%) | 36.600 | 21.600 |
| CLP 349.990 | Distribuidor (−10%) | 77.700 (26%) | 42.700 | 27.700 |
| CLP 369.990 | Tienda 169.990 | 78.900 (25%) | 43.900 | 28.900 |

**Las palancas, por kit [E]:** una tablet 10% más barata suma ~CLP 14,8 mil, y subir el precio de 329.990 a 349.990 suma ~CLP 16 mil.

**El piloto:** a 249.990, por transferencia y sin comisión, cada kit **pierde ~CLP 5,4 mil**, contando la puesta en marcha y 4 meses de Plus. Por Flow perdería ~15,4 mil. Con 20 familias son ~CLP 110 mil, que se asumen como costo de validación. **El piloto no cubre su costo**; para que lo cubra tendría que costar ~CLP 259.990.

**Lectura honesta.** Con tablets compradas en tienda, el hardware deja poco. Bajo CLP 329.990 **se pierde plata** después de captar y de reservar. Los precios de CLP 199 a 249 mil que sugieren las referencias de góndola hacen perder plata. El precio de lista tiene que ser al menos **CLP 349.990**, y aun así el kit queda justo bajo la línea de los 30 mil después de captar, salvo que la tablet salga más barata.

### 6.2 Cuánto cuesta mantener a una familia en el plan gratis (por mes)

| Concepto | Hoy (cómo funciona ahora) | **Año 1** (arreglo barato) | Desde el año 2 (tras migrar) | Base del cálculo |
|---|---|---|---|---|
| Nube | ~CLP 790 | **~CLP 260** | ~CLP 100 | Hoy cada tablet pregunta por cambios cada 20 segundos ([tarifas de Netlify](https://www.netlify.com/pricing/)). Preguntando cada 60 segundos baja a ~CLP 260. En [Cloudflare](https://developers.cloudflare.com/workers/platform/pricing/) baja a ~CLP 50–100, pero hay que migrar |
| IA (uso promedio: 1,5 dictados y 2 importaciones) | ~CLP 45 | ~CLP 45 | ~CLP 45 | Con Gemini 3.5 Flash-Lite: ~CLP 14 por dictado y ~3 a 12 por importación. Con 3.8 Flash, a ~48 por dictado, subiría a ~CLP 100 |
| Soporte después de los primeros 90 días (0,1 consultas por familia al mes × 20 min) | ~CLP 200 | ~CLP 200 | ~CLP 200 | [E]. Los primeros 90 días van en la puesta en marcha del kit |
| Administración de los equipos (Fully Cloud Basic) | 0 | 0 | 0 | Viene gratis con la licencia PLUS. Advanced no se usa en el plan gratis |
| **Total** | **~CLP 1.035 al mes** | **~CLP 505 al mes** | **~CLP 345 al mes** | |
| **% de familias en Plus necesario para cubrir ese costo** | 47% a 73% (imposible) | **23% a 36%** | **18% a 24%** | Según la mezcla de Plus mensual, anual o fundadora (6.3) |

**Conclusión.** Bajar el costo de la nube es requisito para poder prometer «costo mensual 0», pero no basta: aun después de migrar, Plus tendría que llegar a una de cada cinco familias, y el escenario base supone ~5%. **La base gratis la paga la reserva de cada kit, no Plus.** También hay un riesgo urgente: si se acaban los créditos, Netlify **pausa todos los sitios de la cuenta**, y la recarga automática viene apagada ([docs de Netlify](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/), act. 12-08-2026). Hay que activarla ya.

### 6.3 Cuánto deja cada suscriptor de Plus

| | Mensual (CLP 3.990) | Anual (CLP 39.990) | Fundadora (CLP 2.990 al mes) |
|---|---|---|---|
| Venta neta, sin IVA | 3.353 | 33.605 | 2.513 |
| Comisión de pago (3,19% neto) | −127 | −1.276 | −95 |
| Costo variable [E]: IA ilimitada, avisos por WhatsApp (~USD 0,02 cada uno, no verificado), fotos y nube extra | −1.000 al mes | −12.000 al año | −1.000 al mes |
| **Lo que deja** | **~CLP 2.226 al mes** | **~CLP 20.300 al año (1.694 al mes)** | **~CLP 1.417 al mes** |

Con la mitad de los suscriptores en el plan mensual y la mitad en el anual, cada suscriptor deja **~CLP 1.960 al mes**.

El contenido, es decir la nutricionista y las recetas, es un **costo fijo** de unos CLP 150 a 300 mil al mes [E]. Para pagarlo hacen falta **77 a 153 suscriptores**, o 106 a 212 si todos pagan el precio fundadora. Por eso no se contrata contenido fijo hasta medir la conversión real.

### 6.4 Cuántos pasan a pagar, y cuántos se dan de baja

| Referencia | Dato |
|---|---|
| Apps con versión gratis | 2,1% pasa a pagar al día 35 (mediana), contra 10,7% cuando no hay versión gratis. ~72% de los planes anuales se cancela en el primer año (~56% en 2025) ([RevenueCat](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026.md), 19-03-2026) |
| Hardware con suscripción opcional | El 24,5% de los dueños de cámaras Wyze paga un plan ([YipitData](https://ask.yipitdata.com/insights/wyze-camera-owners-no-tracked-cloud-plan), 21-08-2026). Es un panel de recibos electrónicos de EE.UU. **No es comparable**: en una cámara el plan pagado da la función principal, que es guardar el video |
| **Nuestro supuesto [E]** | Al terminar los meses de Plus incluidos, se suscribe el **5% (conservador), 10% (base) o 25% (optimista)** de las familias. Después, **el 6% del plan mensual se da de baja cada mes y sólo el 40% renueva el plan anual**. Con eso, al cierre del año 1 queda en Plus el **2,7%, 5,6% o 14,5%** de las familias, neto de bajas. Sin datos chilenos |

Quien ya pagó el panel y lo usa todos los días tiene más motivo para pagar que quien sólo bajó una app. Por eso el supuesto queda sobre el de las apps. Pero queda bajo el de Wyze, porque en el panel lo básico ya es gratis. **La conversión real se mide en abril y mayo de 2027 con las familias del piloto, antes de contratar contenido fijo.**

### 6.5 Punto de equilibrio

Es cuántos kits al mes, **o** cuántos suscriptores de Plus, hacen falta para pagar los costos fijos. Se usa una mezcla de 70% Kit Pared y 30% Kit Instalado. No incluye el costo de operar la base gratis ni la reserva, así que es un piso.

| Costos fijos al mes [E] | Precios de la v1, tablet de tienda (CLP 45.800 por kit antes de captar), con captación a 25 / 35 / 50 mil | **Precios ajustados, tablet de tienda (CLP 64.200)**, con captación a 25 / 35 / 50 mil | Precios ajustados, tablet a distribuidor (CLP 79.000), con captación a 25 / 35 / 50 mil | O bien, sólo con suscriptores Plus (CLP 1.960 cada uno) |
|---|---|---|---|---|
| CLP 500 mil: lo haces todo tú, sin sueldo (nube, contador, herramientas, contenido mínimo, seguro) | 24 / 46 / imposible | **13 / 17 / 35** | 9 / 11 / 17 | 255 |
| CLP 900 mil: más ayuda de medio tiempo para soporte y armado | 43 / 83 / imposible | **23 / 31 / 64** | 17 / 20 / 31 | 459 |
| CLP 1,8 millones: más una persona de jornada completa | 87 / 167 / imposible | **46 / 62 / 127** | 33 / 41 / 62 | 918 |
| CLP 3,3 millones: lo anterior más **tu sueldo** (~CLP 1,5 millones) | 159 / 306 / imposible | **84 / 113 / 233** | 61 / 75 / 114 | 1.684 |

- Con los precios de la v1 y una captación de 50 mil, el kit deja menos de lo que cuesta captarlo: **no hay punto de equilibrio**.
- El piso de CLP 500 mil sube desde los 350 mil de la v1, que no alcanzaban. Incluye:
  - el contenido mínimo, de 150 a 300 mil;
  - el contador, de 50 a 100 mil;
  - Netlify Pro (USD 20, ~CLP 20 mil);
  - el clima comercial, que no tiene precio publicado ([open-meteo.com](https://open-meteo.com/en/pricing));
  - las herramientas.
- La v1 ponía 3 millones para la fila con tu sueldo, pero 1,8 más 1,5 millones suman 3,3.

El costo de captar a una clienta (la publicidad necesaria para lograr una venta) es una **estimación sin ningún respaldo chileno**, y es la variable que más mueve el resultado (6.7). Hay que medirlo con las reservas y la preventa.

### 6.6 Del +2,7 millones de la v1 al resultado corregido (año 1, escenario base)

Base: 400 kits (70% Pared y 30% Instalado), 150 licencias, captación a CLP 35 mil por kit y 10 mil por licencia, y CLP 900 mil al mes de costos fijos. El motor de cálculo nuevo reproduce la v1 en +2,4 millones; la v1 publicó +2,7, y la diferencia es de método.

| Paso | Efecto | Resultado acumulado |
|---|---|---|
| v1, reproducida con el motor nuevo | | **+2,4 millones** |
| 1. Tablet a CLP 169.990 y no a 159.990 | −3,5 | −1,1 |
| 2. Comisión neta de 3,19%, porque el IVA de la comisión es crédito | +0,9 | −0,2 |
| 3. Las 100 fundadoras: kit a 299.990 y Plus a 2.990 | −2,5 | −2,7 |
| 4. La mitad de las clientas paga en 3 cuotas sin interés | −1,4 | −4,1 |
| 5. Nube sin migrar en el año 1 (CLP 505 por familia al mes, no 350) | −0,5 | −4,6 |
| 6. Puesta en marcha de CLP 7.500 por kit y por licencia | −4,1 | −8,7 |
| 7. Reserva por devoluciones de CLP 2.000 por kit (no 1.000) | −0,3 | −9,0 |
| 8. Instalación a CLP 35 mil (no 20 mil) | −1,8 | −10,8 |
| 9. Plus: 10% al terminar la prueba, con bajas (no 15% sin bajas) | −0,2 | −11,0 |
| 10. Las 20 familias del piloto también cuestan | −0,1 | **−11,1 millones** |
| *Si la mitad paga en 6 cuotas sin interés, en vez de 3* | *−1,0* | *−12,1 millones* |

A eso se suman los gastos previos al lanzamiento: ~CLP 1,7 a 2,2 millones en la versión austera, o 2,4 a 5,3 millones en la completa (11.2).

### 6.7 Escenarios del primer año comercial (marzo 2027 a febrero 2028) [E]

| | Conservador | **Base** | Optimista |
|---|---|---|---|
| Kits vendidos (70% Pared, 30% Instalado) | 150 | **400** | 900 |
| Licencias «Trae tu tablet» | 50 | **150** | 400 |
| Costo de captar a una clienta (kit / licencia) | 50.000 / 15.000 | **35.000 / 10.000** | 25.000 / 8.000 |
| Se suscribe a Plus al terminar la prueba | 5% | **10%** | 25% |
| Familias en Plus al cierre, netas de bajas | 6 (2,7%) | **32 (5,6%)** | 191 (14,5%) |
| Costos fijos al mes, sin tu sueldo | 500 mil | **900 mil** | 1,8 millones |
| Gasto en publicidad (incluido en la captación) | 8,2 millones | **15,5 millones** | 25,7 millones |
| **Con los precios de la v1** (329.990 / 389.990 / fundadora −30 mil / licencia 39.990) | | | |
| Ventas netas, sin IVA | 43,1 millones | 120,0 millones | 277,0 millones |
| **Resultado antes de tu sueldo e impuestos** | **−10,2 millones** | **−11,1 millones** | **−8,7 millones** |
| **Con los precios ajustados** (349.990 / 419.990 / fundadora −20 mil / licencia 79.990) | | | |
| Ventas netas, sin IVA | 48,5 millones | **133,6 millones** | 308,7 millones |
| Lo que dejan los kits, ya descontada la captación | 0,5 millones | **10,1 millones** | 33,7 millones |
| Lo que dejan las licencias | 1,2 millones | **4,2 millones** | 12,0 millones |
| Lo que deja Plus | 0,1 millones | **0,3 millones** | 1,8 millones |
| Costo de operar el plan gratis (CLP 505 por familia al mes) | −0,8 millones | **−1,9 millones** | −4,3 millones |
| Costos fijos | −6,0 millones | **−10,8 millones** | −21,6 millones |
| **Resultado antes de tu sueldo e impuestos** | **−5,0 millones** | **+1,9 millones** | **+21,5 millones** |
| **Precios ajustados y tablet a distribuidor (−10%)** | **−2,8 millones** | **+7,8 millones** | **+34,9 millones** |

**Sensibilidad al costo de captar a una clienta** (escenario base, año 1; resultado antes de tu sueldo e impuestos):

| Costo de captar por kit | Precios de la v1 | **Precios ajustados** | Ajustados y tablet a distribuidor |
|---|---|---|---|
| CLP 25 mil | −7,1 millones | **+5,9 millones** | +11,8 millones |
| CLP 35 mil | −11,1 millones | **+1,9 millones** | +7,8 millones |
| CLP 50 mil | −17,1 millones | **−4,1 millones** | +1,8 millones |
| CLP 70 mil | −25,1 millones | **−12,1 millones** | −6,2 millones |

Con los precios ajustados y la mitad de las clientas en 6 cuotas sin interés, el base queda en +0,8 millones.

**Proyección a 3 años del escenario base [E]:**

| | Año 1 | Año 2 | Año 3 |
|---|---|---|---|
| Unidades vendidas en el año (kits + licencias) | 400 + 150 | 700 + 300 | 1.000 + 500 |
| Costo de captar por kit | 35 mil | 30 mil | 28 mil |
| Familias acumuladas (con el piloto) | 570 | 1.570 | 3.070 |
| Familias en Plus al cierre, netas de bajas | 32 (5,6%) | 88 (5,6%) | 153 (5,0%) |
| Ventas netas, con precios ajustados | CLP 133,6 millones | CLP 240,7 millones | CLP 349,9 millones |
| Lo que deja Plus / lo que cuesta operar el plan gratis | 0,3 / 1,9 millones | 1,4 / 4,6 millones | 2,9 / 9,8 millones |
| Costos fijos al mes | 0,9 millones | 1,5 millones | 2,2 millones |
| **Resultado con precios ajustados** | **+1,9 millones** | **+11,2 millones** | **+16,8 millones** |
| Resultado con precios ajustados y tablet a distribuidor | +7,8 millones | +21,5 millones | +31,6 millones |
| Resultado con los precios de la v1 | −11,1 millones | −11,4 millones | −17,7 millones |

**Lectura honesta:**

- **Con los precios de la v1, el negocio no funciona nunca**: pierde más mientras más vende, porque cada kit deja menos de lo que cuesta mantener la base y los costos fijos.
- **El hardware y las licencias pagan todo, incluida la base gratis. Plus aporta poco**: en el año 3 deja 2,9 millones y la base gratis cuesta 9,8. La v1 decía que Plus pagaba la base; con bajas reales, no la paga.
- **El año 1 no paga sueldo** en ningún escenario base. Con precios ajustados deja ~CLP 160 mil al mes, y con tablet a distribuidor ~650 mil. Hacia el año 3 deja el equivalente a un sueldo modesto: ~CLP 1,4 millones al mes, o 2,6 millones con distribuidor.
- **El resultado depende más del costo de captar que de cualquier otra cosa.** Entre 25 y 50 mil por kit, el año 1 ajustado va de +5,9 a −4,1 millones. Por eso la primera tarea es medirlo con plata real.

### 6.8 Caja mes a mes (noviembre 2026 a febrero 2028) [E]

Supuestos:

- Antes de marzo se gasta el presupuesto austero, ~CLP 1,95 millones (11.2).
- El piloto paga por transferencia: 5 kits en diciembre y 15 en enero, a 249.990 cada uno. Cada kit pierde ~5,4 mil, pero no hay inventario, porque la familia paga antes de que se compre la tablet.
- En febrero se compran 2 kits de reemplazo, ~CLP 0,4 millones de plata parada, que se recupera al venderlos.
- **La preventa de enero y febrero se entrega en marzo y se cuenta en marzo.** Con Flow, la plata llega al día hábil siguiente, o al tercero con la tarifa de 2,89%, y la tablet se compra **después** de que la clienta paga. Por eso cada venta de la preventa deja caja en la misma semana. El problema de las «cuotas comercio» de Transbank, que pagan al comercio mes a mes, no se da con Flow.
- La publicidad se cuenta en el mes de la venta. En la práctica se gasta antes: suma ~CLP 1,9 millones más de caja necesaria en marzo.

| Mes | Kits vendidos (base) | Caja acumulada, precios v1 | **Caja acumulada, precios ajustados** | Caja acumulada, ajustados y distribuidor |
|---|---|---|---|---|
| nov-26 | — | −0,6 millones | −0,6 millones | −0,6 millones |
| dic-26 | 5 del piloto | −1,2 | −1,2 | −1,2 |
| ene-27 | 15 del piloto; abre la preventa | −1,7 | −1,7 | −1,7 |
| feb-27 | 2 de reemplazo | −2,5 | −2,5 | −2,5 |
| mar-27 | 48 (con la preventa) | −4,1 | −2,3 | −1,5 |
| abr-27 | 24 | −5,4 | **−2,6** (lo más bajo) | −1,6 |
| may-27 | 48 (Día de la Madre) | −6,6 | −2,2 | −0,4 |
| jun-27 | 36 (CyberDay) | −7,3 | −1,7 | +0,6 |
| jul-27 | 24 | −8,1 | −1,8 | +0,9 |
| ago-27 | 24 | −8,9 | −1,9 | +1,1 |
| sep-27 | 28 | −9,7 | −1,8 | +1,6 |
| oct-27 | 32 | −10,4 | −1,6 | +2,3 |
| nov-27 | 48 | −11,1 | −0,7 | +3,9 |
| dic-27 | 56 | −11,6 | +0,4 | +5,8 |
| ene-28 | 16 | −12,6 | −0,1 | +5,6 |
| feb-28 | 16 | **−13,6** | −0,6 | +5,3 |
| *Reserva para la base que convendría haber apartado* | | *8,6 millones* | *8,6 millones* | *8,6 millones* |

**Capital que conviene tener [E]:** unos **CLP 5 millones** en el escenario ajustado. Cubren el punto más bajo de caja (−2,6 millones), un mes de publicidad adelantada (~1,9 millones) y un margen. Si captar cuesta 50 mil, la caja del escenario ajustado cae a −6,6 millones al cierre del año 1. **En ningún escenario base alcanza la caja del año 1 para apartar la reserva completa de la base gratis.**

### 6.9 Escenario de sólo software y criterios para cambiar de rumbo

**Sólo software («Trae tu tablet» a CLP 79.990 + Plus), sin inventario ni garantía de hardware [E]:**

| Licencias en el año 1 | Costo de captar por licencia | Gasto en publicidad | Resultado del año 1 (costos fijos de CLP 500 mil al mes) |
|---|---|---|---|
| 300 | 15 mil | 4,5 millones | ~0 |
| 600 | 15 mil | 9,0 millones | +6,1 millones |
| 600 | 25 mil | 15,0 millones | +0,1 millones |
| 1.200 | 15 mil | 18,0 millones | +18,2 millones |

- El punto de equilibrio está en **22 licencias al mes** si captar cuesta 15 mil, o en **39** si cuesta 25 mil.
- **A favor:** no hay inventario, ni garantía de 6 meses, ni retracto de un equipo, ni dependencia del precio de la tablet. Es el camino de menor riesgo para una fundadora sola y con poco capital.
- **En contra:**
  - el mercado es más chico (~20% del GSE alto tiene una tablet Android utilizable [E]);
  - cada tablet es distinta, así que el soporte es más difícil;
  - no sabemos cuánto cuesta captar a alguien que ya tiene tablet;
  - sin el kit, se pierde la experiencia de «llega listo».

**Criterios para cambiar de rumbo, con números** (se miden en la preventa y del 2 de marzo al 15 de abril de 2027):

| Qué se mide | Meta | Si no se cumple |
|---|---|---|
| Costo de captar por kit (publicidad ÷ ventas pagadas) | ≤ CLP 35 mil | **Sobre CLP 40 mil**: se pasa al modelo de sólo software |
| Margen por kit después de captar | ≥ CLP 30 mil | **Bajo CLP 30 mil**: se pasa a sólo software, o se sube el precio, o se busca distribuidor. Con tablet de tienda a 349.990 queda en ~28 a 29 mil, así que hace falta el distribuidor |
| Precio de la tablet a distribuidor, por escrito | ≤ CLP 155 mil con IVA | Si no se consigue, la lista sube a 369.990 o se pasa a sólo software |
| Uso con clases: familias del piloto con cambios 5 días a la semana o más | ≥ 70% | **Bajo 50%**: se para la publicidad y se corrige el producto |
| Familias del piloto que pasan a Plus en abril y mayo | ≥ 10% | **Bajo 5%**: no se contrata contenido fijo; Plus se queda mínimo |
| Reservas reembolsables de desconocidas antes del 15-01-2027 | ≥ 20 | Con menos de 10, se cambia el mensaje o el precio antes de abrir la preventa |
| Lo que deja el negocio frente a tu trabajo actual | A los 12 meses, el resultado mensual supera lo que ganas como asesora en las mismas horas | Replantear la dedicación (no conocemos tu ingreso actual) |

---

## 7. Canales y lanzamiento

### 7.1 Piloto (diciembre 2026 a abril 2027)

- **Piloto 1, en diciembre: 5 familias de confianza**, instaladas en persona antes de Navidad. Sirve **sólo para probar la instalación, el soporte y el costo de la nube**. Diciembre a febrero son vacaciones escolares: no hay horario del colegio que sincronizar y las rutinas se rompen. Por eso el uso medido en enero no dice nada del uso real.
- **Piloto 2, en enero: hasta 15 familias más** (20 en total), con instalación por videollamada.
- **Quiénes:** familias de tu red, siempre con su permiso. Elegir una mezcla de Android y iPhone, con hijos en edad escolar, y por lo menos 3 familias con nana y 3 con la abuela cerca. Si se puede, sumar una familia con padres separados y una con un niño con TEA.
- **Precio:** CLP 249.990 por el kit, **pagado por adelantado por transferencia y con boleta**, así no hay inventario. Cada kit pierde ~5 mil (6.1). Plus va gratis hasta el 31 de marzo de 2027 y después se ofrece a precio fundadora (CLP 2.990, garantizado por 3 años). El objetivo son reseñas, videos y datos.
- **Antes de instalar a la primera familia:** política de privacidad, consentimiento del adulto por los datos de los niños y por la voz de la abuela, y aviso de que hay proveedores en el extranjero, todo firmado (9).
- **Qué se mide:**
  - **en diciembre y enero:** tiempo de instalación y de puesta en marcha, consultas de soporte, problemas de sincronización con Google y costo real de nube por familia;
  - **del 2 de marzo al 15 de abril, con clases:** uso semanal (días con al menos un cambio y quién lo hizo), si lo recomendarían y quién carga los datos;
  - **en abril y mayo:** cuántas pasan a pagar Plus.
- **Se decide en abril**, no al día 90. Hasta entonces, **no se compra más stock que lo vendido en la preventa**.

### 7.2 Reservas y preventa (noviembre 2026 a febrero 2027)

- **Reservas reembolsables desde noviembre.** Una página con el precio real, dos nombres y una reserva de CLP 20 mil que se devuelve si la clienta se arrepiente. Llegan por anuncios a personas desconocidas. Meta: 20 o más antes del 15 de enero. Con esto se mide el costo de captar, y la opinión de la red propia no sirve para eso, porque las conocidas dicen que sí por cariño.
- **Preventa en enero, con entrega en marzo.** Pago con un link de Flow, que no requiere desarrollo, con hasta 3 cuotas sin interés. Hay que comparar con Mercado Pago, cuyas cuotas no pudimos verificar.
- Se ofrece el precio fundadora a las primeras 100 familias: CLP 329.990, o 399.990 instalado. Después rige el precio de lista. **Se prueba un segundo precio** (por ejemplo 369.990) con una parte de los anuncios.
- **Variante para probar:** fundadoras al precio de lista, pero con 6 a 12 meses de Plus incluidos en vez del descuento. Cuesta ~CLP 3 a 9 mil por kit, contra ~17 mil netos que cuesta el descuento.
- Las tablets se compran **después de recibir el pago**, para no inmovilizar plata.
- **Ojo con el retracto:** en compras a distancia rige un retracto de 10 días, o de 90 si no se envía la confirmación por escrito. Para la tablet no se puede excluir. Siempre se envía la confirmación por correo.

### 7.3 Fechas clave en Chile

| Fecha | Qué hacer |
|---|---|
| **27 al 30 de noviembre de 2026**, Black Friday ([fecha](https://www.radioagricultura.cl/noticias/nacional/black-friday-2026-ya-tiene-fecha-en-chile-seran-cuatro-dias-de-ofertas-online-y-presenciales_20261020/), CCS) | **Comprar tablets sólo si la SpA ya tiene RUT e inicio de actividades**, para recuperar el IVA. Si no, comprar sólo las 5 del piloto 1 sin recuperar el IVA, o esperar: el precio de la Redmi Pad 2 baja seguido. Las ofertas suelen limitar las unidades por cliente. El plan no depende de esta fecha |
| **Diciembre de 2026** | Piloto 1: 5 familias de confianza |
| **Enero de 2027** | Piloto 2 y **preventa** con entrega en marzo, en hasta 3 cuotas sin interés. Se adelanta a la «cuesta de marzo», cuando las familias gastan ~CLP 200 mil en útiles y uniformes |
| **Primera semana de marzo de 2027**, vuelta a clases | Entrega de la preventa y lanzamiento: «ordena el año escolar desde el día 1». **Se mide el uso con clases hasta el 15 de abril** |
| **Abril de 2027** | **Decisión** con los criterios de 6.9 |
| **9 de mayo de 2027**, Día de la Madre | **Segundo lanzamiento**: «guarda las recetas de tu mamá», kit de regalo, libro impreso y regalo entre hermanos. El gasto promedio es de sólo unos CLP 20 mil por hogar ([CCS](https://www.radioagricultura.cl/noticias/nacional/ccs-hogares-destinaran-en-promedio-cerca-de-20-mil-para-celebrar-a-las-madres-en-su-dia_20260507/), 07-05-2026), así que conviene posicionarlo como un regalo premium compartido. Medir si convierte mejor que marzo |
| **Junio de 2027**, CyberDay (fecha por confirmar) | Oferta en cuotas. Participar oficialmente exige inscribirse con la CCS (costo no averiguado). La alternativa es una oferta propia esos días |
| **Septiembre de 2027**, Fiestas Patrias | Recetas chilenas en Plus y contenido |
| **Octubre de 2027** (CyberMonday) y **noviembre y diciembre de 2027** (Black Friday y Navidad) | Ofertas, kit de regalo y pantalla para los abuelos |

### 7.4 Canales, en orden

1. **Reseñas y videos de familias reales en Instagram**, con mamás reales y micro-creadoras, no una influencer grande. El 81,5% confía en reseñas de usuarios.
2. **Recomendaciones de quienes ya lo tienen:** «invita a otra familia y las dos ganan 3 meses de Plus».
3. **Canal presencial.** Un panel de pared se compra viéndolo. Las opciones, todas con costo no averiguado:
   - ferias de emprendedoras y ferias navideñas;
   - demostraciones en colegios y centros de padres;
   - un pop-up o showroom en un local amigo.
4. **Terapeutas ocupacionales y centros de terapia** para el segmento con TEA, una red que ya conoces.
5. **Venta directa en la web**, con Flow o Mercado Pago, en hasta 3 cuotas sin interés. Stripe no opera en Chile; en América Latina sólo está en Brasil y México ([stripe.com/global](https://stripe.com/global)).
6. **Empresas y organizaciones (desde mediados de 2027):**
   - cajas de compensación, con crédito por planilla y el riesgo a cargo de la caja;
   - empresas, como beneficio de conciliación de la Ley 21.645, a través de plataformas como Buk o Betterfly;
   - nutricionistas, con menús para sus pacientes. Desde septiembre de 2025 las isapres deben cubrir la consulta, según la [Superintendencia de Salud](https://www.superdesalud.gob.cl/noticias/2025/09/superintendencia-de-salud-ordena-a-isapres-entregar-cobertura-por-consulta-con-nutricionista-no-solo-en-caso-de-sobrepeso-u-obesidad/).

   Ninguno de estos convenios publica sus condiciones: hay que validarlas en reuniones. Captar ahí debería costar menos, pero no está verificado.
7. **Marketplaces, más adelante, como vitrina.** Falabella cobra de 8% a 10% y Ripley de 10% a 12%, frente al 12% a 14% de Mercado Libre (todas son fuentes secundarias). Al precio del kit, el 10% son ~CLP 35 mil, más que todo el margen después de captar.

### 7.5 Alianzas

- **Las Güelis**: contenido con recetas de abuelas de todo Chile. Buscan marcas que los apoyen.
- **Cencosud (Jumbo y Santa Isabel)**: pedir autorización o una alianza para el botón del carro. **No encontramos términos de uso comercial de su API.**
- **Una nutricionista o cocinera chilena** que haga los menús de Plus y que también sea vocera, sólo cuando Plus esté validado.
- **Apps escolares** (Papinotas, Lirmi, Napsis): explorar si se pueden importar sus calendarios.
- **Memoria Chilena**: tiene libros de cocina patrimoniales, pero hay que revisar los derechos de cada obra ([licencia](https://www.memoriachilena.gob.cl/602/w3-article-92899.html)).

---

## 8. Lo que falta en la app para venderla

El tamaño de cada tarea es una estimación propia, trabajando con IA como hasta ahora: **S** son unos días, **M** una o dos semanas y **L** tres semanas o más. La columna «Cuándo» sigue el plan de la sección 11, que supone unas 20 horas a la semana de dedicación [E].

### 8.1 Imprescindible

| # | Qué falta | Explicado simple | Tamaño | Cuándo |
|---|---|---|---|---|
| 1 | **Varias familias con un código de activación** | Hoy la app crea sola sólo la primera familia. **Con la clave `CLAVE_CREACION` ya se pueden crear más a mano** (`calendario/netlify/functions/api-familia.mts`), así que el piloto y la preventa se pueden dar de alta así. Falta el alta automática con un código por tablet | M | Después de la preventa (feb-mar 2027) |
| 2 | **Cuenta del adulto responsable** (correo o Google) | Hoy sólo existe el permiso de cada equipo y el PIN, que no es seguridad. Sin una cuenta no se puede recuperar el acceso si la tablet se pierde, ni cobrar, ni responder a quien pida borrar sus datos | M | Antes de mayo de 2027 |
| 3 | **Google con la cuenta del negocio** | Hoy cada familia tendría que crear un proyecto en Google Cloud, algo imposible para una clienta. Con **una cuenta de servicio del negocio**, la clienta comparte su calendario «Familia» con un correo y pega un código, y eso se hace en la videollamada. Hay que verificar que quien conecta sea el dueño del calendario. Para el piloto 1 hay un atajo sin programar: **un sitio de Netlify por familia**, porque `CLAVE_DUENO_GOOGLE` es una por sitio. Ver además los riesgos de la cuenta de servicio en 8.2 | M | Semanas 7 a 10 |
| 3b | **iCloud sin contraseñas** | Dejar fuera iCloud obliga a cada familia con iPhone a pasarse a Google Calendar, y esa fricción no está validada. Hay dos vías: (a) publicar el calendario del panel como suscripción o como cuenta CalDAV que el iPhone agrega en Ajustes (está por desarrollar; el código ya habla CalDAV como cliente, probado contra Radicale); (b) dejar configurada la cuenta de Google en el iPhone durante la videollamada | M | Sólo si más del 40% de las entrevistadas usa iCloud |
| 4 | **Gemini en el plan pagado** y un cupo por familia | El plan gratis usa lo que se le envía, como la voz de la abuela, para mejorar los productos de Google («Used to improve our products: Yes», [aistudio](https://aistudio.google.com/docs/pricing), 12-11-2026). Pasarse cuesta ~CLP 14 por receta con 3.5 Flash-Lite, o ~48 con 3.8 Flash (precios desde el 1-01-2027) | S | Semanas 1 y 2 |
| 5 | **Clima con licencia comercial** | La API gratis de Open-Meteo es «sólo para uso no comercial» ([open-meteo.com](https://open-meteo.com/en/pricing)). Hay que contratar el plan comercial, que no publica precio, o cambiar de proveedor, y guardar el clima por ciudad | S | Semanas 1 y 2 |
| 6 | **Bajar el costo de la nube y poner alarmas** | Pasar el sondeo de 20 a 60 segundos es cambiar una constante (`CADA = 20_000` en `calendario/lib/datos/repositorioNube.ts`). Además: activar la recarga automática de créditos y poner alarmas de consumo. Más adelante, repartir la revisión del calendario por familia, porque hoy tiene 24 segundos para todas y Netlify corta a los 30 | S (lo urgente) + M | Lo urgente en las semanas 1 y 2 |
| 7 | **Textos para la clienta y un asistente de primera configuración** | Hoy la pantalla muestra cosas como «GOOGLE_CUENTA_SERVICIO en Netlify» o «GEMINI_API_KEY» (en `CalendarioGoogle.tsx`, `CalendarioICloud.tsx` y `lib/dictados/textos.ts`) | S–M | Lo mínimo en las semanas 3 a 6 |
| 8 | **Términos, privacidad y consentimiento** | La política de datos debe cubrir a los niños, la voz de la abuela, a los proveedores en EE.UU. y el uso de IA, e incluir un canal para pedir los datos o borrarlos. Además hay que emitir boleta | Legal + S | **Antes de la primera familia** |
| 9 | **Cobro de Plus** con Flow o Mercado Pago | Cuando entra el pago se activan los extras, y cuando se cancela se apagan. El plan gratis nunca se corta y se puede cancelar por el mismo medio por el que se contrató | M | Antes de junio de 2027, cuando terminan los 3 meses incluidos de las primeras compradoras. Las 20 familias del piloto pagan abril y mayo con un link de pago, a mano |
| 10 | **Preparación de las tablets** | Android con Fully Kiosk, que abre la app sola al encender o después de un corte de luz. Un paso a paso por equipo, el límite de carga de la batería y la pantalla que se apaga cuando no hay nadie | S | Semanas 3 a 6 |
| 11 | **Panel de soporte y respaldo** | Una pantalla tuya para ver el estado de cada familia (versión, última sincronización, errores), con respaldo diario y opción de exportar | M | Abril de 2027 |
| 12 | **Pendientes del `PLAN.md`** | Cambiar sólo un día de un evento que se repite (lo pidió la familia), la vista del celular, dejar más visible «borrar sólo un día» y probar con Google en ambos sentidos y con el dictado usando cuentas reales | M | 12 al 28 de febrero de 2027 |
| 13 | **Un Plus mínimo** | El botón «Mandar al carro de Jumbo», que ya funciona con su API pública, dictados e importaciones ilimitados, y recetas propias y de abuelas con su consentimiento. Sin nutricionista hasta validar Plus | S–M | Semanas 11 a 13, porque los kits de marzo traen 3 meses de Plus |
| 14 | **Seguridad de la clave del negocio** | Una sola clave abre los calendarios de **todas** las familias. Hay que guardarla bien, dar el mínimo permiso posible y pedir una revisión externa | S + revisión | Lo básico en las semanas 3 a 6; la revisión externa antes de pasar las 20 familias |
| 15 | **Importación con IA en el plan gratis**, con tope de 5 al mes | La circular del colegio convertida en eventos, para que la carga baje de verdad (4.2) | S | Con el punto 13 |
| 16 | **Modo local y exportación completa** (plan de continuidad) | Si la nube se apaga, la pantalla sigue funcionando con los datos guardados en la tablet y se pueden exportar | M | Antes de 2028 |

### 8.2 Necesario para escalar (más de 100 familias)

1. **Revisar si Google permite la cuenta de servicio a escala, y planificar OAuth.**
   - **No está verificado** que los términos de uso de las APIs de Google y su política de datos de usuario permitan usar una cuenta de servicio del negocio para leer y escribir calendarios de consumidores a escala, sin pasar por la pantalla de consentimiento. Si Google suspende ese único proyecto, se apagan los calendarios de todas las familias a la vez.
   - Mitigación: que un abogado o un desarrollador con experiencia revise los términos en el primer trimestre de 2027. Usar **un proyecto de Google Cloud por cada lote de familias**; así una suspensión no afecta a todas, a cambio de tener más claves que cuidar.
   - **Fecha:** decidir en marzo de 2027 y, si hace falta, tener OAuth verificado antes de las ~100 familias, que en el escenario base se alcanzan hacia mayo de 2027.
   - **Cuándo aplica la verificación de Google.** Con la cuenta de servicio y calendarios compartidos no se usa OAuth sobre el calendario, así que no aplican ni la verificación de permisos sensibles ni el tope de 100 usuarios. Un «Iniciar sesión con Google» que sólo pide el correo y el perfil tampoco es un permiso sensible. La verificación sólo hace falta si se pasa a OAuth con permisos de calendario: leer el calendario es un permiso «sensible», la revisión toma hasta 10 días, no tiene costo publicado y pide dominio propio, página pública, política de privacidad en el mismo dominio y un video ([Google](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)). Sin verificar, el tope es de 100 usuarios nuevos ([ayuda de Google](https://support.google.com/cloud/answer/7454865)). La página no menciona la auditoría CASA. Con la cuenta de servicio, el riesgo real es la seguridad de la clave (punto 14) y las cuotas de la API.
2. **Cuotas de la API de Google Calendar.** Google confirma que pasar ciertos límites de uso «is planned to incur charges ... later in 2026»: el umbral es 1.000.000 de solicitudes al día por proyecto, con 90 días de aviso. El límite por minuto es 10.000 por proyecto ([Google](https://developers.google.com/workspace/calendar/api/guides/quota), 12-11-2026).
   - Si se sincroniza cada 5 minutos (288 veces al día) con 1 a 3 calendarios por familia, el umbral diario se pasa con **unas 1.160 a 3.470 familias** [E]. Eso ocurre en el año 2 o 3 del escenario base (1.570 y 3.070 familias).
   - Si todas se sincronizan en el mismo minuto, 3.050 familias con 3 calendarios suman ~9.150 solicitudes, al borde del límite por minuto.
   - **Qué hacer:** pasar a las notificaciones push de Google y a la sincronización por `syncToken` **antes de las ~1.000 familias**, repartir la sincronización a lo largo de los 5 minutos y dejar presupuesto para un posible cobro (monto no publicado).
3. **Una nube más barata:** Cloudflare, a unos CLP 50 a 100 por familia al mes, o una base de datos de verdad. Hacerlo al comienzo del año 2 (es lo que supone el modelo).
4. **Planes y funciones según suscripción**, el catálogo de recetas chilenas para descargar y la opción de compartir recetas.
5. **Administración remota de las tablets.** En todas, sólo Fully Cloud Basic, que viene gratis con PLUS. Advanced (hasta EUR 1,18 por equipo al mes más IVA) sólo para clientas de Plus, o no usarlo. Publicar los cambios por etapas.
6. **Cumplimiento completo de la Ley 21.719**: registro de qué datos se tratan, contratos con proveedores y procedimiento ante filtraciones.
7. **Facturación y boleta automáticas**, y recuperación de pagos fallidos.
8. **Correo dedicado con dominio propio** (Fase 3 del `PLAN.md`).
9. **Limpieza de audios sin receta** y límite de espacio por familia.
10. **Perfiles con permisos** (idea propia): la nana y los abuelos ven el menú y las tareas, pero no editan el calendario.

### 8.3 Deseable

- **Fotos en la pared.** Desde marzo de 2025, Google Fotos sólo deja que el usuario elija las fotos una por una ([Google](https://developers.googleblog.com/en/google-photos-picker-api-launch-and-library-api-updates/)).
- Avisos de quehaceres en el celular (gratis) y atajos de Siri.
- Outlook.
- Pictogramas y rutinas por horario, para el segmento con TEA (validar con terapeutas).
- Los casos raros de sincronización con Google que ya están anotados.
- Exportar el calendario.
- Mesada virtual.
- «Panel de los abuelos». Ojo: guardar remedios sería guardar datos de salud, que son sensibles.

---

## 9. Aspectos legales y operativos en Chile

| Tema | Qué dice | Qué hacer |
|---|---|---|
| **Formalización** | Constituir la sociedad por Tu Empresa en un Día «es de costo cero», y el inicio de actividades en el SII «no tiene costo» ([Sercotec](https://www.sercotec.cl/wp-content/uploads/2024/04/Manual-para-formalizar-un-emprendimiento.pdf), 22-04-2024; verificado el 12-11-2026). La patente municipal y los derechos de aseo varían según el municipio (misma fuente; no averiguamos el monto) | Crear una **SpA** aparte de tu actividad como asesora, para separar riesgos. Abrir cuenta bancaria de empresa y contratar contador. Si la SpA no está lista para el piloto, preguntar al contador cómo cobrarlo |
| **Impuestos** | En el régimen Pro Pyme, el impuesto de primera categoría es **12,5% en 2025, 2026 y 2027, y 15% en 2028**. Para tener la tasa rebajada hay que cumplir la cotización del empleador de la Ley 21.735 ([Circular SII 53/2025](https://www.sii.cl/normativa_legislacion/circulares/2025/circu53.pdf), 03-09-2025, Ley 21.755) | El año comercial 1 termina en febrero de 2028, así que los resultados de 2028 ya pagan 15%. Todos los resultados de este informe son antes de impuestos |
| **Boleta e IVA** | La boleta electrónica del SII es gratis. Desde el 1-05-2025 hay que entregar el comprobante en el momento de la venta. Desde 2023 los servicios pagan IVA, así que **la suscripción lleva 19%** ([SII](https://www.sii.cl/noticias/2022/211222noti01aav.htm)) | Comprar las tablets **con factura** para recuperar el IVA. Confirmar con el contador cómo emitir la boleta automática de la suscripción (costo no averiguado) |
| **Garantía legal** | La tablet tiene **6 meses** de garantía y el cliente elige entre reparación, cambio o devolución. Se prohíbe vender seguros que cubran esa garantía ([Ley 21.398](https://www.diariooficial.interior.gob.cl/publicaciones/2021/12/24/43136/01/2061725.pdf)). Sernac fiscalizó en septiembre de 2026 cómo informan la garantía los comercios online; las multas llegan a 300 UTM ([Radio Agricultura](https://www.radioagricultura.cl/noticias/nacional/sernac-fiscaliza-plataformas-de-comercio-electronico-por-informacion-sobre-garantia-legal-a-consumidores_20260909/)) | Explicar la garantía de forma destacada en la página. Tener 2 tablets de reemplazo para cambiar el equipo en 48 horas. Verificar si la garantía de fábrica se mantiene al revender la tablet en un kit (no verificado) |
| **Retracto** | 10 días en compras online, o 90 si no se envió la confirmación escrita. En los bienes sólo se puede excluir en casos que no aplican a una tablet; en los servicios sí, si se avisa de forma destacada antes de pagar ([Ley 21.398](https://www.diariooficial.interior.gob.cl/publicaciones/2021/12/24/43136/01/2061725.pdf), art. 3 bis b) | Reserva de CLP 2.000 por kit (6.1), medirla en el piloto. Enviar siempre la confirmación por correo |
| **Publicidad y promesas** | En la Ley 19.496, la oferta y la publicidad obligan al proveedor | No prometer «gratis para siempre» ni Plus «de por vida». Escribir la garantía con fecha (hasta el 31-12-2031) y publicar el plan de continuidad (5.3) |
| **Cancelar la suscripción** | Se debe poder terminar por el mismo medio por el que se contrató, sin condiciones más difíciles que para contratar (art. 17 B) | Poner un botón «Cancelar» en la app |
| **Datos personales** | La Ley 21.719 **rige el 1-12-2026, salvo que antes se publique la ley de postergación**. El Senado aprobó el 28-10-2026, en primer trámite, postergarla al 15-10-2027 (boletín 18.623-07), y mientras no se publique rige la fecha original ([Garrigues](https://www.garrigues.com/es_ES/noticia/senado-chileno-aprueba-proyecto-ley-busca-postergar-15-octubre-2027-entrada-vigencia-nueva), 30-10-2026). La [ficha del Senado](https://tramitacion.senado.cl/appsenado/templates/tramitacion/index.php?boletin_ini=18623-07), consultada el 12-11-2026, sigue «En tramitación». **No verificamos** las multas (se citan 20.000 UTM o 4% de los ingresos) ni el art. 16 quáter sobre el consentimiento de los padres por los menores de 14 años | **No contar con la postergación.** Es requisito para empezar el piloto tener firmados la política de privacidad, el consentimiento del adulto por los datos de los niños y por la voz de la abuela, y el aviso de proveedores en el extranjero (Google, Netlify). Aunque sea con plantillas revisadas por un abogado. Además: un canal para pedir o borrar datos, y borrar los audios si la familia lo pide. Verificar las multas y el art. 16 quáter en el texto oficial (BCN) con el abogado |
| **Instalación en la casa** | Si la instalación incluye poner un enchufe o pasar cable por el muro, es un trabajo eléctrico que debe hacer un instalador autorizado por la SEC (dato a confirmar). Perforar muros sin seguro expone a daños en cañerías o cables | Limitar el servicio a colgar y conectar a un enchufe que ya existe, con canaleta. Subcontratar a un maestro con boleta, contratar un seguro de responsabilidad civil (no cotizado) y cotizar el costo real con traslado antes de publicar el precio del Kit Instalado |
| **Publicidad de alimentos** | La Ley 20.606 prohíbe publicitar alimentos «ALTO EN» a menores de 14 años, también en apps y juegos | Ninguna publicidad en el módulo de niños. Lo mejor: no tener publicidad en ninguna parte |
| **Derechos de las recetas** | La Ley 17.336 protege la redacción, las fotos y las recopilaciones, no la idea de una receta ([WIPO](https://www.wipo.int/wipolex/es/text/1172)). No encontramos jurisprudencia chilena | Escribir recetas propias. No copiar textos ni fotos de Nestlé, Jumbo o blogs. Pedir consentimiento escrito a cada abuela que comparta su receta |
| **Licencias de terceros** | Open-Meteo gratis es no comercial. Gemini gratis usa los datos. Fully Kiosk se paga por equipo. La API de Jumbo no tiene términos públicos. Falta revisar si los términos de Google permiten la cuenta de servicio a escala (8.2) | Contratar los planes pagados, pedir autorización a Cencosud y hacer revisar los términos de Google |
| **Plata de los niños** | Mover dinero de verdad entra en la regulación de la CMF y la Ley Fintech | Que la «mesada virtual» sólo lleve la cuenta |
| **Importación** (etapa 2) | Se paga 6% de arancel más IVA ([Aduana](https://www.aduana.cl/cuanto-impuesto-se-paga-al-importar/aduana/2026-09-07/115201.html), vista en el buscador). Con el certificado de origen del TLC con China, el arancel es 0% (confianza media). Según una página de Aduanas de 2020, sobre US$1.000 FOB se necesita agente de aduanas ([Aduana](https://www.aduana.cl/que-debo-hacer-para-importar-una-mercancia/aduana/2020-11-16/105953.html), 16-11-2020, vista en el buscador). Que las compras online de hasta US$500 paguen sólo IVA sale de otra página que tampoco se pudo leer. **Ambas reglas están por confirmar** (aduana.cl bloquea la lectura). Los equipos con Wi-Fi necesitan **certificado Subtel por modelo** ([Res. 1985/2017](https://www.subtel.gob.cl/wp-content/uploads/2019/10/Refundido_Res_1985_de_2017_2_855_2019.pdf)), cuyo costo no encontramos. Los cargadores necesitan **sello SEC** | **No importar en la etapa 1.** Las tablets compradas en Chile ya vienen certificadas. Usar siempre un cargador comprado en Chile con sello SEC. Antes de traer muestras, confirmar las dos reglas con un agente de aduanas |
| **Marca** | Registro en INAPI (no averiguamos las tasas) | Registrar el nombre elegido en las clases 9 y 42 antes de invertir fuerte en publicidad |

---

## 10. Riesgos y cómo mitigarlos

| Riesgo | Probabilidad / impacto | Cómo mitigarlo |
|---|---|---|
| **Captar a una clienta cuesta más de lo supuesto** (no hay ningún dato chileno) | Alta / muy alto | Medirlo con reservas reembolsables antes de comprar stock. Sobre CLP 40 mil por kit, pasar a sólo software (6.9). Privilegiar recomendaciones, el canal presencial y las empresas |
| **El hardware deja poco margen** | Alta / alto | Lista a 349.990 o más, cotización de distribuidor por escrito, hasta 3 cuotas sin interés, comprar sólo contra pago y sumar ventas extra |
| **El precio y el stock de la tablet cambian** (pasó de 159.990 a 169.990 en un día) | Alta / medio | Cotización por escrito antes de fijar precios, no acumular stock y confirmar el precio con factura el día de la compra |
| **«Compro una tablet y abro la web»** (la versión casera cuesta ~CLP 178 mil) | Media / alto | Activación con código, licencia a 79.990 y el valor del servicio: soporte-marco, Google conectado, cambio en 48 h, garantía y contenido |
| **La promesa de «gratis» se vuelve una deuda que crece** | Media / alto | Garantía escrita con fecha (2031), reserva de ~CLP 15 mil por kit, plan de continuidad y migrar la nube en el año 2 |
| **La nube se dispara o Netlify pausa a todos** | Alta si no se actúa / muy alto | Recarga automática ya, consultas cada 60 segundos, alarmas de consumo y plan para pasar a Cloudflare |
| **Google suspende la cuenta de servicio o cambia sus reglas** | Baja–media / muy alto | Revisión legal de los términos, un proyecto por lote de familias, plan de OAuth verificado antes de las ~100 familias y un plan B de sólo lectura |
| **Cuotas o cobro de la API de Google** | Media (desde ~1.000 familias) / medio | Notificaciones push y `syncToken` antes de las 1.000 familias, sincronización repartida y presupuesto para un posible cobro |
| **Filtración de datos** (una clave abre todos los calendarios; hay datos de niños) | Baja–media / muy alto | Revisión de seguridad externa antes de pasar las 20 familias, clave en secretos, mínimo permiso, registro de accesos y protocolo ante filtraciones según la Ley 21.719 |
| **El piloto se mide mal** (vacaciones escolares) | Alta si no se corrige / alto | Medir el uso con clases, del 2 de marzo al 15 de abril, y decidir en abril |
| **Dependencia de una sola persona** | Alta / alto | Guías en video, panel de soporte, plan de continuidad (modo local, exportación y código liberado) y contratar ayuda al llegar a unas 25 ventas al mes |
| **Te ahoga el soporte** | Alta / alto | Puesta en marcha estandarizada, guías en video antes de la preventa, respuestas rápidas en WhatsApp Business y piloto chico |
| **Llegan competidores globales o se importan** (Skylight en español, Cozyla, genéricos, Alexa+ en 2027) | Media / medio | Ventaja local: recetas chilenas, once y colación, Jumbo, colegio, soporte, garantía y comunidad. Sin mensualidad obligatoria |
| **Recargo de cuotas** | Alta si se ofrecen 6 o más / medio | Hasta 3 cuotas sin interés; si se ofrecen más, cuotas normales del banco. Confirmar con Flow por escrito |
| **Baterías hinchadas o fallas de la tablet** dentro de la garantía | Media / medio | Equipos con límite de carga, reserva de 3%, 2 tablets de reemplazo y protocolo de cambio rápido |
| **Daños en la instalación** | Baja / medio | Sólo colgar y conectar a un enchufe existente, maestro con boleta y seguro de responsabilidad civil |
| **Mercado chico que se achica** | Alta / medio | Abuelos, padres separados, TEA, empresas y, más adelante, otros países de habla hispana |
| **Consumidor cauto** (el ticket del CyberMonday cayó 15%) | Media / medio | Cuotas, precio fundadora y una comparación clara de lo que cuesta en 3 años |
| **Muchos cancelan Plus** (72% de los anuales se va el primer año, según RevenueCat) | Alta / medio | Ya está en el modelo. Contenido nuevo cada semana y plan anual con descuento. El precio fundadora queda garantizado por 3 años |
| **Sube el dólar** (subió el 10-11-2026) | Media / medio | No acumular stock, revisar precios cada trimestre y comprar contra pago |
| **Cencosud cierra o limita su API** | Media / bajo | Que el carro sea un extra, no la base del negocio. Pedir autorización |
| **Error del dictado con IA** (inventa un ingrediente) | Media / bajo | Que la familia revise y apruebe la receta, que se marque lo dudoso y que se guarde el audio original si la familia quiere |

---

## 11. Plan de 90 días (13 de noviembre de 2026 a 11 de febrero de 2027)

### 11.1 Hitos

El plan supone unas **20 horas a la semana** [E], porque sigues trabajando como asesora. Se recortó a lo que no se puede hacer a mano. Lo que sí se puede hacer a mano se hace a mano hasta después de la preventa:

- el alta de familias con `CLAVE_CREACION`;
- el cobro del piloto por transferencia;
- el soporte por WhatsApp.

| Semanas | Fechas | Qué se hace | Hito |
|---|---|---|---|
| **1–2** | 13 al 29 de noviembre | Entre 10 y 15 entrevistas **para entender el problema**: qué calendario usan, quién anotaría las cosas y cuándo, y si hay nana o abuelos. Página de **reservas reembolsables de CLP 20 mil** con dos nombres y anuncios a desconocidas. Crear la SpA y hacer el inicio de actividades. Encargar al abogado las plantillas de términos, privacidad y consentimientos. Arreglos técnicos de días: Gemini pagado (4), recarga de Netlify y alarmas, sondeo a 60 s (6) y clima (5). **Black Friday: comprar sólo si la SpA tiene RUT** | SpA creada. Reservas abiertas. Nube y Gemini en regla |
| **3–6** | 30 de noviembre al 27 de diciembre (con Navidad) | Privacidad y consentimientos **firmados antes de la primera instalación**. Preparar las tablets (10), seguridad básica de la clave (14) y textos mínimos para la clienta (7). Google con un sitio de Netlify por familia, sin programar. Prototipo del soporte-marco. **Piloto 1: 5 familias, en persona**, cobradas por transferencia y con boleta | 5 familias funcionando antes de Navidad. Medidos el tiempo de instalación, las consultas y la nube por familia |
| **7–10** | 28 de diciembre al 24 de enero | Google con la cuenta del negocio (3). Guías en video. **Abrir la preventa** con link de Flow y hasta 3 cuotas sin interés, con entrega en marzo y dos precios. Piloto 2: hasta 15 familias más (20 en total), por videollamada y pagadas por adelantado | **20 o más reservas pagadas de desconocidas antes del 15 de enero**. Costo por reserva medido |
| **11–13** | 25 de enero al 11 de febrero | Revisión de seguridad externa antes de pasar las 20 familias (14). Plus mínimo e importación con IA en el plan gratis (13 y 15). **Cotización por escrito de un distribuidor** y confirmación de Flow sobre las cuotas. Contactos: Las Güelis, una caja de compensación, 3 nutricionistas y terapeutas ocupacionales | **30 o más kits pagados en la preventa.** Costo de captar por kit ≤ CLP 40 mil. Precio de lista definido con la cotización |

**Después de los 90 días:**

- **12 al 28 de febrero:** pendientes del `PLAN.md` (12) y preparar las entregas de marzo.
- **Marzo:** entregar la preventa y lanzar. Medir el uso con clases hasta el 15 de abril. Alta de familias a mano mientras no esté el código de activación (1).
- **Abril:** **decidir** con los criterios de 6.9; panel de soporte (11).
- **Antes de junio:** cobro de Plus (9) y cuenta del adulto (2).
- **Mayo:** segundo lanzamiento para el Día de la Madre.
- **La decisión de abril:**
  - **si se cumplen los criterios:** seguir y comprar stock sólo contra pago;
  - **si el uso es bueno, pero captar cuesta más de 40 mil o el margen queda bajo 30 mil:** pasar a «Trae tu tablet» más Plus;
  - **si el uso es malo:** parar la publicidad y corregir el producto antes de vender más.

### 11.2 Presupuesto para los 90 días [E]

| Ítem | **Versión austera (recomendada)** | Versión completa (v1) | Nota |
|---|---|---|---|
| SpA e inicio de actividades | 0 | 0 | Verificado (Sercotec) |
| Contador (3 meses) | 150.000 | 150.000 – 300.000 | [E] |
| Abogado | 300.000 – 500.000: revisa plantillas de términos, privacidad y consentimientos | 400.000 – 800.000: redacción completa, más garantía y retracto | [E] |
| Registro de marca en INAPI y dominio .cl | 150.000 (1 clase) | 150.000 – 400.000 (1 o 2 clases) | [E]: verificar las tasas en inapi.cl y nic.cl |
| Nube (Netlify Pro: USD 20 al mes más recargas), Gemini pagado y clima comercial | 150.000 | 150.000 – 350.000 | El precio del clima no está publicado |
| Revisión de seguridad externa | 400.000 (antes de pasar las 20 familias) | 400.000 – 900.000 | [E] |
| Nutricionista | **0**: recetas propias y de abuelas, con consentimiento, hasta validar Plus | 300.000 – 600.000 | [E] |
| Prototipos del soporte-marco | 100.000 | 100.000 – 250.000 | [E] |
| Fotos y videos | **0**: los hacen las familias del piloto, con su permiso | 150.000 – 400.000 | [E] |
| Publicidad para reservas y preventa | 300.000 – 500.000 | 400.000 – 800.000 | [E] |
| Imprevistos (10%) | ~155.000 – 195.000 | 220.000 – 480.000 | |
| **Total de gastos** | **~CLP 1,7 a 2,2 millones** | **~CLP 2,4 a 5,3 millones** | |
| Kits del piloto | 0 por adelantado: las familias pagan antes de que se compre la tablet. Pierde ~CLP 5 mil por kit, ~0,1 millones en total | ~4,6 millones de inventario | |
| 2 kits de reemplazo | ~0,4 millones (plata parada, se recupera) | | |
| Tablets de la preventa | 0 por adelantado | 0 | Se compran después de que la clienta paga |

**Plata necesaria:** ~CLP 2,5 millones para llegar a marzo con la versión austera. Para atravesar el año 1 con los precios ajustados conviene tener **~CLP 5 millones** (6.8).

Antes, en la versión completa, se pedían 7 a 10 millones. Esa versión se deja para cuando Plus y el costo de captar estén validados.

---

## 12. Glosario breve

- **Margen bruto:** lo que queda de la venta sin IVA después de pagar el producto, la comisión, las reservas y la puesta en marcha.
- **Costo de captar a una clienta:** lo que se gasta en publicidad y promoción para lograr una venta (en inglés, CAC).
- **Conversión a pago:** el porcentaje de familias que se suscribe a Plus.
- **Bajas:** las suscriptoras que cancelan cada mes, o que no renuevan el plan anual.
- **Punto de equilibrio:** cuánto hay que vender para no perder plata.
- **Reserva para la base:** plata que se aparta de cada venta para mantener funcionando, sin costo para la familia, el plan gratis de los años siguientes.
- **Cuotas sin interés:** las paga el comercio, con un recargo. **Cuotas normales:** el banco le cobra el interés a la clienta.
- **Kiosco (Fully Kiosk):** una app que deja la tablet fija en el panel y la vuelve a abrir sola después de un corte de luz.
- **Cuenta de servicio:** un «usuario robot» del negocio que tiene permiso para leer y escribir en los calendarios que las familias le comparten.

---

## 13. Supuestos y cifras por confirmar

### 13.1 Supuestos propios que más mueven el resultado [E]

| Supuesto | Valor usado | Cómo confirmarlo |
|---|---|---|
| Costo de captar por kit | CLP 35 mil en el base (rango de 25 a 70 mil); 10 mil por licencia (15 mil en sólo software) | Reservas reembolsables y preventa. **No hay ninguna referencia chilena** |
| Precio de la tablet | CLP 169.990 en tienda; 159.990 de oferta; ~153.000 a distribuidor (−10%, sin cotizar) | Cotización por escrito y factura |
| Ventas del año 1 | 400 kits y 150 licencias, iguales a 329.990 y a 349.990 | Probar dos precios en la preventa; no sabemos cuánto bajan las ventas al subir el precio |
| Uso de las cuotas | La mitad de las clientas usa 3 cuotas sin interés | Datos de Flow en la preventa |
| Puesta en marcha | CLP 7.500 por kit (5 a 10 mil) | Medir en el piloto 1 |
| Instalación con traslado en la RM | CLP 35 mil | Cotizar con maestros con boleta, más el seguro |
| Devoluciones por retracto | CLP 2.000 por kit (1.300 a 2.300 con 3% a 5% de devoluciones) | Medir en la preventa |
| Conversión a Plus y bajas | 10% al terminar la prueba (5% / 25%); 6% de bajas al mes en el plan mensual; 40% renueva el anual | Piloto en abril y mayo de 2027 |
| Costo del plan gratis | CLP 505 por familia al mes en el año 1; 345 desde el año 2 | Medir la nube en el piloto; migrar a Cloudflare |
| Soporte después de 90 días | 0,1 consultas por familia al mes × 20 min | Medir en el piloto |
| Costos fijos al mes | 500 mil / 900 mil / 1,8 millones (3,3 millones con tu sueldo) | Contador y cotizaciones |
| Reserva para la base | CLP 15 mil por kit (12 a 21 mil) | Depende del costo real de la nube y de la fecha de la garantía |
| Contenido de Plus | CLP 150 a 300 mil al mes | Cotizar con nutricionistas cuando Plus esté validado |
| Vida útil de la tablet | 3 a 4 años | Seguimiento de los equipos |
| Consumo eléctrico | CLP 500 a 1.000 al mes por panel | Medir con un enchufe medidor |
| Público de «Trae tu tablet» | ~20% del GSE alto tiene una tablet Android utilizable | Preguntar en las entrevistas |
| Hogares con niños en el GSE objetivo | 30% (no hay tabulado oficial por GSE) | Pedir un tabulado especial al INE o a CASEN |
| Euro | CLP 1.130 | Tipo de cambio del día |

### 13.2 Cifras que no se pudieron verificar

Durante la revisión se agotó el cupo de búsquedas web. Además, varias tiendas y aduana.cl bloquean la lectura (403 o captcha): Ripley, Lider, Falabella, Paris y Mercado Libre.

- **Precios y competencia:**
  - el precio del Skylight Calendar 2 de 15" (USD 299,99, de prensa);
  - el alza de Skylight Plus de USD 39 a 79;
  - el precio del Cozyla Calendar Neo (USD 169,99, según nuestras notas; la página oficial no lo muestra y la URL da 404);
  - los precios del Echo Show 8 y 15 y del Anyuse 16" en Chile (vistos en el buscador);
  - el precio del cargador Samsung en Falabella;
  - el de las pizarras imantadas;
  - si Amazon despacha Skylight a Chile y a qué costo;
  - el precio puesto en Chile de los calendarios genéricos de AliExpress y Temu;
  - si Samsung Family Hub se vende en Chile;
  - Alexa+ en México y su llegada a Chile;
  - el precio actual de Spotify en Chile (el dato es de ago-2025);
  - si ComoQuiero y Chef Digitales siguen activas.
- **Pagos y canales:**
  - la comisión de Mercado Libre (12% a 14%), la de Falabella (8% a 10%) y la de Ripley (10% a 12%), todas de fuentes secundarias;
  - cuánto cobra Mercado Pago por las cuotas sin interés;
  - que las cuotas normales no tengan recargo en Flow;
  - las «cuotas comercio» de Transbank y la regla de la CMF sobre adelantar pagos;
  - el costo de inscribirse en el CyberDay.
- **Mercado:**
  - el ingreso mediano de la EFH 2024 (en la revisión, la página llegó vacía);
  - el estudio de Cadem sobre la once (el PDF dio error);
  - el gasto en útiles de la vuelta a clases (fuentes secundarias de fechas mixtas);
  - el año del dato de trabajadoras de casa particular;
  - la proporción de iPhone e iCloud en el GSE objetivo.
- **Legal:**
  - si la Cámara ya votó la postergación de la Ley 21.719 (al 12-11-2026, la ficha del Senado dice «En tramitación»);
  - las multas de esa ley (20.000 UTM o 4%) y su art. 16 quáter sobre los menores de 14 años;
  - si los términos de Google permiten la cuenta de servicio a escala;
  - el requisito de la SEC para trabajos eléctricos en la instalación;
  - la regla de Aduanas del agente sobre US$1.000 FOB (página de 2020) y la de pagar sólo IVA hasta US$500;
  - el arancel 0% con el TLC con China;
  - el costo del certificado Subtel por modelo;
  - la Ley TEA 21.545 y el sueldo mínimo de ~CLP 539 mil (datos de memoria);
  - si la garantía de fábrica se mantiene al revender la tablet en un kit.
- **Costos no cotizados:**
  - la instalación real con traslado;
  - el seguro de responsabilidad civil;
  - el seguro de envío;
  - el reacondicionamiento de las tablets devueltas;
  - la patente municipal;
  - las tasas de INAPI;
  - la boleta automática;
  - WhatsApp Business (USD 0,02 por mensaje, no verificado);
  - el plan comercial del clima (sin precio publicado);
  - el posible cobro de la API de Google Calendar (monto no publicado);
  - la impresión a pedido del libro de recetas;
  - el canal presencial (ferias, pop-up).
- **Producto:**
  - si la Redmi Pad 2 permite limitar la carga;
  - los términos de uso comercial de la API de Jumbo.

### 13.3 Cifras que sí se verificaron en la revisión, sin cambios

- **Censo 2024:** 6.596.527 hogares; 2,8 personas por hogar; 33,2% con menores de 14 años o menos; 11,6% sólo con mayores de 65.
- **Subtel 2025:** tablet 24,9%, GSE alto 41,6%, hogares con hijos de 4 años o menos 34,4%, smartphone 99,1% e internet 96,6%.
- **Netlify:** planes y créditos, pausa de todos los sitios cuando se acaban, y recarga automática apagada por defecto (act. 12-08-2026).
- **Servicios externos:** Open-Meteo (no comercial y sin precio publicado); Flow (3,19% + IVA y recargos por cuotas); Stripe (no opera en Chile); Fully Kiosk PLUS (EUR 8,90 o USD 10,99 más impuestos, con Fully Cloud Basic incluido).
- **Datos de mercado:** RevenueCat (2,1%, 10,7% y 72%); Wyze (24,5%, 21-08-2026); dólar a CLP 985,5 (10-11-2026); Black Friday del 27 al 30 de noviembre de 2026.
- **Competencia:**
  - Cozyla Super (USD 69,99) y Cozyla «gratis forever»;
  - Hearth (USD 699, Black Friday a USD 559,20, membresía de USD 86,40 al año obligatoria);
  - Skylight (Plus USD 79, Max USD 569,99, venta sólo en 4 países, español EE.UU., 1,3 millones de familias);
  - Cozi (Gold USD 39, Max USD 79, recetario gratis).
- **Legal y técnico:**
  - Ley 21.398 (retracto y garantía);
  - Circular SII 53/2025 (12,5% hasta 2027 y 15% en 2028);
  - Sercotec (formalización gratis, sitio de producción);
  - Google (verificación de permisos sensibles y cuotas de la Calendar API);
  - precios de Gemini 2026-2027;
  - en el código: `CLAVE_CREACION`, `CADA = 20_000`, `CLAVE_DUENO_GOOGLE` y el cliente CalDAV.
