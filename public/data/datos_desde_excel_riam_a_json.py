# -*- coding: utf-8 -*-
"""
Created on Thu Oct  1 14:38:57 2026

@author: grios5
"""


import json
import re
from pathlib import Path
import pandas as pd


def exportar_renta_fija(
    df,
    carpeta="//SRV_RECURSOS/Mesa_Dinero/Carpeta propietaria/geraRios/pagina_vercel/",
    columna_fecha="fecha"
):
    datos = df.copy()
    datos.columns = datos.columns.astype(str).str.strip()

    if datos.columns.duplicated().any():
        raise ValueError("Hay columnas duplicadas.")

    # Preparar fechas y ordenar el histórico
    datos[columna_fecha] = pd.to_datetime(
        datos[columna_fecha],
        dayfirst=True,
        errors="raise"
    ).dt.normalize()

    if (
        datos[columna_fecha].isna().any()
        or datos[columna_fecha].duplicated().any()
    ):
        raise ValueError("Hay fechas vacías o duplicadas.")

    datos = datos.sort_values(columna_fecha).set_index(columna_fecha)

    # Identificar columnas de bonos y depósitos
    bonos = [
        c for c in datos.columns
        if re.fullmatch(r"(BTP|BTU)\d{7}", c)
    ]

    depositos = [
        c for c in datos.columns
        if re.fullmatch(r"DPF_\d+", c)
    ]

    if not bonos or not depositos:
        raise ValueError("Faltan columnas BTP/BTU o DPF.")

    for columna in bonos + depositos:
        datos[columna] = pd.to_numeric(
            datos[columna], errors="raise"
        ).replace(
            [float("inf"), -float("inf")],
            float("nan")
        )

    # 1. Bonos: metadatos e histórico
    instrumentos = []

    for codigo in bonos:
        mes = int(codigo[-4:-2])

        if not 1 <= mes <= 12:
            raise ValueError(f"Vencimiento inválido: {codigo}")

        instrumentos.append({
            "code": codigo,
            "type": codigo[:3],
            "coupon": int(codigo[3:6]) / 10,
            "maturityMonth": mes,
            "maturityYear": 2000 + int(codigo[-2:])
        })

    historia = []

    for fecha, fila in datos[bonos].iterrows():
        valores = {
            codigo: float(valor)
            for codigo, valor in fila.items()
            if pd.notna(valor)
        }

        if valores:
            historia.append({
                "date": fecha.strftime("%Y-%m-%d"),
                "values": valores
            })

    if not historia:
        raise ValueError("No hay valores válidos de bonos.")

    rf = {
        "sourceSheet": "RF",
        "lastMarketDate": historia[-1]["date"],
        "instruments": instrumentos,
        "history": historia
    }

    # 2. Depósitos: último valor y variaciones en puntos base
    instrumentos_dpf = []

    for codigo in sorted(
        depositos,
        key=lambda c: int(c.split("_")[1])
    ):
        serie = datos[codigo].dropna()

        if serie.empty:
            continue

        fecha = serie.index[-1]
        valor = float(serie.iloc[-1])

        def cambio_desde(inicio):
            anteriores = serie[serie.index < inicio]

            # Cierre previo al período; si falta, primer dato del período
            base = (
                anteriores.iloc[-1]
                if not anteriores.empty
                else serie[serie.index >= inicio].iloc[0]
            )

            return (valor - float(base)) * 100

        instrumentos_dpf.append({
            "code": codigo,
            "days": int(codigo.split("_")[1]),
            "value": valor,
            "d1": (
                (valor - float(serie.iloc[-2])) * 100
                if len(serie) > 1
                else None
            ),
            "mtd": cambio_desde(fecha.replace(day=1)),
            "ytd": cambio_desde(fecha.replace(month=1, day=1))
        })

    if not instrumentos_dpf:
        raise ValueError("No hay valores válidos de depósitos.")

    fecha_dpf = (
        datos[depositos]
        .dropna(how="all")
        .index[-1]
        .strftime("%Y-%m-%d")
    )

    dpf = {
        "lastMarketDate": fecha_dpf,
        "rateConvention": "monthly",
        "annualization": "monthly_rate_x12",
        "instruments": instrumentos_dpf
    }

    # Evitar que el archivo auxiliar sobrescriba tu histórico actualizado
    rf_latest = {
        "lastMarketDate": rf["lastMarketDate"],
        "history": []
    }

    # Guardar archivos
    salida = Path(carpeta)
    salida.mkdir(parents=True, exist_ok=True)

    archivos = {
        "rf.json": rf,
        "dpf.json": dpf,
        "rf-latest.json": rf_latest
    }

    for nombre, contenido in archivos.items():
        with (salida / nombre).open("w", encoding="utf-8") as archivo:
            json.dump(
                contenido,
                archivo,
                ensure_ascii=False,
                indent=2,
                allow_nan=False
            )
            archivo.write("\n")

    print(f"Archivos guardados en: {salida.resolve()}")


ruta = "//SRV_RECURSOS/Mesa_Dinero/Carpeta propietaria/geraRios/pagina_vercel/"

df = pd.read_excel(ruta+"datos_desde_riskamerica.xlsx",sheet_name="basededatos")
exportar_renta_fija(df, columna_fecha="fecha")