// 线上端到端验收：用真实方舟 API 走一遍用户实际会走的路
// 用法：node tools/verify_live.js
import { chromium } from 'playwright';

const APP_URL = 'https://traebao-app.surge.sh/';
const ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
const API_KEY = process.env.ARK_KEY || '';
const BAD_MODEL = 'Doubao-Seed-2-1-pro';   // 用户截图里填的那个（缺日期后缀，必然 404）

const results = [];
function check(name, pass, evidence) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${evidence}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openSettings(page) {
  await page.click('#openSettings');
  await page.waitForSelector('#settings:not([hidden])');
}

async function fillSettings(page, { model, apiKey = API_KEY }) {
  await page.fill('[name="apiKey"]', apiKey);
  await page.fill('[name="model"]', model);
}

async function main() {
  if (!API_KEY) {
    console.error('缺少 ARK_KEY 环境变量');
    process.exit(2);
  }

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const badResponses = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('response', (r) => {
    // 故意用错模型名时方舟会回 404，那是这次验收要测的东西，不算错误
    if (r.status() >= 400 && !r.url().includes('volces.com')) {
      badResponses.push(r.status() + ' ' + r.url());
    }
  });

  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await sleep(2500);

  // 1. SW 已升到 v8，且旧缓存被清掉
  const swState = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    const keys = await caches.keys();
    return { regs: regs.length, keys };
  });
  check('1. Service Worker 已注册，缓存只有 traebao-v8',
    swState.regs > 0 && swState.keys.length === 1 && swState.keys[0] === 'traebao-v8',
    JSON.stringify(swState));

  // 2. 填错模型名 → 测试连接应报 404 + 上游错误码
  await openSettings(page);
  await fillSettings(page, { model: BAD_MODEL });
  await page.click('#testConn');
  await page.waitForFunction(() => {
    const t = document.querySelector('#modelHint').textContent;
    return t && t !== '测试中…';
  }, { timeout: 30000 });
  const hintBad = await page.textContent('#modelHint');
  check('2. 错误模型名能看出真实原因（404 + 上游错误码）',
    hintBad.includes('404') && hintBad.includes('InvalidEndpointOrModel.NotFound'),
    hintBad.trim());

  // 3. 点「自动找模型」→ 应自动换成可用的模型 ID
  await page.click('#autoModel');
  await page.waitForFunction(() => {
    const t = document.querySelector('#modelHint').textContent;
    return t && (t.includes('找到可用的模型名') || t.includes('候选模型名都试过了'));
  }, { timeout: 90000 });
  const hintAuto = await page.textContent('#modelHint');
  const modelAfter = await page.inputValue('[name="model"]');
  check('3. 自动找模型把错名换成可用 ID',
    hintAuto.includes('找到可用的模型名') && /^doubao-seed-\d+-\d+-[a-z]+-\d{6}$/.test(modelAfter),
    `${hintAuto.trim()} / model=${modelAfter}`);

  // 4. 保存 + 直接发消息 → 应收到真实回复
  await page.click('#settingsForm button[type="submit"]');
  await page.waitForSelector('#settings', { state: 'hidden' });
  await page.fill('#input', '你好');
  await page.click('#composer button[type="submit"]');
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('.msg-assistant .bubble')];
    const t = b.length ? b[b.length - 1].textContent.trim() : '';
    return t.length > 0 && t !== '（这次没能说完）';
  }, { timeout: 60000 });
  const reply = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.msg-assistant .bubble')];
    return b[b.length - 1].textContent.trim();
  });
  check('4. 发消息能收到模型的真实回复',
    reply.length > 0 && reply !== '（这次没能说完）',
    reply.slice(0, 80));

  // 5. 故意填错模型名保存 → 发消息时应自动纠正并回复
  await openSettings(page);
  await fillSettings(page, { model: BAD_MODEL });
  await page.click('#settingsForm button[type="submit"]');
  await page.waitForSelector('#settings', { state: 'hidden' });
  await page.fill('#input', '你是谁啊');
  await page.click('#composer button[type="submit"]');
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('.msg-assistant .bubble')];
    const t = b.length > 1 ? b[b.length - 1].textContent.trim() : '';
    return t.length > 0 && t !== '（这次没能说完）';
  }, { timeout: 90000 });
  const banner = await page.evaluate(() => {
    const el = document.getElementById('banner');
    return el.hidden ? '' : el.textContent.trim();
  });
  const reply2 = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.msg-assistant .bubble')];
    return b[b.length - 1].textContent.trim();
  });
  check('5. 模型名写错时自动纠正并正常回复（不用手动改）',
    reply2.length > 0 && reply2 !== '（这次没能说完）' && banner.includes('已自动切换到'),
    `banner="${banner}" reply="${reply2.slice(0, 40)}"`);

  // 6. 刷新后仍能聊天（SW 缓存链路正常）
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(2500);
  const before = await page.evaluate(() => document.querySelectorAll('.msg-assistant .bubble').length);
  await page.fill('#input', '在吗');
  await page.click('#composer button[type="submit"]');
  await page.waitForFunction((n) => {
    const b = [...document.querySelectorAll('.msg-assistant .bubble')];
    if (b.length <= n) return false;
    const t = b[b.length - 1].textContent.trim();
    return t.length > 0 && t !== '（这次没能说完）';
  }, before, { timeout: 60000 });
  const reply3 = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.msg-assistant .bubble')];
    return b[b.length - 1].textContent.trim();
  });
  check('6. 刷新后还能正常聊天', reply3.length > 0 && reply3 !== '（这次没能说完）', reply3.slice(0, 60));

  // 故意用错模型名时方舟回 404，浏览器会记一条 "Failed to load resource"，
  // 那是这次验收要测的现象，不算 App 的错误。
  const realErrors = consoleErrors.filter((t) => !t.includes('Failed to load resource'));
  check('7. 无 JS 报错，且除故意触发的 404 外没有失败请求',
    realErrors.length === 0 && badResponses.length === 0,
    [realErrors.slice(0, 3).join(' | '), badResponses.slice(0, 3).join(' | ')].filter(Boolean).join(' ; ') || '无');

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n线上验收通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error('验收脚本异常:', e); process.exit(1); });
