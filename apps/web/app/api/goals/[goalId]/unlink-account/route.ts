import type { NextResponse } from 'next/server';

import {
  errorResponse,
  forwardToApi,
  isUuid,
} from '../../../../../lib/forward-to-api';

type Context = Readonly<{ params: Promise<{ goalId: string }> }>;

export async function POST(
  request: Request,
  context: Context,
): Promise<NextResponse> {
  const { goalId } = await context.params;
  if (!isUuid(goalId)) return errorResponse('not_found');
  return forwardToApi(
    request,
    `/api/v1/goals/${goalId}/unlink-account`,
    'POST',
  );
}
