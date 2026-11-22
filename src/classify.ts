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

// Conventional Commits가 아니면 '기타'로 모은다.
export function classify(c: Commit): Change {
  const base = { hash: c.hash, author: c.author };
  const m = RE.exec(c.subject);
  const breakingBody = /^BREAKING[ -]CHANGE:/m.test(c.body);
  if (!m || !TYPES.has(m[1])) {
    return { ...base, type: '기타', scope: '', subject: c.subject, breaking: breakingBody };
  }
  return { ...base, type: m[1], scope: m[2] ?? '', subject: m[4], breaking: !!m[3] || breakingBody };
}
