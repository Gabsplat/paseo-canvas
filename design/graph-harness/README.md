# Arnés visual del lienzo-grafo

Ejecuta el layout real (`plugin/client/logic.ts`), el adaptador real de conectores (`plugin/client/web.ts`) y los
tokens reales. Las tarjetas son DOM plano que imita a los componentes React Native: el panel real solo se monta
dentro de Paseo. Sirve para mirar distribución, regiones, curvas, puertos, lotes y atenuado; no prueba los
componentes RN ni los gestos.

```bash
pnpm exec esbuild design/graph-harness/harness.ts --bundle --format=iife --outfile=/tmp/lienzo-graph-harness/harness.js
cp design/graph-harness/index.html /tmp/lienzo-graph-harness/
```

Parámetros de `index.html`: `doc=reference|chorizo|example`, `theme=tinta|papel`, `hover=<id>`, `select=<id>`,
`dir=right`, `collapsed=<groupId>`, `move=<id>,<x>,<y>`, `fit=1`. Abrir siempre dentro de omabox.
