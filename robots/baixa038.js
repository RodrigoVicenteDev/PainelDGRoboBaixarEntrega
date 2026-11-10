// Opção 038 — Baixa de Entregas → "Digitação de CTRC" (prog ssw0198).
// Uma baixa por CTRC. Sucesso: o SSW NÃO mostra mensagem; limpa o número do CTRC,
// recebedor e parentesco (a sigla fica). Erro: aviso #errormsg com o texto.

const {
  sleep,
  fill,
  fillAndVerify,
  openAfterAction,
  getTargetWithSelector,
  closeExtraPages,
  debugScreenshot,
} = require("../ssw/helpers");
const { typeMenuOption, recoverMenuPage } = require("../ssw/session");
const {
  limparTexto,
  aguardarSemProcessamento,
  lerAviso,
  fecharAviso,
  clicarSeta,
  dispararChange,
  lerValor,
  garantirUnidade,
  acharAlvo,
} = require("./comum");

const SEL_DIGITACAO = "#a_cod_ocor";
const TIMEOUT_GRAVAR_MS = Number(process.env.TIMEOUT_BAIXA_MS ?? 45000);

// Abre a 038 e entra em "Digitação de CTRC". Devolve { page, target } da tela de digitação.
async function abrir038(context, unidade) {
  const menu = await recoverMenuPage(context);
  await closeExtraPages(context, [menu]);

  console.log("038) Abrindo opção 038...");
  const page038 = await openAfterAction({
    context,
    currentPage: menu,
    selector: "#qtde_ctrc",
    label: "opção 038",
    action: async () => typeMenuOption(menu, "38"),
  });

  const inicial = await getTargetWithSelector(context, page038, "#qtde_ctrc", "tela inicial da 038", 30000);
  await garantirUnidade(inicial.target, unidade, "038");

  console.log("038) Entrando em Digitação de CTRC...");
  const pageDig = await openAfterAction({
    context,
    currentPage: inicial.page,
    selector: SEL_DIGITACAO,
    label: "digitação de CTRC da 038",
    action: async () => clicarSeta(inicial.target, 'a[id="10"]'),
  });

  const dig = await getTargetWithSelector(context, pageDig, SEL_DIGITACAO, "digitação da 038", 30000);
  await sleep(1500); // o menu às vezes abre a opção 2x: fecha a aba duplicada
  await closeExtraPages(context, [menu, dig.page]);
  await garantirUnidade(dig.target, unidade, "038");
  await debugScreenshot(dig.page, "038_digitacao_aberta.png");
  return dig;
}

// Sai do campo com Tab, como uma pessoa: o navegador dispara o onchange do SSW
// (dadosocorr / dadosCTRC). Se o Tab não mudar o foco, dispara o change na mão.
async function sairDoCampo(target, selector) {
  const loc = target.locator(selector).first();
  await loc.focus().catch(() => {});
  await loc.press("Tab").catch(() => {});
  await sleep(300);
  const aindaFocado = await loc.evaluate((el) => document.activeElement === el).catch(() => false);
  if (aindaFocado) await dispararChange(target, selector);
  await aguardarSemProcessamento(target);
}

// Espera um campo preenchido pelo SSW (ex.: #descricao) ter valor. Devolve o valor ou "".
async function esperarValor(target, selector, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = limparTexto(await lerValor(target, selector));
    if (v) return v;
    await sleep(250);
  }
  return "";
}

async function preencherTexto(target, selector, valor, nome) {
  // O SSW bloqueia alguns campos conforme o CTRC/ocorrência (ex.: Complemento readonly).
  // Bloqueado com o valor certo = segue; bloqueado com valor diferente = erro.
  const estado = await target
    .locator(selector)
    .first()
    .evaluate((el) => ({ bloqueado: el.readOnly || el.disabled, valor: el.value ?? "" }))
    .catch(() => null);
  if (estado?.bloqueado) {
    if (limparTexto(estado.valor).toUpperCase() === limparTexto(valor).toUpperCase()) return;
    throw new Error(`${nome} está bloqueado pelo SSW com "${estado.valor}", esperado "${valor}".`);
  }

  await fill(target, selector, valor);
  const lido = limparTexto(await lerValor(target, selector));
  if (lido.toUpperCase() !== limparTexto(valor).toUpperCase()) {
    throw new Error(`${nome} ficou "${lido}", esperado "${valor}".`);
  }
}

