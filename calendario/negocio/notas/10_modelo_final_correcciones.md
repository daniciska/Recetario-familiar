# Modelo del informe final: qué cambió y qué se verificó (12-11-2026)

Script: /tmp/claude-0/-home-user-Recetario-familiar/94bcc22e-699d-51c3-b4ee-57a1ad5cd0ee/scratchpad/calc/informe_calc_v2.py
Salida: /tmp/claude-0/-home-user-Recetario-familiar/94bcc22e-699d-51c3-b4ee-57a1ad5cd0ee/scratchpad/calc/informe_calc_v2_salida.txt

## Supuestos nuevos [E] (todos parámetros de V2 en el script)
- Tablet Redmi Pad 2 a 169.990 (SoloTodo 12-11-2026, Movistar/ABC). 159.990 = caso de oferta. Distribuidor = -10% (152.991), no cotizado.
- Comisión Flow neta 3,19% (el IVA de la comisión es crédito). Recargo cuotas sin interés: 3c +1,99%, 6c +3,49%, 12c +6,99%. Política: hasta 3 cuotas sin interés; base = la mitad las usa (+1,0% promedio).
- Retracto 2.000 por kit (500 por licencia). Puesta en marcha 7.500 por kit y por licencia (videollamada Google + dudas de 90 días). Instalación 35.000 (antes 20.000; por cotizar).
- Plus: 10% de las familias se suscribe al terminar los meses incluidos (5% conservador, 25% optimista); bajas 6% al mes en el mensual; renovación anual 40%. Neto al cierre del año 1: 2,7% / 5,6% / 14,5%.
- Nube: 505 por familia al mes en el año 1 (Netlify a 60 s); 345 desde el año 2 (tras migrar).
- Fijos: conservador 500 mil, base 900 mil, optimista 1,8 M. Con sueldo: 3,3 M (1,8 + 1,5; la v1 decía 3,0 por error).
- Reserva para operar la base: 15.000 por kit (rango 12-21 mil).
- Piloto: 20 familias, 249.990 por transferencia, Plus incluido hasta 31-03-2027.

## Resultados clave
- Motor nuevo reproduce la v1 en +2,4 M (la v1 publicó +2,7 M).
- Base corregido con precios v1: -11,1 M año 1 (-12,1 si la mitad usa 6 cuotas s/i). Años 2 y 3: -11,4 y -17,7.
- Ajustado (349.990 / 419.990 / fundadora -20 mil / licencia 79.990): +1,9 M año 1; con distribuidor +7,8 M.
- CAC 50 mil: ajustado -4,1; ajustado + distribuidor +1,8.
- Caja: mínimo -2,6 M (ajustado), -2,5 M (ajustado + distribuidor), -13,6 M al cierre (precios v1).

## Verificado en esta pasada (WebFetch)
- Sercotec, sitio de producción: https://www.sercotec.cl/wp-content/uploads/2024/04/Manual-para-formalizar-un-emprendimiento.pdf (PDF del 22-04-2024). Dice que Tu Empresa en un Día "es de costo cero" y que el inicio de actividades "no tiene costo". La patente municipal varía por municipio (sin monto).
- Senado, boletín 18.623-07 (consultado 12-11-2026): "En tramitación", fecha 01/09/2026. Sin indicio de aprobación ni publicación.
- Código: CLAVE_CREACION en calendario/netlify/functions/api-familia.mts (crea familias adicionales a mano); CADA = 20_000 en calendario/lib/datos/repositorioNube.ts; CLAVE_DUENO_GOOGLE en servidor/proveedores.ts y funciones de calendario; cliente CalDAV en servidor/caldav.ts.
- Notas previas: Fully Cloud Basic viene gratis con la licencia PLUS; Advanced hasta 1,18 EUR por equipo al mes + IVA (hw_04). Fully Kiosk tiene detección de movimiento para encender la pantalla.
