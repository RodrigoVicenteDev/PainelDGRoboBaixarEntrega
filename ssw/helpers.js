const fs = require("fs");
const path = require("path");

const DEBUG = String(process.env.DEBUG ?? "").trim() === "1";
const DEBUG_DIR = path.join(process.cwd(), "debug");

if (DEBUG && !fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function debugPath(name) {
  return path.join(DEBUG_DIR, name);
}

async function debugScreenshot(page, filename) {
  if (!DEBUG || !page || page.isClosed()) return;

  // prefixa a data de geração no nome do arquivo (ex: 2026-08-06_debug_antes_222.png)
  const stamp = new Date().toISOString().slice(0, 10);
  const out = debugPath(`${stamp}_${filename}`);

  await page.screenshot({
    path: out,
    fullPage: true,
  }).catch(() => {});

  console.log("📸 print salvo:", out);
}

function debugWriteFile(filename, content, encoding = "utf8") {
  if (!DEBUG) return;

  const out = debugPath(filename);

  fs.writeFileSync(out, content, encoding);
  console.log("🧾 arquivo salvo:", out);
}

function debugFrames(page, label = "") {
  if (!DEBUG || !page || page.isClosed()) return;

  console.log(`🧩 Frames ${label}:`);

  for (const f of page.frames()) {
    console.log(" - name:", f.name(), "| url:", f.url());
  }
}

function debugContextPages(context, label = "") {
  if (!DEBUG) return;

  console.log(
    `🧭 Pages ${label}:`,
    context.pages().map((p) => `${p.isClosed() ? "[CLOSED] " : ""}${p.url()}`)
  );
}

async function fill(target, selector, value) {
  const loc = target.locator(selector).first();

  await loc.waitFor({
    state: "visible",
    timeout: 30000,
  });

  await loc.click({ clickCount: 3 }).catch(() => {});
  await loc.fill(String(value));
}

// Preenche um campo digitando caractere a caractere e confere o valor final,
// com retries. Criado para campos do SSW que possuem onkeyup/máscara e que,
// quando o servidor está lento, "engolem" parte do que foi digitado (ex.: o
// CTRC da tela 222 ficava "417" em vez de "4173953"). Digitação humana e
// releitura resolvem essa flakiness de timing.
async function fillAndVerify(target, selector, value, opts = {}) {
  const desired = String(value);
  const label = opts.label || selector;
  const retries = opts.retries ?? 3;
  const typeDelay = opts.typeDelay ?? 40;

  const loc = target.locator(selector).first();

  await loc.waitFor({
    state: "visible",
    timeout: 30000,
  });

  let last = "";

  for (let attempt = 1; attempt <= retries; attempt++) {
    await loc.click({ clickCount: 3 }).catch(() => {});
    await loc.fill("").catch(() => {});
    await loc.pressSequentially(desired, { delay: typeDelay }).catch(() => {});

    // dá tempo do onkeyup/AJAX do SSW processar antes de reler
    await sleep(300);

    last = await loc
      .evaluate((el) => ("value" in el ? el.value ?? "" : ""))
      .catch(() => "");

    if (String(last).trim() === desired.trim()) {
      return;
    }

    console.log(
      `⚠️ ${label}: tentativa ${attempt}/${retries} ficou "${last}", esperado "${desired}". Repetindo...`
    );

    await sleep(500);
  }

  throw new Error(
    `Não consegui preencher ${label}: campo ficou "${last}", esperado "${desired}".`
  );
}

async function getInputState(target, selector) {
  const loc = target.locator(selector).first();

  await loc.waitFor({
    state: "attached",
    timeout: 30000,
  });

  const info = await loc.evaluate((el) => {
    const value = "value" in el ? el.value ?? "" : "";

    return {
      value,
      readOnly: !!el.readOnly,
      disabled: !!el.disabled,
    };
  });

  return {
    loc,
    ...info,
  };
}

async function setInputOrValidate(target, selector, desiredValue) {
  const { loc, value, readOnly, disabled } = await getInputState(
    target,
    selector
  );

  const desired = String(desiredValue);

  if (readOnly || disabled) {
    if (String(value).trim().toUpperCase() !== desired.trim().toUpperCase()) {
      throw new Error(
        `Campo somente leitura com valor "${value}", esperado "${desired}".`
      );
    }

    return;
  }

  await loc.click({ clickCount: 3 }).catch(() => {});
  await loc.fill(desired);
}

async function findFrameWithSelector(page, selector) {
  for (const fr of page.frames()) {
    try {
      if ((await fr.locator(selector).count()) > 0) {
        return fr;
      }
    } catch {}
  }

  return null;
}

async function waitForFrameWithSelector(page, selector, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!page || page.isClosed()) {
      return null;
    }

    const fr = await findFrameWithSelector(page, selector);

    if (fr) {
      return fr;
    }

    await sleep(250);
  }

  return null;
}

