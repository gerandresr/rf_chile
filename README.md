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

### Simulador de estrategias · RSI

El simulador usa las tasas de `rf.json` y RSI 14 de Wilder. Compra el bono tras un cruce ascendente del umbral (o el primer RSI calculable si ya alcanza el umbral), con una sola posición y sin ventas cortas. Permite salir por RSI, por stop/take profit en pb desde la tasa de entrada, o por la primera condición de ambas reglas. Por defecto: entrada 70, stop 5 pb, take profit 15 pb y costo total 0 pb.

Todas las señales se ejecutan en el siguiente cierre disponible, incluidos los stops; no asume ejecuciones exactas en los umbrales ni datos intradía. El RSI se inicializa con datos anteriores al período seleccionado, pero la estrategia comienza sin posición y no arrastra señales anteriores. No abre operaciones en el último cierre y liquida posiciones existentes al final. El resultado de cada compra es `(tasa de entrada - tasa de salida) * 100`, con tasas expresadas en porcentaje, menos el costo total por operación. La curva incluye valoración diaria de la posición y provisiona su costo completo; la caída máxima se calcula desde máximos previos, comenzando en cero. Los pb acumulados no equivalen a rentabilidad o P&L monetario y excluyen cupones, carry y financiamiento.

Validación: `node tests/rsi-backtest.test.cjs`.

La pestaña `/modelos` muestra un catálogo de secciones desplegables. El primer modelo es una NAIRU experimental de Chile mediante una curva de Phillips, filtro de Kalman y suavizador RTS. Utiliza `fecha`, `desempleo` e `ipc_yoy` de `public/data/datos-mensuales.json`; actualizar ese archivo y desplegar vuelve a estimar el modelo, sin generar otra serie manualmente.

La curva usa el cambio mensual de inflación YoY y un rezago de ese cambio. No incluye una constante libre, para evitar confundirla con el nivel de NAIRU. Ajusta sensibilidad de inflación, persistencia y ruido por máxima verosimilitud; la desviación del paseo aleatorio de NAIRU se fija en 0,05 pp por mes. El modelo utiliza únicamente los últimos 120 meses calendario, anclados al último mes con desempleo e inflación disponibles; el histórico anterior no interviene en la estimación ni en el nivel inicial. La ventana avanza cuando se agregan datos nuevos. Si hay menos de diez años, utiliza los meses disponibles (mínimo 60). Los primeros dos meses de la ventana se pierden al construir los cambios y el rezago. Los meses conjuntos deben ser consecutivos y únicos.

La banda del 95% es condicional a parámetros y supuestos, y no representa toda la incertidumbre. La vista filtrada usa parámetros de muestra completa y un nivel inicial basado en la media de los primeros doce meses; no es una serie de estimaciones en tiempo real. La vista muestra tres cuadros (NAIRU, desempleo y brecha) y dos gráficos; mantiene la banda en el gráfico y evita declarar una brecha concluyente si el desempleo queda dentro de la banda de NAIRU. La metodología se conserva documentada aquí; no se presenta como una sección desplegable en la página.

Pruebas del modelo (Node 22.6 o superior con soporte de eliminación de tipos):

```bash
node --experimental-strip-types --test tests/nairu.test.mjs
```
