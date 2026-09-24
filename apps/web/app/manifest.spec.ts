import { describe, expect, it } from 'vitest';

import manifest from './manifest';

describe('PWA manifest', () => {
  it('declares an installable standalone application with local assets', () => {
    expect(manifest()).toMatchObject({
      display: 'standalone',
      name: 'Seshat Finance',
      short_name: 'Seshat',
      start_url: '/',
      theme_color: '#176a61',
    });
    expect(manifest().icons).toEqual([
      { sizes: 'any', src: '/icon.svg', type: 'image/svg+xml' },
    ]);
  });
});
