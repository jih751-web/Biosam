import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const helperPath = new URL('./dist/drive-photos.js', import.meta.url);
const MiB = 1024 * 1024;
function setup(options = {}) {
  assert.ok(fs.existsSync(helperPath), 'browser Drive photo helper exists');
  const requests = [], canvases = [], encodes = [];
  let closed = 0, sessions = 0;
  const context = {
    window: {}, Blob, URL, Error, Uint8Array,
    createImageBitmap: async () => ({ width: options.width || 4000, height: options.height || 3000, close() { closed++; } }),
    document: { createElement() {
      const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }),
        toBlob(callback, type, quality) { encodes.push({ width: canvas.width, height: canvas.height, type, quality }); callback(new Blob([new Uint8Array(options.encodeSize ? options.encodeSize(canvas, quality) : 1024)], { type: options.encodeType || type })); } };
      canvases.push(canvas); return canvas;
    } },
    fetch: async (url, init = {}) => {
      requests.push({ url, ...init });
      if (options.fetch) return options.fetch(url, init, requests);
      if (url.includes('action=status')) return Response.json({ configured: true });
      if (url.includes('action=init')) return Response.json({ sessions: Object.fromEntries(['original', 'display', 'thumb'].map(v => [v, { ticket: v }])) });
      if (url.includes('action=media')) return new Response(new Blob(['photo'], { type: 'image/webp' }));
      return Response.json({ complete: true });
    },
  };
  vm.runInNewContext(fs.readFileSync(helperPath, 'utf8'), context);
  const api = context.window.createBioSEMDrivePhotos({ client: () => ({ auth: { getSession: async () => { sessions++; return { data: { session: options.token ? options.token(sessions) : { access_token: 'session-token' } } }; } } }) });
  return { api, requests, canvases, encodes, closed: () => closed };
}
const photo = (size = 2 * MiB + 9, type = 'image/jpeg') => new Blob([new Uint8Array(size)], { type });
const attachment = { id: '01234567-89ab-4cde-8123-456789abcdef' };

test('status fails closed on network and malformed configuration', async () => {
  for (const fetch of [async () => { throw new Error('offline'); }, async () => Response.json(null), async () => Response.json({ configured: 'true' }), async () => new Response('', { status: 500 })]) {
    assert.equal((await setup({ fetch }).api.status()).configured, false);
  }
});
test('upload preserves original bytes, resizes previews, and authenticates every bounded chunk', async () => {
  const s = setup(), original = photo(), progress = [];
  await s.api.upload(attachment, original, text => progress.push(text));
  const writes = s.requests.filter(r => r.method === 'POST');
  assert.equal(writes[0].url, '/api/drive?action=init');
  assert.deepEqual(JSON.parse(writes[0].body), { attachmentId: attachment.id, displayBytes: 1024, thumbBytes: 1024 });
  assert.ok(writes.every(r => r.headers.Authorization === 'Bearer session-token'));
  const chunks = writes.filter(r => r.url.includes('action=chunk'));
  assert.deepEqual(chunks.map(r => r.headers['x-upload-ticket']), ['original', 'original', 'original', 'display', 'thumb']);
  assert.deepEqual(chunks.slice(0, 3).map(r => Number(r.headers['x-upload-offset'])), [0, MiB, 2 * MiB]);
  assert.ok(chunks.every(r => r.body.size <= MiB));
  assert.deepEqual(await new Blob(chunks.slice(0, 3).map(r => r.body)).arrayBuffer(), await original.arrayBuffer());
  assert.deepEqual(s.encodes.map(c => [c.width, c.height]), [[2048, 1536], [600, 450]]);
  assert.ok(s.encodes.every(c => c.type === 'image/webp'));
  assert.equal(writes.at(-1).url, '/api/drive?action=complete');
  assert.equal(s.closed(), 1);
  assert.ok(progress.length > 0 && progress.every(p => typeof p === 'string'));
});
test('upload rejects unsupported files, oversize files, and decoded image bombs before init', async () => {
  for (const [options, file] of [[{}, photo(10, 'image/gif')], [{}, photo(50 * MiB + 1)], [{ width: 10000, height: 10000 }, photo()]]) {
    const s = setup(options);
    await assert.rejects(() => s.api.upload(attachment, file));
    assert.equal(s.requests.filter(r => r.method === 'POST').length, 0);
  }
});
test('previews lower quality then shrink dimensions to meet byte budgets', async () => {
  const s = setup({ encodeSize: (c) => c.width > 400 ? 2 * MiB : 1000 });
  await s.api.upload(attachment, photo());
  assert.ok(s.encodes.length > 2);
  assert.ok(s.encodes.some(c => c.width < 600));
  assert.ok(s.encodes.some(c => c.quality < 0.8));
});
test('missing auth on any write aborts upload without completing', async () => {
  const s = setup({ token: count => count === 1 ? { access_token: 'first' } : null });
  await assert.rejects(() => s.api.upload(attachment, photo()), /로그인/);
  assert.equal(s.requests.filter(r => r.method === 'POST').length, 1);
});
test('unsupported WebP encoder aborts instead of sending PNG previews', async () => {
  const s = setup({ encodeType: 'image/png' });
  await assert.rejects(() => s.api.upload(attachment, photo()));
  assert.equal(s.requests.filter(r => r.method === 'POST').length, 0);
});
test('download permits display and thumb only, and returns error shape', async () => {
  const s = setup({ token: () => null });
  assert.equal((await s.api.download(attachment)).data.type, 'image/webp');
  assert.equal((await s.api.download(attachment, 'thumb')).error, null);
  const count = s.requests.length;
  assert.ok((await s.api.download(attachment, 'original')).error);
  assert.equal(s.requests.length, count);
  assert.ok(s.requests.every(r => !r.headers?.Authorization));
});
test('remove deletes each attachment with current auth and propagates errors', async () => {
  const s = setup();
  assert.equal((await s.api.remove([attachment, { id: 'second' }])).error, null);
  assert.deepEqual(s.requests.map(r => JSON.parse(r.body).attachmentId), [attachment.id, 'second']);
  assert.ok(s.requests.every(r => r.url === '/api/drive?action=delete' && r.headers.Authorization));
  assert.ok((await setup({ token: () => null }).api.remove([attachment])).error);
});
test('server failure aborts configured uploads without any fallback or completion', async () => {
  const s = setup({ fetch: async (url) => {
    if (url.includes('action=init')) return Response.json({ sessions: Object.fromEntries(['original', 'display', 'thumb'].map(v => [v, { ticket: v }])) });
    return Response.json({ error: 'unavailable' }, { status: 503 });
  } });
  await assert.rejects(() => s.api.upload(attachment, photo()));
  assert.deepEqual(s.requests.map(r => r.url), ['/api/drive?action=init', '/api/drive?action=chunk']);
});
test('small originals are not upscaled and auth is refreshed for media reads', async () => {
  const s = setup({ width: 200, height: 100, token: count => ({ access_token: 'token-' + count }) });
  await s.api.upload(attachment, photo(10));
  assert.ok(s.encodes.every(c => c.width === 200 && c.height === 100));
  assert.equal((await s.api.download(attachment, 'thumb')).error, null);
  const tokens = s.requests.map(r => r.headers.Authorization);
  assert.equal(new Set(tokens).size, tokens.length);
});
test('HTTP download failures cannot be returned as successful image blobs', async () => {
  const s = setup({ fetch: async () => new Response('forbidden', { status: 403 }) });
  const result = await s.api.download(attachment);
  assert.equal(result.data, null);
  assert.ok(result.error);
});
