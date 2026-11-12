import { proxyTransaction } from '../../../../transactions/transaction-api';
import { uuid } from '../../../../transactions/transaction-contract';

interface Context {
  params: Promise<{ transactionId: string }>;
}

export async function PATCH(
  request: Request,
  context: Context,
): Promise<Response> {
  const { transactionId } = await context.params;
  if (!uuid.test(transactionId))
    return Response.json({ error: 'invalid_id' }, { status: 400 });
  return proxyTransaction(request, `transactions/${transactionId}/lifecycle`);
}
