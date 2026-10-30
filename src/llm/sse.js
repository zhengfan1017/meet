export function createSSEParser() {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      const lines = [];
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '').trim();
        buffer = buffer.slice(idx + 1);
        if (line !== '') lines.push(line);
      }
      return lines;
    },
    flush() {
      const line = buffer.trim();
      buffer = '';
      return line ? [line] : [];
    },
  };
}

export function parseSSELine(line) {
  if (!line || !line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (payload === '[DONE]') return 'DONE';
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
