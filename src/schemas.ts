import { z } from 'zod';

export const RESERVED_USERNAMES = new Set([
  'api', 'admin', 'login', 'registro', 'painel', 'membros', 'entrar', 'sair',
  'management', 'sobre', 'termos', 'privacidade', 'cookies', 'lgpd', 'contato', 'ajuda', 'static', 'assets', '_next', 'favicon',
]);

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^https?:\/\//i, 'A URL precisa começar com http:// ou https://');

// Link externo ou arquivo enviado para o nosso próprio /media
const mediaUrl = z.union([
  httpUrl,
  z.string().regex(/^\/api\/media\/[a-f0-9]{32}\.(png|jpg|gif|webp|mp3|ogg|wav|m4a)$/),
  z.literal(''),
]);

// Decoração do avatar: uma das prontas (/decorations no site) ou um arquivo enviado
const decorationUrl = z.union([
  z.string().regex(/^\/decorations\/[a-z0-9-]+\.(gif|png|webp)$/),
  z.string().regex(/^\/api\/media\/[a-f0-9]{32}\.(png|gif|webp)$/),
  z.literal(''),
]);

export const profileSchema = z.object({
  displayName: z.string().trim().min(1, 'Informe um nome').max(40),
  bio: z.string().trim().max(280),
  avatarUrl: mediaUrl,
  bannerUrl: mediaUrl,
  musicUrl: mediaUrl,
  musicTitle: z.string().trim().max(60),
  avatarDecoration: decorationUrl,
  syncAvatar: z.boolean(),
  syncBanner: z.boolean(),
  syncName: z.boolean(),
  showActivity: z.boolean(),
  discord: z.string().trim().max(120),
  links: z
    .array(z.object({ label: z.string().trim().min(1).max(40), url: httpUrl }))
    .max(12),
  games: z
    .array(z.object({ name: z.string().trim().min(1).max(60), detail: z.string().trim().max(60) }))
    .max(12),
  gear: z
    .array(z.object({ category: z.string().trim().min(1).max(30), name: z.string().trim().min(1).max(80) }))
    .max(16),
});

export const membersQuerySchema = z.object({
  q: z.string().trim().max(40).optional(),
  role: z.enum(['membro', 'equipe', 'lider', 'fundador']).optional(),
});

// Quais badges existem é decidido na rota (as de fábrica + as criadas em /management)
export const grantsSchema = z.object({
  badges: z.array(z.string().max(20)).max(60),
});

export const BADGE_ICONS = [
  'star', 'heart', 'crown', 'bolt', 'shield', 'flame', 'gem', 'trophy', 'code',
  'music', 'gamepad', 'rocket', 'skull', 'moon', 'sun', 'check', 'camera', 'mic',
] as const;

export const badgeDefSchema = z.object({
  label: z.string().trim().min(1, 'Informe o nome da badge').max(40),
  desc: z.string().trim().max(120),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida'),
  // Um dos ícones prontos ou "pacote:nome" de um ícone do allsvgicons.com
  icon: z.union([z.enum(BADGE_ICONS), z.string().regex(/^[a-z0-9-]{1,20}:[a-z0-9-]{1,26}$/)]),
});

export const adminUserSchema = z.object({
  role: z.enum(['visitante', 'membro', 'equipe', 'lider', 'fundador']).optional(),
  username: z.string().regex(/^[a-zA-Z0-9_]{3,32}$/, 'Use de 3 a 32 letras, números ou _').optional(),
  views: z.number().int().min(0).max(1_000_000_000).optional(),
});

const usernameField = z.string().regex(/^[a-zA-Z0-9_]{3,32}$/, 'Use de 3 a 32 letras, números ou _');

export const whitelistRequestSchema = z.object({
  username: usernameField,
  message: z.string().trim().max(300),
});

export const whitelistReviewSchema = z.object({
  // Na aprovação a gestão pode ajustar o @ pedido; na recusa, explicar o motivo
  username: usernameField.optional(),
  reason: z.string().trim().max(300).optional(),
});
