import { env } from './env.js';
import { run } from './db.js';
import { fetchSnapshot, type ValorantSnapshot } from './valorant.js';

const STALE_HOURS = 3;

export const saveSnapshot = (userId: number, s: ValorantSnapshot) =>
  run(
    `UPDATE user_valorant SET name = ?, tag = ?, region = ?, level = ?, card_url = ?, tier = ?, tier_id = ?, rr = ?,
       peak_tier = ?, peak_tier_id = ?, synced_at = UTC_TIMESTAMP() WHERE user_id = ?`,
    [s.name, s.tag, s.region, s.level, s.cardUrl, s.tier, s.tierId, s.rr, s.peakTier, s.peakTierId, userId],
  );

/** Puxa o rank de novo para quem não foi atualizado há STALE_HOURS (o UPDATE condicional reserva a vez). */
export async function refreshIfStale(userId: number, name: string, tag: string) {
  if (!env.HENRIK_API_KEY) return;
  const claim = await run(
    `UPDATE user_valorant SET synced_at = UTC_TIMESTAMP()
     WHERE user_id = ? AND (synced_at IS NULL OR synced_at < UTC_TIMESTAMP() - INTERVAL ${STALE_HOURS} HOUR)`,
    [userId],
  );
  if (claim.affectedRows === 0) return;
  await saveSnapshot(userId, await fetchSnapshot(name, tag, env.HENRIK_API_KEY));
}
