import { chooseMove } from './engine.js';

/**
 * Runs `chooseMove` off the main thread so a 1+ second search never freezes
 * the camera, the flames or the HUD while an opponent "thinks".
 */
self.onmessage = (event) => {
  const { id, payload } = event.data || {};
  try {
    const result = chooseMove(payload);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
