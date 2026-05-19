import type { GamePlayerDTO } from 'actions/gamePlayer.server';

/**
 * Compute the current effective bet for a game player.
 * Pure function — safe to use from client code. The DTO type import is
 * type-only and elided at build time.
 */
export const getGamePlayerBetAmount = (gamePlayer : GamePlayerDTO): number => {
  if (!gamePlayer.game_player_bet || !gamePlayer.game_player_bet.length) {
    throw new Error('could not access player bets');
  }
  const initialBet = gamePlayer.game_player_bet.find((playerBet) => playerBet.type === 'initial');
  if (!initialBet) {
    throw new Error('could not get initial player bet');
  }
  const isDoubleDown = gamePlayer.game_player_round.some((gamePlayerRound) => gamePlayerRound.action === 'double down');
  let betAmount = initialBet.amount;
  if (isDoubleDown) {
    betAmount += betAmount;
  }
  return betAmount;
};
