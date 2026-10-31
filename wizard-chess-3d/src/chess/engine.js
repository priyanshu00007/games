/**
 * Built-in chess AI: negamax + alpha-beta + quiescence over chess.js.
 *
 * chess.js owns the rules (and is fed a FEN rebuilt from the 3D board), so the
 * search never has to re-implement castling, pins or check detection. The
 * personality weights from `personalities.js` tilt the evaluation, which is
 * what makes "Krag" and "Seraphine" feel like different opponents even at the
 * same search depth.
 *
 * Everything here is pure and synchronous — the caller decides whether to run
 * it on the main thread or in a Worker (see aiWorker.js).
 */

import { Chess } from 'chess.js';

export const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

const MATE_SCORE = 100000;
const MAX_QUIESCE_PLY = 4;

const KNIGHT_D = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];
const KING_D = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1],
  [0, 1], [1, -1], [1, 0], [1, 1],
];
const ORTHO_D = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG_D = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

/** d4 / e4 / d5 / e5 as r*8+c indices (r=0 is rank 8). */
const CENTER = [27, 28, 35, 36];

/** Piece-square tables, index 0 = a8, index 63 = h1. White's point of view. */
const PST = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
};

export function uciOf(move) {
  return move.from + move.to + (move.promotion || '');
}

/**
 * chess.js's public `moves({verbose:true})` builds a `Move` for every result,
 * and that constructor re-generates the full legal move list *again* to build
 * SAN plus two FENs — roughly 50x the cost of the internal generator. The
 * private `_moves/_makeMove/_undoMove` trio is what the public API itself
 * calls, so we use it when it is present and fall back to the public API if a
 * future chess.js release renames them.
 */
const HAS_FAST_PATH =
  typeof Chess.prototype._moves === 'function' &&
  typeof Chess.prototype._makeMove === 'function' &&
  typeof Chess.prototype._undoMove === 'function';

const FILE_CHARS = 'abcdefgh';
const RANK_CHARS = '87654321';

function ox88ToAlg(square) {
  return FILE_CHARS[square & 15] + RANK_CHARS[square >> 4];
}

/**
 * Normalise a move from either API into the shape the search uses.
 * `from`/`to` are always algebraic so `uciOf()` works uniformly.
 */
function normalizeMove(m) {
  if (typeof m.from === 'number') {
    const fileDiff = Math.abs((m.from & 15) - (m.to & 15));
    return {
      raw: m,
      from: ox88ToAlg(m.from),
      to: ox88ToAlg(m.to),
      piece: m.piece,
      color: m.color,
      captured: m.captured,
      promotion: m.promotion,
      san: null,
      castle: m.piece === 'k' && fileDiff === 2
    };
  }
  const flags = m.flags || '';
  return {
    raw: m,
    from: m.from,
    to: m.to,
    piece: m.piece,
    color: m.color,
    captured: m.captured,
    promotion: m.promotion,
    san: m.san || null,
    castle: flags.indexOf('k') >= 0 || flags.indexOf('q') >= 0
  };
}

function generateMoves(chess) {
  if (HAS_FAST_PATH) {
    const raw = chess._moves({ legal: true });
    const out = new Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = normalizeMove(raw[i]);
    return out;
  }
  const raw = chess.moves({ verbose: true });
  const out = new Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = normalizeMove(raw[i]);
  return out;
}

function applyMove(chess, move) {
  if (HAS_FAST_PATH) chess._makeMove(move.raw);
  else chess.move(move.raw);
}

function revertMove(chess) {
  if (HAS_FAST_PATH) chess._undoMove();
  else chess.undo();
}

/** SAN is only needed for the move we actually play, so build it lazily. */
function sanFor(fen, uci) {
  try {
    const c = new Chess(fen);
    const m = c.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined
    });
    return m ? m.san : '';
  } catch {
    return '';
  }
}

function kingZoneOf(sq) {
  if (!sq) return [];
  const r = sq >> 3;
  const c = sq & 7;
  const out = [sq];
  for (let i = 0; i < KING_D.length; i++) {
    const rr = r + KING_D[i][0];
    const cc = c + KING_D[i][1];
    if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) out.push(rr * 8 + cc);
  }
  return out;
}

/**
 * One static snapshot of the position: material, piece-square scores, an
 * attack map per side, and pawn-structure counters. Building this once per
 * evaluation keeps the inner search loop allocation-free.
 */
