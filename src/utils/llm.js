import { CONFIG } from './config.js';

export const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 30000;

export class NoApiKey extends Error {
  constructor(message = 'Add a valid Groq API key in Settings to use AI features.') {
    super(message);
    this.name = 'NoApiKey';
  }
}

export class Http extends Error {
  constructor(status, message) {
    super(message || 'Groq API request failed (' + status + ').');
    this.name = 'Http';
    this.status = status;
  }
}

export class BadJson extends Error {
  constructor(message = 'Groq returned invalid JSON.') {
    super(message);
    this.name = 'BadJson';
  }
}

export class EmptyResponse extends Error {
  constructor(message = 'Groq returned an empty response. Please try again.') {
    super(message);
    this.name = 'EmptyResponse';
  }
}

function responseText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim();
  }
  return '';
}

function parseJson(text) {
  let candidate = String(text || '').trim();
  const fenced = candidate.match(/^\x60{3}(?:json)?\s*([\s\S]*?)\s*\x60{3}$/i);
  if (fenced) candidate = fenced[1].trim();
  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw new BadJson(error.message);
  }
}

async function requestModel({
  apiKey,
  model,
  system,
  messages,
  maxTokens,
  reasoningEffort,
  includeReasoning,
  tools,
  toolChoice,
  citationOptions,
  temperature,
  json,
  fetchImpl,
  timeoutMs
}) {
  const fetchFunction = fetchImpl || globalThis.fetch;
  if (typeof fetchFunction !== 'function') {
    throw new Http(0, 'Fetch is unavailable in this environment.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const requestMessages = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages;
  const body = { model, max_completion_tokens: maxTokens, messages: requestMessages };
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  if (includeReasoning !== undefined) body.include_reasoning = includeReasoning;
  if (json) body.response_format = { type: 'json_object' };
  if (Array.isArray(tools) && tools.length) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;
  if (citationOptions) body.citation_options = citationOptions;
  if (temperature !== undefined) body.temperature = temperature;

  try {
    const response = await fetchFunction(GROQ_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    let data = {};
    try {
      data = await response.json();
    } catch (_) {
      data = {};
    }
    if (!response.ok) {
      const message = data?.error?.message || 'Groq API request failed (' + response.status + ').';
      if (response.status === 401) throw new NoApiKey(message);
      throw new Http(response.status, message);
    }
    return responseText(data);
  } catch (error) {
    if (error instanceof NoApiKey || error instanceof Http) throw error;
    if (error?.name === 'AbortError') throw new Http(0, 'Groq request timed out.');
    throw new Http(0, error?.message || 'Could not reach Groq.');
  } finally {
    clearTimeout(timeout);
  }
}

export async function callModel(options = {}) {
  const apiKey = String(options.apiKey || '').trim();
  if (!apiKey) throw new NoApiKey();

  const json = Boolean(options.json);
  const initialMessages = Array.isArray(options.messages)
    ? options.messages
    : [{ role: 'user', content: String(options.prompt || '') }];
  const system = [
    options.system || '',
    json ? 'Return valid JSON only. Do not include Markdown fences or explanatory text.' : ''
  ].filter(Boolean).join('\n\n');
  const requestOptions = {
    apiKey,
    model: options.model || CONFIG.models.fast,
    system,
    maxTokens: options.maxTokens || 1000,
    reasoningEffort: options.reasoningEffort || 'low',
    includeReasoning: false,
    json,
    tools: options.tools,
    toolChoice: options.toolChoice,
    citationOptions: options.citationOptions,
    temperature: options.temperature,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS
  };

  let text = await requestModel({ ...requestOptions, messages: initialMessages });
  if (!text && !json) throw new EmptyResponse();
  if (!json) return text;

  try {
    return parseJson(text);
  } catch (firstError) {
    const retryMessages = initialMessages.concat([
      { role: 'assistant', content: text },
      { role: 'user', content: 'The previous response was not valid JSON. Return the same information as valid JSON only.' }
    ]);
    text = await requestModel({ ...requestOptions, messages: retryMessages });
    try {
      return parseJson(text);
    } catch (secondError) {
      throw new BadJson(secondError.message || firstError.message);
    }
  }
}
