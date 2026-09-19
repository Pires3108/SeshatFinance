#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

let input;
try {
  input = JSON.parse(await readStandardInput());
} catch {
  respond({
    permission: 'deny',
    user_message: 'O hook de commits recebeu uma entrada inválida.',
    agent_message:
      'The commit guard failed closed because hook input was invalid.',
  });
}

const command = findCommand(input);
if (!isGitCommit(command)) {
  respond({ permission: 'allow' });
}

let branch;
try {
  branch = execFileSync('git', ['branch', '--show-current'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  respond({
    permission: 'deny',
    user_message: 'Não foi possível confirmar a branch antes do commit.',
    agent_message:
      'Create or enter a descriptive feature branch before committing.',
  });
}

if (branch === '' || branch === 'main' || branch === 'master') {
  respond({
    permission: 'deny',
    user_message: `Commit bloqueado na branch protegida "${branch || 'HEAD destacado'}".`,
    agent_message:
      'Create a descriptive branch for this backlog increment, then retry the commit.',
  });
}

respond({ permission: 'allow' });

async function readStandardInput() {
  let content = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) content += chunk;
  return content;
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

function isGitCommit(command) {
  return /(^|[;&|]\s*)git\s+commit(?:\s|$)/u.test(command);
}

function respond(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
}