export function buildPosition(chess) {
  const board = chess.board();
  const occ = new Int8Array(64);
  const atkW = new Int8Array(64);
  const atkB = new Int8Array(64);

  let matW = 0;
  let matB = 0;
  let pstW = 0;
  let pstB = 0;
  let bishopsW = 0;
  let bishopsB = 0;
  const pawnsW = [];
  const pawnsB = [];
  let kingWSq = -1;
  let kingBSq = -1;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const i = r * 8 + c;
      const white = p.color === 'w';
      const t = p.type;
      occ[i] = white ? 1 : -1;
      const v = PIECE_VALUE[t] || 0;
      const pst = (PST[t] && PST[t][white ? i : (7 - r) * 8 + c]) || 0;
      if (white) {
        matW += v;
        pstW += pst;
      } else {
        matB += v;
        pstB += pst;
      }
      if (t === 'b') {
        if (white) bishopsW++;
        else bishopsB++;
      } else if (t === 'p') {
        (white ? pawnsW : pawnsB).push(i);
      } else if (t === 'k') {
        if (white) kingWSq = i;
        else kingBSq = i;
      }
    }
  }

  const addStep = (arr, rr, cc, color) => {
    if (rr < 0 || rr > 7 || cc < 0 || cc > 7) return;
    const j = rr * 8 + cc;
    if (occ[j] === color) return;
    arr[j]++;
  };

  const addSlide = (arr, r, c, color, dirs) => {
    for (let k = 0; k < dirs.length; k++) {
      let rr = r + dirs[k][0];
      let cc = c + dirs[k][1];
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
        const j = rr * 8 + cc;
        if (occ[j] === color) break;
        arr[j]++;
        if (occ[j] !== 0) break;
        rr += dirs[k][0];
        cc += dirs[k][1];
      }
    }
  };

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const white = p.color === 'w';
      const arr = white ? atkW : atkB;
      const sign = white ? 1 : -1;
      const t = p.type;
      if (t === 'p') {
        addStep(arr, r - 1, c - 1, sign);
        addStep(arr, r - 1, c + 1, sign);
      } else if (t === 'n') {
        for (let k = 0; k < KNIGHT_D.length; k++) {
          addStep(arr, r + KNIGHT_D[k][0], c + KNIGHT_D[k][1], sign);
        }
      } else if (t === 'k') {
        for (let k = 0; k < KING_D.length; k++) {
          addStep(arr, r + KING_D[k][0], c + KING_D[k][1], sign);
        }
      } else if (t === 'r') {
        addSlide(arr, r, c, sign, ORTHO_D);
      } else if (t === 'b') {
        addSlide(arr, r, c, sign, DIAG_D);
      } else if (t === 'q') {
        addSlide(arr, r, c, sign, ORTHO_D);
        addSlide(arr, r, c, sign, DIAG_D);
      }
    }
  }

  let mobW = 0;
  let mobB = 0;
  let centerW = 0;
  let centerB = 0;
  for (let i = 0; i < 64; i++) {
    if (atkW[i]) mobW++;
    if (atkB[i]) mobB++;
  }
  for (let k = 0; k < CENTER.length; k++) {
    centerW += atkW[CENTER[k]];
    centerB += atkB[CENTER[k]];
  }

  let atkOnWhiteZone = 0;
  let atkOnBlackZone = 0;
  const zoneW = kingZoneOf(kingWSq);
  const zoneB = kingZoneOf(kingBSq);
  for (let k = 0; k < zoneW.length; k++) atkOnWhiteZone += atkB[zoneW[k]];
  for (let k = 0; k < zoneB.length; k++) atkOnBlackZone += atkW[zoneB[k]];

  return {
    matW,
    matB,
    pstW,
    pstB,
    mobW,
    mobB,
    centerW,
    centerB,
    bishopsW,
    bishopsB,
    atkOnWhiteZone,
    atkOnBlackZone,
    pawnW: evaluatePawns(pawnsW, pawnsB, true),
    pawnB: evaluatePawns(pawnsB, pawnsW, false),
  };
}

/**
 * Doubled / isolated / passed pawn scoring. `pawns` are our pawns as r*8+c
 * indices, `enemies` the opponent's; ranks run 0 (rank 8) to 7 (rank 1).
 */
