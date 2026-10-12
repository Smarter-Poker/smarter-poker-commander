// Owner direction 2026-10-12: points score leaderboards only, never benefits.
export const FREEROLL_QUALIFICATION_TYPES = ['cash_hours', 'custom', 'open'];
export const POINTS_REWARDS_RETIRED = {
  code: 'POINTS_REWARDS_RETIRED',
  message: 'Points Cannot Qualify Players For Rewards',
};

export function usesRetiredRewardPoints(type, points) {
  return type === 'tournament_points' || (points !== undefined && Number(points) !== 0);
}

// Explicit projection keeps archived loyalty columns out of active analytics/export.
export const PLAYER_STATS_COLUMNS = [
  'id', 'venue_id', 'player_id', 'first_visit', 'last_visit', 'total_visits',
  'visits_this_month', 'visits_this_year', 'total_hours', 'hours_this_month',
  'hours_this_year', 'avg_session_hours', 'longest_session_hours', 'total_buyin',
  'total_cashout', 'avg_buyin', 'preferred_game', 'preferred_stakes', 'games_played',
  'tournaments_played', 'tournament_cashes', 'tournament_wins',
  'total_tournament_earnings', 'promotions_won', 'promotion_earnings',
  'players_referred', 'referral_bonus_earned', 'is_vip', 'notes', 'updated_at',
].join(',');


export const QUALIFICATION_COLUMNS = 'id,freeroll_id,player_id,player_name,hours_logged,custom_value,is_qualified,qualified_at,manually_added,notes,created_at,updated_at';
