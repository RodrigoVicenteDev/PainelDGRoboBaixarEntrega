// sessaoSswApi.js — sessão SSW compartilhada pelos robôs (mesmo arquivo em todos os repos).
//
// O SSW pôs Google reCAPTCHA no login (22/11/2026) e o navegador do robô não passa nele.
// Uma PESSOA loga no Chrome dela pelo DAGO (extensão "DAGO - Sessão SSW", usuário dora)
// e a sessão fica guardada na API. Os robôs NÃO fazem login: carregam essa sessão.
// Se o SSW não aceitar, o robô avisa a API e para com "SESSÃO SSW EXPIRADA" — o DAGO
// então pede a autenticação de novo para quem disparar o próximo robô.
//
// .env: DAGO_API_BASE e ROBO_TOKEN (o mesmo do back). Opcional: SSW_SESSAO_CACHE.
const fs = require("fs");
const path = require("path");

const MENU_URL = "https://tms.ssw.inf.br/bin/menu01";
const API = () => (process.env.DAGO_API_BASE ?? "https://api.paineldg.com.br").replace(/\/+$/, "");
const CACHE = () => process.env.SSW_SESSAO_CACHE || path.join(__dirname, ".sessao-ssw-cache.json");

let capturaAtual = null;

class SessaoSswExpirada extends Error {
  constructor(msg) {
    super(msg || "SESSÃO SSW EXPIRADA — alguém precisa autenticar pelo DAGO (Rodar robôs).");
    this.name = "SessaoSswExpirada";
    this.sessaoExpirada = true;
  }
}

function headersRobo() {
  const token = process.env.ROBO_TOKEN ?? "";
  if (!token) throw new Error("ROBO_TOKEN ausente no .env do robô (o mesmo valor do back).");
  return { "X-Robo-Token": token, "Content-Type": "application/json" };
}

async function chamar(metodo, rota, corpo) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    return await fetch(`${API()}/api/robos-ssw/${rota}`, {
      method: metodo,
      headers: headersRobo(),
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

function gravarCache(dados) {
  try {
    fs.writeFileSync(CACHE(), JSON.stringify(dados), { mode: 0o600 });
    fs.chmodSync(CACHE(), 0o600);
  } catch {}
}

// Busca a sessão na API; se a API estiver fora do ar, usa a última cópia local.
async function obterSessaoSsw() {
  let res;
  try {
    res = await chamar("GET", "robo/sessao");
  } catch (e) {
    res = null;
    console.warn("⚠️ API do DAGO inacessível ao buscar a sessão SSW:", e?.message || e);
  }

  if (res && res.status === 404) throw new SessaoSswExpirada();
  if (res && res.ok) {
    const dados = await res.json();
    gravarCache(dados);
    return dados;
  }
  if (res) console.warn(`⚠️ API respondeu ${res.status} ao buscar a sessão SSW; tentando a cópia local.`);

  if (fs.existsSync(CACHE())) {
    console.log("↩️ Usando a última sessão SSW salva localmente.");
    return JSON.parse(fs.readFileSync(CACHE(), "utf8"));
  }
  throw new Error("Sem acesso à API do DAGO e sem cópia local da sessão SSW.");
}

async function avisarExpirada(motivo) {
  try {
    await chamar("POST", "robo/sessao/expirada", { capturaId: capturaAtual, motivo });
  } catch {}
  try { fs.rmSync(CACHE(), { force: true }); } catch {}
}

async function acharFrameComOpcao(page) {
  for (const fr of page.frames()) {
    if ((await fr.locator('input[name="f3"]').count().catch(() => 0)) > 0) return fr;
  }
  return null;
}

// Coloca a sessão no contexto da página e abre o menu principal (no lugar do login).
async function entrarComSessaoSsw(page) {
  const { capturaId, storageState } = await obterSessaoSsw();
  capturaAtual = capturaId;

  await page.context().addCookies(storageState.cookies || []);

  console.log("1) Abrindo o SSW com a sessão compartilhada...");
  await page.goto(MENU_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  let menu = null;
  for (let i = 0; i < 30 && !menu; i++) {
    if (!page.url().includes("/bin/menu01")) break; // caiu no login = sessão recusada
    menu = await acharFrameComOpcao(page);
    if (!menu) await page.waitForTimeout(500);
  }

  if (!menu) {
    const motivo = `O SSW não aceitou a sessão (abriu ${page.url()}).`;
    await avisarExpirada(motivo);
    throw new SessaoSswExpirada(`SESSÃO SSW EXPIRADA: ${motivo} Autentique pelo DAGO (Rodar robôs).`);
  }

  // espera o "Aguarde..." do menu sumir antes de digitar a opção
  await page.locator("text=Aguarde").first().waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  console.log("2) SSW aberto com a sessão. URL:", page.url());
  return page;
}

// Devolve os cookies atualizados à API (só vale se ainda for a mesma captura).
async function renovarSessaoSsw(context) {
  if (!capturaAtual) return;
  try {
    const storageState = await context.storageState();
    const res = await chamar("POST", "robo/sessao/renovar", { capturaId: capturaAtual, storageState });
    if (res.ok) gravarCache({ capturaId: capturaAtual, storageState });
  } catch {}
}

// Progresso para a barra do DAGO. Nunca derruba o robô.
async function reportarProgresso(execucao, etapa, status, mensagem, etapas) {
  try {
    await chamar("POST", "robo/progresso", {
      execucao,
      etapa,
      status,
      mensagem: mensagem ? String(mensagem).slice(0, 500) : undefined,
      etapas,
    });
  } catch {}
}

module.exports = {
  entrarComSessaoSsw,
  renovarSessaoSsw,
  reportarProgresso,
  avisarExpirada,
  SessaoSswExpirada,
  MENU_URL,
};
