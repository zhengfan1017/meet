// 模型名探测
//
// 方舟的模型 ID 必须带日期后缀（doubao-seed-2-1-pro-260915），
// 而控制台里显示的名字（doubao-seed-2-1-pro）直接填进去必然 404。
// 用户很容易抄错，所以这里做一件事：拿到 404 时，逐个试一遍候选 ID，
// 找出那个真的能用的，直接告诉用户「你该用这个」。

// 方舟当前在线的对话模型（2026-10 拉取自 /api/v3/models，status 非 Shutdown）
export const MODEL_CANDIDATES = [
  'doubao-seed-2-1-pro-260915',
  'doubao-seed-2-1-pro-260628',
  'doubao-seed-2-1-turbo-260628',
  'doubao-seed-2-1-lite-260915',
  'doubao-seed-2-0-mini-260428',
  'doubao-seed-2-0-lite-260428',
];

// 返回第一个能用的模型 ID；全都不能用就返回 null。
// 401/403（Key 不对）、429（额度用完）、网络错误都不继续试 —— 换了模型也没用。
export async function findWorkingModel({
  endpoint,
  apiKey,
  model,
  candidates = MODEL_CANDIDATES,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  if (!endpoint || !apiKey) return null;

  const list = [];
  if (model) list.push(model);
  for (const c of candidates) {
    if (list.indexOf(c) === -1) list.push(c);
  }

  for (const id of list) {
    let res;
    try {
      res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        body: JSON.stringify({
          model: id,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal,
      });
    } catch {
      // 网络不通，继续试下一个也没意义
      return null;
    }
    if (res.ok) return id;
    // Key 不对 / 额度用完 / 服务端故障：换模型解决不了
    if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) {
      return null;
    }
    // 404：模型名不对，继续试下一个
  }
  return null;
}
