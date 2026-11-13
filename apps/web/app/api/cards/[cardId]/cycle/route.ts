import type { NextResponse } from 'next/server';

import {
  errorResponse,
  forwardToApi,
  isUuid,
} from '../../../../../lib/forward-to-api';

type Context = Readonly<{ params: Promise<{ cardId: string }> }>;

export async function GET(
  request: Request,
  context: Context,
): Promise<NextResponse> {
  const { cardId } = await context.params;
  if (!isUuid(cardId)) return errorResponse('not_found');
  const at = new URL(request.url).searchParams.get('at');
  if (at !== null && Number.isNaN(Date.parse(at)))
    return errorResponse('invalid_input');
  const query = at === null ? '' : `?at=${encodeURIComponent(at)}`;
  return forwardToApi(
    request,
    `/api/v1/credit-cards/${cardId}/cycle${query}`,
    'GET',
  );
}
