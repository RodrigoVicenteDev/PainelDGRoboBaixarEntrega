function normalizeValue(v) {
  if (v == null) return "";
  return String(v).trim();
}

function formatMoneyBR(value) {
  let s = normalizeValue(value);

  if (!s) return "0,00";

  s = s.replace(/\s+/g, "");

  if (s.includes(".") && s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }

  const n = Number(s);

  if (!Number.isFinite(n)) {
    throw new Error(`Valor monetário inválido: "${value}"`);
  }

  return n.toFixed(2).replace(".", ",");
}

function parseCtrcComDv(rawCtrc, unidadePadrao = "GRU") {
  const value = normalizeValue(rawCtrc).toUpperCase();

  const mComSigla = value.match(/^([A-Z]{3})(\d+)-(\d+)$/);

  if (mComSigla) {
    return {
      sigla: mComSigla[1],
      numero: mComSigla[2],
      dv: mComSigla[3],
      semHifenComDv: `${mComSigla[2]}${mComSigla[3]}`,
      original: value,
    };
  }

  const mSemSigla = value.match(/^(\d+)-(\d+)$/);

  if (mSemSigla) {
    return {
      sigla: unidadePadrao,
      numero: mSemSigla[1],
      dv: mSemSigla[2],
      semHifenComDv: `${mSemSigla[1]}${mSemSigla[2]}`,
      original: value,
    };
  }

  throw new Error(`CTRC inválido: "${rawCtrc}"`);
}

module.exports = {
  normalizeValue,
  formatMoneyBR,
  parseCtrcComDv,
};