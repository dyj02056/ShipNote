// 웹훅 알림. 실패해도 릴리스는 성공으로 두고 경고만 낸다.
export async function notify(url: string, payload: unknown, timeoutMs = 5000): Promise<boolean> {
  try {
    if (!/^https?:$/.test(new URL(url).protocol)) throw new Error('http(s) URL만 쓸 수 있습니다');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`응답 ${res.status}`);
    return true;
  } catch (e) {
    console.warn(`웹훅 전송 실패: ${(e as Error).message}`);
    return false;
  }
}
