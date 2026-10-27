# RF Markets Chile

Dashboard Next.js preparado para Vercel, basado solo en la hoja `RF` de `bd_rf.xlsx`.

## Incluye
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

## Dashboard RF


Página de inicio `/` (`app/page.tsx`, `lib/dashboard.server.ts`; `/dashboard-rf` redirige aquí, calculada al construir el sitio): franja de indicadores con cambio diario y mini-gráfico de 1 mes, datos macro, mapa de calor de cambios (1D/1S/1M/YTD) por plazo y curva, curvas de hoy versus 1 semana / 1 mes / inicio de año, spreads clave con rango y percentil de 1 año, y monitor de instrumentos ordenable. BTP/BTU 2, 5 y 10 años se interpolan linealmente entre los papeles benchmark (BTP sin cero cupón); 20 años interpola entre bonos con cupón.

## Modelos

## Recomendaciones

Pestaña `/recomendaciones` (`lib/recommendations.server.ts`, `components/RecommendationsView.tsx`). Un informe por fecha en `content/recomendaciones/AAAA-MM-DD.json` (`fecha`, `datosAl`, `resumen`, `ideas`, `advertencia`); se muestran como desplegables con solo la fecha, del más nuevo al más antiguo. Para cada idea, el nivel actual y el resultado desde la entrada se recalculan con los últimos datos al construir el sitio. Para un informe nuevo basta agregar otro archivo con la fecha del día.

## Interpolador de Depósitos

En `/calculadoras`, debajo de Spread Bonos (`components/DepositInterpolator.tsx`, `lib/deposit-interpolation.ts`). Dos listas con el mismo formato: Depósitos CLP (DPF 7/30/90/180/270/360 días, tasa base 30 días, con equivalente anual ×12) y Depósitos UF (DPR 90/180/360 días, tasa real anual), leídas de `public/data/historico_riskamerica`. Usa el último día con todos los plazos, interpola linealmente por días y fuera del rango toma el plazo extremo. Si se ingresa la tasa de un depósito, reemplaza a la interpolada en todos los cálculos. **Swap Spread** (pb) = DPF: tasa base 30 × 12 − swap Cámara CLP; DPR: tasa real − swap Cámara UF; swaps del closing de derivados (`Closing_Icap/swap_clp.json`, `swap_uf.json`) interpolados linealmente por días corridos desde la fecha del closing (fuera de la curva, el plazo extremo). También por plazo en la tabla.

Equivalentes (`lib/deposit-equivalents.ts`) con el closing de derivados: DPF → UF y USD; DPR → pesos (base 30) y USD; para la tasa ingresada o, si no hay, la interpolada, y para cada plazo de la tabla. Factores: DPF 1 + r30·T/30, DPR 1 + rUF·T/360, USD 1 + rUSD·T/360 (ACT/360). Pesos→UF = ×UF₀/UF(T); pesos→USD = ×S/F(T), con S = usdclp Bloomberg del día del closing y F = S + puntos NDF (pesos, `Closing_Icap/ndf.json`) interpolados por días. UF del día 9 de cada mes desde los seguros de inflación (`Closing_Icap/inflacion.json`, el campo IPC es el de dos meses antes), encadenada hacia atrás con el IPC observado para obtener la UF de hoy; entre días 9, interpolación geométrica diaria. Validación: `tests/deposit-equivalents.test.mjs`.

Validación: `node --experimental-strip-types --test tests/deposit-interpolation.test.mjs`.

## Regla de Taylor forward-looking (expectativas de mercado)

Desplegable en `/modelos` debajo de la Regla de Taylor (`lib/taylor-forward.ts`, `components/TaylorForwardModel.tsx`, insumos en `taylorForwardData()` de `lib/market-models.server.ts`). Misma regla y parámetros, pero con inflación esperada a 12 meses en vez del IPC efectivo, y comparada con la TPM implícita en los swaps Cámara.

