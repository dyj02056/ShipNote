import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { getRelease, listReleases, openDb } from './db.ts';
import { sha256 } from './pack.ts';
import { verifyZip } from './verify.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

// 문자열 앞부분 비교는 web/dist-secret 같은 옆 폴더를 통과시키므로 relative로 판단한다.
export function isInside(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

// API 3개와 빌드된 웹 화면(web/dist)만 서빙한다.
export function startServer(opts: { db: string; port: number; web: string; host?: string; pubkey?: string }): Promise<Server> {
  const db = openDb(opts.db);
  const webRoot = resolve(opts.web);

  const server = createServer((req, res) => {
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    try {
      let path: string;
      try {
        path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      } catch {
        return json(400, { error: '주소 형식이 올바르지 않습니다' });
      }

      if (path === '/api/releases') return json(200, listReleases(db));

      const m = /^\/api\/releases\/([^/]+)(\/verify|\/zip)?$/.exec(path);
      if (m) {
        const found = getRelease(db, m[1]);
        if (!found) return json(404, { error: `릴리스가 없습니다: ${m[1]}` });
        if (!m[2]) return json(200, found);
        if (m[2] === '/zip') {
          if (!existsSync(found.release.zip_path)) return json(404, { error: 'zip 파일을 찾을 수 없습니다' });
          res.writeHead(200, {
            'content-type': 'application/zip',
            'content-disposition': `attachment; filename="shipnote-${m[1]}.zip"`,
          });
          return res.end(readFileSync(found.release.zip_path));
        }
        // zip을 다시 읽어 매니페스트와 DB의 zip 해시를 함께 확인한다.
        if (!existsSync(found.release.zip_path)) {
          return json(200, {
            ok: false,
            tag: m[1],
            checked: 0,
            signature: opts.pubkey ? 'missing' : 'unchecked',
            problems: ['zip 파일을 찾을 수 없습니다'],
            warnings: [],
          });
        }
        const zip = readFileSync(found.release.zip_path);
        const result = verifyZip(zip, { pubkey: opts.pubkey });
        if (sha256(zip) !== found.release.zip_sha256) {
          result.ok = false;
          result.problems.push('zip 전체 해시가 기록과 다릅니다');
        }
        return json(200, result);
      }
      if (path.startsWith('/api/')) return json(404, { error: '없는 주소입니다' });

      // 정적 파일. 웹 루트 밖으로 나가는 경로는 막는다.
      let file = resolve(join(webRoot, path));
      if (!isInside(webRoot, file)) return json(403, { error: '허용되지 않는 경로입니다' });
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(webRoot, 'index.html');
      if (!existsSync(file)) return json(404, { error: '웹 화면이 빌드되지 않았습니다. npm run web:build' });
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    } catch (e) {
      json(500, { error: (e as Error).message });
    }
  });

  server.on('close', () => db.close());
  return new Promise((ok) => server.listen(opts.port, opts.host ?? '127.0.0.1', () => ok(server)));
}
