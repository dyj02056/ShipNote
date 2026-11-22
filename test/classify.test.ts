import { describe, expect, it } from 'vitest';
import { classify } from '../src/classify.ts';
import { assertTag, fileSafeTag, parseLog } from '../src/parse.ts';

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
  it('대문자로 쓴 타입도 받는다', () => {
    expect(c('Feat(ui): 버튼 추가')).toMatchObject({ type: 'feat', scope: 'ui', subject: '버튼 추가' });
    expect(c('FIX: 오류').type).toBe('fix');
  });
  it('git revert 기본 메시지를 되돌림으로 분류한다', () => {
    expect(c('Revert "feat: 검색 추가"')).toMatchObject({ type: 'revert', subject: 'feat: 검색 추가' });
  });
});

describe('assertTag', () => {
  it('일반 태그와 /로 나눈 태그를 허용한다', () => {
    for (const t of ['v1.0.0', 'v2.0.0-rc.1', 'release/1.0', 'team/app/v3', '1.0+build.5']) {
      expect(() => assertTag(t)).not.toThrow();
    }
  });
  it('옵션처럼 보이거나 git이 거부하는 이름은 막는다', () => {
    for (const t of ['--output=x', '-v1', 'a..b', 'a//b', 'a/.b', 'a/', 'a.', 'v1.lock', '/v1', '', 'v 1', 'v1~2']) {
      expect(() => assertTag(t), t).toThrow('올바르지 않습니다');
    }
  });
  it('파일 이름에서는 /를 ~로 바꾼다', () => {
    expect(fileSafeTag('release/1.0')).toBe('release~1.0');
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
