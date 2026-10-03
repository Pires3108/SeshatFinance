#!/usr/bin/env node

const input = await readJsonInput();
const command = findCommand(input);

if (isPollingCommand(command)) {
  respond({
    permission: 'deny',
    user_message:
      'Espera ativa de CI ou Jira foi bloqueada. Use a entrega do webhook como sinal de progresso.',
    agent_message:
      'Do not poll CI or Jira. Treat the signed agent-waiter delivery as a progress signal. Make one current-state lookup only when deciding whether to declare completion; watch modes and retry/sleep loops are not allowed.',
  });
}

respond({ permission: 'allow' });

async function readJsonInput() {
  let content = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) content += chunk;

  try {
    return JSON.parse(content);
  } catch {
    respond({
      permission: 'deny',
      user_message: 'Não foi possível validar o comando de espera do agente.',
      agent_message:
        'The webhook waiter guard failed closed because hook input was invalid.',
    });
  }
}

function findCommand(value) {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return '';

  for (const key of ['command', 'cmd']) {
    if (typeof value[key] === 'string') return value[key];
  }

  for (const key of ['input', 'tool_input', 'toolInput', 'arguments']) {
    const nested = findCommand(value[key]);
    if (nested !== '') return nested;
  }

  return '';
}

function isPollingCommand(command) {
  const normalized = command.toLowerCase();
  const isCiWatch =
    /\bgh\s+(?:run\s+watch|pr\s+checks\b[^\r\n]*--watch|run\s+view\b[^\r\n]*--watch)/u.test(
      normalized,
    ) || /\b(?:watch|gh\s+run\s+watch)\b/u.test(normalized);
  const isStatusLoop =
    /\b(?:while|until|for|do)\b[\s\S]*(?:gh\s+(?:run|api)|api\.github\.com|atlassian\.net\/rest\/api)[\s\S]*(?:start-sleep|sleep|timeout)\b/u.test(
      normalized,
    ) ||
    /\b(?:start-sleep|sleep|timeout)\b[\s\S]*(?:gh\s+(?:run|api)|api\.github\.com|atlassian\.net\/rest\/api)/u.test(
      normalized,
    );

  return isCiWatch || isStatusLoop;
}

function respond(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
}