- Proyección: inflación esperada de cada mes futuro = variación compuesta del IPC de los 12 meses siguientes, con IPC observado y forwards ICAP (`Closing_Icap/inflacion.json`, cada contrato corresponde al IPC de dos meses antes). Brecha = −Okun × (desempleo − NAIRU) del último dato, cerrándose según su AR(1) mensual sin constante de los últimos 120 meses. Con inercia: parte de la TPM actual. Mercado: trayectoria por reunión de `lib/tpm-path.ts` llevada al cierre de cada mes, hasta el último plazo cotizado.
- Historia provisoria: inflación esperada = breakeven swap Cámara 1 año (`clpcam_1y` vs `ufcam_1y`), promedio mensual desde 2015. El breakeven NSS a 2 años no sirve antes de 2025 porque la base histórica no tiene bonos cortos y la curva extrapola. Reemplazar por la Encuesta de Expectativas Económicas (inflación a 11 meses) cuando esté en `datos-mensuales.json`.

Validación: `node --experimental-strip-types --test tests/taylor-forward.test.mjs`.

## Modelo Fair Value · Valor relativo (curva NSS)

Responde qué bono tener dentro de la curva. Desplegable en `/modelos` (`lib/nss.ts`, `components/NssFairValueModel.tsx`, calculado al construir el sitio con `historico_riskamerica`). Cada fecha de los últimos ~2 años ajusta una curva Nelson-Siegel-Svensson a los BTP y otra a los BTU sobre TIR: grilla de (τ1, τ2) con τ2 ≥ 1,5·τ1, mínimos cuadrados en β y una segunda pasada con pesos de Huber. Ajustan solo bonos con cupón y más de 1 año al vencimiento; los cero cupón se comparan pero no definen la curva y los menores a 1 año se omiten (estacionalidad del IPC en BTU).

Residuo = TIR observada − TIR de la curva al mismo plazo (pb, + barato). Como cada papel tiene un residuo estructural (cupón, liquidez), la señal es el z-score del residuo sobre 252 días (mínimo 60); |z| ≥ 1,5 se marca barato/caro. Incluye residuo medio, cambio 1M y breakeven de inflación compuesto (BTP vs BTU de las curvas) a 2/5/10/20 años con cambio 1M, percentil de 1 año e historia.

Validación: `node --experimental-strip-types --test tests/nss.test.mjs`.

## Modelo Fair Value · Valor direccional (fundamentales macro)

Responde cuánta duración tener. Desplegable en `/modelos` (`lib/fair-value-macro.ts`, `components/MacroFairValueModel.tsx`). La tasa BTP 10 y BTU 10 de las curvas NSS (ajustadas en toda la muestra una sola vez por construcción y compartidas con el modelo de valor relativo) se explica con TPM (`datos-diarios.json`), Treasury 10 años, CDS Chile, cobre y USD/CLP (`historico_bloomberg`; cobre y USD/CLP en log escalado a 10%, CDS por 10 pb). Las series se alinean al último dato disponible con hasta 7 días corridos.

OLS en ventana móvil de 504 días hábiles que termina en cada fecha, reestimada cada 5 días: el valor justo de cada día usa solo información de ese día. Desvío = observada − justa (+ barata); |z| ≥ 1 error típico se marca barata/cara. Vida media por AR(1) de los residuos de la ventana vigente; t de los coeficientes con Newey-West (21 rezagos). Descomposición del último mes = cambio de cada factor × sensibilidad vigente; el resto es desvío propio. Validación en tiempo real: señales semanales con |z| ≥ 1 y si la tasa se movió hacia el valor justo en 21 días hábiles. La historia empieza cuando hay 2 años con todos los factores (el cobre parte en 2021).

Validación: `node --experimental-strip-types --test tests/fair-value-macro.test.mjs`.

## Swap Spreads

Pestaña independiente `/swap-spreads` para análisis de cartera propia: comparador CLP/UF, spread indicativo papel menos swap por vencimiento o duración, históricos de hasta 5 años, spreads a vencimiento constante (1/2/3/5/10 años), z-score/percentil ajustados, AR(1) con vida media e intervalo condicional, validación walk-forward diaria frente a paseo aleatorio, simulador bono + swap a 1/3 meses, carry, roll-down y bitácora local exportable/restaurable.

