# Verificación de Lienzo

Verificado el 4 de octubre de 2026 contra Paseo y SDK de plugins 0.10.3.
El plugin `canvas` está instalado desde `plugin/` y su última recarga terminó en `running`.
El coordinador ejecutó `pnpm typecheck` y `pnpm test`: 42 pruebas aprobadas,
ninguna fallida ni omitida. Son 30 de backend/protocolo y 12 de frontend.

## Pruebas automatizadas

La suite comprueba transacciones y rollback, conflictos de revisión, alcance por workspace,
selección independiente, grupos anidados, ciclos y membresía, deshacer por agente,
tipos y packs, colisiones de catálogo y exportación portable de ejemplos protegidos.
Incluye las regresiones encontradas por la revisión independiente: los parches de grupos
conservan propiedades omitidas, las escrituras grandes devuelven confirmaciones veraces,
los tipos nuevos desconocidos se rechazan y un ack rápido permanece terminal.

La persistencia se verifica con reapertura, salida abrupta de un proceso y recuperación
de su bloqueo. Las tandas de feedback se guardan antes del envío con identificador,
contenido y eventos inmutables. Un reintento conserva la tanda original y separa eventos
nuevos. Esto no promete transporte exactamente una vez.

La prueba oficial MCP usa `Client` y `StdioClientTransport`: inicializa, lista herramientas,
llama al catálogo y comparte estado con RPC. Verifica autenticación, propietario, workspace,
Origin y conflictos; un cliente existente sigue funcionando tras reabrir puente y store.
La integración Codex comprueba la política del SDK instalado para mantener visible el
catálogo sin conceder aprobación automática a sus escrituras.

Las pruebas de frontend verifican diagramas con bifurcaciones y ciclos, geometría y layouts,
movimientos entre grupos, instrucciones, formularios y URLs. La cámara inicial conserva
una escala legible y muestra completo el primer grupo aunque el contenido desborde.
El documento abierto se restaura al remontar el panel, aislado por host y workspace,
con fallback para documentos eliminados o inaccesibles. El cliente usa ES2023 sin DOM;
las funciones web están confinadas a `client/web.ts`.

## Plugin instalado y agente real

En Chromium dentro de escritorios omabox propios se abrió **Abrir Lienzo** en el
workspace del proyecto. Se creó un ejemplo identificado, se seleccionó una nota,
se cambió su título y se verificaron guardar, deshacer y rehacer en la interfaz.
Un JSON inválido mostró el error de importación. Un pack válido `lienzo-qa` pasó
por revisión e importación; su descarga desde la interfaz produjo JSON portable válido.
El catálogo y los documentos persistieron durante las recargas del plugin.

Un agente con MCP real creó `lienzo-live-demo`, ampliando un diagrama de uno a cuatro
nodos mediante una transacción con revisión esperada. Se comprobaron el historial,
la selección y las instrucciones heredadas del grupo y del documento.
Un agente nuevo confirmó que `canvas_catalog` estaba visible y leyó el pack importado
por UI y las propiedades integradas en español.

Desde la bandeja real se pidió agregar **Reintentar** después de **Error** y conectar
con **Petición**. El agente recibió la acción, aplicó la edición preservando los nodos
existentes y reconoció únicamente su evento. El diagrama quedó con cinco nodos y cinco
conexiones. La interfaz mostró **Recibido por el agente**. Una transacción posterior
actualizó la URL HTTPS del preview y agregó la referencia a la arquitectura. El documento
quedó en revisión 4. No se simuló actividad ni feedback.

## Revisión visual

La auditoría de Opus en `docs/design-audit.md` distingue capturas vistas de lectura de código.
No queda un hallazgo visual material abierto en las superficies que revisó.
Se comprobó el panel amplio bajo temas de host oscuro y claro, diagramas con etiquetas,
radios y checkboxes, inspector, catálogo, importación/exportación, preview HTTPS embebida y cuerpo de referencia multimedia.
El cambio a claro afectó solo el almacenamiento del navegador privado de QA.
No se activó ningún tema del usuario.

A 640×900 se conserva **Lienzo en vivo** después del cambio de tamaño. Se comprobó
el esquema compacto, su diagrama en lista, la bandeja con ack real, el inspector y
los diálogos de documentos, catálogo, packs e importación. También se abrió
el inspector superpuesto en una ventana de 1000×900 sin desbordar la barra superior. Los modales conservan el contexto UI
al cruzar el portal del SDK. Las capturas están en `docs/screenshots/`.

## Arquitectura y página de ejemplo

`node --check` pasa para `architecture/app.js` y `architecture/data.js`.
En omabox se comprobaron mapa, detalles, flujos, avance de pasos y vista Multijugador
con tema claro. La documentación separa funciones actuales y futuras.

La página `design/demo.html` se comprobó en Tinta con edición y guardado local,
y en Papel con error recuperable. También se vio embebida en el bloque preview real.
Los enlaces HTTPS del workspace, arquitectura y demo responden por Tailscale.

## Límites de esta verificación

El tamaño compacto corresponde al cliente web. No se probó en dispositivos físicos
con iOS o Android. Los temas contribuidos Lienzo Papel y Lienzo Tinta no se activaron
en el plugin. Algunos estados excepcionales y detalles indicados en la auditoría
solo tienen cobertura de código o pruebas, sin captura renderizada.

V1 comparte documentos en un mismo host y workspace. No implementa identidades de
personas, presencia, cursores, CRDT ni sincronización entre hosts. Los videos y audios
se muestran como referencias que se abren; no como reproductores embebidos.
