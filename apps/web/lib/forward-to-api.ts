import 'server-only';

import { NextResponse } from 'next/server';

const noStore = { 'Cache-Control': 'no-store' };
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_BODY_BYTES = 16_384;
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type ForwardError =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_input'
  | 'conflict'
  | 'unavailable';

const errorStatus: Readonly<Record<ForwardError, number>> = {
  conflict: 409,
  forbidden: 403,
  invalid_input: 400,
  not_found: 404,
  unauthorized: 401,
  unavailable: 503,
};

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function errorResponse(error: ForwardError): NextResponse {
  return NextResponse.json(
    { error },
    { status: errorStatus[error], headers: noStore },
  );
}

function sessionCookie(request: Request): string | undefined {
  return /(?:^|;\s*)(__Host-seshat_session=[A-Za-z0-9_-]{43})(?:;|$)/u.exec(
    request.headers.get('cookie') ?? '',
  )?.[1];
}

function upstreamError(status: number): ForwardError {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 400 || status === 422) return 'invalid_input';
  if (status === 409) return 'conflict';
  return 'unavailable';
}

/**
 * Forwards a browser request to the API with only the session cookie.
 * Upstream error bodies are never echoed; JSON success bodies pass through.
 */
export async function forwardToApi(
  request: Request,
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  options: Readonly<{ idempotent?: boolean }> = {},
): Promise<NextResponse> {
  const session = sessionCookie(request);
  if (session === undefined) return errorResponse('unauthorized');
  const idempotencyKey = request.headers.get('idempotency-key');
  if (
    options.idempotent === true &&
    (idempotencyKey === null || !UUID_V4.test(idempotencyKey))
  )
    return errorResponse('invalid_input');
  let body: string | undefined;
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    body = await request.text();
    if (body.length > MAX_BODY_BYTES) return errorResponse('invalid_input');
    try {
      JSON.parse(body);
    } catch {
      return errorResponse('invalid_input');
    }
  }
  try {
    const response = await fetch(
      new URL(path, process.env.SESHAT_API_URL ?? 'http://localhost:3001'),
      {
        cache: 'no-store',
        headers: {
          Cookie: session,
          ...(options.idempotent === true && idempotencyKey !== null
            ? { 'Idempotency-Key': idempotencyKey }
            : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        method,
        ...(body === undefined ? {} : { body }),
      },
    );
    if (!response.ok) return errorResponse(upstreamError(response.status));
    if (response.status === 204)
      return new NextResponse(null, { status: 204, headers: noStore });
    const data: unknown = await response.json();
    return NextResponse.json(data, {
      headers: noStore,
      status: response.status,
    });
  } catch {
    return errorResponse('unavailable');
  }
}
