// 小米浏览器专项验收：模拟 Mi Browser 的 UA 与「不触发 beforeinstallprompt」的行为
// 用法：node tools/verify_xiaomi.js
const CDP_HTTP = 'http://127.0.0.1:9222';
const APP_URL = 'http://127.0.0.1:8080/index.html';

const MI_UA = 'Mozilla/5.0 (Linux; U; Android 13; zh-cn; 2201123C Build/TKQ1.221013.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/112.0.0.0 Mobile Safari/537.36 XiaoMi/MiuiBrowser/18.8.7_20230928';

let ws;
let msgId = 0;
const pending = new Map();

function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

async function connect() {
  const list = await (await fetch(`${CDP_HTTP}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(list.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  };
  return list.id;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(expression, awaitPromise = true) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate 超时')), 15000)),
  ]);
  if (r.exceptionDetails) {
    throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result.value;
}

const results = [];
function check(name, pass, evidence) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${evidence}`);
}

async function main() {
  await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');

  const errors = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errors.push(msg.params.entry.text);
    }
  });

  // 1. 伪装成小米浏览器
  await send('Network.setUserAgentOverride', {
    userAgent: MI_UA,
    acceptLanguage: 'zh-CN',
    platform: 'Linux armv8l',
  });

  // 2. 模拟小米浏览器：属性存在（走 setTimeout 兜底分支），但事件永远不触发
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.onbeforeinstallprompt = null;             // 属性存在
      const origAdd = window.addEventListener.bind(window);
      window.addEventListener = function (type, fn, opts) {
        if (type === 'beforeinstallprompt') return;   // 但事件被吞掉
        return origAdd(type, fn, opts);
      };
    `,
  });

  // 3. 干净起点
  await send('Storage.clearDataForOrigin', {
    origin: 'http://127.0.0.1:8080',
    storageTypes: 'indexeddb,local_storage,cache_storage,service_workers',
  }).catch(() => {});
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('ServiceWorker.enable').catch(() => {});

  await send('Page.navigate', { url: APP_URL });
  await sleep(2500);

  const ua = await evaluate(`navigator.userAgent`);
  check('0. UA 已切换为小米浏览器', ua.includes('MiuiBrowser'), ua.slice(0, 90));

  const dom = await evaluate(`(() => {
    const img = document.querySelector('img.stage-sprite');
    const tip = document.getElementById('installTip');
    return {
      sprite: img ? { src: img.getAttribute('src'), complete: img.complete, w: img.naturalWidth } : null,
      hasInput: !!document.getElementById('input'),
      tipHidden: tip ? tip.hidden : null,
      tipText: tip ? tip.textContent.trim() : '',
      tipBtn: !!document.querySelector('#installTip .install-btn'),
    };
  })()`);
  check('1. 页面在小米浏览器下正常渲染',
    !!(dom.sprite && dom.sprite.complete && dom.sprite.w > 0 && dom.hasInput),
    `sprite=${JSON.stringify(dom.sprite)}`);

  check('2. 不触发 beforeinstallprompt 时给出手动添加提示',
    dom.tipHidden === false && dom.tipText.includes('添加到桌面') && !dom.tipBtn,
    `hidden=${dom.tipHidden} text="${dom.tipText}" btn=${dom.tipBtn}`);

  // 3. 设置面板 + 保存
  await evaluate(`document.getElementById('openSettings').click()`);
  await sleep(300);
  await evaluate(`(() => {
    const set = (n, v) => { const el = document.querySelector('[name="' + n + '"]'); el.value = v; el.dispatchEvent(new Event('change', {bubbles:true})); };
    set('mode', 'direct');
    set('endpoint', 'http://127.0.0.1:8899/chat');
    set('apiKey', 'test');
    set('model', 'm1');
    document.getElementById('settingsForm').requestSubmit();
  })()`);
  await sleep(500);
  const saved = await evaluate(`(() => ({
    hidden: document.getElementById('settings').hidden,
    endpoint: document.querySelector('[name="endpoint"]').value,
  }))()`);
  check('3. 设置面板可保存接口配置',
    saved.hidden === true && saved.endpoint === 'http://127.0.0.1:8899/chat',
    JSON.stringify(saved));

  // 4. 发消息
  await evaluate(`(() => {
    const ta = document.getElementById('input');
    ta.value = '今天好累';
    ta.dispatchEvent(new Event('input', {bubbles:true}));
    document.querySelector('#composer button[type="submit"]').click();
  })()`);
  await sleep(3000);
  const chat = await evaluate(`(() => {
    const bs = [...document.querySelectorAll('.msg-assistant .bubble')].map(b => b.textContent);
    const us = [...document.querySelectorAll('.msg-user .bubble')].map(b => b.textContent);
    return { assistant: bs, user: us, emo: document.querySelector('img.stage-sprite').dataset.emo };
  })()`);
  check('4. 聊天与表情切换正常',
    chat.assistant.includes('今天有点累吧？') && chat.user.includes('今天好累') && chat.emo === 'warm',
    JSON.stringify(chat));

  // 5. 记忆入库
  await evaluate(`document.getElementById('openSettings').click()`);
  await sleep(500);
  const mem = await evaluate(`[...document.querySelectorAll('#memoryList .memory-row span')].map(s => s.textContent)`);
  check('5. 记忆正常入库', mem.includes('用户最近常加班到很晚'), JSON.stringify(mem));

  // 6. 刷新后回放
  await send('Page.navigate', { url: APP_URL });
  await sleep(2000);
  const after = await evaluate(`(() => ({
    assistant: [...document.querySelectorAll('.msg-assistant .bubble')].map(b => b.textContent),
    user: [...document.querySelectorAll('.msg-user .bubble')].map(b => b.textContent),
    tipHidden: document.getElementById('installTip').hidden,
  }))()`);
  check('6. 刷新后聊天回放', after.user.includes('今天好累') && after.assistant.includes('今天有点累吧？'), JSON.stringify(after));

  check('7. 无 JS 控制台错误', errors.length === 0, errors.slice(0, 3).join(' | ') || '无');

  const failed = results.filter((r) => !r.pass);
  console.log(`\n小米浏览器场景通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length) process.exitCode = 1;
  process.exit(0);
}

main().catch((e) => { console.error('验收脚本异常:', e); process.exit(1); });
