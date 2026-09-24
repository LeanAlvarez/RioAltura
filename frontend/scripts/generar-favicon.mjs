// spec 026: genera los PNG de respaldo desde `public/favicon.svg`, que es la
// única fuente. Regenerar después de tocar el SVG:
//     node scripts/generar-favicon.mjs
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const svg = readFileSync("public/favicon.svg", "utf8");
const b = await chromium.launch();

// iOS aplica SU PROPIA máscara redondeada al apple-touch-icon, así que esa
// versión va con las esquinas rectas: si no, se redondea dos veces y queda
// un icono chico flotando dentro de su propio recuadro.
const cuadrado = svg.replace('rx="7"', 'rx="0"');

for (const [archivo, tamano, fuente] of [
  ["public/favicon-96.png", 96, svg],
  ["public/apple-touch-icon.png", 180, cuadrado],
]) {
  const p = await b.newPage({ viewport: { width: tamano, height: tamano } });
  await p.setContent(
    `<body style="margin:0"><div style="width:${tamano}px;height:${tamano}px">${fuente}</div></body>`,
  );
  await p.waitForTimeout(250);
  await p.screenshot({ path: archivo, omitBackground: true });
  await p.close();
  console.log(`${archivo}  ${tamano}x${tamano}`);
}
await b.close();
