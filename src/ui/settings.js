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

  function syncMode() {
    const direct = modeField.value === 'direct';
    directBox.hidden = !direct;
    workerBox.hidden = direct;
  }

  modeField.addEventListener('change', syncMode);

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

  return { element: root, load, renderMemories };
}
