import { DatabaseSync } from 'node:sqlite';
import type { Change } from './classify.ts';
import type { Artifact } from './pack.ts';

export type ReleaseRow = {
  id: number;
  tag: string;
  prev_tag: string | null;
  tag_date: string; // 태그가 가리키는 커밋의 날짜
  created_at: string; // 이 도구가 릴리스를 만든 시각
  zip_path: string;
  zip_sha256: string;
  key_id: string | null; // 서명한 키 ID. 서명하지 않았으면 null
};

const SCHEMA_VERSION = 1;

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS releases (
      id INTEGER PRIMARY KEY, tag TEXT UNIQUE NOT NULL, prev_tag TEXT,
      tag_date TEXT NOT NULL, created_at TEXT NOT NULL,
      zip_path TEXT NOT NULL, zip_sha256 TEXT NOT NULL, key_id TEXT);
    CREATE TABLE IF NOT EXISTS changes (
      id INTEGER PRIMARY KEY, release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
      type TEXT NOT NULL, scope TEXT NOT NULL, subject TEXT NOT NULL,
      hash TEXT NOT NULL, author TEXT NOT NULL, breaking INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS artifacts (
      id INTEGER PRIMARY KEY, release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
      name TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL);
  `);
  migrate(db);
  return db;
}

// 0.1.0의 DB에는 tag_date·key_id가 없고 created_at에 태그 날짜가 들어 있었다.
function migrate(db: DatabaseSync): void {
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (user_version >= SCHEMA_VERSION) return;
  const cols = new Set((db.prepare('PRAGMA table_info(releases)').all() as { name: string }[]).map((c) => c.name));
  db.exec('BEGIN');
  try {
    if (!cols.has('tag_date')) {
      db.exec('ALTER TABLE releases ADD COLUMN tag_date TEXT');
      db.exec('UPDATE releases SET tag_date = created_at');
    }
    if (!cols.has('key_id')) db.exec('ALTER TABLE releases ADD COLUMN key_id TEXT');
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export type SaveInput = {
  tag: string;
  prev: string | null;
  tagDate: string;
  createdAt: string;
  zipPath: string;
  zipSha: string;
  keyId?: string;
  changes: Change[];
  artifacts: Artifact[];
};

export function releaseExists(db: DatabaseSync, tag: string): boolean {
  return db.prepare('SELECT 1 FROM releases WHERE tag = ?').get(tag) !== undefined;
}

// 한 트랜잭션으로 저장한다. 같은 태그가 있으면 force일 때만 교체한다.
export function saveRelease(db: DatabaseSync, r: SaveInput, force = false): void {
  const old = db.prepare('SELECT id FROM releases WHERE tag = ?').get(r.tag) as { id: number } | undefined;
  if (old && !force) throw new Error(`이미 있는 릴리스입니다: ${r.tag} (--force로 교체)`);
  db.exec('BEGIN');
  try {
    if (old) db.prepare('DELETE FROM releases WHERE id = ?').run(old.id);
    const id = Number(
      db
        .prepare(
          'INSERT INTO releases (tag, prev_tag, tag_date, created_at, zip_path, zip_sha256, key_id) VALUES (?,?,?,?,?,?,?)',
        )
        .run(r.tag, r.prev, r.tagDate, r.createdAt, r.zipPath, r.zipSha, r.keyId ?? null).lastInsertRowid,
    );
    const ch = db.prepare(
      'INSERT INTO changes (release_id, type, scope, subject, hash, author, breaking) VALUES (?,?,?,?,?,?,?)',
    );
    for (const c of r.changes) ch.run(id, c.type, c.scope, c.subject, c.hash, c.author, c.breaking ? 1 : 0);
    const ar = db.prepare('INSERT INTO artifacts (release_id, name, sha256, bytes) VALUES (?,?,?,?)');
    for (const a of r.artifacts) ar.run(id, a.name, a.sha256, a.bytes);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function listReleases(db: DatabaseSync) {
  return db
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM changes c WHERE c.release_id = r.id) AS change_count
       FROM releases r ORDER BY r.tag_date DESC, r.id DESC`,
    )
    .all() as (ReleaseRow & { change_count: number })[];
}

export function getRelease(db: DatabaseSync, tag: string) {
  const release = db.prepare('SELECT * FROM releases WHERE tag = ?').get(tag) as ReleaseRow | undefined;
  if (!release) return null;
  const changes = db
    .prepare('SELECT type, scope, subject, hash, author, breaking FROM changes WHERE release_id = ? ORDER BY id')
    .all(release.id);
  const artifacts = db.prepare('SELECT name, sha256, bytes FROM artifacts WHERE release_id = ? ORDER BY id').all(release.id);
  return { release, changes, artifacts };
}
