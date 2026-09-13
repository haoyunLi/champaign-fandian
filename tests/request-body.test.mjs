import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PayloadTooLargeError, readRequestText } from '../src/lib/request-body.ts';
import { formatMealDateTime } from '../src/lib/meal-date.ts';

test('stream stops after byte limit even without truthful Content-Length', async () => {
  for (const length of [null, '1']) {
    let pulled = 0, cancelled = false;
    const body = new ReadableStream({ pull(controller) { pulled++; controller.enqueue(new Uint8Array(4096)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const request = new Request('https://example.test', { method: 'POST', body, duplex: 'half', headers: length ? { 'Content-Length': length } : {} });
    await assert.rejects(readRequestText(request), PayloadTooLargeError);
    assert.equal(pulled, 5); assert.equal(cancelled, true);
  }
});
test('oversized declared body is cancelled before reading', async () => {
  let pulled = 0, cancelled = false;
  const body = new ReadableStream({ pull() { pulled++; }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const request = new Request('https://example.test', { method: 'POST', body, duplex: 'half', headers: { 'Content-Length': '1000000' } });
  await assert.rejects(readRequestText(request), PayloadTooLargeError);
  assert.equal(pulled, 0); assert.equal(cancelled, true);
});
test('Chinese text split across chunks survives exact byte limit', async () => {
  const text = '香槟今天吃什么？', bytes = new TextEncoder().encode(text);
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  assert.equal(await readRequestText(new Request('https://example.test', { method: 'POST', body, duplex: 'half' }), bytes.length), text);
});
test('Champaign dates stay consistent in winter, summer and across midnight', () => {
  assert.equal(formatMealDateTime('2026-01-02T05:30:00.000Z'), '2026年01月01日 23:30');
  assert.equal(formatMealDateTime('2026-07-02T05:30:00.000Z'), '2026年07月02日 00:30');
  assert.equal(formatMealDateTime('invalid'), '日期未知');
});
