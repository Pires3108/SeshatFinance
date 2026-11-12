import 'server-only';

import { NextResponse } from 'next/server';

import { uuid } from './transaction-contract';

export async function proxyTransaction(
  request: Request,
  path: string,
): Promise<NextResponse> {
  if (
    !path
      .split('/')
      .filter(Boolean)
      .every(
        (part) =>
          part === 'accounts' ||
          part === 'transactions' ||
          part === 'refunds' ||
          uuid.test(part),
      )
  ) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }
  const session =
    /(?:^|;\s*)(__Host-seshat_session=[A-Za-z0-9_-]{43})(?:;|$)/u.exec(
      request.headers.get('cookie') ?? '',
    )?.[1];
  const headers = new Headers({ Cookie: session ?? '' });
  if (request.method !== 'GET') headers.set('Content-Type', 'application/json');
  const key = request.headers.get('Idempotency-Key');
  if (key && /^[0-9a-f-]{36}$/iu.test(key)) headers.set('Idempotency-Key', key);
  try {
    const response = await fetch(
      new URL(
        `/api/v1/${path}`,
        process.env.SESHAT_API_URL ?? 'http://localhost:3001',
      ),
      {
        method: request.method,
        headers,
        ...(request.method === 'GET' ? {} : { body: await request.text() }),
        cache: 'no-store',
      },
    );
    const body: unknown = await response.json();
    return NextResponse.json(body, {
      status: response.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      { error: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
