const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(process.cwd(), "logs");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function nowLog() {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}

const LOG_FILE = path.join(
  LOG_DIR,
  `robo_baixa_comprovante_${new Date().toISOString().slice(0, 10)}.log`
);

const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });

function writeLog(level, args) {
  const msg = args
    .map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === "string") return a;
      return JSON.stringify(a, null, 2);
    })
    .join(" ");

  logStream.write(`[${nowLog()}] [${level}] ${msg}\n`);
}

function setupLogger() {
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args) => {
    writeLog("INFO", args);
    originalLog(...args);
  };

  console.error = (...args) => {
    writeLog("ERROR", args);
    originalError(...args);
  };

  process.on("uncaughtException", (err) => {
    writeLog("FATAL", [err?.stack || err]);
    originalError(err);
    process.exit(1);
  });

  process.on("unhandledRejection", (err) => {
    writeLog("FATAL", [err?.stack || err]);
    originalError(err);
    process.exit(1);
  });

  return {
    LOG_FILE,
  };
}

module.exports = {
  setupLogger,
  LOG_FILE,
};