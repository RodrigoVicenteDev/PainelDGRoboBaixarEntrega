// Opção 398 — Escanear Comprovante de Entrega (prog ssw0612). Uma subida POR FOTO.
// Fluxo: CTRC (sigla + número c/ DV) → ► (ENV_CTC) → tela do CTe (ssw0612.05) →
// arquivo no input#uploadBtn (sobe sozinho) → o SSW FECHA a tela do CTe e mostra
// "Imagem carregada com sucesso." na tela inicial (ssw0612.04).
// Atenção: a 398 aceita foto nova sempre (não há trava de duplicidade no SSW):
// quem não pode reenviar foto já confirmada é quem chama.

const fs = require("fs");
const path = require("path");

const {
  sleep,
  fillAndVerify,
  openAfterAction,
  getTargetWithSelector,
  closeExtraPages,
  debugScreenshot,
} = require("../ssw/helpers");
const { typeMenuOption, recoverMenuPage, findMenuPage } = require("../ssw/session");
const {
  limparTexto,
  aguardarSemProcessamento,
  lerAviso,
  fecharAviso,
  clicarSeta,
  lerValor,
  garantirUnidade,
  acharAlvo,
  acharTodos,
} = require("./comum");

const SEL_INICIAL = "#ser_ctrc";
const SEL_UPLOAD = "#uploadBtn";
const TIMEOUT_CTE_MS = 30000;
const TIMEOUT_UPLOAD_MS = Number(process.env.TIMEOUT_UPLOAD_MS ?? 120000);
const RE_SUCESSO = /imagem\s+carregada\s+com\s+sucesso/i;
const EXTENSOES = new Set([".jpg", ".jpeg", ".png", ".pdf", ".webp", ".gif", ".bmp"]);

async function abrir398(context, unidade) {
  const menu = await recoverMenuPage(context);
  await closeExtraPages(context, [menu]);

  console.log("398) Abrindo opção 398...");
  const page398 = await openAfterAction({
    context,
    currentPage: menu,
    selector: SEL_INICIAL,
    label: "opção 398",
    action: async () => typeMenuOption(menu, "398"),
  });

  const tela = await getTargetWithSelector(context, page398, SEL_INICIAL, "tela inicial da 398", 30000);
  await sleep(1500); // dá tempo de uma 2ª aba duplicada aparecer, p/ fechar abaixo
  await closeExtraPages(context, [menu, tela.page]);
  await garantirUnidade(tela.target, unidade, "398");
  return tela;
}

