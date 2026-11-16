import type { NextResponse } from 'next/server';

import {
  errorResponse,
  forwardToApi,
  isUuid,
} from '../../../../../lib/forward-to-api';

type Context = Readonly<{ params: Promise<{ loanId: string }> }>;

export async function POST(
  request: Request,
  context: Context,
): Promise<NextResponse> {
  const { loanId } = await context.params;
  if (!isUuid(loanId)) return errorResponse('not_found');
  return forwardToApi(
    request,
    `/api/v1/loans/${loanId}/renegotiation`,
    'POST',
    {
      idempotent: true,
    },
  );
}
