import { NextResponse } from 'next/server';

import { getBalance, listAccounts } from '../../accounts/account-api';

const lifecycles = new Set(['active', 'archived', 'trashed']);

export async function GET(request: Request): Promise<NextResponse> {
  const lifecycle =
    new URL(request.url).searchParams.get('lifecycle') ?? 'active';
  if (!lifecycles.has(lifecycle))
    return NextResponse.json({ error: 'invalid_filter' }, { status: 400 });
  const cookie = request.headers.get('cookie') ?? '';
  const accounts = await listAccounts(cookie, lifecycle);
  if (accounts.status !== 'ok') return errorResponse(accounts.status);
  const values = await Promise.all(
    accounts.value.map(async (account) => ({
      account,
      balance: await getBalance(cookie, account.id),
    })),
  );
  const failure = values.find((value) => value.balance.status !== 'ok');
  if (failure !== undefined && failure.balance.status !== 'ok')
    return errorResponse(failure.balance.status);
  return NextResponse.json(
    values.map((value) => ({
      account: value.account,
      balance: value.balance.status === 'ok' ? value.balance.value : null,
    })),
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export function errorResponse(
  status: 'unauthorized' | 'forbidden' | 'not-found' | 'unavailable',
): NextResponse {
  const code =
    status === 'unauthorized'
      ? 401
      : status === 'forbidden'
        ? 403
        : status === 'not-found'
          ? 404
          : 503;
  return NextResponse.json(
    { error: status },
    { status: code, headers: { 'Cache-Control': 'no-store' } },
  );
}
