import createClient, { type Client } from 'openapi-fetch';

import type { paths } from '../generated/api.js';

export type ApiClient = Client<paths>;

export type ApiClientOptions = Readonly<{
  baseUrl: string;
  session?: Readonly<{ accessToken: string }>;
  correlationId?: string;
}>;

export type ApiErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'API_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class ApiClientError extends Error {
  public readonly code: ApiErrorCode;
  public readonly status: number;
  public readonly correlationId: string | undefined;

  public constructor(status: number, correlationId?: string) {
    const code = errorCode(status);
    super(code);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.correlationId = correlationId;
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = new URL(options.baseUrl);
  if (
    !['http:', 'https:'].includes(baseUrl.protocol) ||
    baseUrl.username ||
    baseUrl.password
  ) {
    throw new Error('Invalid API base URL.');
  }
  if (options.session && !/^\S+$/u.test(options.session.accessToken)) {
    throw new Error('Invalid API session.');
  }
  if (
    options.correlationId &&
    !/^[a-zA-Z0-9._-]{1,128}$/u.test(options.correlationId)
  ) {
    throw new Error('Invalid API correlation ID.');
  }

  const client = createClient<paths>({
    baseUrl: baseUrl.toString(),
    credentials: 'omit',
  });
  client.use({
    onRequest({ request }): Request {
      request.headers.delete('Authorization');
      request.headers.delete('Cookie');
      request.headers.delete('x-correlation-id');
      if (options.session) {
        request.headers.set(
          'Authorization',
          `Bearer ${options.session.accessToken}`,
        );
      }
      if (options.correlationId) {
        request.headers.set('x-correlation-id', options.correlationId);
      }
      return request;
    },
    onResponse({ response }): void {
      if (!response.ok) {
        const correlationId = response.headers.get('x-correlation-id');
        throw new ApiClientError(
          response.status,
          correlationId && /^[a-zA-Z0-9._-]{1,128}$/u.test(correlationId)
            ? correlationId
            : undefined,
        );
      }
    },
    onError({ error }): Error {
      return error instanceof ApiClientError ? error : new ApiClientError(0);
    },
  });
  return client;
}

function errorCode(status: number): ApiErrorCode {
  if (status === 0) return 'API_UNAVAILABLE';
  if (status === 400) return 'INVALID_REQUEST';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 503) return 'SERVICE_UNAVAILABLE';
  return 'INTERNAL_ERROR';
}
