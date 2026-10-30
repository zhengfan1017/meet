import { createProvider } from './provider.js';

export const DEFAULT_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
export const DEFAULT_MODEL = 'doubao-seed-1-6-250615';

export function createDoubaoProvider({
  endpoint = DEFAULT_ENDPOINT,
  apiKey,
  model = DEFAULT_MODEL,
  temperature = 0.9,
  maxTokens = 1024,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  return createProvider({ endpoint, apiKey, model, temperature, maxTokens, fetchImpl, signal });
}