// Faz a baixa de UM CTRC. Devolve { status, mensagem } com status:
//   "ok"         → baixado (campos limparam, sem aviso)
//   "erro"       → SSW recusou (mensagem = texto do aviso)
//   "indefinido" → sem aviso e sem limpar dentro do tempo: conferir à mão na 101
async function baixarCtrc(context, dig, item) {
  const { ctrc } = item;
  const t = dig.target;

  await aguardarSemProcessamento(t);
  const avisoPendente = await lerAviso(t);
  if (avisoPendente) await fecharAviso(t);

  // 1) Ocorrência: código dispara dadosocorr → descrição ao lado (ex.: "ENTREGUE").
  await fillAndVerify(t, "#a_cod_ocor", item.codigo, { label: "Código da ocorrência" });
  await sairDoCampo(t, "#a_cod_ocor");
  const descricao = await esperarValor(t, "#descricao", 8000);
  const avisoOcor = await lerAviso(t);
  if (avisoOcor || !descricao) {
    await debugScreenshot(dig.page, `038_codigo_sem_descricao_${ctrc.original}.png`);
    if (avisoOcor) await fecharAviso(t);
    return { status: "erro", mensagem: `Código ${item.codigo} não aceito: ${avisoOcor?.texto ?? "sem descrição"}` };
  }

  // 2) Data/hora da ocorrência (ddmmaa / hhmm).
  await fillAndVerify(t, "#a_data_ocor", item.data, { label: "Data da ocorrência" });
  await fillAndVerify(t, "#a_hora_ocor", item.hora, { label: "Hora da ocorrência" });

  // 3) CTRC: sigla + número com DV; o número dispara dadosCTRC (valida o CTRC).
  await fillAndVerify(t, "#a_ser_ctrc", ctrc.sigla, { label: "Sigla do CTRC" });
  await fillAndVerify(t, "#a_nro_ctrc", ctrc.semHifenComDv, { label: "Número do CTRC" });
  await sairDoCampo(t, "#a_nro_ctrc");
  await sleep(1000);
  await aguardarSemProcessamento(t);

  const avisoCtrc = await lerAviso(t);
  if (avisoCtrc) {
    await debugScreenshot(dig.page, `038_erro_ctrc_${ctrc.original}.png`);
    await fecharAviso(t);
    return { status: "erro", mensagem: avisoCtrc.texto };
  }

  await debugScreenshot(dig.page, `038_ctrc_carregado_${ctrc.original}.png`);

  // 4) Recebedor/parentesco por último (o dadosCTRC pode mexer no form).
  await preencherTexto(t, "#a_comple", "", "Complemento");
  await preencherTexto(t, "#a_recebedor", item.recebedor, "Recebido por");
  await preencherTexto(t, "#a_parentesco", item.parentesco, "Parentesco");
  await preencherTexto(t, "#a_nro_doc", "", "Documento");

  // Confere que nada foi limpo antes de gravar.
  const conferencia = {
    "#a_cod_ocor": item.codigo,
    "#a_data_ocor": item.data,
    "#a_hora_ocor": item.hora,
    "#a_nro_ctrc": ctrc.semHifenComDv,
  };
  for (const [sel, esperado] of Object.entries(conferencia)) {
    const lido = limparTexto(await lerValor(t, sel));
    if (lido !== esperado) {
      return { status: "erro", mensagem: `Campo ${sel} ficou "${lido}" antes de gravar (esperado "${esperado}"). Nada gravado.` };
    }
  }

  await debugScreenshot(dig.page, `038_antes_gravar_${ctrc.original}.png`);

  // 5) Grava: ► = ajaxEnvia('BA2', 0).
  console.log(`038) Gravando baixa ${ctrc.original}...`);
  await clicarSeta(t, 'a[id="1"]');

  const deadline = Date.now() + TIMEOUT_GRAVAR_MS;
  while (Date.now() < deadline) {
    await sleep(500);

    const alvo = (await acharAlvo(context, SEL_DIGITACAO)) ?? dig;
    const at = alvo.target;

    const aviso = await lerAviso(at);
    if (aviso) {
      await debugScreenshot(alvo.page, `038_aviso_${ctrc.original}.png`);
      await fecharAviso(at);
      return { status: "erro", mensagem: aviso.texto };
    }

    const processando = await at
      .locator("#procimg")
      .first()
      .evaluate((el) => window.getComputedStyle(el).visibility !== "hidden")
      .catch(() => false);
    if (processando) continue;

    const nro = limparTexto(await lerValor(at, "#a_nro_ctrc"));
    const rec = limparTexto(await lerValor(at, "#a_recebedor"));
    const par = limparTexto(await lerValor(at, "#a_parentesco"));
    if (!nro && !rec && !par) {
      dig.page = alvo.page;
      dig.target = at;
      return { status: "ok", mensagem: "Baixado (SSW limpou os campos)." };
    }
  }

  await debugScreenshot(dig.page, `038_indefinido_${ctrc.original}.png`);
  return {
    status: "indefinido",
    mensagem: `Sem aviso e sem limpar os campos em ${TIMEOUT_GRAVAR_MS / 1000}s. Conferir na 101 antes de tentar de novo.`,
  };
}

module.exports = { abrir038, baixarCtrc };
