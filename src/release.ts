import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { assertTag, fileSafeTag, gitLog, prevTag, tagDate, tagExists } from './parse.ts';
import { classify } from './classify.ts';
import { renderHtml, renderNotes, renderReport } from './render.ts';
import { pack, sha256 } from './pack.ts';
import { openDb, releaseExists, saveRelease } from './db.ts';
import { notify } from './notify.ts';
import { readKey } from './sign.ts';

export type ReleaseOpts = {
  tag: string;
  repo: string;
  out: string;
  db: string;
  from?: string; // 직전 태그를 직접 지정할 때
  webhook?: string;
  force?: boolean;
  key?: string; // Ed25519 비밀키 PEM 파일 경로. 주면 manifest.sig를 넣는다.
};

// 파서 → 분류 → 렌더 → 패키징 → DB 저장 → 웹훅 순서로 한 번에 실행한다.
export async function runRelease(o: ReleaseOpts) {
  assertTag(o.tag);
  if (o.from) assertTag(o.from);
  if (!tagExists(o.repo, o.tag)) throw new Error(`태그가 없습니다: ${o.tag}`);
  const privatePem = o.key ? readKey(o.key) : undefined;

  const db = openDb(o.db);
  try {
    // 기존 zip을 건드리기 전에 중복부터 확인한다.
    if (!o.force && releaseExists(db, o.tag)) throw new Error(`이미 있는 릴리스입니다: ${o.tag} (--force로 교체)`);

    const prev = o.from ?? prevTag(o.repo, o.tag);
    const changes = gitLog(o.repo, prev, o.tag).map(classify);
    const info = { tag: o.tag, prev, date: tagDate(o.repo, o.tag), changes };

    const { zip, artifacts, keyId } = pack(
      o.tag,
      {
        'RELEASE_NOTES.md': renderNotes(info),
        'CHANGE_REPORT.md': renderReport(info),
        'CHANGE_REPORT.html': renderHtml(info),
      },
      privatePem,
    );
    const zipSha = sha256(zip);

    // 임시 파일에 쓰고 DB 기록이 끝난 뒤에만 최종 이름으로 바꾼다.
    mkdirSync(o.out, { recursive: true });
    const zipPath = resolve(join(o.out, `shipnote-${fileSafeTag(o.tag)}.zip`));
    const tmpPath = `${zipPath}.tmp`;
    writeFileSync(tmpPath, zip);
    try {
      saveRelease(
        db,
        { tag: o.tag, prev, tagDate: info.date, createdAt: new Date().toISOString(), zipPath, zipSha, keyId, changes, artifacts },
        o.force,
      );
      renameSync(tmpPath, zipPath);
    } catch (e) {
      rmSync(tmpPath, { force: true });
      throw e;
    }

    if (o.webhook) await notify(o.webhook, { tag: o.tag, prev, commits: changes.length, zipSha256: zipSha, keyId });
    return { zipPath, zipSha, keyId, prev, commits: changes.length, artifacts };
  } finally {
    db.close();
  }
}
