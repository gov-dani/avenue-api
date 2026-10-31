import { env } from './env.js';
import { run } from './db.js';
import { fetchSnapshot, type TwitchCredentials, type TwitchSnapshot } from './twitch.js';

const STALE_HOURS = 6;

/** As credenciais do aplicativo, ou null quando o site não configurou a Twitch. */
export const twitchCredentials = (): TwitchCredentials | null =>
  env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET ? { clientId: env.TWITCH_CLIENT_ID, clientSecret: env.TWITCH_CLIENT_SECRET } : null;

export const saveSnapshot = (userId: number, s: TwitchSnapshot) =>
  run(
    `UPDATE user_twitch SET login = ?, display_name = ?, avatar_url = ?, broadcaster_type = ?, account_created = ?,
       synced_at = UTC_TIMESTAMP() WHERE user_id = ?`,
    [s.login, s.displayName, s.avatarUrl, s.broadcasterType, s.created, userId],
  );

/** Atualiza quem não foi visto há STALE_HOURS (o UPDATE condicional reserva a vez, só um pedido ganha). */
export async function refreshIfStale(userId: number, twitchId: string) {
  const creds = twitchCredentials();
  if (!creds) return;
  const claim = await run(
    `UPDATE user_twitch SET synced_at = UTC_TIMESTAMP()
     WHERE user_id = ? AND (synced_at IS NULL OR synced_at < UTC_TIMESTAMP() - INTERVAL ${STALE_HOURS} HOUR)`,
    [userId],
  );
  if (claim.affectedRows === 0) return;
  await saveSnapshot(userId, await fetchSnapshot(twitchId, creds));
}
