import type { FastifyBaseLogger } from 'fastify';
import { env } from './env.js';

const API = 'https://discord.com/api/v10';
const GREEN = 0x22c55e;
const RED = 0xef4444;

export type DmResult = 'enviada' | 'falhou' | 'indisponivel';

interface Embed {
  title: string;
  description: string;
  color: number;
  url?: string;
}

async function discord<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Discord ${path}: ${res.status} ${await res.text().catch(() => '')}`);
  return (await res.json()) as T;
}

/**
 * Manda uma DM pelo bot. Usa a API REST, então não depende do gateway estar conectado.
 * Falha (DM fechada, bot fora do servidor) nunca derruba a ação da gestão: só devolve o resultado.
 */
async function sendDm(discordId: string, embed: Embed, log: FastifyBaseLogger): Promise<DmResult> {
  // Conta do atalho de desenvolvimento não existe no Discord
  if (!env.DISCORD_BOT_TOKEN || discordId.startsWith('dev:')) return 'indisponivel';
  try {
    const channel = await discord<{ id: string }>('/users/@me/channels', { recipient_id: discordId });
    await discord(`/channels/${channel.id}/messages`, { embeds: [{ ...embed, timestamp: new Date().toISOString() }] });
    return 'enviada';
  } catch (err) {
    log.warn(err, 'não foi possível enviar a DM de whitelist');
    return 'falhou';
  }
}

export function dmWhitelistApproved(discordId: string, username: string, log: FastifyBaseLogger) {
  const url = `${env.WEB_URL}/${username}`;
  return sendDm(
    discordId,
    {
      title: '✅ Whitelist aprovada',
      description: `Seu pedido foi aprovado! Seu link na Avenue já está no ar:\n**${url}**\n\nEdite seu perfil pelo painel quando quiser.`,
      color: GREEN,
      url,
    },
    log,
  );
}

export function dmWhitelistRejected(discordId: string, reason: string, log: FastifyBaseLogger) {
  return sendDm(
    discordId,
    {
      title: '❌ Whitelist recusada',
      description: [
        'Seu pedido de whitelist não foi aprovado desta vez.',
        reason ? `**Motivo:** ${reason}` : '',
        `Você pode ajustar e pedir de novo pelo painel: ${env.WEB_URL}/painel`,
      ]
        .filter(Boolean)
        .join('\n\n'),
      color: RED,
    },
    log,
  );
}
