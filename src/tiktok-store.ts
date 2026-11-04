import { queryOne, run } from './db.js';
import { fetchLatestVideo, refreshTokens, TikTokError, type TikTokTokens, type TikTokVideo } from './tiktok.js';

const sqlDate = (secondsFromNow: number) => new Date(Date.now() + secondsFromNow * 1000).toISOString().slice(0, 19).replace('T', ' ');

export const saveTokens = (userId: number, t: TikTokTokens) =>
  run(
    `UPDATE user_tiktok SET access_token = ?, refresh_token = ?, access_expires_at = ?, refresh_expires_at = ? WHERE user_id = ?`,
    [t.accessToken, t.refreshToken, sqlDate(t.expiresIn), sqlDate(t.refreshExpiresIn), userId],
  );

interface TokenRow {
  access_token: string;
  refresh_token: string;
  access_left: number;
}

/** Token de acesso válido da pessoa; renova com o refresh token quando está para vencer. */
async function accessToken(userId: number): Promise<string> {
  const row = await queryOne<TokenRow>(
    `SELECT access_token, refresh_token, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), access_expires_at) AS access_left
     FROM user_tiktok WHERE user_id = ?`,
    [userId],
  );
  if (!row) throw new TikTokError('Sem TikTok vinculado', true);
  if (row.access_left > 300) return row.access_token;

  const fresh = await refreshTokens(row.refresh_token);
  await saveTokens(userId, fresh);
  return fresh.accessToken;
}

// O perfil é consultado por muita gente: guardar o vídeo por um tempo poupa o TikTok.
// A capa do TikTok expira em algumas horas, então o cache fica bem abaixo disso.
const VIDEO_MS = 10 * 60_000;
const cache = new Map<number, { at: number; value: TikTokVideo | null }>();

export const forgetVideo = (userId: number) => cache.delete(userId);

export async function latestVideo(userId: number): Promise<TikTokVideo | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < VIDEO_MS) return hit.value;

  try {
    const value = await fetchLatestVideo(await accessToken(userId));
    cache.set(userId, { at: Date.now(), value });
    return value;
  } catch (err) {
    // TikTok fora do ar: melhor mostrar o vídeo de alguns minutos atrás do que sumir com o cartão
    if (hit && !(err instanceof TikTokError && err.reauth)) return hit.value;
    throw err;
  }
}
