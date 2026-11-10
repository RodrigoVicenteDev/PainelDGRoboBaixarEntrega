const {
  fill,
  getTargetWithSelector,
  openAfterAction,
  closeExtraPages,
  debugScreenshot,
  findFrameWithSelector,
  sleep,
} = require("../ssw/helpers");

const { typeMenuOption, recoverMenuPage } = require("../ssw/session");

// Data de hoje no fuso do Brasil (o servidor roda em UTC: depois das 21h o new Date() local já seria amanhã).
function hojeDDMMAA() {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).formatToParts(new Date());

  const v = (t) => partes.find((p) => p.type === t).value;

  return `${v("day")}${v("month")}${v("year")}`;
}

async function clicarOkSeAparecer(context, pageHint, label = "aviso") {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const pages = context.pages().filter((p) => !p.isClosed());

    for (const p of pages) {
      try {
        const ok = p.locator('a.dialog:has-text("OK"), a[id="0"]').first();

        if (await ok.isVisible().catch(() => false)) {
          const texto = await p.locator("div#errormsglabel").innerText().catch(() => "");
          console.log(`${label}: ${texto.replace(/\s+/g, " ").trim()}`);
          await ok.click({ force: true }).catch(() => {});
          await sleep(500);
          return true;
        }

        const fr = await findFrameWithSelector(p, 'a.dialog:has-text("OK"), a[id="0"]');

        if (fr) {
          const okFrame = fr.locator('a.dialog:has-text("OK"), a[id="0"]').first();

          if (await okFrame.isVisible().catch(() => false)) {
            const texto = await fr.locator("div#errormsglabel").innerText().catch(() => "");
            console.log(`${label}: ${texto.replace(/\s+/g, " ").trim()}`);
            await okFrame.click({ force: true }).catch(() => {});
            await sleep(500);
            return true;
          }
        }
      } catch {}
    }

    if (pageHint && !pageHint.isClosed()) {
      try {
        const ok = pageHint.locator('a.dialog:has-text("OK"), a[id="0"]').first();

        if (await ok.isVisible().catch(() => false)) {
          const texto = await pageHint.locator("div#errormsglabel").innerText().catch(() => "");
          console.log(`${label}: ${texto.replace(/\s+/g, " ").trim()}`);
          await ok.click({ force: true }).catch(() => {});
          await sleep(500);
          return true;
        }
      } catch {}
    }

    await sleep(250);
  }

  return false;
}

async function salvarHtmlDebug(page, nome) {
  try {
    const html = await page.content();
    const fs = require("fs");
    const path = require("path");

    const debugDir = path.resolve(__dirname, "../debug");
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }

    const filePath = path.join(debugDir, nome);
    fs.writeFileSync(filePath, html, "utf8");

    console.log(`📄 html salvo: ${filePath}`);
  } catch (err) {
    console.log(`⚠️ Não consegui salvar HTML debug ${nome}: ${err.message}`);
  }
}

async function openOption040(menuPage, context) {
  console.log("Pós-processamento 040) Abrindo opção 040...");

  const selector040 = [
    'body:has-text("040 - Emissão Capa")',
    'body:has-text("Gerar nova Capa")',
    'a[id="3"]',
    'a:has-text("Gerar meus")',
    'input[name="f2"]',
    'input[id="2"]',
  ].join(", ");

  await debugScreenshot(menuPage, "debug_antes_040.png");
  await salvarHtmlDebug(menuPage, "debug_antes_040.html");

  const page040 = await openAfterAction({
    context,
    currentPage: menuPage,
    selector: selector040,
    label: "opção 040",
    action: async () => {
      await typeMenuOption(menuPage, "40");
      await sleep(1000);
      await debugScreenshot(menuPage, "debug_pos_digitou_040.png");
      await salvarHtmlDebug(menuPage, "debug_pos_digitou_040.html");
    },
  });

  await sleep(5000);

  await debugScreenshot(page040, "pos_040_tela_inicial.png");
  await salvarHtmlDebug(page040, "pos_040_tela_inicial.html");

  return page040;
}

