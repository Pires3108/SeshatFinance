import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: '#f7faf9',
    description: 'Organize suas informações financeiras com clareza.',
    display: 'standalone',
    icons: [{ sizes: 'any', src: '/icon.svg', type: 'image/svg+xml' }],
    name: 'Seshat Finance',
    short_name: 'Seshat',
    start_url: '/',
    theme_color: '#176a61',
  };
}
