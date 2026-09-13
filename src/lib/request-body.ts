export class PayloadTooLargeError extends Error {}

// Enforce the limit while reading: Content-Length is optional and untrusted.
export async function readRequestText(request: Request, limit = 16_384): Promise<string> {
  const length = request.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > limit) {
    await request.body?.cancel();
    throw new PayloadTooLargeError();
  }
  const reader = request.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}
