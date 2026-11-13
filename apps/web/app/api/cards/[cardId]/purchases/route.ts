import type { NextResponse } from 'next/server';

import {
  errorResponse,
  forwardToApi,
  isUuid,
} from '../../../../../lib/forward-to-api';

type Context = Readonly<{ params: Promise<{ cardId: string }> }>;

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export async function GET(
  request: Request,
  context: Context,
): Promise<NextResponse> {
  const { cardId } = await context.params;
  if (!isUuid(cardId)) return errorResponse('not_found');
  const cycle = new URL(request.url).searchParams.get('cycleClosesOn');
  if (cycle !== null && !CIVIL_DATE.test(cycle))
    return errorResponse('invalid_input');
  const query = cycle === null ? '' : `?cycleClosesOn=${cycle}`;
  return forwardToApi(
    request,
    `/api/v1/credit-cards/${cardId}/purchases${query}`,
    'GET',
  );
}

export async function POST(
  request: Request,
  context: Context,
): Promise<NextResponse> {
  const { cardId } = await context.params;
  if (!isUuid(cardId)) return errorResponse('not_found');
  return forwardToApi(
    request,
    `/api/v1/credit-cards/${cardId}/purchases`,
    'POST',
    { idempotent: true },
  );
}
