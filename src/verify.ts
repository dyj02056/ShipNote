import { unzipSync } from 'fflate';
import { sha256, type Manifest } from './pack.ts';
import { verifyBytes } from './sign.ts';

export type SignatureStatus = 'valid' | 'invalid' | 'missing' | 'unchecked' | 'unsigned';
export type VerifyResult = {
  ok: boolean;
  tag: string;
  checked: number;
  signature: SignatureStatus;
  keyId?: string;
  problems: string[];
  warnings: string[];
};
export type VerifyOptions = {
  pubkey?: string; // 공개키 PEM. 주면 서명이 반드시 있어야 하고 맞아야 한다.
  sha256?: string; // 별도 경로로 받은 zip 전체 해시
};

// 받은 zip을 메모리에 풀어 검증하므로 크기에 상한을 둔다(zip 폭탄 대비).
export const LIMITS = { zipBytes: 200 * 1024 * 1024, entries: 100, entryBytes: 50 * 1024 * 1024, totalBytes: 200 * 1024 * 1024 };

const META = new Set(['manifest.json', 'manifest.sig']);
const HEX64 = /^[0-9a-f]{64}$/;
const UNSAFE = /(^|[\/])\.\.([\/]|$)|^[\/]|^[A-Za-z]:/;

// zip을 열어 manifest의 해시를 다시 계산한다. 어긋나거나 빠지거나 더 들어 있으면 실패다.
// 공개키를 주면 manifest.sig 서명까지 확인한다. 서명이 있어야 '전달 중 바뀌지 않음'을 보장한다.
export function verifyZip(zip: Uint8Array, opts: VerifyOptions = {}): VerifyResult {
  const base = { tag: '', checked: 0, signature: (opts.pubkey ? 'missing' : 'unchecked') as SignatureStatus, warnings: [] };
  const fail = (...p: string[]): VerifyResult => ({ ...base, ok: false, problems: p });

  if (opts.sha256 !== undefined) {
    const want = opts.sha256.trim().toLowerCase();
    if (!HEX64.test(want)) return fail('--sha256 값이 SHA-256 형식(16진수 64자)이 아닙니다');
    if (sha256(zip) !== want) return fail('zip 전체 해시가 기대값과 다릅니다');
  }
  if (zip.length > LIMITS.zipBytes) return fail(`zip이 너무 큽니다 (${zip.length}바이트)`);

  const limitErrors: string[] = [];
  let count = 0;
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip, {
      filter: (f) => {
        count++;
        total += f.originalSize;
        if (count > LIMITS.entries) limitErrors.push(`항목이 너무 많습니다 (${LIMITS.entries}개 초과)`);
        else if (f.originalSize > LIMITS.entryBytes || f.size > LIMITS.entryBytes)
          limitErrors.push(`${f.name}: 압축 해제 크기가 너무 큽니다`);
        else if (total > LIMITS.totalBytes) limitErrors.push('전체 압축 해제 크기가 너무 큽니다');
        return limitErrors.length === 0;
      },
    });
  } catch {
    return fail('zip을 열 수 없습니다');
  }
  if (limitErrors.length) return fail(limitErrors[0]);

  const raw = entries['manifest.json'];
  if (!raw) return fail('manifest.json이 없습니다');

  let manifest: Manifest;
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    return fail('manifest.json을 읽을 수 없습니다');
  }
  const shapeError = checkShape(manifest);
  if (shapeError) return fail(`manifest.json 형식이 올바르지 않습니다: ${shapeError}`);

  const problems: string[] = [];
  const warnings: string[] = [];

  // 서명
  let signature: SignatureStatus;
  const sig = entries['manifest.sig'];
  if (opts.pubkey) {
    if (!sig) {
      signature = 'missing';
      problems.push('manifest.sig(서명)가 없습니다');
    } else if (verifyBytes(raw, new TextDecoder().decode(sig), opts.pubkey)) {
      signature = 'valid';
    } else {
      signature = 'invalid';
      problems.push('서명이 공개키와 맞지 않습니다');
    }
  } else {
    signature = sig ? 'unchecked' : 'unsigned';
    warnings.push(
      sig
        ? '서명이 있지만 공개키를 주지 않아 확인하지 않았습니다 (--pubkey)'
        : '서명이 없는 패키지입니다. 내용 일관성만 확인했습니다',
    );
  }

  // 파일 해시
  const listed = new Set<string>();
  for (const f of manifest.files) {
    listed.add(f.name);
    const bytes = entries[f.name];
    if (!bytes) problems.push(`${f.name}: 파일이 없습니다`);
    else if (sha256(bytes) !== f.sha256) problems.push(`${f.name}: 해시가 다릅니다`);
    else if (bytes.length !== f.bytes) problems.push(`${f.name}: 크기가 다릅니다`);
  }
  for (const name of Object.keys(entries)) {
    if (META.has(name)) continue;
    // 경로 탈출 이름은 거부한다(zip slip)
    if (UNSAFE.test(name)) problems.push(`${name}: 허용되지 않는 경로입니다`);
    else if (!listed.has(name)) problems.push(`${name}: manifest에 없는 파일입니다`);
  }
  return {
    ok: problems.length === 0,
    tag: manifest.tag,
    checked: manifest.files.length,
    signature,
    keyId: manifest.keyId,
    problems,
    warnings,
  };
}

// 매니페스트는 신뢰할 수 없는 입력이므로 필드 타입과 중복을 확인한다.
function checkShape(m: unknown): string | null {
  if (!m || typeof m !== 'object') return '객체가 아닙니다';
  const o = m as Record<string, unknown>;
  if (typeof o.tag !== 'string' || !o.tag) return 'tag가 없습니다';
  if (o.keyId !== undefined && typeof o.keyId !== 'string') return 'keyId가 문자열이 아닙니다';
  if (!Array.isArray(o.files)) return 'files가 배열이 아닙니다';
  const seen = new Set<string>();
  for (const [i, f] of o.files.entries()) {
    if (!f || typeof f !== 'object') return `files[${i}]가 객체가 아닙니다`;
    const { name, sha256: h, bytes } = f as Record<string, unknown>;
    if (typeof name !== 'string' || !name) return `files[${i}].name이 없습니다`;
    if (META.has(name)) return `files[${i}].name에 ${name}을 쓸 수 없습니다`;
    if (seen.has(name)) return `파일 이름이 중복됩니다: ${name}`;
    seen.add(name);
    if (typeof h !== 'string' || !HEX64.test(h)) return `files[${i}].sha256 형식이 아닙니다`;
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) return `files[${i}].bytes가 올바르지 않습니다`;
  }
  return null;
}
