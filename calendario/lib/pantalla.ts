// Qué interfaz usa la pantalla (tablet / pared o teléfono). Sin "use client": lo usa también app/layout.tsx.

/** Igual que la variante `md` de globals.css: ancho de tablet Y alto suficiente (un teléfono horizontal no cuenta). */
export const MEDIA_TABLET = "(min-width: 48rem) and (min-height: 29rem)";

/**
 * Zoom con dos dedos sólo en el celular. El meta viewport de app/layout.tsx lo bloquea (maximum-scale=1,
 * user-scalable=no), que es lo que quiere la pared y el tablet: que un niño no agrande la pantalla. Este
 * guion corre en el <head>, antes de pintar nada: si la pantalla NO es de tablet (la misma regla que `md:`
 * y MEDIA_TABLET), pone justo después otro meta viewport sin esas dos partes y con el resto igual
 * (width=device-width, initial-scale=1, viewport-fit=cover): el navegador usa el último, el diseño no se
 * mueve ni parpadea, y en la pared no se agrega nada.
 *
 * No se cambia el meta de Next: React lo revisa al hidratar y, si lo encuentra distinto, agrega otro igual
 * al original al final del <head> (y el zoom volvería a quedar bloqueado). Si la pantalla cambia de
 * interfaz (p. ej. una ventana de iPad que se achica o se agranda), se vuelve a decidir.
 */
export const ZOOM_SOLO_CELULAR = `(function(){try{
var og=document.querySelector('meta[name="viewport"]');if(!og)return;
var fijo=og.getAttribute("content")||"";
var libre=fijo.split(",").filter(function(p){return !/^\\s*(maximum-scale|user-scalable)\\s*=/.test(p)}).join(",");
var mq=matchMedia(${JSON.stringify(MEDIA_TABLET)});var mt=null;
var poner=function(){
if(!mt&&mq.matches)return;
if(!mt){mt=document.createElement("meta");mt.setAttribute("name","viewport");mt.setAttribute("data-zoom","celular")}
var c=mq.matches?fijo:libre;if(mt.getAttribute("content")!==c)mt.setAttribute("content",c);
if(!mt.parentNode)og.parentNode.insertBefore(mt,og.nextSibling)};
poner();if(mq.addEventListener)mq.addEventListener("change",poner);else if(mq.addListener)mq.addListener(poner);
}catch(e){}})();`;
