import type { NextResponse } from 'next/server';

import {
  errorResponse,
  forwardToApi,
  isUuid,
} from '../../../../../lib/forward-to-api';

type Context = Readonly<{ params: Promise<{ investmentId: string }> }>;

export async function GET(
  request: Request,
  context: Context,
): Promise<NextResponse> {
  const { investmentId } = await context.params;
  if (!isUuid(investmentId)) return errorResponse('not_found');
  return forwardToApi(
    request,
    `/api/v1/investments/${investmentId}/events`,
    'GET',
  );
}

export async function POST(
  request: Request,
  context: Context,
): Promise<NextResponse> {
  const { investmentId } = await context.params;
  if (!isUuid(investmentId)) return errorResponse('not_found');
  return forwardToApi(
    request,
    `/api/v1/investments/${investmentId}/events`,
    'POST',
    { idempotent: true },
  );
}
