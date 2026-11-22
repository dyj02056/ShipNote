import { describe, expect, it } from 'vitest';
import { classify } from '../src/classify.ts';
import { parseLog } from '../src/parse.ts';

const c = (subject: string, body = '') => classify({ hash: 'a'.repeat(40), author: 'x', date: '', subject, body });

describe('classify', () => {
  it('표준 메시지를 분류한다', () => {
    expect(c('feat: 로그인 추가')).toMatchObject({ type: 'feat', scope: '', subject: '로그인 추가', breaking: false });
  });
  it('scope를 읽는다', () => {
    expect(c('fix(api): 오류 수정')).toMatchObject({ type: 'fix', scope: 'api' });
  });
  it('! 와 BREAKING CHANGE 본문을 호환 불가로 표시한다', () => {
    expect(c('feat(api)!: 형식 변경').breaking).toBe(true);
    expect(c('fix: x', 'BREAKING CHANGE: 필드 삭제').breaking).toBe(true);
  });
  it('형식이 아니거나 모르는 타입은 기타로 모은다', () => {
    for (const s of ['Merge branch x', 'WIP', '', '초기 설정', 'Fixes: 뭔가']) {
      expect(c(s).type).toBe('기타');
    }
  });
});

describe('parseLog', () => {
  it('본문에 줄바꿈이 있어도 레코드를 나눈다', () => {
    const raw = 'h1\x1fA\x1f2026-01-01T00:00:00+09:00\x1ffix: a\x1f줄1\n줄2\x1e\nh2\x1fB\x1f2026-01-02T00:00:00+09:00\x1ffeat: b\x1f\x1e';
    const r = parseLog(raw);
    expect(r).toHaveLength(2);
    expect(r[0].body).toBe('줄1\n줄2');
    expect(r[1]).toMatchObject({ hash: 'h2', subject: 'feat: b' });
  });
  it('빈 입력은 빈 배열이다', () => {
    expect(parseLog('')).toEqual([]);
  });
});
