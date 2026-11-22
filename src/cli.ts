#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runRelease } from './release.ts';
import { LIMITS, verifyZip } from './verify.ts';
import { listReleases, openDb } from './db.ts';
import { startServer } from './serve.ts';
import { keygen, readKey } from './sign.ts';

const HELP = `shipnote — Git 이력에서 릴리스 문서를 만듭니다

사용법
  shipnote release <태그> [--repo .] [--out out] [--db shipnote.db] [--from 직전태그] [--key 비밀키] [--webhook URL] [--force]
  shipnote verify <zip> [--pubkey 공개키] [--sha256 기대해시]
  shipnote keygen [--out shipnote.key] [--force]
  shipnote ls [--db shipnote.db]
  shipnote serve [--db shipnote.db] [--port 4173] [--web 화면폴더] [--host 127.0.0.1] [--pubkey 공개키]`;

const { values: v, positionals: p } = parseArgs({
  allowPositionals: true,
  options: {
    repo: { type: 'string', default: '.' },
    out: { type: 'string' },
    db: { type: 'string', default: 'shipnote.db' },
    from: { type: 'string' },
    webhook: { type: 'string' },
    force: { type: 'boolean', default: false },
    key: { type: 'string' },
    pubkey: { type: 'string' },
    sha256: { type: 'string' },
    port: { type: 'string', default: '4173' },
    // src/cli.ts와 dist/cli.js 모두 패키지 루트 한 단계 아래에 있다. 설치본에서도 화면을 찾게 한다.
    web: { type: 'string', default: fileURLToPath(new URL('../web/dist', import.meta.url)) },
    host: { type: 'string', default: '127.0.0.1' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

async function main(): Promise<number> {
  const [cmd, arg] = p;
  if (v.help) {
    console.log(HELP);
    return 0;
  }
  if (cmd === 'release' && arg) {
    const r = await runRelease({
      tag: arg,
      repo: v.repo,
      out: v.out ?? 'out',
      db: v.db,
      from: v.from,
      webhook: v.webhook,
      force: v.force,
      key: v.key,
    });
    console.log(`릴리스 ${arg} 생성: 커밋 ${r.commits}건 (${r.prev ?? '처음'} → ${arg})`);
    console.log(`패키지: ${r.zipPath}`);
    console.log(`zip SHA-256: ${r.zipSha}`);
    console.log(r.keyId ? `서명: 키 ${r.keyId}` : '서명: 없음 (--key로 서명하면 받는 쪽이 변조를 확인할 수 있습니다)');
    for (const a of r.artifacts) console.log(`  ${a.sha256}  ${a.name}`);
    return 0;
  }
  if (cmd === 'verify' && arg) {
    const size = statSync(arg).size;
    if (size > LIMITS.zipBytes) throw new Error(`zip이 너무 큽니다 (${size}바이트)`);
    const r = verifyZip(readFileSync(arg), { pubkey: v.pubkey ? readKey(v.pubkey) : undefined, sha256: v.sha256 });
    for (const w of r.warnings) console.warn(`경고: ${w}`);
    if (r.ok) {
      const sig = r.signature === 'valid' ? `, 서명 확인(키 ${r.keyId ?? '?'})` : '';
      console.log(`통과: ${r.tag} 파일 ${r.checked}개가 모두 일치합니다${sig}`);
    } else {
      console.error(`실패: ${arg}`);
      for (const x of r.problems) console.error(`  - ${x}`);
    }
    return r.ok ? 0 : 1;
  }
  if (cmd === 'keygen') {
    const k = keygen(v.out ?? 'shipnote.key', v.force);
    console.log(`비밀키: ${k.keyPath} (외부에 내보내지 마세요)`);
    console.log(`공개키: ${k.pubPath} (받는 쪽에 전달)`);
    console.log(`키 ID: ${k.keyId}`);
    return 0;
  }
  if (cmd === 'ls') {
    const db = openDb(v.db);
    const rows = listReleases(db);
    db.close();
    if (!rows.length) console.log('아직 릴리스가 없습니다. shipnote release <태그>를 실행하세요.');
    for (const r of rows) console.log(`${r.tag}\t${r.created_at.slice(0, 10)}\t커밋 ${r.change_count}건`);
    return 0;
  }
  if (cmd === 'serve') {
    const port = Number(v.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port가 올바르지 않습니다');
    if (!LOOPBACK.has(v.host)) {
      console.warn(`경고: ${v.host}에 공개합니다. API에 인증이 없어 같은 네트워크의 누구나 이력과 zip을 볼 수 있습니다.`);
    }
    await startServer({ db: v.db, port, web: v.web, host: v.host, pubkey: v.pubkey ? readKey(v.pubkey) : undefined });
    console.log(`http://${v.host.includes(':') ? `[${v.host}]` : v.host}:${port} 에서 이력 화면을 서빙합니다`);
    return -1; // 서버가 프로세스를 유지한다
  }
  console.log(HELP);
  return cmd ? 1 : 0;
}

main().then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (e: Error) => {
    console.error(`오류: ${e.message}`);
    process.exitCode = 1;
  },
);
