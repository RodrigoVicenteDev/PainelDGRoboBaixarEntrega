#!/bin/bash
# Wrapper do robô de BAIXA + COMPROVANTE (038/398/040) — escutador (chave "baixa-comprovante") ou cron.
export TZ=America/Sao_Paulo

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$BASE_DIR" || exit 1

# Node 20 via nvm (cron/escutador não carregam sozinhos)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 20 >/dev/null 2>&1

if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

LOG_DIR="$BASE_DIR/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/run_baixa_$(date +%F).log"
LOCK_FILE="/tmp/robo-baixa-comprovante.lock"

{
  echo "[$(date)] 🔐 Tentando adquirir lock..."
  flock -n 200 || { echo "[$(date)] ⛔ Já há uma execução em andamento. Abortando."; exit 0; }
  echo "[$(date)] ✅ Lock adquirido. Iniciando robô de baixa..."
  node index.js
  echo "[$(date)] ✅ Robô finalizado (código $?)."
} 200>"$LOCK_FILE" >> "$LOG" 2>&1
