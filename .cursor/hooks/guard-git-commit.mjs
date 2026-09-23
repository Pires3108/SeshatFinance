#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';

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
const targets = findCommitTargets(command, findWorkingDirectory(input));
if (targets.length === 0) {
  respond({ permission: 'allow' });
}

for (const target of targets) {
  let branch;
  try {
    branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: target,
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

function findWorkingDirectory(value) {
  if (value === null || typeof value !== 'object') return process.cwd();
  for (const key of ['workdir', 'cwd']) {
    if (typeof value[key] === 'string') return path.resolve(value[key]);
  }
  for (const key of ['input', 'tool_input', 'toolInput', 'arguments']) {
    if (key in value) {
      const nested = findWorkingDirectory(value[key]);
      if (nested !== process.cwd()) return nested;
    }
  }
  return process.cwd();
}

function findCommitTargets(command, workingDirectory) {
  const targets = [];
  for (const segment of splitCommands(command)) {
    const tokens = segment.match(/"[^"]*"|'[^']*'|\S+/gu)?.map(unquote) ?? [];
    const gitIndex = tokens.findIndex((token) =>
      /^(?:git|git\.exe)$/iu.test(token),
    );
    if (gitIndex < 0 || !tokens.includes('commit')) continue;
    let directory = workingDirectory;
    let index = gitIndex + 1;
    while (index < tokens.length && tokens[index] !== 'commit') {
      const option = tokens[index];
      if (option === '-C' && index + 1 < tokens.length) {
        directory = path.resolve(directory, tokens[index + 1]);
        index += 2;
      } else if (option?.startsWith('-C') && option.length > 2) {
        directory = path.resolve(directory, option.slice(2));
        index += 1;
      } else if (option === '-c' || option === '--config-env') {
        index += 2;
      } else if (option === '--no-pager' || option === '--paginate') {
        index += 1;
      } else {
        respond({
          permission: 'deny',
          user_message:
            'Use uma chamada direta de git commit em uma branch de trabalho.',
          agent_message:
            'The commit guard could not safely parse this Git command.',
        });
      }
    }
    targets.push(directory);
  }
  return targets;
}

function splitCommands(command) {
  const segments = [];
  let quote = null;
  let start = 0;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ';' || character === '&' || character === '|') {
      segments.push(command.slice(start, index));
      start = index + 1;
    }
  }
  segments.push(command.slice(start));
  return segments;
}

function unquote(token) {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

function respond(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
}
