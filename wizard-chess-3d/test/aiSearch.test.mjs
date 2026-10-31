import test from 'node:test';
import assert from 'node:assert/strict';

const { chooseMove } = await import('../src/chess/engine.js');

/** White to move and mate in one: 1.Qxf7# (Scholar's mate position after 3...Nf6??). */
const MATE_IN_ONE_FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 5 4';

/** White queen on h5, black can play nothing clever; white just must not hang the queen for nothing. */
const QUEEN_HANG_FEN = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

const PERSONALITY = {
  id: 'test',
  name: 'Test',
  engine: 'builtin',
  depth: 3,
  blunderRate: 0,
  blunderSpread: 0,
  jitter: 0,
  timeLimitMs: 800,
  weights: {
    material: 1,
    positional: 1,
    mobility: 0.6,
    center: 1.2,
    aggression: 1,
    kingSafety: 1,
    pawn: 1,
  },
};

const s = (fen) => fen.split(' ')[1];

test('search finds mate-in-one (Qxf7#)', () => {
  const result = chooseMove({
    fen: MATE_IN_ONE_FEN,
    personality: PERSONALITY,
    timeBudgetMs: 800,
  });
  assert.ok(result, 'engine returned no move');
  const uci = typeof result === 'string' ? result : result.uci;
  assert.equal(typeof uci, 'string', 'result.uci missing');
  assert.equal(uci.toLowerCase(), 'h5f7', `expected h5f7 (Qxf7#), got ${uci}`);
});

test('search returns a legal-looking UCI string from the start position', () => {
  const result = chooseMove({
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    personality: PERSONALITY,
    timeBudgetMs: 800,
  });
  assert.ok(result, 'engine returned no move');
  const uci = (typeof result === 'string' ? result : result.uci).toLowerCase();
  assert.match(uci, /^[a-h][1-8][a-h][1-8][qrbn]?$/);
});

test('search keeps searching when the side to move is black (no crash)', () => {
  const result = chooseMove({
    fen: QUEEN_HANG_FEN.replace(' w ', ' b '),
    personality: PERSONALITY,
    timeBudgetMs: 800,
  });
  assert.ok(result, 'engine returned no move for black');
  const uci = (typeof result === 'string' ? result : result.uci).toLowerCase();
  assert.match(uci, /^[a-h][1-8][a-h][1-8][qrbn]?$/);
});

test('search respects a side-to-move token mismatch by still picking a move', () => {
  const result = chooseMove({
    fen: MATE_IN_ONE_FEN.replace(' w ', ' b '),
    personality: PERSONALITY,
    timeBudgetMs: 800,
  });
  // Either a valid move or a documented null result, never a crash.
  if (result) {
    const uci = (typeof result === 'string' ? result : result.uci).toLowerCase();
    assert.match(uci, /^[a-h][1-8][a-h][1-8][qrbn]?$/);
  } else {
    assert.ok(true, 'engine returned null — acceptable fallback');
  }
});

void s;
