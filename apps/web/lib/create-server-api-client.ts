import 'server-only';

import {
  createApiClient,
  type ApiClient,
  type ApiClientOptions,
} from '@seshat/contracts';

type ServerApiClientOptions = Pick<
  ApiClientOptions,
  'session' | 'correlationId'
>;

export function createServerApiClient(
  options: ServerApiClientOptions = {},
): ApiClient {
  if (typeof window !== 'undefined') {
    throw new Error('The API client is server-only.');
  }
  return createApiClient({
    baseUrl: process.env.SESHAT_API_URL ?? 'http://localhost:3001',
    ...options,
  });
}
