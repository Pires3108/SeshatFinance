import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const eslint = new ESLint({
  cwd: root,
  overrideConfig: [tseslint.configs.disableTypeChecked],
});

const violations = [
  [
    'Domain Prisma',
    'packages/domain/src/accounts/fixture.ts',
    "import type { PrismaClient } from '@prisma/client';",
    'architecture/boundaries',
  ],
  [
    'Domain Nest',
    'packages/domain/src/accounts/fixture.ts',
    "import { Injectable } from '@nestjs/common';",
    'architecture/boundaries',
  ],
  [
    'Domain relative traversal',
    'packages/domain/src/accounts/fixture.ts',
    "import { PrismaAccountRepository } from '../../../database/src/accounts/prisma-account-repository.js';",
    'architecture/boundaries',
  ],
  [
    'Domain re-export',
    'packages/domain/src/accounts/fixture.ts',
    "export * from '../../../database/src/index.js';",
    'architecture/boundaries',
  ],
  [
    'Domain dynamic import',
    'packages/domain/src/accounts/fixture.ts',
    "void import('@prisma/client');",
    'architecture/boundaries',
  ],
  [
    'Application deep package',
    'packages/application/src/accounts/fixture.ts',
    "import { Client } from '@seshat/database/internal';",
    'architecture/boundaries',
  ],
  [
    'Web relative database',
    'apps/web/src/app/fixture.ts',
    "import { Client } from '../../../../packages/database/src/index.js';",
    'architecture/boundaries',
  ],
  [
    'Cross-module repository',
    'packages/database/src/cards/fixture.ts',
    "import { PrismaAccountRepository } from '../accounts/prisma-account-repository.js';",
    'architecture/boundaries',
  ],
  [
    'Cross-module alias repository',
    'packages/database/src/cards/fixture.ts',
    "import { PrismaAccountRepository } from '@seshat/database/src/accounts/prisma-account-repository.js';",
    'architecture/boundaries',
  ],
  [
    'Money number',
    'packages/domain/src/accounts/fixture.ts',
    'export type UnsafeMoney = { amount: number; currency: string };',
    'architecture/precise-money',
  ],
  [
    'Numeric Money alias',
    'packages/domain/src/accounts/fixture.ts',
    'export type Money = number;',
    'architecture/precise-money',
  ],
  [
    'Sensitive rate number',
    'packages/application/src/accounts/fixture.ts',
    'export type UnsafeRate = { exchangeRate: number };',
    'architecture/precise-money',
  ],
];

for (const [name, filePath, source, rule] of violations) {
  test(`rejects ${name} with a located architecture diagnostic`, async () => {
    const [result] = await eslint.lintText(source, { filePath });
    const errors = result.messages.filter((message) => message.ruleId === rule);
    assert.equal(errors.length, 1, JSON.stringify(result.messages));
    assert.equal(errors[0].severity, 2);
    assert.equal(errors[0].line, 1);
    assert.ok(errors[0].column > 0);
  });
}

test('accepts layer ports, public audit API, same-module repository and integration setup', async () => {
  const fixtures = [
    [
      'packages/application/src/accounts/fixture.ts',
      "import type { Money } from '@seshat/domain'; export type Balance = { amount: Money };",
    ],
    [
      'packages/database/src/cards/fixture.ts',
      "import { insertFinancialAuditEvent } from '../audit/index.js';",
    ],
    [
      'packages/database/src/accounts/fixture.ts',
      "import { PrismaAccountRepository } from './prisma-account-repository.js';",
    ],
    [
      'packages/database/src/cards/fixture.integration.spec.ts',
      "import { PrismaAccountRepository } from '../accounts/prisma-account-repository.js';",
    ],
    [
      'packages/domain/src/accounts/fixture.ts',
      'export type SafeMoney = { amount: string; currency: string; minorUnitScale: number };',
    ],
  ];
  for (const [filePath, source] of fixtures) {
    const [result] = await eslint.lintText(source, { filePath });
    assert.equal(
      result.messages.filter((message) =>
        message.ruleId?.startsWith('architecture/'),
      ).length,
      0,
      JSON.stringify(result.messages),
    );
  }
});

function compile(source) {
  const filename = path.join(
    root,
    'packages/domain/src/money/architecture-fixture.ts',
  );
  const options = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = (name) =>
    path.resolve(name) === filename ? source : readFile(name);
  host.fileExists = (name) =>
    path.resolve(name) === filename || fileExists(name);
  const program = ts.createProgram([filename], options, host);
  return ts.getPreEmitDiagnostics(program);
}

test('real strict compiler rejects numeric Money inputs and snapshots', () => {
  const diagnostics = compile(
    "import { Money, type MoneySnapshot } from './money.js'; import { Currency } from './currency.js'; const currency = Currency.create('BRL', 2); Money.fromDecimal(1.25, currency); Money.fromMinorUnits(125, currency); const snapshot: MoneySnapshot = { amount: 1.25, currency: currency.toSnapshot() }; void snapshot;",
  );
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code).sort(),
    [2322, 2345, 2345],
  );
  assert.ok(
    diagnostics.every(
      (diagnostic) =>
        diagnostic.file?.fileName.endsWith('architecture-fixture.ts') &&
        diagnostic.start !== undefined,
    ),
  );
});

test('real strict compiler accepts decimal strings and bigint with explicit currency', () => {
  const diagnostics = compile(
    "import { Money, type MoneySnapshot } from './money.js'; import { Currency } from './currency.js'; const currency = Currency.create('BRL', 2); Money.fromDecimal('1.25', currency); Money.fromMinorUnits(125n, currency); const snapshot: MoneySnapshot = { amount: '1.25', currency: currency.toSnapshot() }; Money.restore(snapshot);",
  );
  assert.deepEqual(diagnostics, []);
});
