import { createSSEParser, parseSSELine } from './sse.js';

export class ProviderError extends Error {
  constructor(kind, message, status, detail) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
    this.detail = detail || '';
  }
}

function classifyStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'notfound';
  if (status === 429) return 'quota';
  if (status >= 500) return 'server';
  return 'http';
}

// 上游（方舟 / Worker）返回的错误体里有真正的原因，扒出来给用户看
function extractDetail(raw) {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    const err = parsed && parsed.error ? parsed.error : null;
    if (!err) return '';
    const code = err.code ? String(err.code) : '';
    const msg = err.message ? String(err.message) : '';
    if (code && msg) return code + '：' + msg;
    return code || msg;
  } catch {
    return '';
  }
}

export function createProvider({
  endpoint,
  apiKey,
  model,
  temperature = 0.9,
  maxTokens = 1024,
  headers = {},
  fetchImpl = globalThis.fetch,
  signal,
}) {
  return {
    async *stream({ system, messages }) {
      let res;
      try {
        res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            ...headers,
          },
          body: JSON.stringify({
            model,
            temperature,
            max_tokens: maxTokens,
            stream: true,
            messages: [{ role: 'system', content: system }, ...messages],
          }),
          signal,
        });
      } catch (err) {
        if (err && err.name === 'AbortError') throw new ProviderError('timeout', '请求超时了', 0);
        throw new ProviderError('network', '连不上模型，可能是网络或跨域被拦', 0);
      }

      if (!res.ok) {
        const kind = classifyStatus(res.status);
        let raw = '';
        try { raw = (await res.text()).slice(0, 500); } catch { raw = ''; }
        const detail = extractDetail(raw);
        const messages = {
          auth: 'API Key 不对，检查一下设置面板里的 Key',
          notfound: '模型名或接口地址不对，去设置面板核对一下',
          quota: '额度用完了，去控制台充值或换个模型',
          server: '模型服务出错了，稍后再试',
          http: `请求失败（${res.status}）`,
        };
        throw new ProviderError(kind, messages[kind] || '请求失败', res.status, detail);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = createSSEParser();
      let yielded = false;

      const handle = (line) => {
        const data = parseSSELine(line);
        if (data === null || data === 'DONE') return data;
        // 不用可选链，老版本 Chromium（小米浏览器）解析不了会整块报错
        const choices = data.choices;
        const choice = Array.isArray(choices) ? choices[0] : null;
        const delta = choice && choice.delta ? choice.delta.content : undefined;
        return typeof delta === 'string' ? delta : null;
      };

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          for (const line of parser.push(text)) {
            const delta = handle(line);
            if (delta === 'DONE') return;
            if (typeof delta === 'string' && delta !== '') {
              yielded = true;
              yield delta;
            }
          }
        }
        for (const line of parser.flush()) {
          const delta = handle(line);
          if (typeof delta === 'string' && delta !== '') {
            yielded = true;
            yield delta;
          }
        }
      } catch (err) {
        if (err && err.name === 'AbortError') throw new ProviderError('timeout', '请求超时了', 0);
        throw new ProviderError(
          yielded ? 'interrupted' : 'network',
          yielded ? '断了，可以再发一次' : '连不上模型，可能是网络或跨域被拦',
          0,
        );
      }
    },
  };
}
