# Modelo del informe final (ESTIMACION PROPIA). CLP. IVA 19%. 12-11-2026.
# Incorpora las observaciones de las dos revisoras. Todos los supuestos son parámetros de P.
IVA = 1.19
def n(x): return x / IVA

EXTRA = {0: 0.0, 3: 0.0199, 6: 0.0349, 12: 0.0699}   # recargo Flow cuotas sin interés (+IVA, que es crédito)
SEAS = [s / 400 for s in [48, 24, 48, 36, 24, 24, 28, 32, 48, 56, 16, 16]]   # mar..feb
MESES = ["mar-27","abr-27","may-27","jun-27","jul-27","ago-27","sep-27","oct-27","nov-27","dic-27","ene-28","feb-28"]

V2 = dict(
    tablet=169990, fee=0.0319, dev_kit=2000, dev_lic=500, plusvar=1000, puesta=7500, instal=35000, marco=20000,
    precio_pared=329990, precio_inst=389990, desc_fund=30000, n_fund=100, mix_extra=0.5 * EXTRA[3],
    precio_lic=39990, plus_meses=3, kits_y=(400, 700, 1000), lic_y=(150, 300, 500), cac_y=(35000, 30000, 28000),
    cac_lic=10000, conv=0.10, churn=0.06, renov=0.40, fijo_y=(900000, 1500000, 2200000), ops_y=(505, 345, 345),
    plus_fund=True, piloto=20, years=3,
)
# Reproducción de la v1 (mismo motor): tablet 159.990, comisión 3,8%, retracto 1.000, sin puesta en marcha,
# instalación 20.000, sin fundadoras, sin cuotas, 15% de la base en Plus sin bajas, nube 350, sin piloto.
V1 = dict(V2, tablet=159990, fee=0.038, dev_kit=1000, dev_lic=1000, puesta=0, instal=20000, desc_fund=0, n_fund=0,
          mix_extra=0.0, conv=0.15, churn=0.0, renov=1.0, ops_y=(350, 345, 345), plus_fund=False, piloto=0)
AJ = dict(precio_pared=349990, precio_inst=419990, desc_fund=20000, precio_lic=79990)
DIST = round(169990 * 0.9)

def costo_kit(tablet):
    con_iva = tablet + 18990 + 4990 + 15000 + 12800 + 3000 + 6000
    return con_iva + 5000 + 0.03 * tablet, n(con_iva) + 5000 + 0.03 * tablet

def m_kit(P, precio, inst=False, plus_meses=None):
    c = costo_kit(P['tablet'])[1] + ((n(P['marco']) + P['instal']) if inst else 0)
    pm = P['plus_meses'] if plus_meses is None else plus_meses
    return n(precio) - c - precio * (P['fee'] + P['mix_extra']) - P['dev_kit'] - pm * P['plusvar'] - P['puesta']

def m_lic(P, precio=None):
    p = P['precio_lic'] if precio is None else precio
    return n(p) - (n(12800) + 5000) - p * P['fee'] - P['dev_lic'] - 3 * P['plusvar'] - P['puesta']

def contribs(P):
    CM = n(3990) - 3990 * P['fee'] - P['plusvar']
    CA = (n(39990) - 39990 * P['fee'] - 12 * P['plusvar']) / 12
    CF = n(2990) - 2990 * P['fee'] - P['plusvar']
    return CM, CA, CF

