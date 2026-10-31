import { readFileSync } from 'node:fs';
import mysql, { type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { env } from './env.js';

export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  charset: 'utf8mb4',
  connectionLimit: 10,
  // Datas como texto "YYYY-MM-DD HH:MM:SS" (UTC), o mesmo formato de antes
  dateStrings: true,
  // Sem FOUND_ROWS, affectedRows conta só as linhas que realmente mudaram
  flags: ['-FOUND_ROWS'],
});

pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  return rows as unknown as T[];
}

export async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await query<T>(sql, params))[0];
}

export async function run(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [res] = await pool.query<ResultSetHeader>(sql, params);
  return res;
}

export type Run = typeof run;

/** Várias escritas que valem juntas: se uma falhar, nenhuma fica. */
export async function transaction<T>(fn: (run: Run) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(async (sql, params = []) => (await conn.query<ResultSetHeader>(sql, params))[0]);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// As tabelas vivem em schema.sql (uma só fonte); aqui roda a parte depois de "@tables".
const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').split('-- @tables')[1] ?? '';
const statements = schema
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

for (const sql of statements) {
  try {
    await run(sql);
  } catch (err) {
    // 1060 = coluna já existe, 1061 = índice já existe: o ALTER de uma migração antiga que já foi aplicada
    const errno = (err as { errno?: number }).errno;
    if (errno !== 1060 && errno !== 1061) throw err;
  }
}
