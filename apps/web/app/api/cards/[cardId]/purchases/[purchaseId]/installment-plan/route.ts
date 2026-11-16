import type { NextResponse } from 'next/server';

import {
  errorResponse,
  forwardToApi,
  isUuid,
} from '../../../../../../../lib/forward-to-api';

type Context = Readonly<{
  params: Promise<{ cardId: string; purchaseId: string }>;
}>;

async function target(context: Context): Promise<string | null> {
  const { cardId, purchaseId } = await context.params;
  if (!isUuid(cardId) || !isUuid(purchaseId)) return null;
  return `/api/v1/credit-cards/${cardId}/purchases/${purchaseId}/installment-plan`;
}

export async function GET(
  request: Request,
  context: Context,
): Promise<NextResponse> {
  const path = await target(context);
  if (path === null) return errorResponse('not_found');
  return forwardToApi(request, path, 'GET');
}

export async function POST(
  request: Request,
  context: Context,
): Promise<NextResponse> {
  const path = await target(context);
  if (path === null) return errorResponse('not_found');
  return forwardToApi(request, path, 'POST', { idempotent: true });
}
