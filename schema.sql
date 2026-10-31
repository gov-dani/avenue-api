-- Avenue: banco e tabelas. Rode no HeidiSQL (Arquivo > Carregar arquivo SQL, depois F9).
-- A API roda a parte abaixo de "@tables" sozinha ao subir (tudo com IF NOT EXISTS),
-- então só é preciso criar o banco; as tabelas são opcionais aqui.
--
-- Organização: cada assunto na sua tabela, todas ligadas a `users` por user_id.
--   users            identidade e cargo
--   user_profiles    o que a pessoa edita no perfil
--   user_discord     dados vindos da conta do Discord + o que sincronizar
--   user_links       links do perfil
--   user_games       jogos
--   user_gear        equipamentos do setup
--   user_badges      badges concedidas pela liderança
--   badge_defs       badges criadas no /management
--   audit_log        histórico das ações feitas no /management
--   whitelist_requests  pedidos de link (@usuário) aguardando aprovação
--   profile_views    quem já contou como visualização

CREATE DATABASE IF NOT EXISTS avenue CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE avenue;

-- @tables

-- Identidade e cargo
CREATE TABLE IF NOT EXISTS users (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  discord_id VARCHAR(64)  NOT NULL UNIQUE,
  username   VARCHAR(32)  NOT NULL UNIQUE,
  role       VARCHAR(20)  NOT NULL DEFAULT 'visitante',
  views      INT          NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- O que a pessoa edita no perfil
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id           INT UNSIGNED NOT NULL PRIMARY KEY,
  display_name      VARCHAR(100) NOT NULL,
  bio               VARCHAR(500) NOT NULL DEFAULT '',
  avatar_url        VARCHAR(500) NOT NULL DEFAULT '',
  banner_url        VARCHAR(500) NOT NULL DEFAULT '',
  discord           VARCHAR(150) NOT NULL DEFAULT '',
  music_url         VARCHAR(500) NOT NULL DEFAULT '',
  music_title       VARCHAR(100) NOT NULL DEFAULT '',
  avatar_decoration VARCHAR(64)  NOT NULL DEFAULT '',
  name_style        VARCHAR(24)  NOT NULL DEFAULT '',
  name_font         VARCHAR(24)  NOT NULL DEFAULT '',
  show_activity     TINYINT      NOT NULL DEFAULT 1,
  show_views        TINYINT      NOT NULL DEFAULT 1,
  link_layout       VARCHAR(10)  NOT NULL DEFAULT 'list',
  location          VARCHAR(80)  NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bancos criados antes de show_views (o erro de coluna repetida é ignorado ao subir)
ALTER TABLE user_profiles ADD COLUMN show_views TINYINT NOT NULL DEFAULT 1;
ALTER TABLE user_profiles ADD COLUMN link_layout VARCHAR(10) NOT NULL DEFAULT 'list';
ALTER TABLE user_profiles ADD COLUMN location VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN name_style VARCHAR(24) NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN name_font VARCHAR(24) NOT NULL DEFAULT '';

-- Dados vindos do Discord e o que do perfil acompanha a conta
CREATE TABLE IF NOT EXISTS user_discord (
  user_id       INT UNSIGNED NOT NULL PRIMARY KEY,
  handle        VARCHAR(100) NOT NULL DEFAULT '',
  name          VARCHAR(100) NOT NULL DEFAULT '',
  avatar_url    VARCHAR(500) NOT NULL DEFAULT '',
  banner_url    VARCHAR(500) NOT NULL DEFAULT '',
  accent        VARCHAR(32)  NOT NULL DEFAULT '',
  synced_at     DATETIME     NULL,
  sync_avatar   TINYINT      NOT NULL DEFAULT 1,
  sync_banner   TINYINT      NOT NULL DEFAULT 1,
  sync_name     TINYINT      NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Links do perfil (sort_order = posição na lista)
CREATE TABLE IF NOT EXISTS user_links (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
  label      VARCHAR(40)  NOT NULL,
  url        VARCHAR(500) NOT NULL,
  INDEX idx_user_links_user (user_id, sort_order),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Jogos
CREATE TABLE IF NOT EXISTS user_games (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
  name       VARCHAR(60)  NOT NULL,
  detail     VARCHAR(60)  NOT NULL DEFAULT '',
  INDEX idx_user_games_user (user_id, sort_order),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Equipamentos do setup
CREATE TABLE IF NOT EXISTS user_gear (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
  category   VARCHAR(30)  NOT NULL,
  name       VARCHAR(80)  NOT NULL,
  INDEX idx_user_gear_user (user_id, sort_order),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Badges concedidas à mão pela liderança (girls, parceiro, vip, campeao)
CREATE TABLE IF NOT EXISTS user_badges (
  user_id INT UNSIGNED NOT NULL,
  badge   VARCHAR(20)  NOT NULL,
  PRIMARY KEY (user_id, badge),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Quem já contou como visualização de cada perfil (impede recontar a cada reload)
CREATE TABLE IF NOT EXISTS profile_views (
  user_id   INT UNSIGNED NOT NULL,
  visitor   VARCHAR(64)  NOT NULL,
  viewed_at BIGINT       NOT NULL,
  PRIMARY KEY (user_id, visitor),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Badges criadas pelo dono em /management (as de fábrica ficam no código)
CREATE TABLE IF NOT EXISTS badge_defs (
  badge_key   VARCHAR(20)  NOT NULL PRIMARY KEY,
  label       VARCHAR(40)  NOT NULL,
  description VARCHAR(120) NOT NULL DEFAULT '',
  color       VARCHAR(7)   NOT NULL DEFAULT '#22c55e',
  icon        VARCHAR(48)  NOT NULL DEFAULT 'star',
  icon_svg    TEXT         NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bancos criados antes dos ícones do allsvgicons (o erro de coluna repetida é ignorado ao subir)
ALTER TABLE badge_defs MODIFY icon VARCHAR(48) NOT NULL DEFAULT 'star';
ALTER TABLE badge_defs ADD COLUMN icon_svg TEXT NULL;

-- Histórico do que foi feito em /management
CREATE TABLE IF NOT EXISTS audit_log (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor      VARCHAR(32)  NOT NULL,
  action     VARCHAR(40)  NOT NULL,
  target     VARCHAR(64)  NOT NULL DEFAULT '',
  detail     VARCHAR(300) NOT NULL DEFAULT '',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Quem pode ter perfil público. Linhas que já existiam ficam liberadas (DEFAULT 1);
-- contas novas entram com 0 e dependem do pedido aprovado em /management
ALTER TABLE users ADD COLUMN whitelisted TINYINT NOT NULL DEFAULT 1;

-- Pedidos de whitelist: o @usuário desejado e a decisão da gestão (status: pending, approved, rejected)
CREATE TABLE IF NOT EXISTS whitelist_requests (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  username    VARCHAR(32)  NOT NULL,
  message     VARCHAR(300) NOT NULL DEFAULT '',
  status      VARCHAR(10)  NOT NULL DEFAULT 'pending',
  reason      VARCHAR(300) NOT NULL DEFAULT '',
  reviewed_by VARCHAR(32)  NOT NULL DEFAULT '',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME     NULL,
  INDEX idx_whitelist_status (status, created_at),
  INDEX idx_whitelist_user (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
