import type { NextResponse } from 'next/server';

import {
  errorResponse,
  forwardToApi,
  isUuid,
} from '../../../../../../../../../../lib/forward-to-api';

type Context = Readonly<{
  params: Promise<{ cardId: string; purchaseId: string; changeId: string }>;
}>;

export async function POST(
  request: Request,
  context: Context,
): Promise<NextResponse> {
  const { cardId, purchaseId, changeId } = await context.params;
  if (!isUuid(cardId) || !isUuid(purchaseId) || !isUuid(changeId))
    return errorResponse('not_found');
  return forwardToApi(
    request,
    `/api/v1/credit-cards/${cardId}/purchases/${purchaseId}/installment-plan/changes/${changeId}/reversal`,
    'POST',
    { idempotent: true },
  );
}
