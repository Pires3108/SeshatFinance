import { proxyTransaction } from '../../../../transactions/transaction-api';
import { uuid } from '../../../../transactions/transaction-contract';

interface Context {
  params: Promise<{ accountId: string }>;
}

export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  const { accountId } = await context.params;
  if (!uuid.test(accountId))
    return Response.json({ error: 'invalid_id' }, { status: 400 });
  return proxyTransaction(request, `accounts/${accountId}/transactions`);
}

export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  const { accountId } = await context.params;
  if (!uuid.test(accountId))
    return Response.json({ error: 'invalid_id' }, { status: 400 });
  return proxyTransaction(request, `accounts/${accountId}/transactions`);
}
