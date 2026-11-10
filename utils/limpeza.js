const fs = require("fs");
const path = require("path");

// Remove de uma pasta os arquivos com mais de N dias (pela data de modificação).
function limparAntigos(dirName, diasMax = 4) {
  const dir = path.join(process.cwd(), dirName);
  if (!fs.existsSync(dir)) return;

  const limiteMs = diasMax * 24 * 60 * 60 * 1000;
  const agora = Date.now();
  let removidos = 0;

  for (const nome of fs.readdirSync(dir)) {
    const alvo = path.join(dir, nome);
    try {
      const st = fs.statSync(alvo);
      if (!st.isFile()) continue; // só arquivos; ignora subpastas
      if (agora - st.mtimeMs > limiteMs) {
        fs.unlinkSync(alvo);
        removidos++;
      }
    } catch (e) {
      console.warn(`⚠️ Falha ao limpar ${nome} em ${dirName}/:`, e.message);
    }
  }

  if (removidos > 0) {
    console.log(`🧹 Limpeza: ${removidos} arquivo(s) com mais de ${diasMax} dias removido(s) de ${dirName}/.`);
  }
}

module.exports = { limparAntigos };