function evaluatePawns(pawns, enemies, white) {
  if (!pawns.length) return 0;
  const fileCounts = new Int8Array(8);
  for (let k = 0; k < pawns.length; k++) fileCounts[pawns[k] & 7]++;

  let score = 0;
  for (let f = 0; f < 8; f++) {
    if (fileCounts[f] > 1) score -= 14 * (fileCounts[f] - 1);
  }

  for (let k = 0; k < pawns.length; k++) {
    const i = pawns[k];
    const r = i >> 3;
    const c = i & 7;

    const left = c > 0 ? fileCounts[c - 1] : 0;
    const right = c < 7 ? fileCounts[c + 1] : 0;
    if (left === 0 && right === 0) score -= 16;

    let passed = true;
    for (let e = 0; e < enemies.length; e++) {
      const ei = enemies[e];
      const er = ei >> 3;
      const ec = ei & 7;
      if (Math.abs(ec - c) > 1) continue;
      if (white ? er < r : er > r) {
        passed = false;
        break;
      }
    }
    if (passed) {
      const advance = white ? 6 - r : r - 1;
      score += 15 + 15 * Math.max(0, advance);
    }
  }
  return score;
}

/** Score from White's point of view, in centipawns. */
export function evaluate(pos, w) {
  let s = 0;
  s += (pos.matW - pos.matB) * w.material;
  s += (pos.pstW - pos.pstB) * w.positional;
  s += (pos.mobW - pos.mobB) * w.mobility;
  s += (pos.centerW - pos.centerB) * w.center;
  s += pos.atkOnBlackZone * w.aggression;
  s -= pos.atkOnWhiteZone * w.kingSafety;
  s += (pos.pawnW - pos.pawnB) * w.pawn;
  s += ((pos.bishopsW >= 2 ? 35 : 0) - (pos.bishopsB >= 2 ? 35 : 0)) * w.material;
  return s;
}

function moveOrderScore(m) {
  let s = 0;
  if (m.captured) s += 20000 + PIECE_VALUE[m.captured] * 8 - (PIECE_VALUE[m.piece] || 0);
  if (m.promotion) s += 15000 + (PIECE_VALUE[m.promotion] || 0);
  if (m.castle) s += 300;
  const san = m.san;
  if (san) {
    const last = san.charCodeAt(san.length - 1);
    if (last === 35) s += 100000; // '#'
    else if (last === 43) s += 600; // '+'
  }
  return s;
}

function orderMoves(moves) {
  moves.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));
  return moves;
}

function tick(ctx) {
  ctx.nodes++;
  if ((ctx.nodes & 63) === 0 && performance.now() > ctx.deadline) ctx.aborted = true;
}

function negamax(chess, depth, alpha, beta, w, ctx, ply) {
  tick(ctx);
  if (ctx.aborted) return alpha;

  if (depth <= 0) return quiesce(chess, alpha, beta, w, ctx, ply);

  const moves = generateMoves(chess);
  if (!moves.length) return chess.isCheck() ? -MATE_SCORE + ply : 0;
  if (chess.isDrawByFiftyMoves()) return 0;

  orderMoves(moves);
  let best = -Infinity;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    applyMove(chess, m);
    const s = -negamax(chess, depth - 1, -beta, -alpha, w, ctx, ply + 1);
    revertMove(chess);
    if (ctx.aborted) return best === -Infinity ? alpha : best;
    if (s > best) best = s;
    if (s > alpha) alpha = s;
    if (alpha >= beta) break;
  }
  return best;
}

