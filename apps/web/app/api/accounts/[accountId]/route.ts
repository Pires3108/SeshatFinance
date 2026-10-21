import { NextResponse } from 'next/server';

import { getAccount, getBalance } from '../../../accounts/account-api';
import { errorResponse } from '../route';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function GET(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
): Promise<NextResponse> {
  const { accountId } = await context.params;
  if (!uuid.test(accountId)) return errorResponse('not-found');
  const cookie = request.headers.get('cookie') ?? '';
  const account = await getAccount(cookie, accountId);
  if (account.status !== 'ok') return errorResponse(account.status);
  const balance = await getBalance(cookie, accountId);
  if (balance.status !== 'ok') return errorResponse(balance.status);
  if (
    account.value.currencyCode !== balance.value.currencyCode ||
    account.value.currencyMinorUnitScale !==
      balance.value.currencyMinorUnitScale
  )
    return errorResponse('unavailable');
  return NextResponse.json(
    { account: account.value, balance: balance.value },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
