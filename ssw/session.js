const {
  sleep,
  debugFrames,
  debugScreenshot,
  debugContextPages,
  waitForFrameWithSelector,
  findFrameWithSelector,
} = require("./helpers");

// SSW pôs reCAPTCHA no login (22/11/2026): o robô não loga mais, usa a sessão
// compartilhada capturada por uma pessoa pelo DAGO (ver sessaoSswApi.js).
const { entrarComSessaoSsw } = require("./sessaoSswApi");

async function loginSSW(page) {
  // Mesmo nome de antes para não mexer nos robôs: agora só carrega a sessão.
  await entrarComSessaoSsw(page);

  debugFrames(page, "(após login)");
  debugContextPages(page.context(), "(após login)");
  await debugScreenshot(page, "01_pos_login.png");
}

async function typeMenuOption(page, value) {
  const selector = 'input[name="f3"]';

  const menuFrame = await waitForFrameWithSelector(
    page,
    selector,
    30000
  );

  if (!menuFrame) {
    throw new Error("Campo Opção (f3) não encontrado.");
  }

  const opcao = menuFrame.locator(selector).first();

  await opcao.waitFor({
    state: "visible",
    timeout: 30000,
  });

  for (let attempt = 1; attempt <= 2; attempt++) {
    await opcao.scrollIntoViewIfNeeded().catch(() => {});
    await opcao.click({ force: true }).catch(() => {});
    await opcao.focus().catch(() => {});
    await opcao.press("Control+A").catch(() => {});
    await opcao.press("Backspace").catch(() => {});
    await opcao.type(String(value), { delay: 120 }).catch(() => {});

    let v = await opcao.inputValue().catch(() => "");

    if (v !== String(value)) {
      await opcao.fill(String(value)).catch(() => {});
      v = await opcao.inputValue().catch(() => "");
    }

    if (v === String(value)) {
      await opcao.dispatchEvent("change").catch(() => {});
      await opcao.press("Tab").catch(() => {});
      await opcao.blur().catch(() => {});
      return;
    }

    await sleep(400);
  }

  throw new Error(
    `Não consegui digitar ${value} no campo Opção.`
  );
}

async function findMenuPage(context) {
  const pages = context
    .pages()
    .filter((p) => !p.isClosed());

  for (const p of pages) {
    try {
      if (!p.url().includes("/bin/menu01")) {
        continue;
      }

      const fr = await findFrameWithSelector(
        p,
        'input[name="f3"]'
      );

      if (fr) {
        return p;
      }
    } catch {}
  }

  return null;
}

async function resetSessaoCompleta(context) {
  console.log("🔄 Reset completo da sessão SSW: fechando tudo e refazendo login...");

  for (const p of context.pages()) {
    await p.close().catch(() => {});
  }

  const newPage = await context.newPage();

  await loginSSW(newPage);

  const menu = await findMenuPage(context);

  if (!menu) {
    throw new Error("Reset completo falhou: menu não encontrado após relogin.");
  }

  console.log("✅ Sessão SSW recuperada com relogin completo.");

  return menu;
}

async function recoverMenuPage(context) {
  const existing = await findMenuPage(context);

  if (existing) {
    return existing;
  }

  console.log("🔄 Reabrindo sessão/menu...");

  const newPage = await context.newPage();

  await loginSSW(newPage);

  const menu = await findMenuPage(context);

  if (menu) {
    return menu;
  }

  throw new Error(
    "Não consegui recuperar a página do menu."
  );
}

module.exports = {
  loginSSW,
  typeMenuOption,
  findMenuPage,
  recoverMenuPage,
  resetSessaoCompleta,
};