/** Search captures to a quiet position so the horizon effect doesn't decide games. */
function quiesce(chess, alpha, beta, w, ctx, ply) {
  tick(ctx);
  if (ctx.aborted) return alpha;

  const moves = generateMoves(chess);
  // Mate / stalemate can be delivered at exactly the horizon, so the terminal
  // test has to happen here too, not only in negamax.
  if (!moves.length) return chess.isCheck() ? -MATE_SCORE + ply : 0;

  const side = chess.turn() === 'w' ? 1 : -1;
  const stand = side * evaluate(buildPosition(chess), w);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (ply >= MAX_QUIESCE_PLY) return alpha;

  const caps = [];
  for (let i = 0; i < moves.length; i++) {
    if (moves[i].captured || moves[i].promotion) caps.push(moves[i]);
  }
  if (!caps.length) return alpha;
  orderMoves(caps);
  for (let i = 0; i < caps.length; i++) {
    const m = caps[i];
    applyMove(chess, m);
    const s = -quiesce(chess, -beta, -alpha, w, ctx, ply + 1);
    revertMove(chess);
    if (ctx.aborted) return alpha;
    if (s >= beta) return beta;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

function toResult(move, score, depth, nodes, san) {
  return {
    from: move.from,
    to: move.to,
    promotion: move.promotion || null,
    uci: uciOf(move),
    san: san || move.san || '',
    score,
    depth,
    nodes,
  };
}

/** Returns null instead of a guessed position when the FEN cannot be trusted. */
function safeChess(fen) {
  try {
    return new Chess(fen);
  } catch (err) {
    return null;
  }
}

/**
 * @param {{fen: string, allowed?: Set<string>, personality: object, timeBudgetMs?: number}} payload
 * @returns {{from: string, to: string, promotion: string|null, uci: string, san: string, score: number, depth: number, nodes: number}|null}
 */
export function chooseMove({ fen, allowed, personality, timeBudgetMs }) {
  const p = personality;
  if (!p) return null;
  const chess = safeChess(fen);
  if (!chess) return null;

  let moves = generateMoves(chess);
  if (allowed && allowed.size) {
    const filtered = moves.filter((m) => allowed.has(uciOf(m)));
    if (filtered.length) moves = filtered;
  }
  if (!moves.length) return null;
  if (moves.length === 1) return toResult(moves[0], 0, 1, 0, sanFor(fen, uciOf(moves[0])));
  if (p.engine === 'random') {
    const pick = moves[Math.floor(Math.random() * moves.length)];
    return toResult(pick, 0, 0, 0, sanFor(fen, uciOf(pick)));
  }

  const w = p.weights;
  const budget = timeBudgetMs ?? p.timeLimitMs ?? 600;
  const ctx = { nodes: 0, deadline: performance.now() + budget, aborted: false };
  const maxDepth = Math.max(1, p.depth | 0);

  // Full window at the root: every legal move gets an *exact* score. That is
  // what lets personalities jitter between good moves or deliberately pick a
  // worse one, and subtrees still prune internally.
  const rootScores = new Map();
  let order = moves.slice();
  let completedDepth = 0;

  for (let depth = 1; depth <= maxDepth; depth++) {
    orderMoves(order);
    const local = new Map();
    let aborted = false;
    for (let i = 0; i < order.length; i++) {
      const m = order[i];
      applyMove(chess, m);
      const s = -negamax(chess, depth - 1, -Infinity, Infinity, w, ctx, 1);
      revertMove(chess);
      if (ctx.aborted) {
        aborted = true;
        break;
      }
      local.set(uciOf(m), s);
    }
    if (local.size) {
      rootScores.clear();
      for (const [k, v] of local) rootScores.set(k, v);
      completedDepth = depth;
    }
    if (aborted) break;
    order = order
      .slice()
      .sort((a, b) => (rootScores.get(uciOf(b)) ?? -Infinity) - (rootScores.get(uciOf(a)) ?? -Infinity));
    if (performance.now() > ctx.deadline) break;
  }

  if (!rootScores.size) {
    const pick = moves[Math.floor(Math.random() * moves.length)];
    return toResult(pick, 0, 0, ctx.nodes, sanFor(fen, uciOf(pick)));
  }

  const jitter = p.jitter || 0;

  // A persona may play badly, but it never passes up checkmate — the
  // difficulty comes from not seeing it (depth) or drifting off it (jitter).
  let bestBase = -Infinity;
  for (const v of rootScores.values()) if (v > bestBase) bestBase = v;
  const mateAvailable = bestBase >= MATE_SCORE - 1000;

  const entries = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const base = rootScores.has(uciOf(m)) ? rootScores.get(uciOf(m)) : -MATE_SCORE;
    entries.push({ m, score: base + (Math.random() - 0.5) * jitter });
  }
  entries.sort((a, b) => b.score - a.score);

  let chosen = entries[0];
  if (!mateAvailable && p.blunderRate > 0 && Math.random() < p.blunderRate) {
    const spread = Math.min(0.6, Math.max(0.05, p.blunderSpread || 0.25));
    const start = Math.max(1, Math.floor(entries.length * (1 - spread)));
    const pool = entries.slice(start);
    if (pool.length) chosen = pool[Math.floor(Math.random() * pool.length)];
  }

  return toResult(chosen.m, Math.round(chosen.score), completedDepth, ctx.nodes, sanFor(fen, uciOf(chosen.m)));
}

/** Quick noisy evaluation of one move, used when a personality decides to blunder. */
export function staticScoreAfterMove(fen, move, w) {
  const chess = safeChess(fen);
  if (!chess) return -MATE_SCORE;
  const target = generateMoves(chess).find((m) => uciOf(m) === uciOf(move));
  if (!target) return -MATE_SCORE;
  applyMove(chess, target);
  const side = chess.turn() === 'w' ? 1 : -1;
  return side * evaluate(buildPosition(chess), w);
}
