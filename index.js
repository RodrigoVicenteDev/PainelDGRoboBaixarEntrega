// Robô de BAIXA DE ENTREGA + COMPROVANTE no SSW.
//
// Agrupado por unidade de destino (unidade receptora do CTRC); para CADA CTRC, nesta ordem:
//   1) 038 Baixa de Entregas → uma baixa
//   2) 398 Escanear Comprovante → uma subida por FOTO (CTRC com várias NFs = várias fotos)
//   3) 040 Capa de Comprovantes → "Gerar meus" (uma capa por baixa, igual à descarga do roboComplementar)
//
// 1ª versão: entrada por arquivo JSON (sem API Dago). Ver README.md e baixas.exemplo.json.
//   node index.js [baixas.json]
// Saída: resultados/resultado_<data>.json no MESMO formato da entrada, com o status de cada
// etapa. Dá para rodar de novo passando esse arquivo: só refaz o que deu "erro" ou ficou pendente.

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const { setupLogger } = require("./utils/logger");
const { limparAntigos } = require("./utils/limpeza");
const { parseCtrcComDv } = require("./utils/formatters");
const { loginSSW, resetSessaoCompleta, recoverMenuPage } = require("./ssw/session");
const { closeExtraPages } = require("./ssw/helpers");
const { trocarUnidadeMenu } = require("./robots/comum");
const { abrir038, baixarCtrc } = require("./robots/baixa038");
const { abrir398, subirFoto } = require("./robots/comprovante398");
const capaComprovante040 = require("./robots/capaComprovante040");

const HEADLESS = String(process.env.HEADLESS ?? "1").trim() !== "0";
const SLOWMO = Number(process.env.SLOWMO ?? 0);
const CODIGOS_ACEITOS = new Set(["01", "17"]); // 36/68 (devolução) nunca automático: vão pro Arquivo
const RECEBEDOR_PADRAO = process.env.BAIXA_RECEBEDOR_PADRAO ?? "ASSINATURA";
const PARENTESCO_PADRAO = process.env.BAIXA_PARENTESCO_PADRAO ?? "RUBRICA";
const HORA_PADRAO = process.env.BAIXA_HORA_PADRAO ?? "1200";

// ---------------- entrada ----------------

function normalizarData(v) {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (m) return `${m[1]}${m[2]}${m[3].slice(-2)}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}${m[2]}${m[1].slice(-2)}`;
  if (/^\d{6}$/.test(s)) return s;
  throw new Error(`data inválida "${v}" (use dd/mm/aaaa ou ddmmaa)`);
}

function normalizarHora(v) {
  const s = String(v ?? "").replace(":", "").trim() || HORA_PADRAO;
  if (!/^\d{4}$/.test(s)) throw new Error(`hora inválida "${v}" (use hhmm)`);
  return s;
}

function textoCampo(v, padrao) {
  return String(v ?? padrao).trim().toUpperCase().slice(0, 20);
}

function statusDe(etapa) {
  return etapa && typeof etapa === "object" ? etapa.status ?? null : null;
}

// Lê o JSON e valida. Item inválido não para o robô: vai pro resultado como erro.
function carregarItens(arquivo) {
  const bruto = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  const lista = Array.isArray(bruto) ? bruto : bruto.baixas;
  if (!Array.isArray(lista)) throw new Error(`${arquivo}: esperado uma lista (ou { "baixas": [...] }).`);

  return lista.map((raw, i) => {
    const item = {
      ctrc: raw.ctrc,
      unidade: String(raw.unidade ?? "").trim().toUpperCase(),
      data: raw.data,
      hora: raw.hora ?? HORA_PADRAO,
      codigo: String(raw.codigo ?? "01").padStart(2, "0"),
      recebedor: textoCampo(raw.recebedor, RECEBEDOR_PADRAO),
      parentesco: textoCampo(raw.parentesco, PARENTESCO_PADRAO),
      baixa: raw.baixa ?? null,
      capa: raw.capa ?? null,
      fotos: (raw.fotos ?? []).map((f) => (typeof f === "string" ? { arquivo: f } : { ...f })),
      _invalido: null,
    };

    try {
      item._ctrc = parseCtrcComDv(item.ctrc, "");
      if (!item._ctrc.sigla) throw new Error(`CTRC "${item.ctrc}" sem sigla (use ex. CCM143231-1)`);
      if (!/^[A-Z]{3}$/.test(item.unidade)) throw new Error(`unidade inválida "${raw.unidade}" (sigla de 3 letras, ex. FEC)`);
      if (!CODIGOS_ACEITOS.has(item.codigo)) throw new Error(`código ${item.codigo} não é automático (só 01 e 17)`);
      item.data = normalizarData(item.data);
      item.hora = normalizarHora(item.hora);
      if (item.fotos.length === 0) throw new Error("sem fotos");
    } catch (e) {
      item._invalido = `Linha ${i + 1}: ${e.message}`;
    }
    return item;
  });
}