def simular(P, detalle=False):
    CM, CA, CF = contribs(P)
    mp, mi = m_kit(P, P['precio_pared']), m_kit(P, P['precio_inst'], True)
    mpf, mif = m_kit(P, P['precio_pared'] - P['desc_fund']), m_kit(P, P['precio_inst'] - P['desc_fund'], True)
    ml = m_lic(P)
    fam = P['piloto']; vend = 0
    cohort = [(1, P['piloto'], 1.0)] if P['piloto'] else []
    sm, sa, out = [], [], []
    for m in range(12 * P['years']):
        y = m // 12
        k = P['kits_y'][y] * SEAS[m % 12]; l = P['lic_y'][y] * SEAS[m % 12]
        kf = max(0.0, min(k, P['n_fund'] - vend)); kn = k - kf; vend += k
        ck = kf * (0.7 * mpf + 0.3 * mif) + kn * (0.7 * mp + 0.3 * mi) - k * P['cac_y'][y]
        cl = l * (ml - P['cac_lic'])
        ventas = (kf * (0.7 * (P['precio_pared'] - P['desc_fund']) + 0.3 * (P['precio_inst'] - P['desc_fund']))
                  + kn * (0.7 * P['precio_pared'] + 0.3 * P['precio_inst']) + l * P['precio_lic']) / IVA
        if k + l: cohort.append((m + 1 + P['plus_meses'], k + l, kf / (k + l)))
        for (mc, q, ff) in cohort:
            if mc == m:
                nu = q * P['conv']; fq = nu * ff if P['plus_fund'] else 0; rq = nu - fq
                sm.append([fq, CF]); sm.append([rq / 2, CM]); sa.append([rq / 2, CA, m])
        plus = sum(q * c for q, c in sm) + sum(q * c for q, c, _ in sa)
        ventas += sum(q * (n(2990) if c == CF else n(3990)) for q, c in sm) + sum(q * n(39990) / 12 for q, _, _ in sa)
        act = sum(q for q, _ in sm) + sum(q for q, _, _ in sa)
        for s in sm: s[0] *= (1 - P['churn'])
        for s in sa:
            if (m - s[2]) % 12 == 11: s[0] *= P['renov']
        fam += k + l
        ops = (fam - (k + l) / 2) * P['ops_y'][y]
        r = ck + cl + plus - ops - P['fijo_y'][y]
        out.append(dict(k=k, l=l, fam=fam, act=act, ventas=ventas, ck=ck, cl=cl, plus=plus, ops=ops, fijo=P['fijo_y'][y], r=r,
                        cac=k * P['cac_y'][y] + l * P['cac_lic']))
    res = []
    for y in range(P['years']):
        o = out[12 * y:12 * y + 12]
        res.append({key: sum(x[key] for x in o) for key in ('ventas', 'ck', 'cl', 'plus', 'ops', 'fijo', 'r', 'cac', 'k', 'l')})
        res[-1].update(fam=o[-1]['fam'], act=o[-1]['act'])
    return (res, out) if detalle else res

def fmt(r):
    return (f"ventas {r['ventas']/1e6:6.1f}M | kits {r['ck']/1e6:6.1f} | lic {r['cl']/1e6:5.2f} | plus {r['plus']/1e6:5.2f} | "
            f"ops {-r['ops']/1e6:5.2f} | fijo {-r['fijo']/1e6:5.1f} => R {r['r']/1e6:6.1f}M | fam {r['fam']:,.0f} Plus {r['act']:,.0f} ({r['act']/r['fam']:.1%}) | publicidad {r['cac']/1e6:.1f}M")

def y1(P): return simular(dict(P, years=1))[0]['r'] / 1e6

