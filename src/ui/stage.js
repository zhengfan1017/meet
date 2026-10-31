import { EMO_LABELS, EMO_SPRITE, DEFAULT_EMO, spritePath } from '../mood.js';

const LOCK_MS = 30000;

export function createStage(root) {
  const img = document.createElement('img');
  img.className = 'stage-sprite';
  img.alt = 'Trae宝';
  root.appendChild(img);

  let current = DEFAULT_EMO;
  let lockedUntil = 0;
  let manual = false;

  function render(emo) {
    current = emo;
    img.dataset.emo = emo;
    img.src = spritePath(emo, 'gif');
    img.onerror = () => { img.src = spritePath(emo, 'png'); };
    const meta = EMO_SPRITE[emo];
    root.setAttribute('aria-label', (meta && meta.desc) || '');
  }

  function setEmotion(emo, { force = false } = {}) {
    if (!EMO_LABELS.includes(emo)) return false;
    if (!force && manual && Date.now() < lockedUntil) return false;
    render(emo);
    return true;
  }

  function setManual(emo) {
    manual = true;
    lockedUntil = Date.now() + LOCK_MS;
    render(emo);
  }

  function releaseLock() {
    manual = false;
    lockedUntil = 0;
  }

  let streamTimer = null;
  function startStreaming() {
    if (streamTimer) return;
    let tick = 0;
    streamTimer = setInterval(() => {
      if (manual && Date.now() < lockedUntil) return;
      tick += 1;
      render(tick % 2 === 0 ? 'think' : 'cheer');
    }, 2500);
  }

  function stopStreaming() {
    if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
  }

  render(DEFAULT_EMO);

  root.addEventListener('click', () => {
    stopStreaming();
    const order = EMO_LABELS;
    const next = order[(order.indexOf(current) + 1) % order.length];
    setManual(next);
  });

  return {
    element: root,
    get current() { return current; },
    setEmotion,
    setManual,
    releaseLock,
    startStreaming,
    stopStreaming,
    isLocked: () => manual && Date.now() < lockedUntil,
  };
}
