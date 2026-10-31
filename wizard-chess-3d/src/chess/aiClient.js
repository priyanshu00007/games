import { chooseMove } from './engine.js';

let worker = null;
let broken = false;
let seq = 0;
const pending = new Map();

function failAll(err) {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    try {
      entry.resolve(fallbackSync(entry.payload));
    } catch (e) {
      entry.reject(err || e);
    }
  }
  pending.clear();
}

function fallbackSync(payload) {
  return chooseMove(payload);
}

function ensureWorker() {
  if (broken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./aiWorker.js', import.meta.url), { type: 'module' });
  } catch (err) {
    broken = true;
    return null;
  }
  worker.onmessage = (event) => {
    const { id, result, error } = event.data || {};
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (error) {
      try {
        entry.resolve(fallbackSync(entry.payload));
      } catch (e) {
        entry.reject(e);
      }
    } else {
      entry.resolve(result);
    }
  };
  worker.onerror = () => {
    broken = true;
    const err = new Error('AI worker failed');
    if (worker) {
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
    }
    worker = null;
    failAll(err);
  };
  return worker;
}

/**
 * Ask for a move. Resolves with the same shape as `chooseMove`, or falls back
 * to running the search on the main thread if the Worker cannot start.
 */
export function requestAiMove(payload, timeoutMs = 10000) {
  const w = ensureWorker();
  if (!w) {
    try {
      return Promise.resolve(fallbackSync(payload));
    } catch (err) {
      return Promise.reject(err);
    }
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      try {
        resolve(fallbackSync(payload));
      } catch (err) {
        reject(err);
      }
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer, payload });
    w.postMessage({ id, payload });
  });
}

export function isAiWorkerHealthy() {
  return !broken;
}
