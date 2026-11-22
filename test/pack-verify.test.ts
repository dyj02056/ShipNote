import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { pack } from '../src/pack.ts';
import { verifyZip } from '../src/verify.ts';
import { renderHtml, renderNotes, renderReport } from '../src/render.ts';

const files = { 'A.md': '# a', 'B.md': '# b' };

describe('pack / verify', () => {
  it('정상 zip은 통과한다', () => {
    const r = verifyZip(pack('v1', files).zip);
    expect(r).toMatchObject({ ok: true, tag: 'v1', checked: 2, problems: [] });
  });

  it('파일 한 바이트가 바뀌면 실패한다', () => {
    const e = unzipSync(pack('v1', files).zip);
    e['A.md'] = strToU8('# A'); // 변조
    const r = verifyZip(zipSync(e));
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['A.md: 해시가 다릅니다']);
  });

  it('파일이 빠지면 실패한다', () => {
    const e = unzipSync(pack('v1', files).zip);
    delete e['B.md'];
    expect(verifyZip(zipSync(e)).problems).toEqual(['B.md: 파일이 없습니다']);
  });

  it('manifest에 없는 파일과 경로 탈출 이름을 거부한다', () => {
    const e = unzipSync(pack('v1', files).zip);
    e['extra.txt'] = strToU8('x');
    e['../evil.txt'] = strToU8('x');
    const p = verifyZip(zipSync(e)).problems;
    expect(p).toContain('extra.txt: manifest에 없는 파일입니다');
    expect(p).toContain('../evil.txt: 허용되지 않는 경로입니다');
  });

  it('zip이 아니거나 manifest가 없으면 실패한다', () => {
    expect(verifyZip(strToU8('not a zip')).ok).toBe(false);
    expect(verifyZip(zipSync({ 'A.md': strToU8('a') })).problems).toEqual(['manifest.json이 없습니다']);
  });
});

describe('render', () => {
  const info = {
    tag: 'v1',
    prev: null,
    date: '2026-11-22T00:00:00+09:00',
    changes: [
      { type: 'feat', scope: 'api', subject: '<script>alert(1)</script> | 추가', breaking: true, hash: 'abcdef1234', author: 'kim' },
      { type: 'chore', scope: '', subject: '정리', breaking: false, hash: '1234567890', author: 'lee' },
    ],
  };
  it('릴리스 노트는 호환 불가·새 기능을 먼저 보이고 나머지는 건수만 쓴다', () => {
    const n = renderNotes(info);
    expect(n).toContain('## 호환되지 않는 변경');
    expect(n).toContain('## 새 기능');
    expect(n).toContain('그 밖의 변경 1건');
    expect(n).not.toContain('정리');
  });
  it('보고서 표에서 파이프를 이스케이프한다', () => {
    expect(renderReport(info)).toContain('\\| 추가');
  });
  it('HTML은 커밋 메시지를 이스케이프한다', () => {
    const h = renderHtml(info);
    expect(h).not.toContain('<script>alert');
    expect(h).toContain('&lt;script&gt;');
  });
});
