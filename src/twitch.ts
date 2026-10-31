// API Helix da Twitch com token de aplicativo (client credentials). Não pede login de ninguém:
// a prova de que o canal é da pessoa é um código colado na bio do canal, como no Roblox.
const TIMEOUT_MS = 6000;
export const TWITCH_LOGIN = /^[A-Za-z0-9_]{4,25}$/;

export class TwitchError extends Error {}

export interface TwitchCredentials { clientId: string; clientSecret: string }

let token: { value: string; clientId: string; expiresAt: number } | null = null;

async function appToken(c: TwitchCredentials): Promise<string> {
  if (token && token.clientId === c.clientId && token.expiresAt > Date.now() + 60_000) return token.value;

  let res: Response;
  try {
    res = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'client_credentials' }),
    });
  } catch {
    throw new TwitchError('A Twitch não respondeu. Tente de novo em instantes.');
  }
  if (!res.ok) throw new TwitchError('A chave da Twitch deste site não foi aceita. Avise a gestão.');
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, clientId: c.clientId, expiresAt: Date.now() + body.expires_in * 1000 };
  return token.value;
}

async function helix<T>(c: TwitchCredentials, path: string, retry = true): Promise<T> {
  const bearer = await appToken(c);
  let res: Response;
  try {
    res = await fetch(`https://api.twitch.tv/helix${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Client-Id': c.clientId, Authorization: `Bearer ${bearer}` },
    });
  } catch {
    throw new TwitchError('A Twitch não respondeu. Tente de novo em instantes.');
  }
  // Token revogado antes de vencer: pega outro uma vez
  if (res.status === 401 && retry) {
    token = null;
    return helix(c, path, false);
  }
  if (res.status === 429) throw new TwitchError('A Twitch pediu para esperar um pouco. Tente de novo em instantes.');
  if (!res.ok) throw new TwitchError('Não foi possível falar com a Twitch agora.');
  return ((await res.json()) as { data: T }).data;
}

interface HelixUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
  description: string;
  broadcaster_type: string;
  created_at: string;
}

export interface TwitchSnapshot {
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string;
  /** Texto "Sobre" do canal: onde a pessoa cola o código */
  description: string;
  /** 'affiliate', 'partner' ou vazio */
  broadcasterType: string;
  created: string;
}

const toSnapshot = (u: HelixUser): TwitchSnapshot => ({
  id: u.id,
  login: u.login,
  displayName: u.display_name,
  avatarUrl: u.profile_image_url.startsWith('https://') ? u.profile_image_url : '',
  description: u.description ?? '',
  broadcasterType: u.broadcaster_type === 'affiliate' || u.broadcaster_type === 'partner' ? u.broadcaster_type : '',
  created: u.created_at,
});

/** Procura o canal pelo nome; null se não existir (ou estiver banido). */
export async function findByLogin(login: string, c: TwitchCredentials): Promise<TwitchSnapshot | null> {
  const [u] = await helix<HelixUser[]>(c, `/users?login=${encodeURIComponent(login)}`);
  return u ? toSnapshot(u) : null;
}

export async function fetchSnapshot(id: string, c: TwitchCredentials): Promise<TwitchSnapshot> {
  const [u] = await helix<HelixUser[]>(c, `/users?id=${encodeURIComponent(id)}`);
  if (!u) throw new TwitchError('Esse canal da Twitch não existe mais.');
  return toSnapshot(u);
}

export interface TwitchLive {
  live: boolean;
  game?: string;
  title?: string;
  viewers?: number;
  startedAt?: string;
}

// A página consulta a cada 30s: guardar a resposta por um tempo poupa a Twitch
const LIVE_MS = 25_000;
const liveCache = new Map<string, { at: number; value: TwitchLive }>();

export async function fetchLive(id: string, c: TwitchCredentials): Promise<TwitchLive> {
  const hit = liveCache.get(id);
  if (hit && Date.now() - hit.at < LIVE_MS) return hit.value;

  const [s] = await helix<{ type: string; game_name: string; title: string; viewer_count: number; started_at: string }[]>(
    c,
    `/streams?user_id=${encodeURIComponent(id)}`,
  );
  const value: TwitchLive =
    s?.type === 'live'
      ? { live: true, game: s.game_name, title: s.title.slice(0, 140), viewers: s.viewer_count, startedAt: s.started_at }
      : { live: false };

  liveCache.set(id, { at: Date.now(), value });
  return value;
}
