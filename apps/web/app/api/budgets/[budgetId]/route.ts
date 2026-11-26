import type { NextResponse } from 'next/server';

import {
  errorResponse,
  forwardToApi,
  isUuid,
} from '../../../../lib/forward-to-api';

type Context = Readonly<{ params: Promise<{ budgetId: string }> }>;

export async function PUT(
  request: Request,
  context: Context,
): Promise<NextResponse> {
  const { budgetId } = await context.params;
  if (!isUuid(budgetId)) return errorResponse('not_found');
  return forwardToApi(request, `/api/v1/budgets/${budgetId}`, 'PUT');
}
