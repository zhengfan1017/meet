// 小米浏览器回归：用 Playwright 伪装成 Mi Browser 的 UA，验证本地流程没被改坏
// 用法：node tools/verify_xiaomi_playwright.js
// 需要先起两个本地服务：8080（静态） 和 8899（mock 方舟）
import { chromium } from 'playwright';

const APP_URL = 'http://127.0.0.1:8080/index.html';
const MI_UA = 'Mozilla/5.0 (Linux; U; Android 13; zh-cn; 2201123C Build/TKQ1.221013.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/112.0.0.0 Mobile Safari/537.36 XiaoMi/MiuiBrowser/18.8.7_20230928';

const results = [];
function check(name, pass, evidence) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${evidence}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext({
  userAgent: MI_UA,
  viewport: { width: 412, height: 915 },
  locale: 'zh-CN',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// 小米浏览器：有 beforeinstallprompt 这个属性，但事件永远不触发
await page.addInitScript(() => {
  window.onbeforeinstallprompt = null;
  const orig = window.addEventListener.bind(window);
  window.addEventListener = function (type, fn, opts) {
    if (type === 'beforeinstallprompt') return;
    return orig(type, fn, opts);
  };
});

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await sleep(2000);

const dom = await page.evaluate(() => ({
  ua: navigator.userAgent,
  sprite: (() => { const i = document.querySelector('img.stage-sprite'); return i ? { ok: i.complete && i.naturalWidth > 0 } : null; })(),
  tip: (() => { const t = document.getElementById('installTip'); return { hidden: t.hidden, text: t.textContent.trim() }; })(),
  hasAutoModel: !!document.getElementById('autoModel'),
  hasRepair: !!document.getElementById('repairApp'),
}));
check('1. 小米浏览器 UA 生效', dom.ua.includes('MiuiBrowser'), dom.ua.slice(0, 60));
check('2. 页面正常渲染（立绘 + 输入框）', dom.sprite && dom.sprite.ok, JSON.stringify(dom.sprite));
check('3. 不触发 beforeinstallprompt 时给手动添加提示',
  dom.tip.hidden === false && dom.tip.text.includes('添加到桌面'), JSON.stringify(dom.tip));
check('4. 新增的自救入口在（自动找模型 / 清缓存重载）',
  dom.hasAutoModel && dom.hasRepair, `autoModel=${dom.hasAutoModel} repair=${dom.hasRepair}`);

// 设置 → 连 mock 方舟 → 发消息
await page.click('#openSettings');
await page.fill('[name="endpoint"]', 'http://127.0.0.1:8899/chat');
await page.fill('[name="apiKey"]', 'test');
await page.fill('[name="model"]', 'm1');
await page.click('#settingsForm button[type="submit"]');
await page.waitForSelector('#settings', { state: 'hidden' });

await page.fill('#input', '今天好累');
await page.click('#composer button[type="submit"]');
// 等整个流结束（表情被解析成 warm 才算完），否则会截到半句话
await page.waitForFunction(() => {
  const s = document.querySelector('img.stage-sprite');
  return s && s.dataset.emo === 'warm';
}, { timeout: 20000 });
const chat = await page.evaluate(() => ({
  assistant: [...document.querySelectorAll('.msg-assistant .bubble')].map((b) => b.textContent),
  user: [...document.querySelectorAll('.msg-user .bubble')].map((b) => b.textContent),
  emo: document.querySelector('img.stage-sprite').dataset.emo,
}));
check('5. 聊天与表情切换正常',
  chat.assistant.join('').includes('今天有点累吧') && chat.user.join('').includes('今天好累') && chat.emo === 'warm',
  JSON.stringify(chat));

await page.click('#openSettings');
await sleep(400);
const mem = await page.evaluate(() => [...document.querySelectorAll('#memoryList .memory-row span')].map((s) => s.textContent));
check('6. 记忆正常入库', mem.includes('用户最近常加班到很晚'), JSON.stringify(mem));

await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(1800);
const after = await page.evaluate(() => ({
  assistant: [...document.querySelectorAll('.msg-assistant .bubble')].map((b) => b.textContent),
  user: [...document.querySelectorAll('.msg-user .bubble')].map((b) => b.textContent),
}));
check('7. 刷新后聊天回放',
  after.user.join('').includes('今天好累') && after.assistant.join('').includes('今天有点累吧'),
  JSON.stringify(after));

check('8. 无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | ') || '无');

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n小米浏览器场景通过 ${results.length - failed.length}/${results.length}`);
if (failed.length) process.exitCode = 1;
