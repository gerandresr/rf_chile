# Estimaciones intradía de Tasas Benchmark

La pestaña **Mercados** calcula el **cierre oficial** directamente desde los históricos de RiskAmerica. Este archivo agrega **solo** una estimación, sin reemplazar ni alterar el cierre oficial.

## Dónde editar

Editar `public/data/cierre-estimado-rf.json`, guardar el cambio en GitHub y esperar a que Vercel publique la nueva versión. Si la página ya estaba abierta, presionar **Actualizar** en la tabla Benchmark.

## Ejemplo de contenido (tasas ilustrativas, NO son datos reales)

```json
{
  "fecha": "2026-10-08",
  "actualizaciones": [
    {
      "hora": "11:00",
      "modo": "maturity",
      "benchmark": {
        "PESOS-02": 4.85,
        "PESOS-05": 5.12,
        "PESOS-10": 5.51,
        "UF-02": 1.92,
        "UF-05": 2.16,
        "UF-10": 2.39
      }
    },
    {
      "hora": "14:30",
      "modo": "maturity",
      "benchmark": {
        "PESOS-02": 4.89,
        "PESOS-05": 5.19,
        "PESOS-10": 5.57,
        "UF-02": 1.90,
        "UF-05": 2.13,
        "UF-10": 2.43
      }
    }
  ]
}
```

- `fecha`: día de la estimación en Chile, formato `AAAA-MM-DD`. Cada mañana actualizarla y empezar las actualizaciones de ese día; las estimaciones de otra fecha no se muestran.
- `hora`: hora local de Chile `HH:MM` (24 horas). La página elige la actualización **más reciente por hora**.
- `modo`: `"maturity"` corresponde al selector **Por vencimiento** y `"duration"` a **Por duración**. Se mantienen separadas porque no representan el mismo benchmark; si quieres estimaciones en ambos modos, agrega entradas independientes para cada uno.
- `benchmark`: tasas expresadas **en porcentaje**, por ejemplo `5.19` para `5,19%`; no ingresar valores en puntos básicos.
- Cada actualización es una foto completa de los seis benchmarks. Es posible dejar campos sin informar: se mostrarán como `—`, sin arrastrar estimaciones antiguas.
- Puedes agregar varias actualizaciones intradía (11:00, 12:00, 14:30). No es necesario conservar el cierre oficial en este JSON.
- Si aún no existe una estimación de **hoy** o el cierre oficial ya cubre esa misma fecha, la tabla mostrará **—** y un aviso para evitar confundir datos anteriores con cotizaciones actuales.

La columna `Δ hoy (bp)` se calcula como `(estimación actual - cierre oficial) × 100`. Los indicadores MTD y YTD siguen calculados con **cierres oficiales**.
