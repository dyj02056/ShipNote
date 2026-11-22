import { useEffect, useState } from 'react';
import { LABEL } from '../../src/render.ts';

type Row = { tag: string; prev_tag: string | null; created_at: string; change_count: number };
type Change = { type: string; scope: string; subject: string; hash: string; author: string; breaking: number };
type Detail = {
  release: Row & { zip_sha256: string };
  changes: Change[];
  artifacts: { name: string; sha256: string; bytes: number }[];
};
type Verify = { ok: boolean; checked: number; problems: string[] };

const HIGHLIGHT = ['feat', 'fix', 'perf', 'refactor'];
const day = (iso: string) => iso.slice(0, 10);

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? `요청 실패 (${r.status})`);
  return body as T;
}

// 주소 해시(#v1.0.0)로 선택한 릴리스를 기억한다.
function useTag(): [string, (t: string) => void] {
  const read = () => decodeURIComponent(location.hash.slice(1));
  const [tag, setTag] = useState(read);
  useEffect(() => {
    const on = () => setTag(read());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return [tag, (t) => (location.hash = encodeURIComponent(t))];
}

export function App() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [tag, select] = useTag();

  useEffect(() => {
    getJson<Row[]>('/api/releases').then(setRows, (e: Error) => setError(e.message));
  }, []);

  const current = rows?.find((r) => r.tag === tag) ?? rows?.[0];

  return (
    <div className="shell">
      <aside className="rail" aria-label="릴리스 목록">
        <h1 className="brand">ShipNote</h1>
        {rows && rows.length > 0 && (
          <ol className="timeline">
            {rows.map((r) => (
              <li key={r.tag}>
                <button
                  className="tagbtn"
                  aria-current={r.tag === current?.tag ? 'true' : undefined}
                  onClick={() => select(r.tag)}
                >
                  <span className="tagname">{r.tag}</span>
                  <span className="tagmeta">{day(r.created_at)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </aside>
      <main className="sheet-area">
        {error && <p className="notice err">{error}</p>}
        {rows && rows.length === 0 && (
          <p className="notice">
            아직 릴리스가 없습니다. <code>shipnote release v0.1.0</code>을 실행하면 여기에 표시됩니다.
          </p>
        )}
        {!rows && !error && <p className="notice">불러오는 중입니다.</p>}
        {current && <Sheet key={current.tag} tag={current.tag} />}
      </main>
    </div>
  );
}

function Sheet({ tag }: { tag: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState('');
  const [v, setV] = useState<Verify | 'loading'>('loading');

  const verify = () => {
    setV('loading');
    getJson<Verify>(`/api/releases/${encodeURIComponent(tag)}/verify`).then(setV, (e: Error) =>
      setV({ ok: false, checked: 0, problems: [e.message] }),
    );
  };

  useEffect(() => {
    getJson<Detail>(`/api/releases/${encodeURIComponent(tag)}`).then(setD, (e: Error) => setErr(e.message));
    verify();
  }, [tag]);

  if (err) return <p className="notice err">{err}</p>;
  if (!d) return <p className="notice">불러오는 중입니다.</p>;

  const breaking = d.changes.filter((c) => c.breaking);
  const rest = d.changes.filter((c) => !HIGHLIGHT.includes(c.type));
  const li = (c: Change) => (
    <li key={c.hash}>
      {c.scope && <span className="scope">{c.scope}</span>}
      {c.subject} <code className="hash">{c.hash.slice(0, 7)}</code>
    </li>
  );

  return (
    <article className="sheet">
      <Stamp v={v} total={d.artifacts.length} />
      <header className="head">
        <h2>{d.release.tag}</h2>
        <p className="range">
          {day(d.release.created_at)} · {d.release.prev_tag ? `${d.release.prev_tag}에서 이어서` : '첫 릴리스'} · 커밋{' '}
          {d.changes.length}건
        </p>
      </header>

      <div className="prose">
        {breaking.length > 0 && (
          <section className="warn">
            <h3>호환되지 않는 변경</h3>
            <ul>{breaking.map(li)}</ul>
          </section>
        )}
        {HIGHLIGHT.map((t) => {
          const list = d.changes.filter((c) => c.type === t);
          return list.length ? (
            <section key={t}>
              <h3>{LABEL[t]}</h3>
              <ul>{list.map(li)}</ul>
            </section>
          ) : null;
        })}
        {rest.length > 0 && (
          <details>
            <summary>그 밖의 변경 {rest.length}건</summary>
            <ul>
              {rest.map((c) => (
                <li key={c.hash}>
                  <span className="scope">{LABEL[c.type] ?? c.type}</span>
                  {c.subject} <code className="hash">{c.hash.slice(0, 7)}</code>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <section className="files">
        <div className="files-head">
          <h3>전달 파일</h3>
          <div className="actions">
            <button className="btn ghost" onClick={verify} disabled={v === 'loading'}>
              다시 검증하기
            </button>
            <a className="btn" href={`/api/releases/${encodeURIComponent(tag)}/zip`}>
              릴리스 문서 받기
            </a>
          </div>
        </div>
        <dl>
          {d.artifacts.map((a) => (
            <div key={a.name} className="file">
              <dt>{a.name}</dt>
              <dd>
                <code>{a.sha256}</code>
              </dd>
            </div>
          ))}
        </dl>
        {v !== 'loading' && !v.ok && (
          <ul className="problems">
            {v.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

// 검인 도장: 색만이 아니라 글자와 모양으로도 상태를 알린다.
function Stamp({ v, total }: { v: Verify | 'loading'; total: number }) {
  if (v === 'loading') return <div className="stamp wait" role="status">검증하는 중</div>;
  return v.ok ? (
    <div className="stamp ok" role="status">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path d="M3 9.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.4" />
      </svg>
      <span>
        검인 완료
        <small>
          파일 {v.checked}/{total} 일치
        </small>
      </span>
    </div>
  ) : (
    <div className="stamp bad" role="status">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path d="M4 4l10 10M14 4L4 14" fill="none" stroke="currentColor" strokeWidth="2.4" />
      </svg>
      <span>
        불일치
        <small>{v.problems.length}건 확인 필요</small>
      </span>
    </div>
  );
}
