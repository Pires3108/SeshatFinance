import createClient, { type Client } from 'openapi-fetch';

import type { paths } from '../generated/api.js';

export type ApiClient = Client<paths>;

export function createApiClient(baseUrl: string): ApiClient {
  return createClient<paths>({ baseUrl });
}
