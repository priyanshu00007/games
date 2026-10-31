/**
 * Optional Stockfish 19 opponent.
 *
 * The engine lives in `public/stockfish/` and is only ever fetched when the
 * player picks the Grandmaster opponent — nothing here touches the network
 * until `ensureEngine()` runs. Stockfish talks raw UCI over postMessage.
 *
 * If the WASM fails to load (offline, blocked worker, old browser) every
 * method rejects and the caller falls back to the built-in engine.
 */

const ENGINE_URL = '/stockfish/stockfish.js';
const INIT_TIMEOUT_MS = 20000;

let worker = null;
let initPromise = null;
let bestmoveResolver = null;

function post(line) {
  if (worker) worker.postMessage(line);
}

function ensureEngine() {
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    let w;
    try {
      w = new Worker(ENGINE_URL);
    } catch (err) {
      reject(new Error('Stockfish worker blocked: ' + (err && err.message)));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        w.terminate();
      } catch {
        /* ignore */
      }
      reject(new Error('Stockfish did not initialise in time'));
    }, INIT_TIMEOUT_MS);

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        try {
          w.terminate();
        } catch {
          /* ignore */
        }
        worker = null;
        reject(err);
      } else {
        worker = w;
        resolve(value);
      }
    };

    w.onmessage = (event) => {
      // The engine also posts download-progress objects while the WASM
      // streams in; only UCI replies are strings.
      if (typeof event.data !== 'string') return;
      const line = event.data;
      if (line === 'uciok') {
        post('setoption name Clear Hash value true');
        post('isready');
      } else if (line === 'readyok') {
        finish(null, w);
      } else if (line.startsWith('bestmove')) {
        const uci = line.split(/\s+/)[1] || null;
        const resolver = bestmoveResolver;
        bestmoveResolver = null;
        if (resolver) resolver(uci);
      }
    };

    w.onerror = (err) => {
      finish(new Error('Stockfish failed to load (WASM unavailable)'));
      void err;
    };

    post('uci');
  });

  return initPromise;
}

/**
 * @param {{fen: string, skill?: number, movetime?: number, allowed?: Set<string>}} opts
 * @returns {Promise<string|null>} UCI move such as "e2e4", or null if Stockfish
 *   was unavailable or chose a move the 3D board cannot execute.
 */
export async function stockfishMove({ fen, skill = 18, movetime = 700, allowed }) {
  const w = await ensureEngine();

  const skillLevel = Math.max(0, Math.min(20, Math.round(skill)));
  post(`setoption name Skill Level value ${skillLevel}`);
  post('ucinewgame');
  post(`position fen ${fen}`);

  const uci = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (bestmoveResolver === resolve) {
        bestmoveResolver = null;
        post('stop');
        reject(new Error('Stockfish search timed out'));
      }
    }, movetime + 6000);
    bestmoveResolver = (value) => {
      clearTimeout(timeout);
      resolve(value);
    };
    post(`go movetime ${Math.max(100, movetime)}`);
  });

  if (!uci) return null;
  // Stockfish is a correct engine, but the 3D board has its own rule set
  // (e.g. no en passant), so a move we cannot animate must be discarded.
  if (allowed && allowed.size && !allowed.has(uci)) return null;
  void w;
  return uci;
}

export function disposeStockfish() {
  if (bestmoveResolver) {
    bestmoveResolver(null);
    bestmoveResolver = null;
  }
  if (worker) {
    try {
      post('quit');
      worker.terminate();
    } catch {
      /* ignore */
    }
  }
  worker = null;
  initPromise = null;
}

export function isStockfishLoaded() {
  return worker !== null;
}
