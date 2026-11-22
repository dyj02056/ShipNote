import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Ed25519 서명. 비밀키는 보내는 쪽만, 공개키는 받는 쪽에 따로 전달한다.

export function pubPathFor(keyPath: string): string {
  return keyPath.endsWith('.key') ? `${keyPath.slice(0, -4)}.pub` : `${keyPath}.pub`;
}

export function keygen(keyPath: string, force = false): { keyPath: string; pubPath: string; keyId: string } {
  const pubPath = pubPathFor(keyPath);
  if (!force && (existsSync(keyPath) || existsSync(pubPath))) {
    throw new Error(`키 파일이 이미 있습니다: ${keyPath} (--force로 교체)`);
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
  return { keyPath, pubPath, keyId: keyId(publicKey) };
}

// 공개키 지문. 매니페스트에 적어 두면 어떤 키로 서명했는지 확인할 수 있다.
export function keyId(key: KeyObject | string): string {
  const k = typeof key === 'string' ? (key.includes('PRIVATE') ? createPrivateKey(key) : createPublicKey(key)) : key;
  const pub = k.type === 'private' ? createPublicKey(k) : k;
  return createHash('sha256').update(pub.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
}

export function readKey(path: string): string {
  return readFileSync(path, 'utf8');
}

export function signBytes(data: Uint8Array, privatePem: string): string {
  return sign(null, data, privatePem).toString('base64');
}

export function verifyBytes(data: Uint8Array, sigB64: string, publicPem: string): boolean {
  try {
    return verify(null, data, publicPem, Buffer.from(sigB64.trim(), 'base64'));
  } catch {
    return false;
  }
}
