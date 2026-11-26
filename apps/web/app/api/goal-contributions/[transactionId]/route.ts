import type { NextResponse } from 'next/server';

import {
  errorResponse,
  forwardToApi,
  isUuid,
} from '../../../../lib/forward-to-api';

type Context = Readonly<{ params: Promise<{ transactionId: string }> }>;

export async function GET(
  request: Request,
  context: Context,
): Promise<NextResponse> {
  const { transactionId } = await context.params;
  if (!isUuid(transactionId)) return errorResponse('not_found');
  return forwardToApi(
    request,
    `/api/v1/goal-contributions/${transactionId}`,
    'GET',
  );
}

export async function PUT(
  request: Request,
  context: Context,
): Promise<NextResponse> {
  const { transactionId } = await context.params;
  if (!isUuid(transactionId)) return errorResponse('not_found');
  return forwardToApi(
    request,
    `/api/v1/goal-contributions/${transactionId}`,
    'PUT',
    { idempotent: true },
  );
}
