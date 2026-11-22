import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { keyId, signBytes } from './sign.ts';

export type Artifact = { name: string; sha256: string; bytes: number };
export type Manifest = { tag: string; keyId?: string; files: Artifact[] };

export const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

// 파일 묶음 + manifest.json(파일별 SHA-256)을 zip 하나로 만든다. 해시는 바이트 기준이다.
// 비밀키를 주면 manifest.json 바이트에 대한 Ed25519 서명을 manifest.sig로 넣는다.
export function pack(
  tag: string,
  files: Record<string, string>,
  privatePem?: string,
): { zip: Uint8Array; artifacts: Artifact[]; keyId?: string } {
  const data: Record<string, Uint8Array> = {};
  const artifacts: Artifact[] = [];
  for (const [name, text] of Object.entries(files)) {
    const bytes = strToU8(text);
    data[name] = bytes;
    artifacts.push({ name, sha256: sha256(bytes), bytes: bytes.length });
  }
  const id = privatePem ? keyId(privatePem) : undefined;
  const manifest: Manifest = id ? { tag, keyId: id, files: artifacts } : { tag, files: artifacts };
  const m = strToU8(JSON.stringify(manifest, null, 2));
  data['manifest.json'] = m;
  if (privatePem) data['manifest.sig'] = strToU8(signBytes(m, privatePem) + '\n');
  return { zip: zipSync(data), artifacts, keyId: id };
}
