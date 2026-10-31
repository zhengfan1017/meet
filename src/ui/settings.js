import { findWorkingModel, MODEL_CANDIDATES } from '../llm/modelProbe.js';

export function createSettings(root, { store, onClose, onModeChange }) {
  const form = root.querySelector('form');
  const modeField = root.querySelector('[name="mode"]');
  const endpointField = root.querySelector('[name="endpoint"]');
  const keyField = root.querySelector('[name="apiKey"]');
  const modelField = root.querySelector('[name="model"]');
  const workerUrlField = root.querySelector('[name="workerUrl"]');
  const accessTokenField = root.querySelector('[name="accessToken"]');
  const directBox = root.querySelector('#directBox');
  const workerBox = root.querySelector('#workerBox');
  const toggleBtn = root.querySelector('#toggleKey');
  const memoryList = root.querySelector('#memoryList');
  const clearBtn = root.querySelector('#clearAll');
  const modelHint = root.querySelector('#modelHint');
  const testConnBtn = root.querySelector('#testConn');
  const autoModelBtn = root.querySelector('#autoModel');
  const repairBtn = root.querySelector('#repairApp');

  function currentEndpoint() {
    return endpointField.value.trim() || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  }

  // 直接问模型一句最短的话，验证 Key / 模型名 / 接口地址三件事对不对
  async function testConnection() {
    const endpoint = currentEndpoint();
    const apiKey = keyField.value.trim();
    const model = modelField.value.trim();
    if (!apiKey) { modelHint.textContent = '先填 API Key'; return; }
    if (!model) { modelHint.textContent = '先填模型名'; return; }

    testConnBtn.disabled = true;
    modelHint.textContent = '测试中…';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({
          model,
          max_tokens: 8,
          messages: [{ role: 'user', content: '你好' }],
        }),
      });
      if (res.ok) {
        modelHint.textContent = '连接正常，模型名可用';
      } else {
        const body = await res.text();
        let detail = '';
        try {
          const parsed = JSON.parse(body);
          const e = parsed && parsed.error ? parsed.error : null;
          if (e) detail = (e.code ? e.code + '：' : '') + (e.message || '');
        } catch { detail = body.slice(0, 120); }
        modelHint.textContent = '失败（' + res.status + '）' + (detail ? ' ' + detail : '');
      }
    } catch (err) {
      modelHint.textContent = '连不上，可能是网络或跨域被拦，换 Worker 代理试试';
    } finally {
      testConnBtn.disabled = false;
    }
  }

  // 方舟的模型 ID 必须带日期后缀，用户很容易抄成控制台上显示的名字。
  // 这里不要求用户懂这件事，直接挨个试候选 ID，找到能用的填进去。
  async function autoFindModel() {
    const endpoint = currentEndpoint();
    const apiKey = keyField.value.trim();
    if (!apiKey) { modelHint.textContent = '先填 API Key'; return; }

    autoModelBtn.disabled = true;
    modelHint.textContent = '正在找一个能用的模型名…';
    try {
      const found = await findWorkingModel({
        endpoint,
        apiKey,
        model: modelField.value.trim(),
        candidates: MODEL_CANDIDATES,
      });
      if (found) {
        modelField.value = found;
        await store.setKV('model', found);
        modelHint.textContent = '找到可用的模型名：' + found + '（已填好，点「保存」）';
      } else {
        modelHint.textContent = '候选模型名都试过了，没有一个能用。检查 API Key 和接口地址。';
      }
    } catch (err) {
      modelHint.textContent = '查找失败：' + (err && err.message ? err.message : err);
    } finally {
      autoModelBtn.disabled = false;
    }
  }

  function syncMode() {
    const direct = modeField.value === 'direct';
    directBox.hidden = !direct;
    workerBox.hidden = direct;
  }

  modeField.addEventListener('change', syncMode);

  testConnBtn.addEventListener('click', testConnection);
  autoModelBtn.addEventListener('click', autoFindModel);

  // 版本混搭的逃生门：清掉所有缓存重新拉一遍
  repairBtn.addEventListener('click', async () => {
    repairBtn.disabled = true;
    modelHint.textContent = '正在清理缓存并重新加载…';
    try {
      if (window.caches && window.caches.keys) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((k) => window.caches.delete(k)));
      }
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch (err) {
      // 清缓存失败也要继续刷新
    }
    window.location.reload();
  });

  toggleBtn.addEventListener('click', () => {
    const showing = keyField.type === 'text';
    keyField.type = showing ? 'password' : 'text';
    toggleBtn.textContent = showing ? '显示' : '隐藏';
  });

  async function load() {
    modeField.value = (await store.getKV('mode')) || 'direct';
    endpointField.value = (await store.getKV('endpoint')) || '';
    keyField.value = (await store.getKV('apiKey')) || '';
    modelField.value = (await store.getKV('model')) || '';
    workerUrlField.value = (await store.getKV('workerUrl')) || '';
    accessTokenField.value = (await store.getKV('accessToken')) || '';
    syncMode();
    await renderMemories();
  }

  function setModel(name) {
    modelField.value = name;
  }

  async function renderMemories() {
    const memories = await store.listMemories();
    memoryList.innerHTML = '';
    if (memories.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = '还没有记住任何东西。';
      memoryList.appendChild(empty);
      return;
    }
    for (const m of memories) {
      const row = document.createElement('div');
      row.className = 'memory-row';

      const label = document.createElement('span');
      label.textContent = m.text;
      row.appendChild(label);

      const pin = document.createElement('button');
      pin.type = 'button';
      pin.textContent = m.pinned ? '取消置顶' : '置顶';
      pin.addEventListener('click', async () => {
        await store.setPinned(m.id, !m.pinned);
        await renderMemories();
      });
      row.appendChild(pin);

      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '删除';
      del.addEventListener('click', async () => {
        await store.deleteMemory(m.id);
        await renderMemories();
      });
      row.appendChild(del);

      memoryList.appendChild(row);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await store.setKV('mode', modeField.value);
    await store.setKV('endpoint', endpointField.value.trim());
    await store.setKV('apiKey', keyField.value.trim());
    await store.setKV('model', modelField.value.trim());
    await store.setKV('workerUrl', workerUrlField.value.trim());
    await store.setKV('accessToken', accessTokenField.value.trim());
    if (onModeChange) await onModeChange();
    onClose();
  });

  clearBtn.addEventListener('click', async () => {
    const ok = window.confirm('会清空所有聊天记录、记忆和 API Key，确定吗？');
    if (!ok) return;
    await store.clearAll();
    await load();
  });

  root.querySelector('#closeSettings').addEventListener('click', onClose);

  return { element: root, load, renderMemories, setModel };
}
