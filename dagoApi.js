// Fala com a API Dago: login (Bearer) + X-Robo-Token nos endpoints do robô.
//   POST api/baixa-comprovante/robo/proximas      → baixas prontas (o back marca NO_ROBO)
//   GET  api/baixa-comprovante/robo/foto/{fotoId} → arquivo da foto
//   POST api/baixa-comprovante/robo/{id}/resultado → retorno da 038 / 398 / 040
const fs = require("fs");
const path = require("path");

const BASE_URL = (process.env.DAGO_API_BASE ?? "https://api.paineldg.com.br").replace(/\/+$/, "");
const DAGO_EMAIL = process.env.DAGO_EMAIL ?? "";
const DAGO_SENHA = process.env.DAGO_SENHA ?? "";
const ROBO_TOKEN = process.env.ROBO_TOKEN ?? "";

let token = null;

async function login() {
  if (!DAGO_EMAIL || !DAGO_SENHA) throw new Error("Defina DAGO_EMAIL e DAGO_SENHA no .env");
  if (!ROBO_TOKEN) throw new Error("Defina ROBO_TOKEN no .env (o mesmo do back)");

  const r = await fetch(`${BASE_URL}/api/Auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: DAGO_EMAIL, senha: DAGO_SENHA }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Login na API falhou (${r.status}): ${txt.slice(0, 200)}`);

  let j = null;
  try { j = JSON.parse(txt); } catch {}
  token = j?.token ?? j?.accessToken ?? j?.data?.token ?? null;
  if (!token) throw new Error("Login OK, mas token não encontrado na resposta.");
  console.log("✅ Login na API Dago.");
}

function headers(extra = {}) {
  return { Authorization: `Bearer ${token}`, "X-Robo-Token": ROBO_TOKEN, ...extra };
}

async function proximas(limite = 20) {
  const r = await fetch(`${BASE_URL}/api/baixa-comprovante/robo/proximas?limite=${limite}`, {
    method: "POST",
    headers: headers(),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`proximas (${r.status}): ${txt.slice(0, 200)}`);
  return JSON.parse(txt);
}

// Baixa a foto p/ a pasta temporária. Devolve o caminho.
async function baixarFoto(fotoId, pasta) {
  const r = await fetch(`${BASE_URL}/api/baixa-comprovante/robo/foto/${fotoId}`, { headers: headers() });
  if (!r.ok) throw new Error(`foto ${fotoId} (${r.status}): ${(await r.text()).slice(0, 200)}`);

  const tipo = (r.headers.get("content-type") || "").toLowerCase();
  const ext = tipo.includes("png") ? ".png" : tipo.includes("webp") ? ".webp" : tipo.includes("pdf") ? ".pdf" : ".jpg";
  fs.mkdirSync(pasta, { recursive: true });
  const arquivo = path.join(pasta, `foto_${fotoId}${ext}`);
  fs.writeFileSync(arquivo, Buffer.from(await r.arrayBuffer()));
  return arquivo;
}

async function enviarResultado(baixaId, resultado) {
  const r = await fetch(`${BASE_URL}/api/baixa-comprovante/robo/${baixaId}/resultado`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(resultado),
  });
  if (!r.ok) throw new Error(`resultado ${baixaId} (${r.status}): ${(await r.text()).slice(0, 200)}`);
}

module.exports = { login, proximas, baixarFoto, enviarResultado };
