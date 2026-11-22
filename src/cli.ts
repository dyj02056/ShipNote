#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { runRelease } from './release.ts';
import { verifyZip } from './verify.ts';
import { listReleases, openDb } from './db.ts';
import { startServer } from './serve.ts';

const HELP = `shipnote — Git 이력에서 릴리스 문서를 만듭니다

사용법
  shipnote release <태그> [--repo .] [--out out] [--db shipnote.db] [--from 직전태그] [--webhook URL] [--force]
  shipnote verify <zip>
  shipnote ls [--db shipnote.db]
  shipnote serve [--db shipnote.db] [--port 4173] [--web web/dist] [--host 127.0.0.1]`;

const { values: v, positionals: p } = parseArgs({
  allowPositionals: true,
  options: {
    repo: { type: 'string', default: '.' },
    out: { type: 'string', default: 'out' },
    db: { type: 'string', default: 'shipnote.db' },
    from: { type: 'string' },
    webhook: { type: 'string' },
    force: { type: 'boolean', default: false },
    port: { type: 'string', default: '4173' },
    web: { type: 'string', default: 'web/dist' },
    host: { type: 'string', default: '127.0.0.1' },
  },
});

async function main(): Promise<number> {
  const [cmd, arg] = p;
  if (cmd === 'release' && arg) {
    const r = await runRelease({ tag: arg, repo: v.repo, out: v.out, db: v.db, from: v.from, webhook: v.webhook, force: v.force });
    console.log(`릴리스 ${arg} 생성: 커밋 ${r.commits}건 (${r.prev ?? '처음'} → ${arg})`);
    console.log(`패키지: ${r.zipPath}`);
    for (const a of r.artifacts) console.log(`  ${a.sha256}  ${a.name}`);
    return 0;
  }
  if (cmd === 'verify' && arg) {
    const r = verifyZip(readFileSync(arg));
    if (r.ok) console.log(`통과: ${r.tag} 파일 ${r.checked}개가 모두 일치합니다`);
    else {
      console.error(`실패: ${arg}`);
      for (const x of r.problems) console.error(`  - ${x}`);
    }
    return r.ok ? 0 : 1;
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
    await startServer({ db: v.db, port, web: v.web, host: v.host });
    console.log(`http://${v.host}:${port} 에서 이력 화면을 서빙합니다`);
    return -1; // 서버가 프로세스를 유지한다
  }
  console.log(HELP);
  return cmd ? 1 : 0;
}

main().then(
  (code) => code >= 0 && process.exit(code),
  (e: Error) => {
    console.error(`오류: ${e.message}`);
    process.exit(1);
  },
);
