// Tests for the Worker's chat routes with mocked Workers AI and KV bindings.
// Run with: npm test   (Node 18+, no extra dependencies)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

// In-memory stand-in for a KV namespace.
function mockKV() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

// Fake Workers AI binding. With stream: true it returns a ReadableStream that
// emits `sseText` split into small chunks, so events (and multi-byte
// characters) are cut across chunk boundaries the way a network would.
function mockAI({ reply = 'Hello world', sseText, chunkSize = 7 } = {}) {
  const calls = [];
  return {
    calls,
    async run(model, options) {
      calls.push({ model, options });
      if (!options.stream) return { response: reply };
      const bytes = new TextEncoder().encode(sseText);
      let offset = 0;
      return new ReadableStream({
        pull(controller) {
          if (offset >= bytes.length) return controller.close();
          controller.enqueue(bytes.slice(offset, offset + chunkSize));
          offset += chunkSize;
        },
      });
    },
  };
}

function sseFromTokens(tokens) {
  return tokens.map((t) => `data: ${JSON.stringify({ response: t })}\n\n`).join('') + 'data: [DONE]\n\n';
}

function post(path, body) {
  return new Request('https://worker.test' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function parseEvents(text) {
  return text
    .split('\n\n')
    .filter((raw) => raw.trim())
    .map((raw) => {
      const event = raw.match(/^event: (.*)$/m)[1];
      const data = JSON.parse(raw.match(/^data: (.*)$/m)[1]);
      return { event, data };
    });
}

test('stream relays tokens in order and saves the full reply to history', async () => {
  const tokens = ['Gradient', ' descent', ' steps', ' downhill', ' é∂', '.'];
  const env = { AI: mockAI({ sseText: sseFromTokens(tokens) }), STUDY_DATA: mockKV() };

  const res = await worker.fetch(post('/api/chat/stream', { message: 'Explain GD', userId: 'u1' }), env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type'), /text\/event-stream/);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');

  const events = parseEvents(await res.text());
  const streamed = events.filter((e) => e.event === 'token').map((e) => e.data.token);
  assert.deepEqual(streamed, tokens);
  assert.deepEqual(events.at(-1), { event: 'done', data: { historyLength: 2 } });

  const history = JSON.parse(env.STUDY_DATA.store.get('chat_history_u1'));
  assert.deepEqual(history, [
    { role: 'user', content: 'Explain GD' },
    { role: 'assistant', content: tokens.join('') },
  ]);
  assert.equal(env.AI.calls[0].options.stream, true);
});

test('stream handles CRLF line endings and ignores malformed lines', async () => {
  const sseText = 'data: {"response":"A"}\r\n\r\ndata: not-json\r\n\r\ndata: {"response":"B"}\r\n\r\ndata: [DONE]\r\n\r\n';
  const env = { AI: mockAI({ sseText, chunkSize: 3 }), STUDY_DATA: mockKV() };
  const res = await worker.fetch(post('/api/chat/stream', { message: 'hi', userId: 'u2' }), env);
  const events = parseEvents(await res.text());
  assert.deepEqual(events.map((e) => e.event), ['token', 'token', 'done']);
  assert.equal(events.map((e) => e.data.token).join(''), 'AB');
});

test('stream sends prior history to the model', async () => {
  const kv = mockKV();
  kv.store.set('chat_history_u3', JSON.stringify([
    { role: 'user', content: 'earlier' },
    { role: 'assistant', content: 'reply' },
  ]));
  const env = { AI: mockAI({ sseText: sseFromTokens(['ok']) }), STUDY_DATA: kv };
  await (await worker.fetch(post('/api/chat/stream', { message: 'now', userId: 'u3' }), env)).text();

  const roles = env.AI.calls[0].options.messages.map((m) => m.role);
  assert.deepEqual(roles, ['system', 'user', 'assistant', 'user']);
  assert.equal(JSON.parse(kv.store.get('chat_history_u3')).length, 4);
});

test('history is capped at 20 messages', async () => {
  const kv = mockKV();
  const old = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
  kv.store.set('chat_history_u4', JSON.stringify(old));
  const env = { AI: mockAI({ sseText: sseFromTokens(['new']) }), STUDY_DATA: kv };
  const events = parseEvents(await (await worker.fetch(post('/api/chat/stream', { message: 'q', userId: 'u4' }), env)).text());

  assert.deepEqual(events.at(-1), { event: 'done', data: { historyLength: 20 } });
  const saved = JSON.parse(kv.store.get('chat_history_u4'));
  assert.equal(saved.length, 20);
  assert.equal(saved[0].content, 'm2');
  assert.equal(saved.at(-1).content, 'new');
});

test('empty model output sends an error event and saves nothing', async () => {
  const env = { AI: mockAI({ sseText: 'data: [DONE]\n\n' }), STUDY_DATA: mockKV() };
  const events = parseEvents(await (await worker.fetch(post('/api/chat/stream', { message: 'q', userId: 'u5' }), env)).text());
  assert.deepEqual(events, [{ event: 'error', data: { error: 'The model returned an empty response' } }]);
  assert.equal(env.STUDY_DATA.store.size, 0);
});

test('bad requests get JSON 400s', async () => {
  const env = { AI: mockAI(), STUDY_DATA: mockKV() };
  const missing = await worker.fetch(post('/api/chat/stream', { message: 'no user' }), env);
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).success, false);

  const notJson = await worker.fetch(post('/api/chat/stream', '{oops'), env);
  assert.equal(notJson.status, 400);
  assert.equal(env.AI.calls.length, 0);
});

test('non-streaming /api/chat still works', async () => {
  const env = { AI: mockAI({ reply: 'Full reply' }), STUDY_DATA: mockKV() };
  const res = await worker.fetch(post('/api/chat', { message: 'hi', userId: 'u6' }), env);
  assert.deepEqual(await res.json(), { response: 'Full reply', success: true, historyLength: 2 });
});
