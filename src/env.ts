import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(4000),
    HOST: z.string().default('0.0.0.0'),
    JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me'),
    WEB_ORIGIN: z.string().default('http://localhost:3000'),
    // URL pública do site (para onde o usuário volta depois do login)
    WEB_URL: z.string().default('http://localhost:3000'),
    // MySQL (crie o banco antes, ex.: pelo HeidiSQL, com utf8mb4_unicode_ci)
    DB_HOST: z.string().default('127.0.0.1'),
    DB_PORT: z.coerce.number().default(3306),
    DB_USER: z.string().default('root'),
    DB_PASSWORD: z.string().default(''),
    DB_NAME: z.string().default('avenue'),
    // Onde ficam banners, fotos e músicas enviados pelos usuários
    // Backups do banco (.sql), um por dia; BACKUP_KEEP é quantos ficam guardados
    BACKUP_DIR: z.string().default('./data/backups'),
    // Caminho do mysqldump quando ele não está no PATH (comum no Windows)
    MYSQLDUMP_PATH: z.string().default('mysqldump'),
    BACKUP_KEEP: z.coerce.number().int().min(1).default(14),
    // Chave do Fivemanage (https://fivemanage.com): quando definida, as imagens enviadas vão para lá
    FIVEMANAGE_API_KEY: z.string().optional(),
    // Chave da HenrikDev (https://api.henrikdev.xyz/dashboard): puxa o rank do Valorant. Sem ela o perfil mostra só o Riot ID e o link do tracker.gg
    HENRIK_API_KEY: z.string().optional(),
    UPLOAD_DIR: z.string().default('./data/uploads'),
    // Aplicativo OAuth2 criado em https://discord.com/developers/applications
    DISCORD_CLIENT_ID: z.string().optional(),
    DISCORD_CLIENT_SECRET: z.string().optional(),
    // Precisa estar cadastrada em OAuth2 > Redirects, idêntica a esta
    DISCORD_REDIRECT_URI: z.string().default('http://localhost:3000/api/auth/discord/callback'),
    // Bot que lê a presença (jogo atual) dos membros do servidor. Opcional: sem ele usa o Lanyard
    DISCORD_BOT_TOKEN: z.string().optional(),
    DISCORD_GUILD_ID: z.string().optional(),
  })
  .refine((e) => e.NODE_ENV !== 'production' || e.JWT_SECRET !== 'dev-only-secret-change-me', {
    message: 'JWT_SECRET precisa ser definido em produção',
    path: ['JWT_SECRET'],
  })
  .refine((e) => e.NODE_ENV !== 'production' || (e.DISCORD_CLIENT_ID && e.DISCORD_CLIENT_SECRET), {
    message: 'DISCORD_CLIENT_ID e DISCORD_CLIENT_SECRET são obrigatórios em produção',
    path: ['DISCORD_CLIENT_ID'],
  });

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === 'production';
