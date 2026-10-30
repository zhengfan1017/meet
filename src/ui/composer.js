export function createComposer(root, { onSend }) {
  const input = root.querySelector('textarea');
  const button = root.querySelector('button[type="submit"]');

  function setDisabled(disabled) {
    button.disabled = disabled;
    input.disabled = disabled;
  }

  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  }

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    autoGrow();
    await onSend(text);
  }

  const form = root.tagName === 'FORM' ? root : root.querySelector('form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  input.addEventListener('input', autoGrow);

  return { element: root, input, setDisabled, autoGrow };
}
