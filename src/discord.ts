import { env } from './env.js';

const API = 'https://discord.com/api';
const CDN = 'https://cdn.discordapp.com';

export const discordEnabled = Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);

// Atalho de desenvolvimento: só existe fora de produção e sem app Discord configurado
export const devLoginEnabled = env.NODE_ENV === 'development' && !discordEnabled;

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  banner?: string | null;
  accent_color?: number | null;
}

export function authorizeUrl(state: string) {
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID!,
    redirect_uri: env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'none',
  });
  return `${API}/oauth2/authorize?${params}`;
}

/** Troca o `code` do callback pelo perfil do usuário no Discord. */
export async function fetchDiscordUser(code: string): Promise<DiscordUser> {
  const tokenRes = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID!,
      client_secret: env.DISCORD_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.DISCORD_REDIRECT_URI,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Discord token: ${tokenRes.status}`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const userRes = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!userRes.ok) throw new Error(`Discord user: ${userRes.status}`);
  return (await userRes.json()) as DiscordUser;
}

// Hash que começa com `a_` é animado (gif)
const asset = (kind: 'avatars' | 'banners', id: string, hash: string, size: number) =>
  `${CDN}/${kind}/${id}/${hash}.${hash.startsWith('a_') ? 'gif' : 'png'}?size=${size}`;

export const discordAvatarUrl = (u: DiscordUser) => (u.avatar ? asset('avatars', u.id, u.avatar, 256) : '');

export const discordBannerUrl = (u: DiscordUser) => (u.banner ? asset('banners', u.id, u.banner, 600) : '');

export const discordAccent = (u: DiscordUser) =>
  typeof u.accent_color === 'number' ? `#${u.accent_color.toString(16).padStart(6, '0')}` : '';

// --- Presença (o que a pessoa está jogando agora) ---------------------------
// O Discord não entrega presença por OAuth. Usamos o Lanyard, serviço público
// que expõe a presença de quem entrou no servidor dele (discord.gg/lanyard).

export interface Activity {
  /** false = a pessoa ainda não entrou no servidor do Lanyard */
  monitored: boolean;
  /** De onde veio a presença */
  source: 'bot' | 'lanyard';
  status?: 'online' | 'idle' | 'dnd' | 'offline';
  game?: { name: string; details: string; state: string; since: number | null; image: string };
  spotify?: { song: string; artist: string; album: string; art: string };
  custom?: { text: string; emoji: string };
}

interface LanyardActivity {
  type: number;
  name: string;
  details?: string;
  state?: string;
  emoji?: { name?: string };
  application_id?: string;
  timestamps?: { start?: number };
  assets?: { large_image?: string };
}

interface LanyardResponse {
  success: boolean;
  data?: {
    discord_status: 'online' | 'idle' | 'dnd' | 'offline';
    activities: LanyardActivity[];
    listening_to_spotify: boolean;
    spotify?: { song: string; artist: string; album: string; album_art_url: string };
  };
}

const CACHE_MS = 15_000;
const cache = new Map<string, { at: number; value: Activity }>();

function gameImage(a: LanyardActivity): string {
  const img = a.assets?.large_image;
  if (!img || !a.application_id || img.includes(':')) return '';
  return `${CDN}/app-assets/${a.application_id}/${img}.png`;
}

export async function fetchLanyard(discordId: string): Promise<Activity> {
  const hit = cache.get(discordId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  let value: Activity = { monitored: false, source: 'lanyard' };
  try {
    const res = await fetch(`https://api.lanyard.rest/v1/users/${encodeURIComponent(discordId)}`, {
      signal: AbortSignal.timeout(3000),
    });
    const body = (await res.json()) as LanyardResponse;
    if (body.success && body.data) {
      const d = body.data;
      const play = d.activities.find((a) => a.type === 0);
      const custom = d.activities.find((a) => a.type === 4);
      value = {
        monitored: true,
        source: 'lanyard',
        status: d.discord_status,
        game: play && {
          name: play.name,
          details: play.details ?? '',
          state: play.state ?? '',
          since: play.timestamps?.start ?? null,
          image: gameImage(play),
        },
        spotify:
          d.listening_to_spotify && d.spotify
            ? { song: d.spotify.song, artist: d.spotify.artist, album: d.spotify.album, art: d.spotify.album_art_url }
            : undefined,
        custom: custom && (custom.state || custom.emoji?.name)
          ? { text: custom.state ?? '', emoji: custom.emoji?.name ?? '' }
          : undefined,
      };
    }
  } catch {
    // Lanyard fora do ar: mostra como "sem presença" e tenta de novo no próximo ciclo
  }

  cache.set(discordId, { at: Date.now(), value });
  return value;
}
