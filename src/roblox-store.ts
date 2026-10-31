import { run } from './db.js';
import { fetchSnapshot, type RobloxSnapshot } from './roblox.js';

const STALE_HOURS = 6;

/** Grava os dados públicos de uma conta já verificada. */
export const saveSnapshot = (userId: number, s: RobloxSnapshot) =>
  run(
    `UPDATE user_roblox SET username = ?, display_name = ?, avatar_url = ?, friends = ?, followers = ?,
       account_created = ?, synced_at = UTC_TIMESTAMP() WHERE user_id = ?`,
    [s.name, s.displayName, s.avatarUrl, s.friends, s.followers, s.created, userId],
  );

/**
 * Atualiza os dados de quem foi visto há mais de STALE_HOURS. O UPDATE condicional "reserva" a
 * vez (só um pedido ganha), então visitas simultâneas ou o Roblox fora do ar não geram enxurrada.
 */
export async function refreshIfStale(userId: number, robloxId: string) {
  const claim = await run(
    `UPDATE user_roblox SET synced_at = UTC_TIMESTAMP()
     WHERE user_id = ? AND (synced_at IS NULL OR synced_at < UTC_TIMESTAMP() - INTERVAL ${STALE_HOURS} HOUR)`,
    [userId],
  );
  if (claim.affectedRows === 0) return;
  await saveSnapshot(userId, await fetchSnapshot(robloxId));
}
