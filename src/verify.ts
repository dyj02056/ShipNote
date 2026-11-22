import { unzipSync } from 'fflate';
import { sha256, type Artifact } from './pack.ts';

export type VerifyResult = { ok: boolean; tag: string; checked: number; problems: string[] };

// zip을 열어 manifest의 해시를 다시 계산한다. 어긋나거나 빠지거나 더 들어 있으면 실패다.
export function verifyZip(zip: Uint8Array): VerifyResult {
  const fail = (p: string): VerifyResult => ({ ok: false, tag: '', checked: 0, problems: [p] });
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    return fail('zip을 열 수 없습니다');
  }
  const raw = entries['manifest.json'];
  if (!raw) return fail('manifest.json이 없습니다');

  let manifest: { tag: string; files: Artifact[] };
  try {
    manifest = JSON.parse(new TextDecoder().decode(raw));
    if (!Array.isArray(manifest.files)) throw new Error();
  } catch {
    return fail('manifest.json을 읽을 수 없습니다');
  }

  const problems: string[] = [];
  const listed = new Set<string>();
  for (const f of manifest.files) {
    listed.add(f.name);
    const bytes = entries[f.name];
    if (!bytes) problems.push(`${f.name}: 파일이 없습니다`);
    else if (sha256(bytes) !== f.sha256) problems.push(`${f.name}: 해시가 다릅니다`);
  }
  for (const name of Object.keys(entries)) {
    if (name === 'manifest.json') continue;
    // 경로 탈출 이름은 거부한다(zip slip)
    if (/(^|[\\/])\.\.([\\/]|$)|^[\\/]|^[A-Za-z]:/.test(name)) problems.push(`${name}: 허용되지 않는 경로입니다`);
    else if (!listed.has(name)) problems.push(`${name}: manifest에 없는 파일입니다`);
  }
  return { ok: problems.length === 0, tag: manifest.tag, checked: manifest.files.length, problems };
}
