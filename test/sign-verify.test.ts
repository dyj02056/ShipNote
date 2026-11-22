import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { pack, sha256 } from '../src/pack.ts';
import { verifyZip, LIMITS } from '../src/verify.ts';
import { keygen, keyId } from '../src/sign.ts';

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    pub: publicKey.export({ type: 'spki', format: 'pem' }) as string,
  };
};
const files = { 'A.md': '# a', 'B.md': '# b' };

describe('서명', () => {
  const k = pair();

  it('서명한 zip은 공개키로 검증된다', () => {
    const { zip, keyId: id } = pack('v1', files, k.priv);
    const r = verifyZip(zip, { pubkey: k.pub });
    expect(r).toMatchObject({ ok: true, signature: 'valid', keyId: id, problems: [] });
    expect(id).toBe(keyId(k.pub));
  });

  it('파일을 바꾸고 매니페스트를 다시 계산해도 서명에서 걸린다', () => {
    const e = unzipSync(pack('v1', files, k.priv).zip);
    e['A.md'] = strToU8('# 변조');
    const m = JSON.parse(new TextDecoder().decode(e['manifest.json']));
    m.files[0].sha256 = sha256(e['A.md']);
    m.files[0].bytes = e['A.md'].length;
    e['manifest.json'] = strToU8(JSON.stringify(m, null, 2));
    const forged = zipSync(e);
    // 공개키 없이 보면 일관성만 맞으므로 통과한다(서명의 필요성).
    expect(verifyZip(forged).ok).toBe(true);
    expect(verifyZip(forged).signature).toBe('unchecked');
    const r = verifyZip(forged, { pubkey: k.pub });
    expect(r.ok).toBe(false);
    expect(r.signature).toBe('invalid');
  });

  it('서명을 빼거나 다른 키로 확인하면 실패한다', () => {
    const e = unzipSync(pack('v1', files, k.priv).zip);
    delete e['manifest.sig'];
    expect(verifyZip(zipSync(e), { pubkey: k.pub })).toMatchObject({ ok: false, signature: 'missing' });
    expect(verifyZip(pack('v1', files, k.priv).zip, { pubkey: pair().pub })).toMatchObject({
      ok: false,
      signature: 'invalid',
    });
  });

  it('서명 없는 패키지는 경고와 함께 일관성만 확인한다', () => {
    const r = verifyZip(pack('v1', files).zip);
    expect(r).toMatchObject({ ok: true, signature: 'unsigned' });
    expect(r.warnings[0]).toContain('서명이 없는');
  });

  it('keygen은 키 쌍을 만들고 덮어쓰기를 거부한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shipnote-key-'));
    const kp = join(dir, 'shipnote.key');
    const r = keygen(kp);
    expect(existsSync(join(dir, 'shipnote.pub'))).toBe(true);
    const { zip } = pack('v1', files, readFileSync(kp, 'utf8'));
    expect(verifyZip(zip, { pubkey: readFileSync(r.pubPath, 'utf8') }).signature).toBe('valid');
    expect(() => keygen(kp)).toThrow('이미 있습니다');
  });
});

describe('zip 전체 해시', () => {
  it('기대값과 같으면 통과, 다르면 실패, 형식이 틀리면 실패', () => {
    const { zip } = pack('v1', files);
    expect(verifyZip(zip, { sha256: sha256(zip).toUpperCase() }).ok).toBe(true);
    expect(verifyZip(zip, { sha256: '0'.repeat(64) }).problems).toEqual(['zip 전체 해시가 기대값과 다릅니다']);
    expect(verifyZip(zip, { sha256: 'abc' }).ok).toBe(false);
  });
});

describe('크기 상한', () => {
  it('항목이 너무 많으면 거부한다', () => {
    const e: Record<string, Uint8Array> = {};
    for (let i = 0; i <= LIMITS.entries; i++) e[`f${i}.txt`] = strToU8('x');
    expect(verifyZip(zipSync(e)).problems[0]).toContain('항목이 너무 많습니다');
  });

  it('압축 해제 크기가 너무 큰 항목을 풀지 않고 거부한다', () => {
    const bomb = zipSync({ 'big.bin': new Uint8Array(LIMITS.entryBytes + 1) }, { level: 9 });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(verifyZip(bomb).problems[0]).toContain('너무 큽니다');
  });
});

describe('매니페스트 형식', () => {
  const withManifest = (m: unknown) => {
    const e = unzipSync(pack('v1', files).zip);
    e['manifest.json'] = strToU8(JSON.stringify(m));
    return verifyZip(zipSync(e));
  };
  const good = { name: 'A.md', sha256: sha256('# a'), bytes: 3 };

  it.each([
    ['files가 배열이 아님', { tag: 'v1', files: {} }, 'files가 배열이 아닙니다'],
    ['tag 없음', { files: [] }, 'tag가 없습니다'],
    ['이름 중복', { tag: 'v1', files: [good, good] }, '중복'],
    ['해시 형식', { tag: 'v1', files: [{ ...good, sha256: 'xyz' }] }, 'sha256 형식'],
    ['bytes 음수', { tag: 'v1', files: [{ ...good, bytes: -1 }] }, 'bytes'],
    ['예약된 이름', { tag: 'v1', files: [{ ...good, name: 'manifest.sig' }] }, '쓸 수 없습니다'],
  ])('%s', (_, m, msg) => {
    const r = withManifest(m);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain(msg);
  });

  it('크기가 기록과 다르면 실패한다', () => {
    const r = withManifest({ tag: 'v1', files: [{ ...good, bytes: 4 }, { name: 'B.md', sha256: sha256('# b'), bytes: 3 }] });
    expect(r.problems).toEqual(['A.md: 크기가 다릅니다']);
  });
});
