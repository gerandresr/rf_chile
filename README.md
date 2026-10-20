# RF Markets Chile

Dashboard Next.js preparado para Vercel, basado solo en la hoja `RF` de `bd_rf.xlsx`.

## Incluye
- **Mercados**: curva BTP/BTU, tarjetas BTP29/BTP30/BTP40/BTP50 y tablas de instrumentos vigentes.
- **Vigencia automática**: lee `MMYY` al final del código y mantiene el bono visible durante su mes de vencimiento y el mes siguiente.
- **Históricos**: Yield, cambio diario y volatilidad móvil 10/30/90 días.
- Comparación de hasta 4 instrumentos.
- Datos del Excel convertidos a `public/data/rf.json` para que Vercel no necesite leer Excel en producción.

## Ejecutar
```bash
npm install
npm run dev
```

## Publicar en Vercel
Sube esta carpeta a GitHub e importa el repositorio desde Vercel. Next.js será detectado automáticamente.

## Modelos

### Técnicos para BTP/BTU · Osciladores

Los tres simuladores usan las tasas de `rf.json`: RSI 14 de Wilder, Slow Stochastic de 14 cierres con %K suavizado en 3 observaciones (las señales usan %K, sin datos intradía), y Z-score de 60 observaciones con desviación estándar poblacional. Compra el bono tras un cruce ascendente del umbral del oscilador (o su primer valor calculable si ya alcanza el umbral), con una sola posición y sin ventas cortas. Permite salir por el nivel del oscilador, por stop/take profit en pb desde la tasa de entrada, o por la primera condición de ambas reglas. Niveles iniciales: RSI 70/50, Slow Stochastic 80/50 y Z-score +2/0. Cada modelo inicia con salida por stop de 5 pb / take profit de 15 pb, y bid/ask spread de 0 pb por lado.

Todas las señales se ejecutan en el siguiente cierre disponible, incluidos los stops; no asume ejecuciones exactas en los umbrales ni datos intradía. El oscilador se inicializa con datos anteriores al período seleccionado, pero la estrategia comienza sin posición y no arrastra señales anteriores. No abre operaciones en el último cierre y liquida posiciones existentes al final. El spread ingresado es el castigo por cada lado: la tasa de compra es la tasa de mercado menos `spread / 100`, y la de venta es la tasa de mercado más `spread / 100`. El resultado neto es `(tasa de entrada ajustada - tasa de salida ajustada) * 100`, con tasas expresadas en porcentaje; una operación completa pierde dos veces el spread ingresado respecto del resultado bruto. Los stops y objetivos se evalúan sobre ese resultado neto. La caída máxima usa la valoración diaria neta desde máximos previos, comenzando en cero. El módulo contiene «Técnicos para BTP/BTU» y tres desplegables internos con prefijo «(Oscilador)», y muestra indicadores y tabla de operaciones, sin gráfico de resultado acumulado. Los pb acumulados no equivalen a rentabilidad o P&L monetario y excluyen cupones, carry y financiamiento.

Cada backtest se compara con comprar y mantener el mismo bono en el período, con el mismo castigo por spread.

Validación: `node tests/rsi-backtest.test.cjs` y `node tests/oscillators.test.cjs`.

La TPM descontada por swaps (distribución de probabilidad por reunión e historia) se muestra en la pestaña Inflación y TPM (`/inflacion`).

La pestaña `/modelos` muestra un catálogo de secciones desplegables. Los modelos macro se estiman al construir el sitio (`app/modelos/page.tsx`): actualizar `public/data/historico_bcentral/datos-mensuales.json` y desplegar los vuelve a estimar.

### Tasa de desempleo natural (`lib/nairu.ts`)

Filtro de Kalman multivariado con ley de Okun, sobre toda la muestra con desempleo e IMACEC desestacionalizado:

- `u_t = n_t + c_t` (desempleo desestacionalizado = tasa natural + ciclo)
- `100·log(IMACEC)_t = y*_t − θ·c_t` (θ = coeficiente de Okun)
- `n_t` paseo aleatorio; `c_t` AR(2) estacionario; `y*_t` tendencia con deriva.

El desempleo publicado (trimestre móvil sin ajuste) se desestaciona con factores mensuales aditivos, estimados excluyendo mar-2020 a jun-2021. Los parámetros se estiman por máxima verosimilitud (Nelder-Mead con varios puntos de partida); se muestran la estimación filtrada y la suavizada (RTS) con banda del 95% condicional a los parámetros. La prueba contra una implementación matricial independiente en numpy/scipy coincide a 1e-6.

No se usa una curva de Phillips: con los datos desde 2015 la pendiente estimada es ≈ 0 en todas las especificaciones probadas (inflación en cambios o anclada a la meta, con tipo de cambio real, con y sin pandemia), y con pendiente cero el filtro queda fijo en su valor inicial.

### Regla de Taylor (`lib/taylor.ts`)

`i = TPM neutral + (1 + a)·(π − meta) + b·brecha`, con TPM neutral 4,25% (punto medio del rango 3,75%–4,75% del IPoM de diciembre de 2025), a = b = 0,5 y banda por ±0,5 pp de neutral. La brecha de actividad es la del modelo de tasa natural (suavizada o en tiempo real), no un filtro HP. Incluye la regla con inercia `ρ·TPM_(t−1) + (1−ρ)·Taylor_t`.

### GARCH(1,1) (`lib/garch.ts`)

Sobre cambios diarios de yield en pb, con variance targeting. El pronóstico se centra en la yield actual (sin deriva). El rango de 1 día usa cuantiles empíricos de los residuos estandarizados (colas gruesas); 5 y 20 días usan cuantiles normales.

### TPM descontada por el mercado (`lib/tpm-path.ts`)

Trayectoria de TPM por reunión implícita en los swaps Cámara de hasta 18 meses (Bloomberg o cierre ICAP, el más reciente). En ese tramo los swaps tienen un solo pago al vencimiento, por lo que el descuento se cancela y la tasa fija entrega el ICP esperado (`1 + r·días/360`) sin doble curva. Overnight escalonado entre reuniones (`tpm-meetings.json`, efecto el día hábil siguiente), ICP = TPM + spread estimado, ajuste por mínimos cuadrados con penalización a saltos. Incluye la historia de lo descontado a 0–3, 3–6 y 6–12 meses versus la TPM efectiva.

### Carry y roll-down BTP/BTU (`lib/carry.ts`)

Retorno en exceso a 1, 3 y 6 meses con curva constante: devengo de la TIR (BTU: TIR real × UF esperada con IPC observado y forwards ICAP) menos financiamiento al swap Cámara del plazo, más roll-down sobre una curva Nelson-Siegel por tipo (bonos con cupón, plazo ≥ 1 año, sin extrapolar). Breakeven en pb y retorno/riesgo con la volatilidad de los últimos 3 meses. Duración de RiskAmerica: Macaulay (modificada = Macaulay / (1 + TIR)).

### Tipo de cambio real

Desviaciones del TCR respecto de su promedio histórico acumulado y de su promedio móvil de 36 meses, con percentil histórico.

Pruebas de los modelos (Node 22.6 o superior):

```bash
node --experimental-strip-types --test tests/nairu.test.mjs tests/taylor.test.mjs tests/garch.test.mjs tests/exchange-rate.test.mjs tests/tpm-path.test.mjs tests/carry.test.mjs
```
