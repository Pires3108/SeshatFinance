import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Next.js requires this hook to be asynchronous.
  // eslint-disable-next-line @typescript-eslint/require-await
  async headers() {
    return [
      {
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
        source: '/service-worker.js',
      },
    ];
  },
  output: 'standalone',
  poweredByHeader: false,
};

export default nextConfig;