// ---------------- saída ----------------

function agoraIso() {
  return new Date().toISOString();
}

function salvarResultado(arquivoSaida, itens) {
  const limpo = itens.map(({ _ctrc, _invalido, ...resto }) => resto);
  fs.writeFileSync(arquivoSaida, JSON.stringify({ geradoEm: agoraIso(), baixas: limpo }, null, 2), "utf8");
}

function marcar(alvo, campo, status, mensagem) {
  alvo[campo] = { status, mensagem, quando: agoraIso() };
}

// ---------------- execução ----------------

async function prepararUnidade(context, unidade) {
  await closeExtraPages(context, [await recoverMenuPage(context)]);
  await trocarUnidadeMenu(context, unidade);
}

async function recuperar(context) {
  try {
    await resetSessaoCompleta(context);
  } catch (e) {
    console.error("⚠️ Falha ao recuperar a sessão SSW:", e?.message || e);
  }
}

// Um CTRC por vez, igual à descarga do roboComplementar: 038 → 398 (fotos) → 040.
// A capa sai mesmo se alguma foto falhar (a baixa já existe; a foto é retentada depois).
async function processarCtrc(context, unidade, it, salvar) {
  // ---- 1) 038: baixa ----
  const st = statusDe(it.baixa);
  if (st !== "ok" && st !== "indefinido") {
    try {
      await prepararUnidade(context, unidade);
      const dig = await abrir038(context, unidade);
      const r = await baixarCtrc(context, dig, { ...it, ctrc: it._ctrc });
      marcar(it, "baixa", r.status, r.mensagem);
      console.log(`${r.status === "ok" ? "✅" : "❌"} 038 ${it.ctrc}: ${r.mensagem}`);
    } catch (e) {
      marcar(it, "baixa", "erro", `Robô: ${e.message}`);
      console.error(`❌ 038 ${it.ctrc}:`, e?.stack || e);
      await recuperar(context);
    }
    salvar();
  }

  if (statusDe(it.baixa) !== "ok") return; // sem baixa: não sobe foto nem gera capa

  // ---- 2) 398: uma subida por foto ----
  let tela398 = null;
  for (const foto of it.fotos) {
    if (["ok", "indefinido"].includes(foto.status)) continue;
    try {
      if (!tela398) {
        await prepararUnidade(context, unidade);
        tela398 = await abrir398(context, unidade);
      }
      const r = await subirFoto(context, tela398, it._ctrc, foto.arquivo);
      Object.assign(foto, { status: r.status, mensagem: r.mensagem, quando: agoraIso() });
      console.log(`${r.status === "ok" ? "✅" : "❌"} 398 ${it.ctrc} ${path.basename(foto.arquivo)}: ${r.mensagem}`);
      if (r.status !== "ok") tela398 = null;
    } catch (e) {
      Object.assign(foto, { status: "erro", mensagem: `Robô: ${e.message}`, quando: agoraIso() });
      console.error(`❌ 398 ${it.ctrc} ${foto.arquivo}:`, e?.stack || e);
      tela398 = null;
      await recuperar(context);
    }
    salvar();
  }

  // ---- 3) 040: capa "Gerar meus" desta baixa ----
  if (statusDe(it.capa) === "ok") return;
  try {
    await prepararUnidade(context, unidade);
    await capaComprovante040.executar({ context, menuPage: await recoverMenuPage(context) });
    marcar(it, "capa", "ok", `Capa gerada em ${unidade}.`);
    console.log(`✅ 040 ${it.ctrc}: capa gerada em ${unidade}.`);
  } catch (e) {
    marcar(it, "capa", "erro", `Robô: ${e.message}`);
    console.error(`❌ 040 ${it.ctrc}:`, e?.stack || e);
    await recuperar(context);
  }
  salvar();
}

