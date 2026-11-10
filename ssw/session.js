const {
  sleep,
  debugFrames,
  debugScreenshot,
  debugContextPages,
  waitForFrameWithSelector,
  findFrameWithSelector,
} = require("./helpers");

const LOGIN_URL = "https://sistema.ssw.inf.br/bin/ssw0422";

const SITE_DOMINIO = process.env.SITE_DOMINIO ?? "";
const SITE_CPF = process.env.SITE_CPF ?? "";
const SITE_USER = process.env.SITE_USER ?? "";
const SITE_PASS = process.env.SITE_PASS ?? "";

async function loginSSW(page) {
  if (!SITE_DOMINIO || !SITE_CPF || !SITE_USER || !SITE_PASS) {
    throw new Error(
      "Variáveis obrigatórias ausentes: SITE_DOMINIO, SITE_CPF, SITE_USER, SITE_PASS"
    );
  }

  console.log("1) Abrindo login SSW...");

  await page.goto(LOGIN_URL, {
    waitUntil: "domcontentloaded",
  });

  console.log("2) Preenchendo login SSW...");

  await page.locator('input[id="1"]').fill(SITE_DOMINIO);
  await page.locator('input[id="2"]').fill(SITE_CPF);
  await page.locator('input[id="3"]').fill(SITE_USER);
  await page.locator('input[id="4"]').fill(SITE_PASS);

  console.log("3) Clicando entrar...");

  await page.locator('a[id="5"]').click();

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page
    .waitForLoadState("networkidle", {
      timeout: 10000,
    })
    .catch(() => {});

  const erroLogin = await page
    .locator("div#errormsglabel")
    .innerText()
    .catch(() => "");

  if (erroLogin && !page.url().includes("/bin/menu01")) {
    throw new Error(
      `Login SSW falhou: ${erroLogin.replace(/\s+/g, " ").trim()}`
    );
  }

  const menuFrame = await waitForFrameWithSelector(
    page,
    'input[name="f3"]',
    15000
  );

  const estaNoMenu =
    page.url().includes("/bin/menu01") && !!menuFrame;

  if (!estaNoMenu) {
    debugFrames(page, "(login sem menu)");

    await debugScreenshot(
      page,
      "falha_login_ssw_sem_menu.png"
    );

    throw new Error(
      `Login SSW não abriu o menu. URL atual: ${page.url()}`
    );
  }

  console.log("4) Logado no SSW. URL:", page.url());

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