if __name__ == "__main__":
    P = V2
    print("Costo kit: tablet 169.990 ->", [round(x) for x in costo_kit(169990)], "| 159.990 ->", round(costo_kit(159990)[1]), "| distribuidor", DIST, "->", round(costo_kit(DIST)[1]))
    print("Costo Instalado neto:", round(costo_kit(169990)[1] + n(20000) + 35000))

    print("\n== Margen Kit Pared por precio y cuotas (tablet 169.990) ==")
    for p in (249990, 299990, 329990, 349990, 369990):
        print("  ", f"{p:,}", " | ".join(f"{c}c {m_kit(dict(P, mix_extra=EXTRA[c]), p):,.0f} ({m_kit(dict(P, mix_extra=EXTRA[c]), p)/n(p):.1%})" for c in (0, 3, 6, 12)))
    print("Mezcla política recomendada (50% en 3 cuotas s/i):")
    for p in (299990, 329990, 349990, 369990):
        for t, lab in ((169990, "retail 169.990"), (159990, "oferta 159.990"), (DIST, "distribuidor -10%")):
            m = m_kit(dict(P, tablet=t), p)
            print(f"   {p:,} {lab}: {m:,.0f} ({m/n(p):.1%}) | -CAC35k {m-35000:,.0f} | -CAC y reserva 15k {m-50000:,.0f}")
    print("Palancas desde 329.990 retail: tablet -10%:", round(m_kit(dict(P, tablet=DIST), 329990) - m_kit(P, 329990)),
          "| subir a 349.990:", round(m_kit(P, 349990) - m_kit(P, 329990)))
    print("Piloto 249.990 por transferencia (sin comisión ni cuotas, 4 meses Plus):",
          round(n(249990) - costo_kit(169990)[1] - 4000 - 7500), "| con Flow:", round(m_kit(dict(P, mix_extra=0), 249990, plus_meses=4)))
    for p in (389990, 399990, 419990):
        print(f"Instalado {p:,}: {m_kit(P, p, True):,.0f} ({m_kit(P, p, True)/n(p):.1%})")
    for t in (206991, 219990):
        print(f"Samsung {t:,} en 329.990: {m_kit(dict(P, tablet=t), 329990)/n(329990):.1%} | contado {m_kit(dict(P, tablet=t, mix_extra=0), 329990)/n(329990):.1%}")
    for p in (39990, 59990, 69990, 79990):
        m = m_lic(P, p); print(f"Licencia {p:,}: {m:,.0f} ({m/n(p):.0%}) | -CAC 10k {m-10000:,.0f} | -CAC y reserva 5 años 20.700 {m-30700:,.0f}")
    print("12 meses de Plus en vez de 3: costo extra por kit", 9 * P['plusvar'])

    CM, CA, CF = contribs(P); MIXP = (CM + CA) / 2
    print(f"\n== Plus == mensual {CM:,.0f} | anual {CA:,.0f}/mes | mezcla {MIXP:,.0f} | fundadora {CF:,.0f}")
    for ops in (345, 505):
        print(f"  % en Plus para cubrir {ops}: mensual {ops/CM:.1%} mezcla {ops/MIXP:.1%} anual {ops/CA:.1%} fundadora {ops/CF:.1%}")
    print("  suscriptores para fijos 500k/900k/1,8M/3,3M:", [round(F / MIXP) for F in (500000, 900000, 1800000, 3300000)])
    print(f"  contenido 150-300k: {150000/MIXP:.0f}-{300000/MIXP:.0f} (fundadora {150000/CF:.0f}-{300000/CF:.0f})")

    print("\n== Puente año 1 base ==")
    print(f"  v1 reproducida con este motor: {y1(V1):.1f}  (la v1 publicó +2,7)")
    pasos = [
        ("tablet a 169.990", dict(tablet=169990)),
        ("comisión neta 3,19% (IVA es crédito)", dict(fee=0.0319)),
        ("100 fundadoras (kit -30 mil y Plus a 2.990)", dict(desc_fund=30000, n_fund=100, plus_fund=True)),
        ("la mitad paga en 3 cuotas sin interés", dict(mix_extra=0.5 * EXTRA[3])),
        ("nube sin migrar en el año 1 (505 al mes)", dict(ops_y=(505, 345, 345))),
        ("puesta en marcha 7.500 por kit y licencia", dict(puesta=7500)),
        ("retracto 2.000 por kit (y 500 por licencia)", dict(dev_kit=2000, dev_lic=500)),
        ("instalación a 35.000", dict(instal=35000)),
        ("Plus: 10% al fin de la prueba, con bajas (6%/mes, renovación anual 40%)", dict(conv=0.10, churn=0.06, renov=0.40)),
        ("las 20 familias del piloto en la base", dict(piloto=20)),
    ]
    Q = dict(V1); prev = y1(Q)
    for lab, ch in pasos:
        Q.update(ch); cur = y1(Q); print(f"  {lab}: {cur-prev:+.1f} -> {cur:.1f}"); prev = cur
    print(f"  (si en vez de 3 cuotas la mitad usa 6 cuotas s/i: {y1(dict(Q, mix_extra=0.5*EXTRA[6])):.1f})")

    ESC = {
        "Conservador": dict(kits_y=(150, 0, 0), lic_y=(50, 0, 0), cac_y=(50000, 0, 0), cac_lic=15000, conv=0.05, fijo_y=(500000, 0, 0)),
        "Base": dict(),
        "Optimista": dict(kits_y=(900, 0, 0), lic_y=(400, 0, 0), cac_y=(25000, 0, 0), cac_lic=8000, conv=0.25, fijo_y=(1800000, 0, 0)),
    }
    for lab, extra in (("PRECIOS V1 CORREGIDOS", {}), ("AJUSTADO", AJ), ("AJUSTADO + TABLET DISTRIBUIDOR", dict(AJ, tablet=DIST))):
        print(f"\n== Escenarios año 1: {lab} ==")
        for e, d in ESC.items():
            print(f"  {e}: {fmt(simular(dict(P, years=1, **d, **extra))[0])}")

    print("\n== Sensibilidad año 1 (escenario base) al costo de captar ==")
    for cac in (25000, 35000, 50000, 70000):
        print(f"  CAC {cac:,}: precios v1 {y1(dict(P, cac_y=(cac,0,0))):.1f} | ajustado {y1(dict(P, cac_y=(cac,0,0), **AJ)):.1f} | ajustado+distribuidor {y1(dict(P, cac_y=(cac,0,0), tablet=DIST, **AJ)):.1f}")
    print("  ajustado con 50% en 6 cuotas s/i:", round(y1(dict(P, mix_extra=0.5 * EXTRA[6], **AJ)), 1))

    print("\n== Proyección 3 años ==")
    for lab, d in (("Precios v1 corregidos", {}), ("Ajustado", AJ), ("Ajustado + distribuidor", dict(AJ, tablet=DIST))):
        for i, r in enumerate(simular(dict(P, **d)), 1):
            print(f"  {lab} año {i}: {fmt(r)}")

    print("\n== Sólo software (Trae tu tablet 79.990 + Plus), fijo 500k ==")
    for nl, cacl in ((300, 15000), (600, 15000), (600, 25000), (1200, 15000)):
        r = simular(dict(P, years=1, kits_y=(0,0,0), lic_y=(nl,0,0), cac_lic=cacl, precio_lic=79990, n_fund=0, fijo_y=(500000,0,0)))[0]
        print(f"  {nl} licencias, CAC {cacl:,}: {fmt(r)}")
    mlic = m_lic(P, 79990)
    print(f"  licencias al mes para cubrir 500k: CAC 15k -> {500000/(mlic-15000):.0f}; CAC 25k -> {500000/(mlic-25000):.0f}")

    print("\n== Punto de equilibrio (kits al mes, mezcla 70/30, tras captar) ==")
    for lab, d in (("precios v1, retail", {}), ("ajustado, retail", AJ), ("ajustado, distribuidor", dict(AJ, tablet=DIST))):
        Q2 = dict(P, **d); mk = 0.7 * m_kit(Q2, Q2['precio_pared']) + 0.3 * m_kit(Q2, Q2['precio_inst'], True)
        print(f"  {lab}: contribución antes de captar {mk:,.0f} ->", " | ".join(
            f"F{F/1e3:.0f}k " + "/".join((f"{F/(mk-c):.0f}" if mk > c else "no") for c in (25000, 35000, 50000)) for F in (500000, 900000, 1800000, 3300000)))

    print("\n== Caja mensual (presupuesto austero ~1,95 M antes de marzo) ==")
    def caja(d, lab):
        Q3 = dict(P, years=1, **d); res, out = simular(Q3, detalle=True)
        c = costo_kit(169990)[1]; pil = n(249990) - c - 4000 - 7500   # piloto y reemplazos siempre con tablet de tienda
        pre = [("nov-26", -600000, 0), ("dic-26", -600000, 5 * pil), ("ene-27", -350000, 15 * pil), ("feb-27", -400000, -2 * c)]
        acum = 0; fil = []
        for mes, g, x in pre: acum += g + x; fil.append((mes, g + x, acum))
        for i, o in enumerate(out): acum += o['r']; fil.append((MESES[i], o['r'], acum))
        print(f"  {lab}:\n    " + " ".join(f"{m}:{f/1e6:+.1f}/{a/1e6:+.1f}" for m, f, a in fil))
        print(f"    mínimo {min(a for *_, a in fil)/1e6:.1f}M | final {fil[-1][2]/1e6:.1f}M | reserva sugerida (15 mil x {sum(o['k']+o['l'] for o in out)+20:.0f} familias): {(sum(o['k']+o['l'] for o in out)+20)*15000/1e6:.1f}M")
    caja({}, "Precios v1 corregidos"); caja(AJ, "Ajustado"); caja(dict(AJ, tablet=DIST), "Ajustado + distribuidor")

    print("\n== Varios ==")
    for cals in (1, 2, 3):
        print(f"  Google: {cals} cal. cada 5 min = {288*cals} req/día -> 1M/día con {1_000_000//(288*cals):,} familias")
    print("  3.050 familias x 3 calendarios en el mismo minuto:", 3050 * 3)
    print("  Fully Cloud Advanced 1,18 EUR x ~1.130 + IVA:", round(1.18 * 1130 * 1.19))
    print("  Costo anual de la base gratis con 3.070 familias: a 345", round(3070 * 345 * 12 / 1e6, 1), "M; a 505", round(3070 * 505 * 12 / 1e6, 1), "M")
    print("  Reserva 36 / 60 meses a 345:", 36 * 345, 60 * 345)
    print("  DIY: tablet 169.990 + soporte 7.990 =", 169990 + 7990, "| + licencia 39.990 =", 177980 + 39990, "| + 79.990 =", 177980 + 79990)
    print("  Brecha kit 349.990 vs DIY con licencia 79.990:", 349990 - 257970, f"({(349990-257970)/257970:.0%})", "| v1 329.990 vs DIY 39.990:", 329990 - 217970)
    print("  Cozyla Neo USD 169,99:", round(169.99 * 985), "+ IVA", round(169.99 * 985 * 1.19), "| Plus 2 USD 349,99 + IVA", round(349.99 * 985 * 1.19))
    print("  Hearth Black Friday USD 559,20:", round(559.20 * 985))
    print("  Gemini 2027 circular (3k entrada, 1k salida) Flash:", round((3000 * 1.5 + 1000 * 7.5) / 1e6 * 985, 1), "CLP; Flash-Lite 3.5:", round((3000 * 0.3 + 1000 * 2.5) / 1e6 * 985, 1))
    print("  Electricidad: 6 W x 720 h = 4,3 kWh/mes")
