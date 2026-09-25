import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);
const ignoredDirectories = new Set([
  '.git',
  '.next',
  'coverage',
  'dist',
  'node_modules',
]);
const prohibitedProviders = [
  'adyen',
  'asaas',
  'braintree',
  'iugu',
  'mercadopago',
  'pagarme',
  'paypal',
  'plaid',
  'stripe',
];
const prohibitedOperations = [
  'authorizePayment',
  'cancelPayment',
  'capturePayment',
  'initiatePayment',
  'schedulePayment',
];

export async function inspectOperationalBoundary(rootDirectory) {
  const violations = [];
  for (const directory of ['apps', 'packages']) {
    await inspectDirectory(
      join(rootDirectory, directory),
      rootDirectory,
      violations,
    );
  }
  for (const manifest of await findPackageManifests(rootDirectory)) {
    await inspectPackageManifest(manifest, rootDirectory, violations);
  }
  return violations;
}

async function inspectDirectory(directory, rootDirectory, violations) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        await inspectDirectory(path, rootDirectory, violations);
      }
    } else if (entry.isFile() && sourceExtensions.has(extension(entry.name))) {
      await inspectSource(path, rootDirectory, violations);
    }
  }
}

async function inspectSource(path, rootDirectory, violations) {
  const source = await readFile(path, 'utf8');
  const normalized = source.toLowerCase();
  for (const provider of prohibitedProviders) {
    const providerPattern = new RegExp(
      `(?:from\\s*|require\\s*\\(|import\\s*\\()(['\"])${provider}(?:[-/][^'\"]*)?\\1`,
      'iu',
    );
    if (providerPattern.test(source)) {
      violations.push(`${relative(rootDirectory, path)} imports ${provider}.`);
    }
  }
  for (const operation of prohibitedOperations) {
    if (normalized.includes(operation.toLowerCase())) {
      violations.push(
        `${relative(rootDirectory, path)} declares ${operation}.`,
      );
    }
  }
}

async function findPackageManifests(rootDirectory) {
  const manifests = [join(rootDirectory, 'package.json')];
  for (const directory of ['apps', 'packages']) {
    await collectPackageManifests(join(rootDirectory, directory), manifests);
  }
  return manifests;
}

async function collectPackageManifests(directory, manifests) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
      await collectPackageManifests(path, manifests);
    } else if (entry.isFile() && entry.name === 'package.json') {
      manifests.push(path);
    }
  }
}

async function inspectPackageManifest(path, rootDirectory, violations) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  };
  for (const dependency of Object.keys(dependencies)) {
    if (prohibitedProviders.some((provider) => dependency.includes(provider))) {
      violations.push(
        `${relative(rootDirectory, path)} depends on ${dependency}.`,
      );
    }
  }
}

function extension(name) {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot);
}

async function main() {
  const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const violations = await inspectOperationalBoundary(rootDirectory);
  if (violations.length > 0) {
    throw new Error(
      `Operational financial boundary violations:\n${violations.join('\n')}`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
