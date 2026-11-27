import type { NextResponse } from 'next/server';

import {
  errorResponse,
  forwardToApi,
  isUuid,
} from '../../../../../lib/forward-to-api';

type Context = Readonly<{ params: Promise<{ eventId: string }> }>;

export async function POST(
  request: Request,
  context: Context,
): Promise<NextResponse> {
  const { eventId } = await context.params;
  if (!isUuid(eventId)) return errorResponse('not_found');
  return forwardToApi(
    request,
    `/api/v1/investment-events/${eventId}/lifecycle`,
    'POST',
  );
}
