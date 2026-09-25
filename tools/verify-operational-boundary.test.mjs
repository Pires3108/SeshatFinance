import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { inspectOperationalBoundary } from './verify-operational-boundary.mjs';

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'seshat-boundary-'));
  await mkdir(join(directory, 'apps', 'api', 'src'), { recursive: true });
  await mkdir(join(directory, 'packages', 'domain', 'src'), {
    recursive: true,
  });
  await writeFile(join(directory, 'package.json'), '{}');
  return directory;
}

test('accepts internal financial-record code', async () => {
  const directory = await createFixture();
  try {
    await writeFile(
      join(directory, 'apps', 'api', 'src', 'record.ts'),
      'export function recordDeclaredPayment(): void {}\n',
    );
    assert.deepEqual(await inspectOperationalBoundary(directory), []);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('rejects financial-provider imports and operation names', async () => {
  const directory = await createFixture();
  try {
    await writeFile(
      join(directory, 'apps', 'api', 'src', 'payment.ts'),
      "import Stripe from 'stripe';\nexport const run = initiatePayment;\n",
    );
    await writeFile(
      join(directory, 'packages', 'domain', 'package.json'),
      JSON.stringify({ dependencies: { '@acme/mercadopago-client': '1.0.0' } }),
    );
    const violations = await inspectOperationalBoundary(directory);
    assert.equal(violations.length, 3);
    assert.match(violations.join('\n'), /imports stripe/u);
    assert.match(violations.join('\n'), /declares initiatePayment/u);
    assert.match(violations.join('\n'), /mercadopago/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
