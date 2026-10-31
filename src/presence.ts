import { ActivityType, Client, GatewayIntentBits, type Presence } from 'discord.js';
import type { FastifyBaseLogger } from 'fastify';
import { env } from './env.js';
import { fetchLanyard, type Activity } from './discord.js';

/**
 * Presença própria: um bot dentro do servidor da Avenue recebe, em tempo real,
 * o que cada membro está jogando/ouvindo. Sem bot configurado, cai no Lanyard.
 */
export const botConfigured = Boolean(env.DISCORD_BOT_TOKEN && env.DISCORD_GUILD_ID);

// Vários servidores aceitos, separados por vírgula em DISCORD_GUILD_ID
const guildIds = (env.DISCORD_GUILD_ID ?? '').split(',').map((id) => id.trim()).filter(Boolean);

let client: Client | null = null;
let ready = false;

// Quem não tem presença guardada pode estar offline ou fora do servidor: lembramos a resposta
const membership = new Map<string, { at: number; inGuild: boolean }>();
const MEMBERSHIP_MS = 60_000;

const STATUS = new Set(['online', 'idle', 'dnd']);

function toActivity(p: Presence): Activity {
  const status = STATUS.has(p.status) ? (p.status as 'online' | 'idle' | 'dnd') : 'offline';
  const out: Activity = { monitored: true, source: 'bot', status };

  for (const a of p.activities) {
    if (a.type === ActivityType.Custom) {
      if (a.state || a.emoji?.name) out.custom = { text: a.state ?? '', emoji: a.emoji?.name ?? '' };
    } else if (a.type === ActivityType.Listening && a.name === 'Spotify') {
      const image = a.assets?.largeImage?.replace('spotify:', '');
      out.spotify = {
        song: a.details ?? '',
        artist: (a.state ?? '').replaceAll(';', ','),
        album: a.assets?.largeText ?? '',
        art: image ? `https://i.scdn.co/image/${image}` : '',
      };
    } else if (a.type === ActivityType.Playing && !out.game) {
      out.game = {
        name: a.name,
        details: a.details ?? '',
        state: a.state ?? '',
        since: a.timestamps?.start ? a.timestamps.start.getTime() : null,
        image: a.assets?.largeImageURL({ size: 128 }) ?? '',
      };
    }
  }
  return out;
}

export function startPresenceBot(log: FastifyBaseLogger) {
  if (!botConfigured) {
    log.info('Bot de presença desligado (sem DISCORD_BOT_TOKEN/DISCORD_GUILD_ID): usando Lanyard');
    return;
  }

  // Só precisa de Guilds e GuildPresences (esta última é "privileged": ativar no portal)
  // Invisível: aparece offline no Discord, mas continua recebendo a presença dos membros
  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildPresences],
    presence: { status: 'invisible' },
  });
  client.on('error', (err) => log.error(err, 'bot de presença'));
  client.once('clientReady', (c) => {
    ready = true;
    log.info(`Bot de presença conectado como ${c.user.tag}`);
  });
  client.login(env.DISCORD_BOT_TOKEN).catch((err) => {
    client = null;
    log.error(err, 'Bot de presença não conectou (token inválido ou Presence Intent desligado?)');
  });
}

async function isInGuild(discordId: string): Promise<boolean> {
  const hit = membership.get(discordId);
  if (hit && Date.now() - hit.at < MEMBERSHIP_MS) return hit.inGuild;

  let inGuild = false;
  for (const id of guildIds) {
    const guild = client!.guilds.cache.get(id);
    if (guild && (await guild.members.fetch(discordId).catch(() => null))) {
      inGuild = true;
      break;
    }
  }
  membership.set(discordId, { at: Date.now(), inGuild });
  return inGuild;
}

export async function fetchActivity(discordId: string): Promise<Activity> {
  if (!client || !ready) return fetchLanyard(discordId);

  for (const id of guildIds) {
    const presence = client.guilds.cache.get(id)?.presences.cache.get(discordId);
    if (presence) return toActivity(presence);
  }

  // Sem presença guardada: ou está offline, ou nem está no servidor
  if (await isInGuild(discordId)) return { monitored: true, source: 'bot', status: 'offline' };
  return { monitored: false, source: 'bot' };
}
