/**
 * Opponent roster for Wizard Chess.
 *
 * Every opponent is defined by three things:
 *   1. `engine`     which search to run ('builtin' | 'stockfish' | 'random')
 *   2. `depth` etc. how hard it looks
 *   3. `weights`    how it *values* the position — this is what makes two
 *                   opponents of equal depth play visibly differently.
 *
 * Weaks are multipliers on the evaluation terms in `engine.js`:
 *
 *   material     raw piece value
 *   positional   piece-square tables (development, centralisation, king posts)
 *   mobility     how many squares its pieces can actually reach
 *   center       control of d4/e4/d5/e5
 *   aggression   attacking squares around the enemy king
 *   kingSafety   panic weight for squares around its own king
 *   pawn         pawn structure (doubled / isolated / passed)
 */

export const DEFAULT_WEIGHTS = {
  material: 1.0,
  positional: 1.0,
  mobility: 0.6,
  center: 1.2,
  aggression: 1.0,
  kingSafety: 1.0,
  pawn: 1.0,
};

/** @type {ReadonlyArray<{id: string, name: string, epithet: string, style: string, blurb: string, sigil: string, engine: string, depth: number, blunderRate: number, blunderSpread: number, jitter: number, timeLimitMs: number, weights: typeof DEFAULT_WEIGHTS, skill?: number, movetime?: number}>} */
export const PERSONALITIES = [
  {
    id: 'novice',
    name: 'Pip',
    epithet: 'the Squire',
    style: 'Beginner',
    blurb: 'Still learning which end of the bishop points forward. Hangs pieces, apologises, does it again.',
    sigil: 'P',
    engine: 'builtin',
    depth: 1,
    blunderRate: 0.42,
    blunderSpread: 0.5,
    jitter: 280,
    timeLimitMs: 200,
    weights: {
      material: 0.85,
      positional: 0.35,
      mobility: 0.2,
      center: 0.4,
      aggression: 0.3,
      kingSafety: 0.2,
      pawn: 0.3,
    },
  },
  {
    id: 'berserker',
    name: 'Krag',
    epithet: 'the Unchained',
    style: 'Aggressive',
    blurb: 'Believes defence is something other people do. Throws pieces at your king until something breaks.',
    sigil: 'K',
    engine: 'builtin',
    depth: 3,
    blunderRate: 0.07,
    blunderSpread: 0.32,
    jitter: 95,
    timeLimitMs: 700,
    weights: {
      material: 0.8,
      positional: 0.5,
      mobility: 0.85,
      center: 1.0,
      aggression: 3.2,
      kingSafety: 0.15,
      pawn: 0.6,
    },
  },
  {
    id: 'guardian',
    name: 'Seraphine',
    epithet: 'Warden of the Nave',
    style: 'Defensive',
    blurb: 'Builds a wall, then another wall, then asks why you are still attacking. Impossible to crack carelessly.',
    sigil: 'S',
    engine: 'builtin',
    depth: 3,
    blunderRate: 0.03,
    blunderSpread: 0.2,
    jitter: 45,
    timeLimitMs: 700,
    weights: {
      material: 1.1,
      positional: 1.1,
      mobility: 0.5,
      center: 0.8,
      aggression: 0.2,
      kingSafety: 3.4,
      pawn: 1.7,
    },
  },
  {
    id: 'trickster',
    name: 'Vex',
    epithet: 'of the Crooked Path',
    style: 'Gambit',
    blurb: 'Offers a free rook. It is never a free rook. Half the fun is finding out what it actually is.',
    sigil: 'V',
    engine: 'builtin',
    depth: 2,
    blunderRate: 0.15,
    blunderSpread: 0.36,
    jitter: 360,
    timeLimitMs: 520,
    weights: {
      material: 0.7,
      positional: 0.9,
      mobility: 1.25,
      center: 1.0,
      aggression: 1.7,
      kingSafety: 0.4,
      pawn: 0.8,
    },
  },
  {
    id: 'strategist',
    name: 'Marrow',
    epithet: 'the Architect',
    style: 'Positional',
    blurb: 'Plays the board, not the pieces. Will happily take ten moves to make one of yours illegal.',
    sigil: 'M',
    engine: 'builtin',
    depth: 4,
    blunderRate: 0.02,
    blunderSpread: 0.15,
    jitter: 30,
    timeLimitMs: 950,
    weights: {
      material: 1.0,
      positional: 1.9,
      mobility: 1.4,
      center: 1.7,
      aggression: 0.5,
      kingSafety: 1.3,
      pawn: 2.1,
    },
  },
  {
    id: 'tactician',
    name: 'Nix',
    epithet: 'the Hexblade',
    style: 'Tactical',
    blurb: 'Sees forks, pins and skewers three moves before you do. Loves a check that also wins a piece.',
    sigil: 'N',
    engine: 'builtin',
    depth: 3,
    blunderRate: 0.04,
    blunderSpread: 0.2,
    jitter: 70,
    timeLimitMs: 750,
    weights: {
      material: 1.05,
      positional: 0.8,
      mobility: 1.0,
      center: 1.1,
      aggression: 2.2,
      kingSafety: 0.9,
      pawn: 0.7,
    },
  },
  {
    id: 'veteran',
    name: 'Elder Orin',
    epithet: 'of the Long Table',
    style: 'Balanced',
    blurb: 'No tricks, no tics — just solid chess with the odd flourish. The one the others measure themselves against.',
    sigil: 'O',
    engine: 'builtin',
    depth: 4,
    blunderRate: 0.03,
    blunderSpread: 0.18,
    jitter: 55,
    timeLimitMs: 900,
    weights: { ...DEFAULT_WEIGHTS },
  },
  {
    id: 'oracle',
    name: 'Syth',
    epithet: 'the Oracle',
    style: 'Master',
    blurb: 'Looks further than anyone else at the table. Punishes the first loose move and never gives it back.',
    sigil: 'Y',
    engine: 'builtin',
    depth: 5,
    blunderRate: 0.0,
    blunderSpread: 0.1,
    jitter: 14,
    timeLimitMs: 1500,
    weights: {
      material: 1.05,
      positional: 1.3,
      mobility: 0.9,
      center: 1.4,
      aggression: 1.2,
      kingSafety: 1.4,
      pawn: 1.3,
    },
  },
  {
    id: 'chaos',
    name: 'Impkin',
    epithet: 'the Chaos',
    style: 'Wildcard',
    blurb: 'Picks a legal move at random. Statistically terrible, emotionally devastating when it works.',
    sigil: 'I',
    engine: 'random',
    depth: 0,
    blunderRate: 1,
    blunderSpread: 1,
    jitter: 0,
    timeLimitMs: 0,
    weights: { ...DEFAULT_WEIGHTS },
  },
  {
    id: 'grandmaster',
    name: 'Stockfish 19',
    epithet: 'the Unblinking',
    style: 'Grandmaster',
    blurb: 'A real UCI engine, downloaded only when you pick it. Bring a plan, a snack, and an alibi.',
    sigil: 'SF',
    engine: 'stockfish',
    depth: 0,
    blunderRate: 0,
    blunderSpread: 0,
    jitter: 0,
    timeLimitMs: 0,
    skill: 18,
    movetime: 700,
    weights: { ...DEFAULT_WEIGHTS },
  },
];

export const DEFAULT_PERSONALITY_ID = 'veteran';

const BY_ID = new Map(PERSONALITIES.map((p) => [p.id, p]));

export function getPersonality(id) {
  return BY_ID.get(id) || BY_ID.get(DEFAULT_PERSONALITY_ID);
}

export function isStockfishPersonality(personality) {
  return Boolean(personality) && personality.engine === 'stockfish';
}
