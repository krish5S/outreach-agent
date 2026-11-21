import test from 'node:test';
import assert from 'node:assert/strict';
import { callModel, NoApiKey, Http, BadJson } from '../src/utils/llm.js';

function fakeResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; }
  };
}

function messageResponse(text) {
  return fakeResponse({ choices: [{ message: { content: text } }] });
}

test('callModel sends Groq chat-completions headers and returns text', async () => {
  let request;
  const result = await callModel({
    apiKey: 'test-key',
    model: 'openai/gpt-oss-20b',
    maxTokens: 64,
    messages: [{ role: 'user', content: 'Say hello.' }],
    fetchImpl: async (url, options) => {
      request = { url, options };
      return messageResponse('Hello.');
    }
  });
  assert.equal(result, 'Hello.');
  assert.equal(request.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  assert.equal(JSON.parse(request.options.body).model, 'openai/gpt-oss-20b');
  assert.equal(JSON.parse(request.options.body).max_completion_tokens, 64);
});

test('callModel forwards Groq browser-search tool options without enabling JSON mode', async () => {
  let request;
  await callModel({
    apiKey: 'test-key',
    model: 'openai/gpt-oss-20b',
    messages: [{ role: 'user', content: 'Search for recent news.' }],
    tools: [{ type: 'browser_search' }],
    toolChoice: 'required',
    citationOptions: 'disabled',
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return messageResponse('{"results":[]}');
    }
  });
  assert.deepEqual(request.tools, [{ type: 'browser_search' }]);
  assert.equal(request.tool_choice, 'required');
  assert.equal(request.citation_options, 'disabled');
  assert.equal(request.response_format, undefined);
});

test('callModel requests JSON mode and parses JSON enclosed in Markdown fences', async () => {
  const fence = String.fromCharCode(96).repeat(3);
  let request;
  const result = await callModel({
    apiKey: 'test-key',
    json: true,
    messages: [{ role: 'user', content: 'Return JSON.' }],
    fetchImpl: async (_url, options) => {
      request = options;
      return messageResponse(fence + 'json\n{"ok":true}\n' + fence);
    }
  });
  assert.deepEqual(JSON.parse(request.body).response_format, { type: 'json_object' });
  assert.deepEqual(result, { ok: true });
});

test('callModel retries once when the first JSON response is invalid', async () => {
  let calls = 0;
  const result = await callModel({
    apiKey: 'test-key',
    json: true,
    messages: [{ role: 'user', content: 'Return JSON.' }],
    fetchImpl: async () => {
      calls += 1;
      return messageResponse(calls === 1 ? 'not json' : '{"fixed":true}');
    }
  });
  assert.equal(calls, 2);
  assert.deepEqual(result, { fixed: true });
});

test('callModel reports a rejected key as NoApiKey', async () => {
  await assert.rejects(
    callModel({
      apiKey: 'invalid-test-key',
      messages: [{ role: 'user', content: 'Hello.' }],
      fetchImpl: async () => fakeResponse({ error: { message: 'Invalid API key.' } }, 401)
    }),
    NoApiKey
  );
});

test('callModel reports other HTTP failures with their status', async () => {
  await assert.rejects(
    callModel({
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'Hello.' }],
      fetchImpl: async () => fakeResponse({ error: { message: 'Service unavailable.' } }, 503)
    }),
    (error) => error instanceof Http && error.status === 503
  );
});

test('callModel reports invalid JSON after its single retry', async () => {
  let calls = 0;
  await assert.rejects(
    callModel({
      apiKey: 'test-key',
      json: true,
      messages: [{ role: 'user', content: 'Return JSON.' }],
      fetchImpl: async () => {
        calls += 1;
        return messageResponse('still not json');
      }
    }),
    BadJson
  );
  assert.equal(calls, 2);
});

test('callModel rejects an absent key without making a request', async () => {
  let called = false;
  await assert.rejects(
    callModel({
      messages: [{ role: 'user', content: 'Hello.' }],
      fetchImpl: async () => { called = true; return messageResponse('Hello.'); }
    }),
    NoApiKey
  );
  assert.equal(called, false);
});
