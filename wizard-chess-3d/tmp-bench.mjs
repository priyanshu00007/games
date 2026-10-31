import { chooseMove } from './src/chess/engine.js';
import { getPersonality, PERSONALITIES } from './src/chess/personalities.js';
import { Chess } from 'chess.js';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const chess = new Chess(FEN);
const allowed = new Set(chess.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || '')));

for (const id of ['berserker', 'veteran', 'oracle']) {
  const p = getPersonality(id);
  const t0 = performance.now();
  const r = chooseMove({ fen: FEN, allowed, personality: p, timeBudgetMs: 250 });
  const t1 = performance.now();
  console.log(
    `${id.padEnd(10)} took=${Math.round(t1 - t0)}ms nodes=${r.nodes} depth=${r.depth} move=${r.uci}`
  );
}
console.log('personas:', PERSONALITIES.map((p) => p.id).join(','));
