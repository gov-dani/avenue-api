import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyBaseLogger } from 'fastify';
import { env } from './env.js';

const DAY = 24 * 60 * 60 * 1000;
export const BACKUP_NAME = /^avenue-\d{8}-\d{4}\.sql$/;

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
}

export async function listBackups(): Promise<BackupInfo[]> {
  await mkdir(env.BACKUP_DIR, { recursive: true });
  const names = (await readdir(env.BACKUP_DIR)).filter((n) => BACKUP_NAME.test(n));
  const out = await Promise.all(
    names.map(async (name) => {
      const info = await stat(join(env.BACKUP_DIR, name));
      return { name, size: info.size, createdAt: info.mtime.toISOString() };
    }),
  );
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

export const backupPath = (name: string) => (BACKUP_NAME.test(name) ? join(env.BACKUP_DIR, name) : null);

let running: Promise<BackupInfo> | null = null;

/** Gera um .sql com mysqldump e apaga os mais antigos. Só roda um por vez. */
export function runBackup(): Promise<BackupInfo> {
  running ??= doBackup().finally(() => {
    running = null;
  });
  return running;
}

async function doBackup(): Promise<BackupInfo> {
  await mkdir(env.BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const name = `avenue-${stamp}.sql`;
  const file = join(env.BACKUP_DIR, name);

  const dump = spawn(
    'mysqldump',
    [
      '--single-transaction',
      '--routines',
      `--host=${env.DB_HOST}`,
      `--port=${env.DB_PORT}`,
      `--user=${env.DB_USER}`,
      env.DB_NAME,
    ],
    // A senha vai por variável de ambiente para não aparecer na lista de processos
    { env: { ...process.env, MYSQL_PWD: env.DB_PASSWORD }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  dump.stderr.on('data', (c) => (stderr += c));
  const exited = new Promise<number | null>((resolve, reject) => {
    dump.on('error', reject);
    dump.on('close', resolve);
  });

  try {
    await pipeline(dump.stdout, createWriteStream(file));
    if ((await exited) !== 0) throw new Error(stderr.trim() || 'mysqldump terminou com erro');
  } catch (err) {
    await rm(file, { force: true });
    throw err;
  }

  const old = (await listBackups()).slice(env.BACKUP_KEEP);
  await Promise.all(old.map((b) => rm(join(env.BACKUP_DIR, b.name), { force: true })));

  const info = await stat(file);
  return { name, size: info.size, createdAt: info.mtime.toISOString() };
}

/** Faz um backup a cada 24 h. Olha o mais recente em vez de contar o tempo desde o boot, então reiniciar a API não repete nem pula. */
export function startBackupSchedule(log: FastifyBaseLogger) {
  const tick = async () => {
    try {
      const latest = (await listBackups())[0];
      if (latest && Date.now() - Date.parse(latest.createdAt) < DAY) return;
      const made = await runBackup();
      log.info(`backup do banco salvo: ${made.name}`);
    } catch (err) {
      log.error(err, 'falha no backup do banco');
    }
  };
  void tick();
  setInterval(tick, 60 * 60 * 1000).unref();
}
