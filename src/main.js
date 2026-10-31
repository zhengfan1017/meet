import { createStage } from './ui/stage.js';
import { createTimeline } from './ui/timeline.js';
import { createComposer } from './ui/composer.js';
import { createSettings } from './ui/settings.js';
import { createDefaultStore } from './memory/store.js';
import { buildContext } from './memory/retriever.js';
import { extractTags, stripMarkers } from './memory/extractor.js';
import { buildSystemPrompt } from './llm/prompt.js';
import { createDoubaoProvider } from './llm/doubao.js';
import { createWorkerProvider } from './llm/worker.js';

const stage = createStage(document.getElementById('stage'));
const timeline = createTimeline(document.getElementById('timeline'));
const banner = document.getElementById('banner');
const settingsRoot = document.getElementById('settings');

// 用顶层 let 而不是顶层 await：老版本 Chromium（小米浏览器 MIUI 12 时代）
// 不支持 top-level await，顶层 await 会让整个模块解析失败、页面白屏。
let store = null;
let session = null;
let composer = null;
let settings = null;
let busy = false;

function showBanner(text) {
  if (!text) { banner.hidden = true; return; }
  banner.textContent = text;
  banner.hidden = false;
}

function openSettings() {
  settingsRoot.hidden = false;
  if (settings) settings.load();
}

async function buildProvider() {
  const mode = (await store.getKV('mode')) || 'direct';
  if (mode === 'worker') {
    return createWorkerProvider({
      workerUrl: await store.getKV('workerUrl'),
      accessToken: await store.getKV('accessToken'),
      model: (await store.getKV('model')) || 'doubao-seed-1-6-250615',
    });
  }
  return createDoubaoProvider({
    endpoint: (await store.getKV('endpoint')) || undefined,
    apiKey: await store.getKV('apiKey'),
    model: (await store.getKV('model')) || undefined,
  });
}

const ERROR_HINTS = {
  network: '连不上模型。如果是跨域被拦，去设置里换成 Worker 代理。',
  interrupted: '断了，可以再发一次。',
  auth: 'API Key 不对，去设置面板改一下。',
  quota: '额度用完了，去控制台充值。',
  server: '模型服务出错了，稍后再试。',
  timeout: '请求超时了，再试一次。',
};

async function runStream(bubble, ctx) {
  const provider = await buildProvider();
  let raw = '';
  let rendered = '';
  stage.startStreaming();
  try {
    for await (const delta of provider.stream({ system: ctx.system, messages: ctx.messages })) {
      raw += delta;
      const visible = stripMarkers(raw);
      if (visible.length > rendered.length && visible.startsWith(rendered)) {
        timeline.appendText(bubble, visible.slice(rendered.length));
      } else {
        timeline.setBubbleText(bubble, visible);
      }
      rendered = visible;
    }
  } finally {
    stage.stopStreaming();
  }
  return raw;
}