Fuentes: `historico_riskamerica` (TIR y Macaulay) e `historico_bloomberg` (`clpcam_*`, `ufcam_*`). Solo cruza observaciones de la misma fecha y no extrapola; fecha y ausencias quedan visibles. Macaulay se transforma en modificada según la convención anual del proyecto. La comparación por duración usa una sensibilidad swap aproximada. No es un asset swap spread de flujos.

El spread bruto del mismo bono es descriptivo: no genera señales contra su media histórica porque el bono envejece. Cada fecha se estima una curva de pares de la misma moneda, excluyendo el propio papel, y se calcula el desajuste = spread observado menos referencia al plazo/duración de entonces. Z-score/percentil exigen 60 desajustes y AR(1) utiliza esos desajustes, sin arrastrar señales antiguas si hoy falta referencia. La interpolación lineal no extrapola: las puntas pueden quedar sin señal; no se ajustan explícitamente cupón o liquidez. La curva histórica incluye los bonos disponibles que estaban vigentes en cada fecha, incluso hoy vencidos; no necesariamente representa el universo completo de emisiones históricas.

Los spreads a plazo constante se interpolan de la curva diaria por vencimiento, siempre con plazo fijo, independientemente de la comparación seleccionada en la ficha. Sus z-scores son del tramo de mercado, no del papel.

Roll-down: curva de pares por vencimiento de la fecha del papel, sin cambios y sin incluirlo. Mantiene constante el desajuste particular. Spread neutral = referencia al plazo futuro más desajuste actual; objetivo automático = referencia al plazo futuro más desajuste AR proyectado. Convergencia adicional = cambio del desajuste, evitando doble conteo. El simulador conjunto utiliza siempre curvas por vencimiento y separa el roll-down del bono y el swap elegido. La ficha y su registro de tesis mantienen la comparación seleccionada por plazo o duración.

AR(1) omite saltos de más de una rueda lunes–viernes. Su diagnóstico normal sobre phi es preliminar, no una prueba formal de raíz unitaria; validación de hasta 60 pronósticos diarios con ventanas pasadas de hasta 252 observaciones. No equivale a un backtest económico multimensual.

Bitácora en `localStorage` de cada navegador, sin sincronización ni envío de posiciones al servidor. Preserva tesis y objetivos originales; admite respaldo JSON, restauración por identificador y cierre de seguimiento. Atribución de tasas/spread aproximada, no P&L contable.

Simulador `lib/bond-swap.ts` / `components/BondSwapStrategy.tsx`: objetivo DV01 USD/pb, USD/CLP y TPM desde el último dato BCCh (editables), duración modificada editable, selector del tenor swap y porcentaje de cobertura. VM del bono = DV01 CLP / (Dmod × 1e-4); nominal estimado con factor VM/nominal inicialmente a par. Nocional swap = DV01 cubierto / (anualidad × 1e-4), con posible sustitución manual de la sensibilidad. En UF se muestran equivalentes CLP y conversión opcional a nominal UF si se ingresa UF spot.

Curva única swap bootstrapeada de tasas par, descuentos log-lineales, pago único hasta 1a y semestral después, base ACT/360 aproximada sin ajustes de calendario. El swap paga fijo y recibe Cámara: sensibilidad positiva ante subidas de tasa, opuesta a la del bono. Resultados económicos indicativos a 1/3 meses con días reales: devengo efectivo del bono, fondeo de su VM por TPM editable, Cámara nominal compuesta diaria, fija simple, ambos roll-down, shocks comunes/adicionales, convergencia residual AR opcional y costos totales CLP. Para UF se convierte Cámara a real mediante factor UF del horizonte, con fondeo CLP. La sensibilidad inicial permanece constante y el roll del swap usa un instrumento par al plazo restante; no es una valorización contractual con calendarios residuales completos. El porcentaje de resultado se expresa sobre VM del bono, no capital aportado. Muestra compensación por shock paralelo, riesgo de base y breakeven en pb. No suma nocional swap al monto a fondear ni inventa un costo de garantías.

La bitácora existente sigue registrando tesis del bono, no operaciones reales completas de swap. El simulador actualiza el monto de referencia del bono sin alterar registros anteriores.

Validación: `node --experimental-strip-types --test tests/bond-swap.test.mjs tests/swap-spreads.test.mjs tests/carry.test.mjs` y `npm run build`.

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
