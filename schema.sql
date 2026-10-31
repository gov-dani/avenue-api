-- Avenue: banco e tabelas. Rode no HeidiSQL (Arquivo > Executar arquivo SQL, ou cole na aba Consulta).
-- A API também cria as tabelas sozinha ao subir (CREATE TABLE IF NOT EXISTS), então rodar isto é opcional.

CREATE DATABASE IF NOT EXISTS avenue CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE avenue;

CREATE TABLE IF NOT EXISTS users (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  discord_id        VARCHAR(64)  NOT NULL UNIQUE,
  username          VARCHAR(32)  NOT NULL UNIQUE,
  display_name      VARCHAR(100) NOT NULL,
  bio               TEXT         NOT NULL,
  avatar_url        TEXT         NOT NULL,
  banner_url        TEXT         NOT NULL,
  discord           VARCHAR(150) NOT NULL DEFAULT '',
  discord_handle    VARCHAR(100) NOT NULL DEFAULT '',
  discord_name      VARCHAR(100) NOT NULL DEFAULT '',
  discord_avatar    TEXT         NOT NULL,
  discord_banner    TEXT         NOT NULL,
  discord_accent    VARCHAR(32)  NOT NULL DEFAULT '',
  discord_synced_at VARCHAR(32)  NOT NULL DEFAULT '',
  sync_avatar       TINYINT      NOT NULL DEFAULT 1,
  sync_banner       TINYINT      NOT NULL DEFAULT 1,
  sync_name         TINYINT      NOT NULL DEFAULT 0,
  show_activity     TINYINT      NOT NULL DEFAULT 1,
  badges            TEXT         NOT NULL,
  music_url         TEXT         NOT NULL,
  music_title       VARCHAR(255) NOT NULL DEFAULT '',
  avatar_decoration VARCHAR(64)  NOT NULL DEFAULT '',
  links             TEXT         NOT NULL,
  games             TEXT         NOT NULL,
  gear              TEXT         NOT NULL,
  role              VARCHAR(20)  NOT NULL DEFAULT 'visitante',
  views             INT          NOT NULL DEFAULT 0,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Quem já contou como visualização de cada perfil
CREATE TABLE IF NOT EXISTS profile_views (
  user_id   INT UNSIGNED NOT NULL,
  visitor   VARCHAR(64)  NOT NULL,
  viewed_at BIGINT       NOT NULL,
  PRIMARY KEY (user_id, visitor),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
