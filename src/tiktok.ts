// Login Kit + Display API do TikTok (v2). A pessoa autoriza o site pelo login do próprio TikTok,
// o que já prova que a conta é dela, e o último vídeo público vem da API com o token dela.
import { env } from './env.js';

const TIMEOUT_MS = 8000;
const SCOPES = 'user.info.basic,user.info.profile,video.list';

export class TikTokError extends Error {
  constructor(
    message: string,
    /** O token não vale mais: só um novo login resolve */
    public reauth = false,
  ) {
    super(message);
  }
}

export const tiktokEnabled = Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET);

export interface TikTokTokens {
  accessToken: string;
  refreshToken: string;
  openId: string;
  /** Segundos até vencer */
  expiresIn: number;
  refreshExpiresIn: number;
}

export function authorizeUrl(state: string) {
  const params = new URLSearchParams({
    client_key: env.TIKTOK_CLIENT_KEY!,
    scope: SCOPES,
    response_type: 'code',
    redirect_uri: env.TIKTOK_REDIRECT_URI,
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
}

async function call(url: string, init: RequestInit): Promise<Record<string, any>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new TikTokError('O TikTok não respondeu. Tente de novo em instantes.');
  }
  const body = (await res.json().catch(() => null)) as Record<string, any> | null;
  if (res.status === 429) throw new TikTokError('O TikTok pediu para esperar um pouco. Tente de novo em instantes.');
  if (!body) throw new TikTokError('Não foi possível falar com o TikTok agora.');

  // OAuth devolve { error: 'invalid_grant', ... }; a Display API devolve { error: { code: 'ok' | ... } }
  const code = typeof body.error === 'string' ? body.error : body.error?.code;
  if (code && code !== 'ok') {
    const dead = /invalid_grant|access_token_invalid|scope_not_authorized|invalid_token/.test(code);
    throw new TikTokError(dead ? 'A autorização do TikTok venceu. Vincule de novo.' : 'O TikTok recusou o pedido.', dead);
  }
  if (!res.ok) throw new TikTokError('Não foi possível falar com o TikTok agora.');
  return body;
}

const toTokens = (b: Record<string, any>): TikTokTokens => {
  if (!b.access_token || !b.refresh_token || !b.open_id) throw new TikTokError('O TikTok não devolveu a autorização.');
  return {
    accessToken: b.access_token,
    refreshToken: b.refresh_token,
    openId: b.open_id,
    expiresIn: Number(b.expires_in) || 86_400,
    refreshExpiresIn: Number(b.refresh_expires_in) || 31_536_000,
  };
};

const tokenRequest = (params: Record<string, string>) =>
  call('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY!, client_secret: env.TIKTOK_CLIENT_SECRET!, ...params }),
  }).then(toTokens);

/** Troca o `code` do callback pelos tokens da pessoa. */
export const exchangeCode = (code: string) =>
  tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: env.TIKTOK_REDIRECT_URI });

export const refreshTokens = (refreshToken: string) => tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });

/** Revoga a autorização no TikTok (ao desvincular). Falhar aqui não impede o resto. */
export async function revoke(token: string) {
  await call('https://open.tiktokapis.com/v2/oauth/revoke/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY!, client_secret: env.TIKTOK_CLIENT_SECRET!, token }),
  }).catch(() => undefined);
}

export interface TikTokProfile {
  username: string;
  displayName: string;
}

export async function fetchProfile(accessToken: string): Promise<TikTokProfile> {
  const b = await call('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const u = b.data?.user ?? {};
  return { username: String(u.username ?? '').slice(0, 64), displayName: String(u.display_name ?? '').slice(0, 100) };
}

export interface TikTokVideo {
  id: string;
  title: string;
  coverUrl: string;
  url: string;
  createdAt: string;
  views: number;
  likes: number;
}

/** O vídeo público mais recente, ou null se a conta não tem nenhum. */
export async function fetchLatestVideo(accessToken: string): Promise<TikTokVideo | null> {
  const fields = 'id,title,video_description,cover_image_url,share_url,create_time,view_count,like_count';
  const b = await call(`https://open.tiktokapis.com/v2/video/list/?fields=${fields}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ max_count: 5 }),
  });

  const videos = (b.data?.videos ?? []) as Record<string, any>[];
  // A API já manda do mais novo para o mais velho, mas não custa garantir
  const v = videos.sort((x, y) => (y.create_time ?? 0) - (x.create_time ?? 0))[0];
  if (!v?.id || typeof v.share_url !== 'string') return null;

  const https = (url: unknown) => (typeof url === 'string' && url.startsWith('https://') ? url : '');
  return {
    id: String(v.id),
    title: String(v.title || v.video_description || '').slice(0, 150),
    coverUrl: https(v.cover_image_url),
    url: https(v.share_url),
    createdAt: new Date((v.create_time ?? 0) * 1000).toISOString(),
    views: Number(v.view_count) || 0,
    likes: Number(v.like_count) || 0,
  };
}
