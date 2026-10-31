import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backupPath } from '../src/backup.ts';

test('só aceita nomes de backup gerados pela API', () => {
  assert.ok(backupPath('avenue-20261031-0400.sql'));
  for (const bad of ['../.env', '..%2Fx.sql','avenue-20261031-0400.sql/../../x', 'avenue.sql', '/etc/passwd', 'avenue-20261031-0400.sql.gz']) {
    assert.equal(backupPath(bad), null, bad);
  }
});
