import type { Change } from './classify.ts';

export type ReleaseInfo = { tag: string; prev: string | null; date: string; changes: Change[] };

export const LABEL: Record<string, string> = {
  feat: '새 기능',
  fix: '수정 사항',
  perf: '성능 개선',
  refactor: '구조 개선',
  docs: '문서',
  test: '테스트',
  build: '빌드',
  ci: 'CI',
  style: '스타일',
  chore: '유지보수',
  revert: '되돌림',
  기타: '분류 안 됨',
};
const ORDER = Object.keys(LABEL);
const HIGHLIGHT = ['feat', 'fix', 'perf', 'refactor'];

const short = (h: string) => h.slice(0, 7);
const line = (c: Change) => `- ${c.scope ? `(${c.scope}) ` : ''}${c.subject} (${short(c.hash)})`;
const range = (r: ReleaseInfo) => (r.prev ? `${r.prev} → ${r.tag}` : `${r.tag} (첫 릴리스)`);
const cell = (s: string) => s.replace(/\|/g, '\\|');

function countBy(changes: Change[], key: (c: Change) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const c of changes) m.set(key(c), (m.get(key(c)) ?? 0) + 1);
  return [...m];
}

// 사용자용: 눈에 띄는 변경만 모은다.
export function renderNotes(r: ReleaseInfo): string {
  const out = [`# ${r.tag} 릴리스 노트`, '', `${r.date.slice(0, 10)} · ${range(r)}`, ''];
  const breaking = r.changes.filter((c) => c.breaking);
  if (breaking.length) out.push('## 호환되지 않는 변경', '', ...breaking.map(line), '');
  for (const t of HIGHLIGHT) {
    const list = r.changes.filter((c) => c.type === t);
    if (list.length) out.push(`## ${LABEL[t]}`, '', ...list.map(line), '');
  }
  const rest = r.changes.filter((c) => !HIGHLIGHT.includes(c.type)).length;
  if (rest) out.push(`그 밖의 변경 ${rest}건은 변경 보고서에 있습니다.`, '');
  return out.join('\n');
}

// 협력사용: 모든 커밋과 통계를 표로 남긴다.
export function renderReport(r: ReleaseInfo): string {
  const byType = countBy(r.changes, (c) => c.type).sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
  const byAuthor = countBy(r.changes, (c) => c.author).sort((a, b) => b[1] - a[1]);
  return [
    `# ${r.tag} 변경 보고서`,
    '',
    `- 기간: ${range(r)}`,
    `- 기준일: ${r.date.slice(0, 10)}`,
    `- 커밋: ${r.changes.length}건 (호환되지 않는 변경 ${r.changes.filter((c) => c.breaking).length}건)`,
    '',
    '## 분류별 건수',
    '',
    '| 분류 | 건수 |',
    '| --- | --- |',
    ...byType.map(([t, n]) => `| ${LABEL[t] ?? t} | ${n} |`),
    '',
    '## 작성자별 건수',
    '',
    '| 작성자 | 건수 |',
    '| --- | --- |',
    ...byAuthor.map(([a, n]) => `| ${cell(a)} | ${n} |`),
    '',
    '## 커밋 목록',
    '',
    '| 해시 | 분류 | 내용 | 작성자 |',
    '| --- | --- | --- | --- |',
    ...r.changes.map(
      (c) =>
        `| ${short(c.hash)} | ${LABEL[c.type] ?? c.type}${c.breaking ? ' (호환 불가)' : ''} | ${cell(
          (c.scope ? `(${c.scope}) ` : '') + c.subject,
        )} | ${cell(c.author)} |`,
    ),
    '',
  ].join('\n');
}

// 커밋 메시지는 신뢰할 수 없는 입력이라 반드시 이스케이프한다.
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export function renderHtml(r: ReleaseInfo): string {
  const rows = r.changes
    .map(
      (c) =>
        `<tr><td><code>${short(c.hash)}</code></td><td>${esc(LABEL[c.type] ?? c.type)}${
          c.breaking ? ' <b>(호환 불가)</b>' : ''
        }</td><td>${esc((c.scope ? `(${c.scope}) ` : '') + c.subject)}</td><td>${esc(c.author)}</td></tr>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${esc(r.tag)} 변경 보고서</title>
<style>body{font:15px/1.6 sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#1c2531}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ccd;padding:.3rem .5rem;text-align:left}</style>
</head><body>
<h1>${esc(r.tag)} 변경 보고서</h1>
<p>${esc(range(r))} · ${esc(r.date.slice(0, 10))} · 커밋 ${r.changes.length}건</p>
<table><thead><tr><th>해시</th><th>분류</th><th>내용</th><th>작성자</th></tr></thead>
<tbody>
${rows}
</tbody></table>
</body></html>
`;
}
