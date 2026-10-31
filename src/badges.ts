import type { UserRow } from './users.js';

export interface Badge {
  key: string;
  label: string;
  desc: string;
}

/** Badges que a liderança concede à mão. As demais são calculadas do perfil. */
export const GRANTABLE: Record<string, Omit<Badge, 'key'>> = {
  girls: { label: 'Avenue Girls', desc: 'Faz parte das Avenue Girls' },
  parceiro: { label: 'Parceiro', desc: 'Parceiro oficial da Avenue' },
  vip: { label: 'VIP', desc: 'Destaque da comunidade' },
  campeao: { label: 'Campeão', desc: 'Venceu um campeonato pela Avenue' },
};

/** Badge exclusiva, atribuída pelo Discord ID e não pela liderança. */
const DEVELOPER_DISCORD_IDS = new Set(['504882460106948619']);

const ROLE_BADGE: Partial<Record<UserRow['role'], Badge>> = {
  fundador: { key: 'fundador', label: 'Fundador', desc: 'Criou a Avenue' },
  lider: { key: 'lider', label: 'Liderança', desc: 'Lidera a Avenue' },
  equipe: { key: 'equipe', label: 'Equipe', desc: 'Faz parte da equipe da Avenue' },
  membro: { key: 'membro', label: 'Membro', desc: 'Da família Avenue' },
};

const STREAM_HOSTS = /(^|\.)(twitch\.tv|kick\.com|youtube\.com|youtu\.be)$/i;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

const fmtDate = (sqlDate: string) => {
  const [y, m, d] = sqlDate.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export const grantedKeys = (u: UserRow): string[] => u.badges.filter((k) => k in GRANTABLE);

/** Badges exibidas no perfil, na ordem em que aparecem. */
export function computeBadges(u: UserRow): Badge[] {
  const out: Badge[] = [];

  const role = ROLE_BADGE[u.role];
  if (role) out.push(role);

  if (DEVELOPER_DISCORD_IDS.has(u.discord_id)) {
    out.push({ key: 'dev', label: 'Desenvolvedor', desc: 'Desenvolveu e mantém o site da Avenue' });
  }

  for (const key of grantedKeys(u)) out.push({ key, ...GRANTABLE[key]! });

  if (u.role !== 'visitante') {
    out.push({ key: 'desde', label: 'Na Avenue', desc: `Membro desde ${fmtDate(u.created_at)}` });
  }
  if (!u.discord_id.startsWith('dev:')) {
    out.push({ key: 'discord', label: 'Discord vinculado', desc: 'Conta conectada ao Discord' });
  }
  if (u.links.some((l) => STREAM_HOSTS.test(hostOf(l.url)))) {
    out.push({ key: 'streamer', label: 'Criador de conteúdo', desc: 'Faz live ou vídeos' });
  }
  if (u.games.length >= 3) {
    out.push({ key: 'gamer', label: 'Gamer', desc: 'Joga em vários jogos' });
  }
  if (u.gear.length >= 4) {
    out.push({ key: 'setup', label: 'Setup montado', desc: 'Mostra o setup completo' });
  }
  if (u.views >= 100) {
    out.push({ key: 'popular', label: 'Popular', desc: `${u.views.toLocaleString('pt-BR')} visualizações no perfil` });
  }
  return out;
}