async function handleSend(text) {
  if (busy) return;
  const mode = (await store.getKV('mode')) || 'direct';
  if (mode !== 'worker' && !(await store.getKV('apiKey'))) {
    showBanner('还没填 API Key，点一下右上角「设置」填上。');
    openSettings();
    return;
  }
  busy = true;
  composer.setDisabled(true);
  showBanner('');

  await store.addMessage({ sessionId: session.id, role: 'user', content: text });
  timeline.addBubble('user', text);

  const bubble = timeline.beginAssistant();
  const memories = await store.listMemories();
  const recent = await store.listMessages(session.id, 12);
  const ctx = buildContext({
    systemPrompt: buildSystemPrompt(),
    memories,
    messages: recent.map((m) => ({ role: m.role, content: m.content })),
  });
  await store.markUsed(ctx.usedMemoryIds);

  let raw = '';
  try {
    raw = await runStream(bubble, ctx);
    if (raw.trim() === '') {
      // 空回复：温和重试一次
      timeline.setBubbleText(bubble, '');
      raw = await runStream(bubble, ctx);
    }
  } catch (err) {
    const kind = err && err.kind ? err.kind : 'unknown';
    showBanner(ERROR_HINTS[kind] || '出了点问题，再试一次。');
    const partial = extractTags(raw).content.trim();
    timeline.setBubbleText(bubble, partial || '（这次没能说完）');
    busy = false;
    composer.setDisabled(false);
    return;
  }

  if (raw.trim() === '') {
    showBanner('模型这次没回话，再试一次。');
    timeline.setBubbleText(bubble, '（这次没能说完）');
    busy = false;
    composer.setDisabled(false);
    return;
  }

  const parsed = extractTags(raw);
  timeline.setBubbleText(bubble, parsed.content);
  if (parsed.emo) stage.setEmotion(parsed.emo);
  for (const mem of parsed.memories) {
    await store.addMemory(mem);
  }
  await store.addMessage({
    sessionId: session.id,
    role: 'assistant',
    content: parsed.content,
    emo: parsed.emo,
  });
  await store.updateSession(session.id, { title: session.title === '新对话' ? text.slice(0, 20) : session.title });

  busy = false;
  composer.setDisabled(false);
}

window.addEventListener('offline', () => showBanner('没网了，等你回来。'));
window.addEventListener('online', () => showBanner(''));

// 安装引导：
// - 支持 beforeinstallprompt 的浏览器（Chrome / Edge）→ 给一键安装按钮
// - 不支持的（小米浏览器、微信内置、Firefox 等）→ 给手动添加说明
const installTip = document.getElementById('installTip');
let deferredPrompt = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: minimal-ui)').matches
    || window.navigator.standalone === true;
}

function showManualTip() {
  installTip.innerHTML = '';
  const hint = document.createElement('span');
  hint.className = 'install-hint';
  hint.textContent = '想放到桌面？用浏览器菜单里的「添加到桌面 / 新建快捷方式」。';
  installTip.appendChild(hint);
  installTip.hidden = false;
}

function showInstallButton() {
  installTip.innerHTML = '';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'install-btn';
  btn.textContent = '添加到桌面';
  btn.addEventListener('click', async () => {
    const prompt = deferredPrompt;
    if (!prompt) { showManualTip(); return; }
    await prompt.prompt();
    const choice = await prompt.userChoice;
    deferredPrompt = null;
    // 用户点了取消 → 退回手动说明，别让提示直接消失
    if (choice && choice.outcome === 'accepted') installTip.hidden = true;
    else showManualTip();
  });
  installTip.appendChild(btn);
  installTip.hidden = false;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (!isStandalone()) showInstallButton();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  installTip.hidden = true;
});

if (isStandalone()) {
  installTip.hidden = true;
} else if (!('onbeforeinstallprompt' in window)) {
  showManualTip();
} else {
  // 有些浏览器有 API 但不触发（比如小米浏览器）：延迟一点后仍无事件就给手动说明
  setTimeout(() => {
    if (!deferredPrompt && !isStandalone()) showManualTip();
  }, 1500);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 本地 file:// 打开时会失败，忽略 */ });
  });
}

async function boot() {
  store = await createDefaultStore();

  // 复用最近一次会话，刷新 / 重开 App 都能看到上次的聊天
  const existingSessions = await store.listSessions();
  session = existingSessions[0] || await store.createSession();

  composer = createComposer(document.getElementById('composer'), { onSend: handleSend });

  settings = createSettings(settingsRoot, {
    store,
    onClose: () => { settingsRoot.hidden = true; },
    onModeChange: () => { /* 下次发消息时按最新配置重建 provider */ },
  });

  document.getElementById('openSettings').addEventListener('click', openSettings);

  // 回放上一轮聊天
  const pastMessages = await store.listMessages(session.id, 12);
  timeline.renderHistory(pastMessages);
}

boot().catch((err) => {
  showBanner('初始化失败：' + (err && err.message ? err.message : err));
});
