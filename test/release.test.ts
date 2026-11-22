import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { runRelease } from '../src/release.ts';
import { verifyZip } from '../src/verify.ts';
import { getRelease, listReleases, openDb } from '../src/db.ts';
import { startServer } from '../src/serve.ts';

let tmp: string;
let repo: string;
let db: string;
let out: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'shipnote-'));
  repo = join(tmp, 'repo');
  db = join(tmp, 't.db');
  out = join(tmp, 'out');
  execFileSync('node', ['scripts/make-sample-repo.mjs', repo], { stdio: 'pipe' });
}, 120_000);

// Windows에서 git 객체 파일이 읽기 전용이라 지우기가 실패할 수 있다. 임시 폴더라 무시한다.
afterAll(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {}
});

describe('릴리스 파이프라인(샘플 저장소 100건 이상)', () => {
  it('첫 릴리스는 처음부터, 다음 릴리스는 직전 태그부터 읽는다', async () => {
    const a = await runRelease({ tag: 'v0.1.0', repo, out, db });
    const b = await runRelease({ tag: 'v0.2.0', repo, out, db });
    expect(a.prev).toBeNull();
    expect(b.prev).toBe('v0.1.0');
    expect(a.commits + b.commits).toBeGreaterThanOrEqual(100);
  }, 60_000);

  it('분류 결과가 DB에 들어간다(기타·호환 불가 포함)', () => {
    const d = openDb(db);
    const r = getRelease(d, 'v0.2.0')!;
    d.close();
    const types = new Set((r.changes as { type: string }[]).map((c) => c.type));
    expect(types.has('기타')).toBe(true);
    expect((r.changes as { breaking: number }[]).some((c) => c.breaking === 1)).toBe(true);
    expect(r.artifacts).toHaveLength(3);
  });

  it('생성된 zip이 verify를 통과하고 한 바이트 바꾸면 실패한다', () => {
    const p = join(out, 'shipnote-v0.2.0.zip');
    expect(verifyZip(readFileSync(p)).ok).toBe(true);
    // 본문 변조는 pack-verify 테스트가 다룬다. 여기서는 잘린 zip이 실패하는지만 본다.
    expect(verifyZip(readFileSync(p).subarray(0, 200)).ok).toBe(false);
  });

  it('같은 태그는 --force 없이는 거부한다', async () => {
    await expect(runRelease({ tag: 'v0.2.0', repo, out, db })).rejects.toThrow('이미 있는 릴리스');
    await expect(runRelease({ tag: 'v0.2.0', repo, out, db, force: true })).resolves.toBeTruthy();
  }, 30_000);

  it('없는 태그와 잘못된 태그 이름을 거부한다', async () => {
    await expect(runRelease({ tag: 'v9', repo, out, db })).rejects.toThrow('태그가 없습니다');
    await expect(runRelease({ tag: '--output=x', repo, out, db })).rejects.toThrow('올바르지 않습니다');
  });
});

describe('API 서버', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    const web = join(tmp, 'web');
    execFileSync('node', ['-e', `require('fs').mkdirSync(${JSON.stringify(web)},{recursive:true})`]);
    writeFileSync(join(web, 'index.html'), '<h1>ok</h1>');
    server = await startServer({ db, port: 0, web });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => server.close());

  it('목록·상세·검증을 돌려준다', async () => {
    const list = (await (await fetch(`${base}/api/releases`)).json()) as { tag: string }[];
    expect(list.map((r) => r.tag).sort()).toEqual(['v0.1.0', 'v0.2.0']);
    expect((await fetch(`${base}/api/releases/v0.2.0`)).status).toBe(200);
    const v = (await (await fetch(`${base}/api/releases/v0.2.0/verify`)).json()) as { ok: boolean };
    expect(v.ok).toBe(true);
    expect((await fetch(`${base}/api/releases/nope`)).status).toBe(404);
  });

  it('zip이 변조되면 verify API가 실패를 알린다', async () => {
    const d = openDb(db);
    const zipPath = listReleases(d).find((r) => r.tag === 'v0.1.0')!.zip_path;
    d.close();
    const bytes = readFileSync(zipPath);
    writeFileSync(zipPath, Buffer.concat([bytes, Buffer.from('x')]));
    const v = (await (await fetch(`${base}/api/releases/v0.1.0/verify`)).json()) as { ok: boolean };
    expect(v.ok).toBe(false);
  });

  it('웹 루트 밖 경로를 막는다', async () => {
    const r = await fetch(`${base}/..%2f..%2fpackage.json`);
    expect(await r.text()).not.toContain('"name": "shipnote"');
  });
});
