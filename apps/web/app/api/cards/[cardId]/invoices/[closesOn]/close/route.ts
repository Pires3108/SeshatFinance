import type { NextResponse } from 'next/server';

import {
  errorResponse,
  forwardToApi,
  isUuid,
} from '../../../../../../../lib/forward-to-api';

type Context = Readonly<{
  params: Promise<{ cardId: string; closesOn: string }>;
}>;

export async function POST(
  request: Request,
  context: Context,
): Promise<NextResponse> {
  const { cardId, closesOn } = await context.params;
  if (!isUuid(cardId) || !/^\d{4}-\d{2}-\d{2}$/u.test(closesOn))
    return errorResponse('not_found');
  return forwardToApi(
    request,
    `/api/v1/credit-cards/${cardId}/invoices/${closesOn}/close`,
    'POST',
  );
}
