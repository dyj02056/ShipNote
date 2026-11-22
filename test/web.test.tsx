// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../web/src/App.tsx';

const rows = [
  { tag: 'v0.2.0', prev_tag: 'v0.1.0', tag_date: '2026-11-20T00:00:00Z', key_id: 'abcd', change_count: 2 },
  { tag: 'v0.1.0', prev_tag: null, tag_date: '2026-11-01T00:00:00Z', key_id: null, change_count: 1 },
];
const detail = (tag: string) => ({
  release: { ...rows.find((r) => r.tag === tag)!, zip_sha256: 'f'.repeat(64) },
  changes: [
    { type: 'feat', scope: 'api', subject: '검색 추가', hash: 'a'.repeat(40), author: 'kim', breaking: 1 },
    { type: 'chore', scope: '', subject: '정리', hash: 'b'.repeat(40), author: 'lee', breaking: 0 },
  ],
  artifacts: [{ name: 'RELEASE_NOTES.md', sha256: 'c'.repeat(64), bytes: 10 }],
});

function mockApi(verify: (n: number) => unknown, list: unknown = rows) {
  let calls = 0;
  const fetchMock = vi.fn(async (url: string) => {
    const body = url === '/api/releases' ? list : url.endsWith('/verify') ? verify(++calls) : detail(decodeURIComponent(url.split('/')[3]));
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  location.hash = '';
});

describe('릴리스 이력 화면', () => {
  it('목록을 그리고 최신 릴리스를 연다', async () => {
    mockApi(() => ({ ok: true, checked: 1, signature: 'valid', problems: [] }));
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'v0.2.0' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /v0\.\d\.0/ })).toHaveLength(2);
    expect(screen.getByText('호환되지 않는 변경')).toBeTruthy();
    expect(screen.getByText('그 밖의 변경 1건')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('검인 완료'));
    expect(screen.getByRole('status').textContent).toContain('서명 확인');
  });

  it('다시 검증하면 도장이 불일치로 바뀌고 문제를 보여준다', async () => {
    mockApi((n) =>
      n === 1
        ? { ok: true, checked: 1, signature: 'unsigned', problems: [] }
        : { ok: false, checked: 1, signature: 'unsigned', problems: ['RELEASE_NOTES.md: 해시가 다릅니다'] },
    );
    render(<App />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('검인 완료'));
    fireEvent.click(screen.getByRole('button', { name: '다시 검증하기' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('불일치'));
    expect(screen.getByText('RELEASE_NOTES.md: 해시가 다릅니다')).toBeTruthy();
  });

  it('목록에서 고르면 주소 해시로 다른 릴리스를 연다', async () => {
    mockApi(() => ({ ok: true, checked: 1, problems: [] }));
    render(<App />);
    await screen.findByRole('heading', { name: 'v0.2.0' });
    fireEvent.click(screen.getByRole('button', { name: /v0\.1\.0/ }));
    expect(await screen.findByRole('heading', { name: 'v0.1.0' })).toBeTruthy();
    expect(location.hash).toBe('#v0.1.0');
  });

  it('릴리스가 없으면 안내를 보여준다', async () => {
    mockApi(() => ({}), []);
    render(<App />);
    expect(await screen.findByText(/아직 릴리스가 없습니다/)).toBeTruthy();
  });
});
