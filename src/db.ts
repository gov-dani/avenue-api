import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from './env.js';

mkdirSync(dirname(env.DB_PATH), { recursive: true });

export const db = new DatabaseSync(env.DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id    TEXT NOT NULL UNIQUE,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    bio           TEXT NOT NULL DEFAULT '',
    avatar_url    TEXT NOT NULL DEFAULT '',
    discord       TEXT NOT NULL DEFAULT '',
    links         TEXT NOT NULL DEFAULT '[]',
    games         TEXT NOT NULL DEFAULT '[]',
    gear          TEXT NOT NULL DEFAULT '[]',
    role          TEXT NOT NULL DEFAULT 'visitante',
    views         INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
`);

// Quem já contou como visualização de cada perfil (impede recontar a cada reload)
db.exec(`
  CREATE TABLE IF NOT EXISTS profile_views (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    visitor   TEXT NOT NULL,
    viewed_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, visitor)
  );
`);

// Colunas da vinculação com o Discord. `discord_*` guarda o que veio de lá;
// `sync_*` diz o que do perfil acompanha a conta.
const added: Record<string, string> = {
  banner_url: "TEXT NOT NULL DEFAULT ''",
  discord_handle: "TEXT NOT NULL DEFAULT ''",
  discord_name: "TEXT NOT NULL DEFAULT ''",
  discord_avatar: "TEXT NOT NULL DEFAULT ''",
  discord_banner: "TEXT NOT NULL DEFAULT ''",
  discord_accent: "TEXT NOT NULL DEFAULT ''",
  discord_synced_at: "TEXT NOT NULL DEFAULT ''",
  sync_avatar: 'INTEGER NOT NULL DEFAULT 1',
  sync_banner: 'INTEGER NOT NULL DEFAULT 1',
  sync_name: 'INTEGER NOT NULL DEFAULT 0',
  show_activity: 'INTEGER NOT NULL DEFAULT 1',
  badges: "TEXT NOT NULL DEFAULT '[]'",
  music_url: "TEXT NOT NULL DEFAULT ''",
  music_title: "TEXT NOT NULL DEFAULT ''",
  avatar_decoration: "TEXT NOT NULL DEFAULT ''",
};
const have = new Set(
  (db.prepare('PRAGMA table_info(users)').all() as unknown as { name: string }[]).map((c) => c.name),
);
for (const [col, def] of Object.entries(added)) {
  if (!have.has(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
}
