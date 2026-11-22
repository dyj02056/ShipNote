import { execFileSync } from 'node:child_process';

export type Commit = { hash: string; author: string; date: string; subject: string; body: string };

// 레코드는 \x1e, 필드는 \x1f로 나눈다. 본문에 줄바꿈이 있어도 깨지지 않는다.
const FORMAT = '%H%x1f%an%x1f%aI%x1f%s%x1f%b%x1e';

export function parseLog(raw: string): Commit[] {
  return raw
    .split('\x1e')
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim())
    .map((r) => {
      const [hash, author, date, subject, body = ''] = r.split('\x1f');
      return { hash, author, date, subject, body: body.trim() };
    });
}

// 태그 이름은 git 옵션으로 오해되지 않게 엄격히 검사한다.
export function assertTag(tag: string): void {
  if (!/^[A-Za-z0-9][\w.+-]*$/.test(tag)) throw new Error(`태그 이름이 올바르지 않습니다: ${tag}`);
}

function git(repo: string, args: string[]): string {
  // stderr는 가려서 '태그 없음' 같은 예상된 실패가 화면에 새지 않게 한다.
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function tagExists(repo: string, tag: string): boolean {
  try {
    git(repo, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]);
    return true;
  } catch {
    return false;
  }
}

// 직전 태그. 없으면 null(첫 릴리스).
export function prevTag(repo: string, tag: string): string | null {
  try {
    return git(repo, ['describe', '--tags', '--abbrev=0', `${tag}^`]).trim() || null;
  } catch {
    return null;
  }
}

export function tagDate(repo: string, tag: string): string {
  return git(repo, ['log', '-1', '--format=%aI', tag]).trim();
}

export function gitLog(repo: string, from: string | null, to: string): Commit[] {
  const range = from ? `${from}..${to}` : to;
  return parseLog(git(repo, ['log', '--no-merges', `--format=${FORMAT}`, range]));
}
