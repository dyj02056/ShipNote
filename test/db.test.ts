import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listReleases, openDb } from '../src/db.ts';

describe('DB 마이그레이션', () => {
  it('0.1.0 형식 DB에 tag_date·key_id를 추가하고 기존 날짜를 옮긴다', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'shipnote-db-')), 'old.db');
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE releases (id INTEGER PRIMARY KEY, tag TEXT UNIQUE NOT NULL, prev_tag TEXT,
        created_at TEXT NOT NULL, zip_path TEXT NOT NULL, zip_sha256 TEXT NOT NULL);
      INSERT INTO releases (tag, prev_tag, created_at, zip_path, zip_sha256)
        VALUES ('v1', NULL, '2025-01-02T00:00:00Z', '/x.zip', 'ab');`);
    old.close();

    const db = openDb(path);
    const [r] = listReleases(db);
    expect(r).toMatchObject({ tag: 'v1', tag_date: '2025-01-02T00:00:00Z', key_id: null });
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1);
    db.close();
    // 두 번 열어도 문제없다
    openDb(path).close();
  });
});
