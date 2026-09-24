import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const source = await readFile(
  new URL('./service-worker.js', import.meta.url),
  'utf8',
);

describe('service worker cache policy', () => {
  it('pre-caches only public shell resources and immutable Next assets', () => {
    expect(source).toContain(
      "const SHELL = ['/offline', '/icon.svg', '/manifest.webmanifest']",
    );
    expect(source).toContain("url.pathname.startsWith('/_next/static/')");
  });

  it('keeps API requests and writes out of Cache Storage', () => {
    expect(source).toContain("request.method !== 'GET'");
    expect(source).toContain("url.pathname.startsWith('/api/')");
    expect(source).not.toContain('BackgroundSync');
    expect(source).not.toContain('indexedDB');
  });

  it('does not take control of open pages during an update', () => {
    expect(source).not.toContain('skipWaiting');
    expect(source).not.toContain('clients.claim');
  });
});
