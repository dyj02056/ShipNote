import { createServer, type ServerResponse, type Server } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { getRelease, listReleases, openDb } from './db.ts';
import { fileSafeTag } from './parse.ts';
import { sha256 } from './pack.ts';
import { LIMITS, verifyZip, type VerifyResult } from './verify.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

// 문자열 앞부분 비교는 web/dist-secret 같은 옆 폴더를 통과시키므로 relative로 판단한다.
export function isInside(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function fileSize(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

function send(res: ServerResponse, code: number, type: string, body?: string | Buffer, extra: Record<string, string> = {}) {
  res.writeHead(code, { 'content-type': type, 'x-content-type-options': 'nosniff', ...extra });
  res.end(body);
}
const json = (res: ServerResponse, code: number, body: unknown) =>
  send(res, code, 'application/json; charset=utf-8', JSON.stringify(body), { 'cache-control': 'no-store' });

class BadRequest extends Error {}
const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    throw new BadRequest('주소 형식이 올바르지 않습니다');
  }
};

// API 3개와 빌드된 웹 화면(web/dist)만 서빙한다. 인증이 없으므로 기본은 127.0.0.1에만 연다.
export function startServer(opts: {
  db: string;
  port: number;
  web: string;
  host?: string;
  pubkey?: string; // 주면 서명까지 확인한다
}): Promise<Server> {
  const db = openDb(opts.db);
  const webRoot = resolve(opts.web);

  async function verifyRelease(tag: string, zipPath: string, zipSha: string): Promise<VerifyResult> {
    const missing = (p: string): VerifyResult => ({
      ok: false,
      tag,
      checked: 0,
      signature: opts.pubkey ? 'missing' : 'unchecked',
      problems: [p],
      warnings: [],
    });
    const size = await fileSize(zipPath);
    if (size === null) return missing('zip 파일을 찾을 수 없습니다');
    if (size > LIMITS.zipBytes) return missing(`zip이 너무 큽니다 (${size}바이트)`);
    const zip = await readFile(zipPath);
    // zip을 다시 읽어 매니페스트와 DB의 zip 해시를 함께 확인한다.
    const result = verifyZip(zip, { pubkey: opts.pubkey });
    if (sha256(zip) !== zipSha) {
      result.ok = false;
      result.problems.push('zip 전체 해시가 기록과 다릅니다');
    }
    return result;
  }

  async function handle(req: { url?: string; method?: string }, res: ServerResponse) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: '허용되지 않는 메서드입니다' });
    // 태그에 '/'가 들어갈 수 있으므로(%2F) API는 디코딩 전 경로로 나눈다.
    const raw = new URL(req.url ?? '/', 'http://x').pathname;

    if (raw === '/api/releases') return json(res, 200, listReleases(db));

    const m = /^\/api\/releases\/([^/]+)(\/verify|\/zip)?$/.exec(raw);
    if (m) {
      const tag = decode(m[1]);
      const found = getRelease(db, tag);
      if (!found) return json(res, 404, { error: `릴리스가 없습니다: ${tag}` });
      if (!m[2]) return json(res, 200, found);
      if (m[2] === '/verify') {
        return json(res, 200, await verifyRelease(tag, found.release.zip_path, found.release.zip_sha256));
      }
      const size = await fileSize(found.release.zip_path);
      if (size === null) return json(res, 404, { error: 'zip 파일을 찾을 수 없습니다' });
      res.writeHead(200, {
        'content-type': 'application/zip',
        'content-length': String(size),
        'content-disposition': `attachment; filename="shipnote-${fileSafeTag(tag)}.zip"`,
        'x-content-type-options': 'nosniff',
      });
      if (req.method === 'HEAD') return res.end();
      return pipeline(createReadStream(found.release.zip_path), res);
    }
    if (raw.startsWith('/api/')) return json(res, 404, { error: '없는 주소입니다' });

    // 정적 파일. 웹 루트 밖으로 나가는 경로는 막는다.
    let file = resolve(join(webRoot, decode(raw)));
    if (!isInside(webRoot, file)) return json(res, 403, { error: '허용되지 않는 경로입니다' });
    if ((await fileSize(file)) === null) file = join(webRoot, 'index.html');
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      return json(res, 404, { error: '웹 화면이 빌드되지 않았습니다. npm run web:build' });
    }
    send(res, 200, MIME[extname(file)] ?? 'application/octet-stream', req.method === 'HEAD' ? undefined : body);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e: Error) => {
      if (res.headersSent) return res.destroy();
      if (e instanceof BadRequest) return json(res, 400, { error: e.message });
      json(res, 500, { error: e.message });
    });
  });

  server.on('close', () => db.close());
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(opts.port, opts.host ?? '127.0.0.1', () => ok(server));
  });
}
