// 用 CDP 驱动本机 Chrome 做端到端验收（零依赖，Node 内置 WebSocket）
const CDP_HTTP = 'http://127.0.0.1:9222';
const APP_URL = 'http://127.0.0.1:8080/index.html';

let ws;
let msgId = 0;
const pending = new Map();
const events = [];

function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

async function connect() {
  const list = await (await fetch(`${CDP_HTTP}/json/new?about:blank`, { method: 'PUT' })).json();
  const target = list;
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  };
  return target.id;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(expression, awaitPromise = true) {
  const r = await Promise.race([
    send('Runtime.evaluate', {
      expression, awaitPromise, returnByValue: true, userGesture: true,
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate 超时: ' + expression.slice(0, 60))), 15000)),
  ]);
  if (r.exceptionDetails) {
    throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result.value;
}

const results = [];
function check(name, pass, evidence) {
  results.push({ name, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${evidence}`);
}

async function main() {
  await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  const consoleErrors = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push(msg.params.entry.text);
    }
  });

  // 1. 清空历史残留（IndexedDB + localStorage），保证验收从干净状态开始
  await send('Storage.clearDataForOrigin', {
    origin: 'http://127.0.0.1:8080',
    storageTypes: 'indexeddb,local_storage,cache_storage,service_workers',
  }).catch(() => {});

  // 2. 打开页面
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('ServiceWorker.enable').catch(() => {});
  await send('Page.navigate', { url: APP_URL });
  await sleep(1800);

  const dom = await evaluate(`(() => {
    const img = document.querySelector('img.stage-sprite');
    const ta = document.getElementById('input');
    const btn = document.querySelector('#composer button[type="submit"]');
    return {
      title: document.title,
      sprite: img ? { src: img.getAttribute('src'), emo: img.dataset.emo, complete: img.complete, w: img.naturalWidth } : null,
      hasInput: !!ta,
      hasSend: !!btn,
      settingsHidden: document.getElementById('settings')?.hidden,
    };
  })()`);
  check('1. 页面渲染出角色与输入框',
    !!(dom.sprite && dom.sprite.complete && dom.sprite.w > 0 && dom.hasInput && dom.hasSend),
    `sprite=${JSON.stringify(dom.sprite)} input=${dom.hasInput} send=${dom.hasSend}`);

  // 2. 打开设置面板并填写
  await evaluate(`document.getElementById('openSettings').click()`);
  await sleep(300);
  const panelOpen = await evaluate(`!document.getElementById('settings').hidden`);
  await evaluate(`(() => {
    const set = (n, v) => { const el = document.querySelector('[name="' + n + '"]'); el.value = v; el.dispatchEvent(new Event('change', {bubbles:true})); };
    set('mode', 'direct');
    set('endpoint', 'http://127.0.0.1:8899/chat');
    set('apiKey', 'test');
    set('model', 'm1');
    document.getElementById('settingsForm').requestSubmit();
  })()`);
  await sleep(500);
  const afterSave = await evaluate(`(() => ({
    hidden: document.getElementById('settings').hidden,
    endpoint: document.querySelector('[name="endpoint"]').value,
    apiKey: document.querySelector('[name="apiKey"]').value,
    model: document.querySelector('[name="model"]').value,
  }))()`);
  check('2. 设置面板可打开并保存接口配置',
    panelOpen && afterSave.hidden === true && afterSave.endpoint === 'http://127.0.0.1:8899/chat' && afterSave.apiKey === 'test' && afterSave.model === 'm1',
    `panelOpen=${panelOpen} saved=${JSON.stringify(afterSave)}`);

  // 3. 发消息，看气泡逐字出现
  await evaluate(`(() => {
    const ta = document.getElementById('input');
    ta.value = '今天好累';
    ta.dispatchEvent(new Event('input', {bubbles:true}));
    document.querySelector('#composer button[type="submit"]').click();
  })()`);
  await sleep(400);
  const midStream = await evaluate(`(() => {
    const bs = [...document.querySelectorAll('.msg-assistant .bubble')].map(b => b.textContent);
    return { count: bs.length, last: bs[bs.length-1] };
  })()`);
  await sleep(2500);
  const full = await evaluate(`(() => {
    const bs = [...document.querySelectorAll('.msg-assistant .bubble')].map(b => b.textContent);
    const us = [...document.querySelectorAll('.msg-user .bubble')].map(b => b.textContent);
    return { count: bs.length, last: bs[bs.length-1], user: us[us.length-1], banner: document.getElementById('banner').hidden ? '' : document.getElementById('banner').textContent };
  })()`);
  check('3. 气泡逐字出现并显示完整回复',
    full.count >= 1 && full.last === '今天有点累吧？' && full.user === '今天好累',
    `中途长度=${JSON.stringify(midStream)} 最终=${JSON.stringify(full)}`);

  // 4. 表情切换
  const emo = await evaluate(`(() => { const img = document.querySelector('img.stage-sprite'); return { emo: img.dataset.emo, src: img.getAttribute('src') }; })()`);
  check('4. 角色表情切换到 warm(08-定稿吧)',
    emo.emo === 'warm' && emo.src.includes('08-定稿吧'),
    JSON.stringify(emo));

  // 5. 记忆列表
  await evaluate(`document.getElementById('openSettings').click()`);
  await sleep(500);
  const mem = await evaluate(`(() => ({
    rows: [...document.querySelectorAll('#memoryList .memory-row span')].map(s => s.textContent),
    empty: document.querySelector('#memoryList .muted')?.textContent || '',
  }))()`);
  check('5. 记忆列表出现「用户最近常加班到很晚」',
    mem.rows.includes('用户最近常加班到很晚'),
    JSON.stringify(mem));
  await evaluate(`document.getElementById('closeSettings').click()`);
  await sleep(200);

  // 6. 刷新后回放
  await send('Page.navigate', { url: APP_URL });
  await sleep(1500);
  const afterReload = await evaluate(`(() => {
    const bs = [...document.querySelectorAll('.msg-assistant .bubble')].map(b => b.textContent);
    const us = [...document.querySelectorAll('.msg-user .bubble')].map(b => b.textContent);
    return { assistant: bs, user: us };
  })()`);
  await evaluate(`document.getElementById('openSettings').click()`);
  await sleep(500);
  const memAfter = await evaluate(`[...document.querySelectorAll('#memoryList .memory-row span')].map(s => s.textContent)`);
  check('6. 刷新后聊天回放且记忆仍在',
    afterReload.user.includes('今天好累') && afterReload.assistant.includes('今天有点累吧？') && memAfter.includes('用户最近常加班到很晚'),
    `回放=${JSON.stringify(afterReload)} 记忆=${JSON.stringify(memAfter)}`);

  check('7. 无 JS 控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || '无');

  // 截图：主界面 + 设置面板
  await evaluate(`document.getElementById('closeSettings').click()`);
  await sleep(400);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });
  await sleep(600);
  await send('Page.captureScreenshot', { format: 'png' }).then(async (r) => {
    const fs = await import('node:fs');
    fs.writeFileSync('/workspace/traebao-pwa/verify-screenshot.png', Buffer.from(r.data, 'base64'));
  }).catch(() => {});

  const failed = results.filter((r) => !r.pass);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length) process.exitCode = 1;
  process.exit(0);
}

main().catch((e) => { console.error('验收脚本异常:', e); process.exit(1); });
