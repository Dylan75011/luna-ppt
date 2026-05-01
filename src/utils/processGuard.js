const fs = require('fs');
const path = require('path');

const state = {
  startedAt: Date.now(),
  shuttingDown: false,
  lastError: null,
  unhandledRejections: 0,
  uncaughtExceptions: 0,
  warnings: 0
};

function ensureLogDir() {
  const dir = path.resolve('./data/logs');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  return dir;
}

function serializeError(error) {
  if (!error) return 'unknown';
  if (error instanceof Error) {
    return `${error.stack || error.message || error.name}`;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function recordProcessIssue(type, error) {
  const message = serializeError(error);
  state.lastError = {
    type,
    message: message.slice(0, 2000),
    at: new Date().toISOString()
  };

  const line = [
    `[${state.lastError.at}] ${type}`,
    message,
    ''
  ].join('\n');

  try {
    fs.appendFileSync(path.join(ensureLogDir(), 'process.log'), line);
  } catch {}
}

function installProcessGuards({ shutdown } = {}) {
  const strictFatalExit = process.env.LUNA_STRICT_FATAL_EXIT === '1';

  process.on('unhandledRejection', (reason) => {
    state.unhandledRejections += 1;
    recordProcessIssue('unhandledRejection', reason);
    console.error('[processGuard] unhandledRejection:', serializeError(reason));
  });

  process.on('uncaughtException', (error) => {
    state.uncaughtExceptions += 1;
    recordProcessIssue('uncaughtException', error);
    console.error('[processGuard] uncaughtException:', serializeError(error));

    if (strictFatalExit) {
      const stop = typeof shutdown === 'function'
        ? shutdown(1, 'uncaughtException')
        : Promise.resolve();
      stop.finally(() => process.exit(1));
    }
  });

  process.on('warning', (warning) => {
    state.warnings += 1;
    recordProcessIssue('warning', warning);
    console.warn('[processGuard] warning:', warning?.message || warning);
  });

  const requestShutdown = (signal) => {
    if (state.shuttingDown) return;
    state.shuttingDown = true;
    console.log(`[processGuard] received ${signal}, shutting down...`);
    const stop = typeof shutdown === 'function'
      ? shutdown(0, signal)
      : Promise.resolve();
    stop.finally(() => process.exit(0));
  };

  process.on('SIGINT', () => requestShutdown('SIGINT'));
  process.on('SIGTERM', () => requestShutdown('SIGTERM'));

  return state;
}

function getProcessHealth() {
  return {
    uptimeMs: Date.now() - state.startedAt,
    shuttingDown: state.shuttingDown,
    unhandledRejections: state.unhandledRejections,
    uncaughtExceptions: state.uncaughtExceptions,
    warnings: state.warnings,
    lastError: state.lastError
  };
}

module.exports = {
  installProcessGuards,
  getProcessHealth,
  recordProcessIssue
};
