const DAY = 86400000;

export function pickMemories(memories, { limit = 8 } = {}) {
  const list = Array.isArray(memories) ? memories : [];
  const pinned = list.filter((m) => m.pinned);
  const rest = list
    .filter((m) => !m.pinned)
    .map((m) => {
      const age = (Date.now() - (m.lastUsedAt || m.createdAt || 0)) / DAY;
      return { m, score: (m.hits || 0) * 10 - age };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.m);
  return { pinned, top: rest.slice(0, limit) };
}

export function formatMemoryBlock(memories) {
  if (!memories || memories.length === 0) return '';
  return `\n[记忆]\n${memories.map((m) => `- ${m.text}`).join('\n')}`;
}

export function buildContext({ systemPrompt = '', memories = [], messages = [], limit = 8 }) {
  const { pinned, top } = pickMemories(memories, { limit });
  const used = [...pinned, ...top];
  return {
    system: `${systemPrompt}${formatMemoryBlock(used)}`,
    messages,
    usedMemoryIds: used.map((m) => m.id),
  };
}
