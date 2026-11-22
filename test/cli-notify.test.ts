import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pack } from '../src/pack.ts';
import { notify } from '../src/notify.ts';

const cli = (...args: string[]) =>
  spawnSync(process.execPath, ['src/cli.ts', ...args], { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });

describe('CLI 종료 코드', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'shipnote-cli-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('인자 없이 실행하면 도움말과 0, 모르는 명령은 1', () => {
    const a = cli();
    expect(a.status).toBe(0);
    expect(a.stdout).toContain('사용법');
    expect(cli('nope').status).toBe(1);
    expect(cli('--help').status).toBe(0);
  });

  it('verify는 통과하면 0, 실패하면 1', () => {
    const k = cli('keygen', '--out', join(dir, 'k.key'));
    expect(k.status).toBe(0);
    const good = join(dir, 'good.zip');
    writeFileSync(good, pack('v1', { 'A.md': 'a' }).zip);
    const ok = cli('verify', good);
    expect(ok.status).toBe(0);
    expect(ok.stderr).toContain('서명이 없는 패키지');
    const bad = cli('verify', good, '--pubkey', join(dir, 'k.pub'));
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('manifest.sig(서명)가 없습니다');
    expect(cli('verify', good, '--sha256', '0'.repeat(64)).status).toBe(1);
  });

  it('없는 파일이나 잘못된 포트는 오류 메시지와 1', () => {
    const r = cli('verify', join(dir, 'none.zip'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('오류:');
    expect(cli('serve', '--port', 'abc').status).toBe(1);
  });
});

describe('웹훅', () => {
  let server: Server;
  let base: string;
  const got: unknown[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.url === '/ok') {
          got.push(JSON.parse(body));
          res.writeHead(204).end();
        } else if (req.url === '/fail') res.writeHead(500).end();
        // /slow는 응답하지 않는다
      });
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it('성공하면 true와 함께 JSON을 보낸다', async () => {
    expect(await notify(`${base}/ok`, { tag: 'v1' })).toBe(true);
    expect(got).toEqual([{ tag: 'v1' }]);
  });

  it('오류 응답, 시간 초과, http(s)가 아닌 주소는 false', async () => {
    expect(await notify(`${base}/fail`, {})).toBe(false);
    expect(await notify(`${base}/slow`, {}, 200)).toBe(false);
    expect(await notify('file:///etc/passwd', {})).toBe(false);
    expect(await notify('not a url', {})).toBe(false);
  });
});
