import { createProvider } from './provider.js';

export function createWorkerProvider({
  workerUrl,
  accessToken,
  model,
  temperature = 0.9,
  maxTokens = 1024,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  if (!workerUrl) throw new Error('缺少 Worker 地址');
  return createProvider({
    endpoint: workerUrl,
    model,
    temperature,
    maxTokens,
    headers: accessToken ? { 'X-Access-Token': accessToken } : {},
    fetchImpl,
    signal,
  });
}
