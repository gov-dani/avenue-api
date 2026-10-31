import { z } from 'zod';

export const RESERVED_USERNAMES = new Set([
  'api', 'admin', 'login', 'registro', 'painel', 'membros', 'entrar', 'sair',
  'sobre', 'termos', 'privacidade', 'cookies', 'lgpd', 'contato', 'ajuda', 'static', 'assets', '_next', 'favicon',
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

export const memberRoleSchema = z.object({
  role: z.enum(['visitante', 'membro', 'equipe', 'lider', 'fundador']),
});

export const membersQuerySchema = z.object({
  q: z.string().trim().max(40).optional(),
  role: z.enum(['membro', 'equipe', 'lider', 'fundador']).optional(),
});

export const grantsSchema = z.object({
  badges: z.array(z.enum(['girls', 'parceiro', 'vip', 'campeao'])).max(4),
});
