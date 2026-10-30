"use strict";
class GameError extends Error {
  constructor(message, code = "GAME_ERROR") {
    super(message);
    this.name = "GameError";
    this.code = code;
  }
}
function assert(ok, message, code) {
  if (!ok) throw new GameError(message, code);
}
module.exports = { GameError, assert };