// Sobe UMA foto no CTRC. Devolve { status, mensagem }:
//   "ok" → aviso de sucesso · "erro" → foto NÃO subiu (pode tentar de novo)
//   "indefinido" → arquivo entregue ao SSW mas sem confirmação: conferir antes de reenviar.
async function subirFoto(context, tela, ctrc, caminhoFoto) {
  const arquivo = path.resolve(caminhoFoto);
  if (!fs.existsSync(arquivo)) {
    return { status: "erro", mensagem: `Arquivo não encontrado: ${arquivo}` };
  }
  if (!EXTENSOES.has(path.extname(arquivo).toLowerCase())) {
    return { status: "erro", mensagem: `Tipo de arquivo não aceito pela 398 (só imagem/PDF): ${path.basename(arquivo)}` };
  }

  // Tela inicial (pode ter recarregado depois da foto anterior).
  const inicial = (await acharAlvo(context, SEL_INICIAL)) ?? tela;
  const t = inicial.target;

  // A tela do CTe pode abrir em OUTRA janela, e o aviso de sucesso aparece na tela inicial
  // da 398 depois que ela fecha. Antes de cada foto, fecha qualquer janela que sobrou da foto
  // anterior, para um aviso velho nunca ser lido como sucesso desta foto.
  await closeExtraPages(context, [await findMenuPage(context), inicial.page]);

  await aguardarSemProcessamento(t);
  const pendente = await lerAviso(t);
  if (pendente) await fecharAviso(t);

  await fillAndVerify(t, "#ser_ctrc", ctrc.sigla, { label: "Sigla do CTRC (398)" });
  await fillAndVerify(t, "#nro_ctrc", ctrc.semHifenComDv, { label: "Número do CTRC (398)" });

  // ► = ajaxEnvia('ENV_CTC', 1). Sem onchange: tem que clicar na seta.
  let cte;
  try {
    const pageCte = await openAfterAction({
      context,
      currentPage: inicial.page,
      selector: SEL_UPLOAD,
      label: "tela do CTe na 398",
      timeoutMs: TIMEOUT_CTE_MS,
      action: async () => clicarSeta(t, 'a[id="4"]'),
    });
    cte = await getTargetWithSelector(context, pageCte, SEL_UPLOAD, "campo de upload da 398", 10000);
  } catch (e) {
    const aviso = await lerAviso(t);
    if (aviso) {
      await fecharAviso(t);
      return { status: "erro", mensagem: aviso.texto };
    }
    return { status: "erro", mensagem: `Tela do CTe não abriu: ${e.message}` };
  }

  // Confere que o SSW abriu o CTRC certo ANTES de subir (a tela some depois do upload).
  const ser = limparTexto(await lerValor(cte.target, "#h_ser_ctrc")).toUpperCase();
  const num = limparTexto(await lerValor(cte.target, "#h_num_ctrc"));
  const dig = limparTexto(await lerValor(cte.target, "#h_dig_ctrc"));
  if (ser !== ctrc.sigla || num !== ctrc.numero || dig !== ctrc.dv) {
    await debugScreenshot(cte.page, `398_ctrc_divergente_${ctrc.original}.png`);
    await fecharTelaCte(cte.target);
    return { status: "erro", mensagem: `398 abriu ${ser}${num}-${dig}, esperado ${ctrc.original}. Foto não enviada.` };
  }

  console.log(`398) Subindo ${path.basename(arquivo)} em ${ctrc.original}...`);
  await aguardarSemProcessamento(cte.target);
  const inicioUpload = Date.now();
  await cte.target.locator(SEL_UPLOAD).first().setInputFiles(arquivo);

  // Sucesso = tela inicial de volta + aviso "Imagem carregada com sucesso.".
  const deadline = Date.now() + TIMEOUT_UPLOAD_MS;
  let proximoDiag = Date.now() + 3000;
  while (Date.now() < deadline) {
    await sleep(500);

    // Alerta nativo (window.alert) — o Playwright fecha sozinho; o index.js guarda o texto.
    const alerta = (context.__alertas ?? []).find((a) => a.quando >= inicioUpload);
    if (alerta) {
      return RE_SUCESSO.test(alerta.texto)
        ? { status: "ok", mensagem: alerta.texto }
        : { status: "erro", mensagem: `Alerta do SSW: ${alerta.texto}` };
    }

    if (Date.now() >= proximoDiag) {
      await diagnosticar(context, "398 aguardando");
      proximoDiag = Date.now() + 10000;
    }

    const candidatos = [
      ...(await acharTodos(context, SEL_INICIAL)).map((a) => ({ ...a, sel: SEL_INICIAL })),
      ...(await acharTodos(context, SEL_UPLOAD)).map((a) => ({ ...a, sel: SEL_UPLOAD })),
    ];
    for (const alvo of candidatos) {
      const sel = alvo.sel;
      const aviso = await lerAviso(alvo.target);
      if (!aviso) continue;

      await debugScreenshot(alvo.page, `398_aviso_${ctrc.original}.png`);
      await fecharAviso(alvo.target);

      if (RE_SUCESSO.test(aviso.texto)) {
        return { status: "ok", mensagem: aviso.texto };
      }
      if (sel === SEL_UPLOAD) await fecharTelaCte(alvo.target);
      return { status: "erro", mensagem: aviso.texto };
    }
  }

  await diagnosticar(context, "398 timeout", true);
  const alvoFinal = await acharAlvo(context, SEL_UPLOAD);
  if (alvoFinal) {
    await debugScreenshot(alvoFinal.page, `398_timeout_${ctrc.original}.png`);
    await fecharTelaCte(alvoFinal.target);
  }
  return {
    status: "indefinido",
    mensagem: `Sem "Imagem carregada com sucesso" em ${TIMEOUT_UPLOAD_MS / 1000}s. Conferir no SSW antes de reenviar (a 398 aceita foto repetida).`,
  };
}

// Diagnóstico: o que cada aba/frame mostra (tela, campos, aviso). Com print=true, tira print de todas.
async function diagnosticar(context, rotulo, print = false) {
  const pages = context.pages().filter((p) => !p.isClosed());
  for (const [i, p] of pages.entries()) {
    for (const fr of p.frames()) {
      const info = await fr
        .evaluate(() => {
          const vis = (id) => {
            const el = document.getElementById(id);
            return el ? getComputedStyle(el).visibility : "-";
          };
          const txt = (id) => (document.getElementById(id)?.innerText ?? "").replace(/\s+/g, " ").trim();
          return {
            tela: txt("telaprog"),
            inicial: !!document.getElementById("ser_ctrc"),
            upload: !!document.getElementById("uploadBtn"),
            progresso: document.getElementById("uploadprogress")?.value ?? "-",
            procimg: vis("procimg"),
            errormsg: vis("errormsg"),
            aviso: txt("errormsglabel"),
          };
        })
        .catch(() => null);
      if (info && (info.tela || info.inicial || info.upload || info.aviso)) {
        console.log(`🔎 ${rotulo} | aba ${i} ${fr === p.mainFrame() ? "principal" : "frame " + fr.name()} | ${JSON.stringify(info)}`);
      }
    }
    if (print) await debugScreenshot(p, `398_diag_aba${i}.png`);
  }
}

// "×" da tela do CTe: volta para a tela inicial da 398.
async function fecharTelaCte(target) {
  const x = target.locator('a[id="1"]').first();
  if ((await x.count().catch(() => 0)) > 0) {
    await x.evaluate((el) => { el.focus(); el.click(); }).catch(() => {});
    await sleep(800);
  }
}

module.exports = { abrir398, subirFoto };