async function gerarCapaMeus(context, page040) {
  console.log("Pós-processamento 040) Preenchendo data final e clicando Gerar meus...");

  await debugScreenshot(page040, "pos_040_antes_qualquer_acao.png");
  await salvarHtmlDebug(page040, "pos_040_antes_qualquer_acao.html");

  await clicarOkSeAparecer(context, page040, "Aviso pendente antes do 040");

  const foundCampo = await getTargetWithSelector(
    context,
    page040,
    'input[name="f2"], input[id="2"]',
    "campo data final da opção 040",
    60000
  );

  const pageReal = foundCampo.page;
  const targetCampo = foundCampo.target;

  await debugScreenshot(pageReal, "pos_040_campo_data_encontrado.png");
  await salvarHtmlDebug(pageReal, "pos_040_campo_data_encontrado.html");

  const hoje = hojeDDMMAA();

  await fill(targetCampo, 'input[name="f2"], input[id="2"]', hoje);

  await sleep(1000);

  await debugScreenshot(pageReal, "pos_040_data_final_preenchida.png");
  await salvarHtmlDebug(pageReal, "pos_040_data_final_preenchida.html");

  await clicarOkSeAparecer(context, pageReal, "Aviso pendente antes de Gerar meus 040");

  console.log("Pós-processamento 040) Procurando link Gerar meus após preencher data...");

  const foundGerar = await getTargetWithSelector(
    context,
    pageReal,
    'a[id="3"], a:has-text("Gerar meus")',
    "link Gerar meus da 040",
    60000
  );

  const pageGerar = foundGerar.page;
  const targetGerar = foundGerar.target;

  await debugScreenshot(pageGerar, "pos_040_link_gerar_meus_encontrado.png");
  await salvarHtmlDebug(pageGerar, "pos_040_link_gerar_meus_encontrado.html");

  const linkGerarMeus = targetGerar
    .locator('a[id="3"], a:has-text("Gerar meus")')
    .first();

  await linkGerarMeus.waitFor({
    state: "visible",
    timeout: 30000,
  });

  await linkGerarMeus.scrollIntoViewIfNeeded().catch(() => {});

  const downloadPromise = pageGerar
    .waitForEvent("download", { timeout: 15000 })
    .catch(() => null);

  console.log("Pós-processamento 040) Clicando em Gerar meus...");

  await debugScreenshot(pageGerar, "pos_040_antes_click_gerar_meus.png");
  await salvarHtmlDebug(pageGerar, "pos_040_antes_click_gerar_meus.html");

  await linkGerarMeus.click({ force: true });

  await sleep(2000);

  await debugScreenshot(pageGerar, "pos_040_depois_click_gerar_meus.png");
  await salvarHtmlDebug(pageGerar, "pos_040_depois_click_gerar_meus.html");

  const download = await downloadPromise;

  if (download) {
    console.log("Pós-processamento 040) Download detectado e ignorado.");
    await download.delete().catch(() => {});
  }

  await clicarOkSeAparecer(context, pageGerar, "Retorno Gerar meus 040");

  await sleep(1000);

  await debugScreenshot(pageGerar, "pos_040_gerar_meus_final.png");
  await salvarHtmlDebug(pageGerar, "pos_040_gerar_meus_final.html");

  return pageGerar;
}

async function executar({ context, menuPage }) {
  console.log("======================================");
  console.log("🤖 Pós-processamento 040 iniciado");
  console.log("======================================");

  await closeExtraPages(context, [menuPage]);

  const menuAtual = await recoverMenuPage(context);

  await debugScreenshot(menuAtual, "pos_040_menu_recuperado.png");
  await salvarHtmlDebug(menuAtual, "pos_040_menu_recuperado.html");

  const page040 = await openOption040(menuAtual, context);

  await gerarCapaMeus(context, page040);

  await closeExtraPages(context, [menuAtual]);

  console.log("✅ Pós-processamento 040 finalizado.");

  return {
    ok: true,
  };
}

module.exports = {
  nome: "capaComprovante040",
  executar,
};