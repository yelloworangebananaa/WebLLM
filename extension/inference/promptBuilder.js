export function buildPrompt(question, withScreen = true) {
  const q = question.trim();
  if (!withScreen) {
    return q;
  }
  return `SCREEN:
(screenshot attached)

Q:
${q}`;
}

export function buildMessages(question) {
  const text = buildPrompt(question);
  return [
    {
      role: 'user',
      content: [{ type: 'image' }, { type: 'text', text }],
    },
  ];
}

export function buildPreflightMessages() {
  return [
    {
      role: 'user',
      content: [{ type: 'text', text: 'ping' }],
    },
  ];
}
