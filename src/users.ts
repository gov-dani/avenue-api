import { computeBadges, grantedKeys } from './badges.js';
import { db } from './db.js';
import { RESERVED_USERNAMES } from './schemas.js';

export const ROLES = ['visitante', 'membro', 'equipe', 'lider', 'fundador'] as const;
export type Role = (typeof ROLES)[number];

// Quanto maior, mais alto na hierarquia
export const ROLE_RANK: Record<Role, number> = {
  visitante: 0,
  membro: 1,
  equipe: 2,
  lider: 3,
  fundador: 4,
};

export const isAdmin = (role: Role) => ROLE_RANK[role] >= ROLE_RANK.lider;

export interface Link { label: string; url: string }
export interface Game { name: string; detail: string }
export interface Gear { category: string; name: string }

export interface UserRow {
  id: number;
  discord_id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string;
  banner_url: string;
  discord: string;
  discord_handle: string;
  discord_name: string;
  discord_avatar: string;
  discord_banner: string;
  discord_accent: string;
  discord_synced_at: string;
  sync_avatar: number;
  sync_banner: number;
  sync_name: number;
  show_activity: number;
  badges: string;
  music_url: string;
  music_title: string;
  avatar_decoration: string;
  links: string;
  games: string;
  gear: string;
  role: Role;
  views: number;
  created_at: string;
}

export const findByUsername = (username: string) =>
  db.prepare('SELECT * FROM users WHERE username = ?').get(username) as unknown as UserRow | undefined;

export const findById = (id: number) =>
  db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow | undefined;

const findByDiscordId = (discordId: string) =>
  db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordId) as unknown as UserRow | undefined;

export const countUsers = () =>
  (db.prepare('SELECT COUNT(*) AS n FROM users').get() as unknown as { n: number }).n;

/** Transforma o nome do Discord em um @usuario válido e livre. */
function freeUsername(raw: string): string {
  let base = raw.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 16);
  if (base.length < 3) base = `${base}av9`.slice(0, 16);
  if (RESERVED_USERNAMES.has(base.toLowerCase())) base = `${base}_av9`;

  let candidate = base;
  for (let n = 2; findByUsername(candidate); n++) candidate = `${base}${n}`;
  return candidate;
}

interface DiscordProfile {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string;
  bannerUrl: string;
  accent: string;
}

// Contas `dev:` vêm do atalho de desenvolvimento e não existem no Discord
export const isLinked = (u: UserRow) => !u.discord_id.startsWith('dev:');

/** Copia para o perfil o que o usuário pediu para acompanhar a conta do Discord. */
export function applySync(id: number) {
  const u = findById(id);
  if (!u || !isLinked(u)) return;
  db.prepare(
    `UPDATE users SET
       avatar_url   = CASE WHEN sync_avatar = 1 AND discord_avatar != '' THEN discord_avatar ELSE avatar_url END,
       banner_url   = CASE WHEN sync_banner = 1 THEN discord_banner ELSE banner_url END,
       display_name = CASE WHEN sync_name = 1 AND discord_name != '' THEN substr(discord_name, 1, 40) ELSE display_name END
     WHERE id = ?`,
  ).run(id);
}

/**
 * Entra com a conta do Discord, criando o perfil no primeiro acesso.
 * A cada entrada os dados da conta são atualizados e o que está marcado para
 * sincronizar é copiado para o perfil; o resto do que o usuário editou fica.
 * O primeiro usuário vira fundador.
 */
export function loginWithDiscord(d: DiscordProfile): { user: UserRow; created: boolean } {
  const existing = findByDiscordId(d.id);
  const synced = [d.handle, d.displayName, d.avatarUrl, d.bannerUrl, d.accent];

  if (existing) {
    db.prepare(
      `UPDATE users SET discord_handle = ?, discord_name = ?, discord_avatar = ?,
         discord_banner = ?, discord_accent = ?, discord_synced_at = datetime('now') WHERE id = ?`,
    ).run(...synced, existing.id);
    applySync(existing.id);
    return { user: findById(existing.id)!, created: false };
  }

  const role: Role = countUsers() === 0 ? 'fundador' : 'visitante';
  const result = db
    .prepare(
      `INSERT INTO users (discord_id, username, display_name, avatar_url, banner_url, discord, role,
         discord_handle, discord_name, discord_avatar, discord_banner, discord_accent, discord_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(
      d.id,
      freeUsername(d.handle),
      d.displayName.slice(0, 40),
      d.avatarUrl,
      d.bannerUrl,
      d.handle,
      role,
      ...synced,
    );

  return { user: findById(Number(result.lastInsertRowid))!, created: true };
}

const parse = <T>(json: string): T[] => {
  try {
    return JSON.parse(json) as T[];
  } catch {
    return [];
  }
};

export function toPublic(u: UserRow) {
  return {
    username: u.username,
    displayName: u.display_name,
    bio: u.bio,
    avatarUrl: u.avatar_url,
    bannerUrl: u.banner_url,
    musicUrl: u.music_url,
    musicTitle: u.music_title,
    avatarDecoration: u.avatar_decoration,
    bannerColor: u.discord_accent,
    badges: computeBadges(u),
    hasActivity: Boolean(u.show_activity) && isLinked(u),
    discord: u.discord,
    role: u.role,
    links: parse<Link>(u.links),
    games: parse<Game>(u.games),
    gear: parse<Gear>(u.gear),
    views: u.views,
    createdAt: u.created_at,
  };
}

export const toPrivate = (u: UserRow) => ({
  ...toPublic(u),
  id: u.id,
  syncAvatar: Boolean(u.sync_avatar),
  syncBanner: Boolean(u.sync_banner),
  syncName: Boolean(u.sync_name),
  showActivity: Boolean(u.show_activity),
  discordAccount: {
    linked: isLinked(u),
    handle: u.discord_handle,
    name: u.discord_name,
    avatarUrl: u.discord_avatar,
    bannerUrl: u.discord_banner,
    accent: u.discord_accent,
    syncedAt: u.discord_synced_at,
  },
});

export const toCard = (u: UserRow) => ({
  username: u.username,
  displayName: u.display_name,
  avatarUrl: u.avatar_url,
  role: u.role,
  grants: grantedKeys(u),
});
