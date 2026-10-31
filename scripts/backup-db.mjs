// Backup do MySQL: gera data/backups/avenue-AAAA-MM-DD-HHMM.sql.gz e apaga os mais antigos.
// Uso: node --env-file=.env scripts/backup-db.mjs   (agende no cron da VPS, ex.: 0 4 * * *)
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const dir = process.env.BACKUP_DIR ?? './data/backups';
const keep = Number(process.env.BACKUP_KEEP ?? 14);
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const file = join(dir, `avenue-${stamp}.sql.gz`);

await mkdir(dir, { recursive: true });

const dump = spawn(
  'mysqldump',
  [
    '--single-transaction',
    '--routines',
    `--host=${process.env.DB_HOST ?? '127.0.0.1'}`,
    `--port=${process.env.DB_PORT ?? 3306}`,
    `--user=${process.env.DB_USER ?? 'root'}`,
    process.env.DB_NAME ?? 'avenue',
  ],
  // A senha vai por variável de ambiente para não aparecer na lista de processos
  { env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD ?? '' }, stdio: ['ignore', 'pipe', 'inherit'] },
);
const exited = new Promise((resolve, reject) => {
  dump.on('error', reject);
  dump.on('close', resolve);
});

try {
  await pipeline(dump.stdout, createGzip(), createWriteStream(file));
  if ((await exited) !== 0) throw new Error('mysqldump terminou com erro');
} catch (err) {
  await rm(file, { force: true });
  console.error('Backup falhou:', err.message);
  process.exit(1);
}

const old = (await readdir(dir)).filter((f) => /^avenue-.*\.sql\.gz$/.test(f)).sort().slice(0, -keep);
await Promise.all(old.map((f) => rm(join(dir, f))));
console.log(`Backup salvo em ${file} (${old.length} antigo(s) removido(s))`);