async function waitForPageReady(page, timeout = 30000) {
  if (!page || page.isClosed()) return;

  await page
    .waitForLoadState("domcontentloaded", { timeout })
    .catch(() => {});

  await page
    .waitForLoadState("networkidle", { timeout: 10000 })
    .catch(() => {});
}

async function closeExtraPages(context, keepPages = []) {
  const keep = new Set(keepPages.filter(Boolean));

  for (const p of context.pages()) {
    if (!keep.has(p)) {
      await p.close().catch(() => {});
    }
  }
}

// Lê o popup de erro do SSW (div#errorpanel). Quando ele está aberto, cobre a tela e
// intercepta os cliques — sem isso o robô só via "Timeout 30000ms" e o motivo real
// (ex.: "CTRC cancelado") se perdia. Retorna o texto ou null se não há erro visível.
async function lerErroSsw(target) {
  const panel = target.locator("div#errorpanel").first();

  if (!(await panel.isVisible().catch(() => false))) return null;

  for (const sel of ["div#errormsglabel", "div#errormsg", "div#errorpanel"]) {
    const loc = target.locator(sel).first();
    if (!(await loc.isVisible().catch(() => false))) continue;

    const texto = (await loc.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (texto) return texto;
  }

  return null;
}

async function getTargetWithSelector(
  context,
  pageHint,
  selector,
  label = "alvo",
  timeoutMs = 15000
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const pages = context.pages().filter((p) => !p.isClosed());

    if (pageHint && !pageHint.isClosed()) {
      try {
        const countMain = await pageHint.locator(selector).count().catch(() => 0);

        if (countMain > 0) {
          return {
            page: pageHint,
            target: pageHint,
          };
        }

        const fr = await findFrameWithSelector(pageHint, selector);

        if (fr) {
          return {
            page: pageHint,
            target: fr,
          };
        }
      } catch {}
    }

    for (const p of pages) {
      try {
        const countMain = await p.locator(selector).count().catch(() => 0);

        if (countMain > 0) {
          return {
            page: p,
            target: p,
          };
        }

        const fr = await findFrameWithSelector(p, selector);

        if (fr) {
          return {
            page: p,
            target: fr,
          };
        }
      } catch {}
    }

    await sleep(250);
  }

  if (pageHint && !pageHint.isClosed()) {
    debugFrames(pageHint, `(falha ao localizar ${label})`);
    await debugScreenshot(
      pageHint,
      `falha_${label.replace(/\s+/g, "_")}.png`
    ).catch(() => {});
  }

  throw new Error(`Não encontrei ${label}.`);
}

async function openAfterAction({
  context,
  currentPage,
  selector,
  action,
  timeoutMs = 20000,
  label = "nova tela",
}) {
  const beforePages = new Set(context.pages().filter((p) => !p.isClosed()));

  await action();

  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const pages = context.pages().filter((p) => !p.isClosed());

    for (const p of pages) {
      if (!beforePages.has(p)) {
        try {
          await p.waitForLoadState("domcontentloaded").catch(() => {});

          const count = await p.locator(selector).count().catch(() => 0);

          if (count > 0) {
            await waitForPageReady(p);
            return p;
          }

          const fr = await findFrameWithSelector(p, selector);

          if (fr) {
            await waitForPageReady(p);
            return p;
          }
        } catch {}
      }
    }

    if (currentPage && !currentPage.isClosed()) {
      try {
        const countMain = await currentPage.locator(selector).count().catch(() => 0);

        if (countMain > 0) {
          await waitForPageReady(currentPage);
          return currentPage;
        }
      } catch {}

      try {
        const fr = await findFrameWithSelector(currentPage, selector);

        if (fr) {
          return currentPage;
        }
      } catch {}
    }

    await sleep(250);
  }

  if (currentPage && !currentPage.isClosed()) {
    debugFrames(currentPage, `(falha ao abrir ${label})`);
    debugContextPages(context, `(falha ao abrir ${label})`);

    await debugScreenshot(
      currentPage,
      `falha_${label.replace(/\s+/g, "_")}.png`
    );
  }

  throw new Error(`Não consegui identificar onde abriu ${label}.`);
}

module.exports = {
  DEBUG,
  sleep,
  debugScreenshot,
  debugWriteFile,
  debugFrames,
  debugContextPages,
  fill,
  fillAndVerify,
  setInputOrValidate,
  findFrameWithSelector,
  waitForFrameWithSelector,
  waitForPageReady,
  closeExtraPages,
  getTargetWithSelector,
  openAfterAction,
  lerErroSsw,
};