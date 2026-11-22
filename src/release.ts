import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { assertTag, gitLog, prevTag, tagDate, tagExists } from './parse.ts';
import { classify } from './classify.ts';
import { renderHtml, renderNotes, renderReport } from './render.ts';
import { pack, sha256 } from './pack.ts';
import { openDb, saveRelease } from './db.ts';
import { notify } from './notify.ts';

export type ReleaseOpts = {
  tag: string;
  repo: string;
  out: string;
  db: string;
  from?: string; // 직전 태그를 직접 지정할 때
  webhook?: string;
  force?: boolean;
};

// 파서 → 분류 → 렌더 → 패키징 → DB 저장 → 웹훅 순서로 한 번에 실행한다.
export async function runRelease(o: ReleaseOpts) {
  assertTag(o.tag);
  if (o.from) assertTag(o.from);
  if (!tagExists(o.repo, o.tag)) throw new Error(`태그가 없습니다: ${o.tag}`);

  const prev = o.from ?? prevTag(o.repo, o.tag);
  const changes = gitLog(o.repo, prev, o.tag).map(classify);
  const info = { tag: o.tag, prev, date: tagDate(o.repo, o.tag), changes };

  const { zip, artifacts } = pack(o.tag, {
    'RELEASE_NOTES.md': renderNotes(info),
    'CHANGE_REPORT.md': renderReport(info),
    'CHANGE_REPORT.html': renderHtml(info),
  });

  mkdirSync(o.out, { recursive: true });
  const zipPath = resolve(join(o.out, `shipnote-${o.tag}.zip`));
  writeFileSync(zipPath, zip);

  const db = openDb(o.db);
  try {
    saveRelease(
      db,
      { tag: o.tag, prev, createdAt: info.date, zipPath, zipSha: sha256(zip), changes, artifacts },
      o.force,
    );
  } finally {
    db.close();
  }

  if (o.webhook) await notify(o.webhook, { tag: o.tag, prev, commits: changes.length, zipSha256: sha256(zip) });
  return { zipPath, prev, commits: changes.length, artifacts };
}
