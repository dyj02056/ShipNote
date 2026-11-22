import type { Commit } from './parse.ts';

export type Change = {
  type: string;
  scope: string;
  subject: string;
  breaking: boolean;
  hash: string;
  author: string;
};

const TYPES = new Set(['feat', 'fix', 'docs', 'chore', 'refactor', 'test', 'perf', 'build', 'ci', 'style', 'revert']);
const RE = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;
const GIT_REVERT = /^Revert "(.+)"$/; // git revert가 만드는 기본 메시지

// Conventional Commits가 아니면 '기타'로 모은다.
export function classify(c: Commit): Change {
  const base = { hash: c.hash, author: c.author };
  const breakingBody = /^BREAKING[ -]CHANGE:/m.test(c.body);
  const rv = GIT_REVERT.exec(c.subject);
  if (rv) return { ...base, type: 'revert', scope: '', subject: rv[1], breaking: breakingBody };
  const m = RE.exec(c.subject);
  const type = m?.[1].toLowerCase(); // Feat:, FIX: 처럼 대문자로 쓴 경우도 받는다
  if (!m || !type || !TYPES.has(type)) {
    return { ...base, type: '기타', scope: '', subject: c.subject, breaking: breakingBody };
  }
  return { ...base, type, scope: m[2] ?? '', subject: m[4], breaking: !!m[3] || breakingBody };
}
