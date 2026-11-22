import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';

export type Artifact = { name: string; sha256: string; bytes: number };

export const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

// 파일 묶음 + manifest.json(파일별 SHA-256)을 zip 하나로 만든다. 해시는 바이트 기준이다.
export function pack(tag: string, files: Record<string, string>): { zip: Uint8Array; artifacts: Artifact[] } {
  const data: Record<string, Uint8Array> = {};
  const artifacts: Artifact[] = [];
  for (const [name, text] of Object.entries(files)) {
    const bytes = strToU8(text);
    data[name] = bytes;
    artifacts.push({ name, sha256: sha256(bytes), bytes: bytes.length });
  }
  data['manifest.json'] = strToU8(JSON.stringify({ tag, files: artifacts }, null, 2));
  return { zip: zipSync(data), artifacts };
}
