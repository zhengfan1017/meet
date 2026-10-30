export function createTimeline(root) {
  function scrollToEnd() {
    root.scrollTop = root.scrollHeight;
  }

  function addBubble(role, text) {
    const wrap = document.createElement('div');
    wrap.className = `msg msg-${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    wrap.appendChild(bubble);
    root.appendChild(wrap);
    scrollToEnd();
    return bubble;
  }

  function renderHistory(messages) {
    root.innerHTML = '';
    for (const m of messages) {
      addBubble(m.role, m.content);
    }
  }

  function beginAssistant() {
    return addBubble('assistant', '');
  }

  function appendText(bubble, text) {
    bubble.textContent += text;
    scrollToEnd();
  }

  function setBubbleText(bubble, text) {
    bubble.textContent = text;
    scrollToEnd();
  }

  return { element: root, addBubble, renderHistory, beginAssistant, appendText, setBubbleText, scrollToEnd };
}
