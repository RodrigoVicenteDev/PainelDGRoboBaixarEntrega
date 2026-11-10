// Peças comuns às telas 038 e 398 (e à troca de unidade).
// Armadilhas do SSW que isto cobre: ver memória "Padrões de robô SSW".

const {
  sleep,
  fill,
  getTargetWithSelector,
  findFrameWithSelector,
} = require("../ssw/helpers");
const { recoverMenuPage } = require("../ssw/session");

function limparTexto(t) {
  return String(t ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

async function estaVisivel(loc) {
  return loc
    .evaluate((el) => {
      const s = window.getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none";
    })
    .catch(() => false);
}

// Espera o "Aguarde..." (#procimg) sumir. Clique feito com ele na tela é ignorado pelo SSW.
async function aguardarSemProcessamento(target, timeoutMs = 30000) {
  const proc = target.locator("#procimg").first();
  if ((await proc.count().catch(() => 0)) === 0) return;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await estaVisivel(proc))) return;
    await sleep(250);
  }
  throw new Error("SSW ficou em 'Aguarde...' por tempo demais.");
}

// Lê o aviso do SSW (#errormsg visível). Devolve { texto, campo } ou null.
// "campo" vem de <foc vl="a_ser_ctrc"> quando o SSW aponta o campo culpado.
async function lerAviso(target) {
  const box = target.locator("#errormsg").first();
  if ((await box.count().catch(() => 0)) === 0) return null;
  if (!(await estaVisivel(box))) return null;

  const label = target.locator("#errormsglabel").first();
  const texto = limparTexto(await label.innerText().catch(() => ""));
  if (!texto) return null;

  const campo = await target
    .locator("#errormsglabel foc")
    .first()
    .getAttribute("vl")
    .catch(() => null);

  return { texto, campo: campo || null };
}

// Clica no "7. OK" do aviso.
async function fecharAviso(target) {
  const ok = target.locator('#errormsg a[id="0"], a.dialog:has-text("OK")').first();
  if ((await ok.count().catch(() => 0)) > 0) {
    await ok.click({ force: true }).catch(() => {});
    await sleep(400);
  }
}

// O SSW usa a global `obj` (onfocus="obj=this") dentro do ajaxEnvia: foca antes de clicar.
async function clicarSeta(target, selector) {
  const seta = target.locator(selector).first();
  await seta.waitFor({ state: "visible", timeout: 30000 });
  await aguardarSemProcessamento(target);
  await seta.evaluate((el) => {
    el.focus();
    el.click();
  });
}

// Dispara o onchange de um campo (dadosocorr, dadosCTRC) e espera o SSW terminar.
async function dispararChange(target, selector) {
  await target
    .locator(selector)
    .first()
    .evaluate((el) => {
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  await sleep(300);
  await aguardarSemProcessamento(target);
}

async function lerValor(target, selector) {
  return target
    .locator(selector)
    .first()
    .evaluate((el) => ("value" in el ? el.value ?? "" : ""))
    .catch(() => "");
}

// Cabeçalho "Domínio: DAG FEC rodrigov 16" → "FEC".
async function lerUnidadeDaTela(target) {
  const texto = limparTexto(await target.locator("#infodiv").first().innerText().catch(() => ""));
  const m = texto.match(/Dom[ií]nio:\s*\S+\s+([A-Z]{3})\b/i);
  return m ? m[1].toUpperCase() : null;
}

async function garantirUnidade(target, unidade, tela) {
  const atual = await lerUnidadeDaTela(target);
  if (atual !== unidade) {
    throw new Error(`Tela ${tela} abriu na unidade "${atual ?? "?"}", esperado "${unidade}". Nada foi gravado.`);
  }
}

// Troca a unidade do menu (campo f2), igual ao roboComplementar, e confere o valor.
async function trocarUnidadeMenu(context, unidade) {
  console.log(`🔄 Unidade do menu → ${unidade}`);
  const menu = await recoverMenuPage(context);
  const found = await getTargetWithSelector(
    context,
    menu,
    'input[name="f2"], input[id="2"]',
    "campo Unidade do menu",
    30000
  );
  const sel = 'input[name="f2"], input[id="2"]';

  await fill(found.target, sel, unidade);
  await found.target
    .locator(sel)
    .first()
    .evaluate((el) => {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
    })
    .catch(() => {});
  await sleep(2000);
  await aguardarSemProcessamento(found.target).catch(() => {});

  const aviso = await lerAviso(found.target);
  if (aviso) {
    await fecharAviso(found.target);
    throw new Error(`SSW recusou a unidade ${unidade}: ${aviso.texto}`);
  }

  const valor = limparTexto(await lerValor(found.target, sel)).toUpperCase();
  if (valor !== unidade) {
    throw new Error(`Campo Unidade do menu ficou "${valor}", esperado "${unidade}".`);
  }

  return found.page;
}

// Procura, em todas as abas/frames, o primeiro alvo que tem o seletor. Não lança erro.
async function acharAlvo(context, selector) {
  for (const p of context.pages().filter((x) => !x.isClosed())) {
    try {
      if ((await p.locator(selector).count().catch(() => 0)) > 0) return { page: p, target: p };
      const fr = await findFrameWithSelector(p, selector);
      if (fr) return { page: p, target: fr };
    } catch {}
  }
  return null;
}

// Todos os alvos (abas/frames) que têm o seletor. O menu às vezes abre a opção DUAS vezes
// (duas abas da mesma tela): olhar só a primeira perde o aviso que saiu na outra.
async function acharTodos(context, selector) {
  const achados = [];
  for (const p of context.pages().filter((x) => !x.isClosed())) {
    for (const fr of p.frames()) {
      try {
        if ((await fr.locator(selector).count().catch(() => 0)) > 0) {
          achados.push({ page: p, target: fr === p.mainFrame() ? p : fr });
        }
      } catch {}
    }
  }
  return achados;
}

module.exports = {
  acharTodos,
  limparTexto,
  aguardarSemProcessamento,
  lerAviso,
  fecharAviso,
  clicarSeta,
  dispararChange,
  lerValor,
  lerUnidadeDaTela,
  garantirUnidade,
  trocarUnidadeMenu,
  acharAlvo,
};
