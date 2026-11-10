// Enquadra a foto do comprovante ("estilo scanner") antes de subir na 398.
// Quem acha o papel é a IA do back (gpt-6.1-terra): devolve os 4 cantos (0–1000) + rotação.
// Aqui só se aplica: corte com perspectiva (homografia), rotação e contraste leve.
// Na dúvida NÃO enquadra: devolve null e o robô sobe a foto original (pior caso = como é hoje).
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const MARGEM = 0.02;        // folga p/ fora (2%) p/ não cortar a beira do canhoto
const AREA_MINIMA = 0.15;   // papel tem que ocupar pelo menos 15% da foto
const LADO_MINIMO = 150;    // em unidades 0–1000

function cruz(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

// Confere se os cantos formam um papel plausível. Devolve o motivo da recusa ou null.
function motivoRecusa(pts) {
  if (pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || p[0] < -5 || p[1] < -5 || p[0] > 1005 || p[1] > 1005))
    return "cantos fora da imagem";

  const sinais = [0, 1, 2, 3].map((i) => Math.sign(cruz(pts[i], pts[(i + 1) % 4], pts[(i + 2) % 4])));
  if (!sinais.every((s) => s === sinais[0] && s !== 0)) return "quadrilátero torto/cruzado";

  let area = 0;
  for (let i = 0; i < 4; i++) area += pts[i][0] * pts[(i + 1) % 4][1] - pts[(i + 1) % 4][0] * pts[i][1];
  area = Math.abs(area) / 2 / 1e6;
  if (area < AREA_MINIMA) return `papel pequeno demais (${Math.round(area * 100)}% da foto)`;

  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < LADO_MINIMO) return "lado curto demais";
  }
  return null;
}

// Homografia que leva o retângulo destino → quadrilátero na foto.
function homografia(dst, src) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], [u, v] = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) if (r !== c) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}

// enq = { supEsq:{x,y}, supDir, infDir, infEsq, rotacao } (como vem da API).
// Devolve o caminho do arquivo enquadrado, ou null (usar a original).
async function enquadrar(arquivo, enq) {
  if (!enq || /\.pdf$/i.test(arquivo)) return null;

  const norm = [enq.supEsq, enq.supDir, enq.infDir, enq.infEsq].map((p) => [Number(p?.x), Number(p?.y)]);
  const recusa = motivoRecusa(norm);
  if (recusa) {
    console.log(`   enquadrar: usando a original (${recusa}).`);
    return null;
  }

  // margem: empurra cada canto p/ fora a partir do centro
  const cx = norm.reduce((s, p) => s + p[0], 0) / 4, cy = norm.reduce((s, p) => s + p[1], 0) / 4;
  const comMargem = norm.map(([x, y]) => [
    Math.min(1000, Math.max(0, x + (x - cx) * MARGEM * 2)),
    Math.min(1000, Math.max(0, y + (y - cy) * MARGEM * 2)),
  ]);

  // Sem auto-rotate EXIF: a foto do WhatsApp chega sem EXIF e os cantos da IA são da imagem como veio
  // (igual à bateria de 10/11, onde o recorte foi validado).
  const img = sharp(arquivo);
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;

  const src = comMargem.map(([x, y]) => [(x / 1000) * W, (y / 1000) * H]);
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const w = Math.round(Math.max(d(src[0], src[1]), d(src[3], src[2])));
  const h = Math.round(Math.max(d(src[0], src[3]), d(src[1], src[2])));
  const [a, b2, c, dd, e, f, g, hh] = homografia([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], src);

  const out = Buffer.alloc(w * h * C);
  const px = (xx, yy, k) => data[(Math.min(H - 1, Math.max(0, yy)) * W + Math.min(W - 1, Math.max(0, xx))) * C + k];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const z = g * x + hh * y + 1;
    const u = (a * x + b2 * y + c) / z, v = (dd * x + e * y + f) / z;
    const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
    const o = (y * w + x) * C;
    for (let k = 0; k < C; k++) {
      out[o + k] = (1 - fy) * ((1 - fx) * px(x0, y0, k) + fx * px(x0 + 1, y0, k)) +
                   fy * ((1 - fx) * px(x0, y0 + 1, k) + fx * px(x0 + 1, y0 + 1, k));
    }
  }

  const destino = arquivo.replace(/(\.[a-z]+)?$/i, "_enquadrada.jpg");
  await sharp(out, { raw: { width: w, height: h, channels: C } })
    .rotate([0, 90, 180, 270].includes(enq.rotacao) ? enq.rotacao : 0)
    .normalise()
    .jpeg({ quality: 85 })
    .toFile(destino);
  return destino;
}

module.exports = { enquadrar, motivoRecusa };