async function processarUnidade(context, unidade, itens, salvar) {
  console.log("======================================");
  console.log(`🏢 Unidade ${unidade}: ${itens.length} CTRC(s)`);
  console.log("======================================");

  for (const it of itens) {
    console.log(`—— ${it.ctrc} (${it.fotos.length} foto(s)) ——`);
    await processarCtrc(context, unidade, it, salvar);
  }
}

async function run() {
  const { LOG_FILE } = setupLogger();
  limparAntigos("logs", 4);
  limparAntigos("debug", 4);

  const arquivoEntrada = path.resolve(process.argv[2] ?? "baixas.json");
  fs.mkdirSync("resultados", { recursive: true });
  const arquivoSaida = path.resolve(
    "resultados",
    `resultado_${agoraIso().replace(/[:.]/g, "-").slice(0, 19)}.json`
  );

  console.log("🤖 Robô de baixa + comprovante iniciado");
  console.log("Entrada:", arquivoEntrada);
  console.log("Saída:", arquivoSaida);
  console.log("HEADLESS:", HEADLESS, "| Log:", LOG_FILE);

  const itens = carregarItens(arquivoEntrada);
  const salvar = () => salvarResultado(arquivoSaida, itens);

  for (const it of itens.filter((x) => x._invalido)) {
    marcar(it, "baixa", "erro", it._invalido);
    console.error(`❌ ${it._invalido}`);
  }

  const validos = itens.filter((x) => !x._invalido);
  const porUnidade = new Map();
  for (const it of validos) {
    if (!porUnidade.has(it.unidade)) porUnidade.set(it.unidade, []);
    porUnidade.get(it.unidade).push(it);
  }
  salvar();

  if (porUnidade.size > 0) {
    const browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOWMO });
    try {
      const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 768 } });

      // Alertas nativos (window.alert) do SSW: registra o texto e aceita (a 398 usa p/ o resultado?).
      context.__alertas = [];
      const ouvirAlertas = (p) =>
        p.on("dialog", async (d) => {
          const texto = String(d.message() ?? "").trim();
          console.log(`💬 Alerta do SSW (${d.type()}): ${texto}`);
          context.__alertas.push({ texto, quando: Date.now() });
          await d.accept().catch(() => {});
        });
      context.on("page", ouvirAlertas);
      await loginSSW(await context.newPage());

      for (const [unidade, lista] of porUnidade) {
        try {
          await processarUnidade(context, unidade, lista, salvar);
        } catch (e) {
          console.error(`❌ Unidade ${unidade} interrompida:`, e?.stack || e);
          await recuperar(context);
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }
  }

  salvar();

  // ---- resumo ----
  const n = (f) => itens.filter(f).length;
  const fotos = itens.flatMap((it) => it.fotos);
  console.log("======================================");
  console.log(`Baixas: ${n((i) => statusDe(i.baixa) === "ok")} ok · ${n((i) => statusDe(i.baixa) === "erro")} erro · ${n((i) => statusDe(i.baixa) === "indefinido")} indefinido`);
  console.log(`Fotos:  ${fotos.filter((f) => f.status === "ok").length} ok · ${fotos.filter((f) => f.status === "erro").length} erro · ${fotos.filter((f) => f.status === "indefinido").length} indefinido · ${fotos.filter((f) => !f.status).length} não enviadas`);
  console.log(`Capas:  ${n((i) => statusDe(i.capa) === "ok")} ok · ${n((i) => statusDe(i.capa) === "erro")} erro`);
  console.log("Resultado:", arquivoSaida);
  console.log("======================================");

  const tudoOk =
    itens.every((i) => statusDe(i.baixa) === "ok") &&
    fotos.every((f) => f.status === "ok") &&
    itens.every((i) => statusDe(i.capa) === "ok");
  process.exit(tudoOk ? 0 : 1);
}

run().catch((e) => {
  console.error("❌ Falha geral:", e?.stack || e);
  process.exit(1);
});
