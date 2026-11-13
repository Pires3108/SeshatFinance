import type { NextResponse } from 'next/server';

import {
  errorResponse,
  forwardToApi,
  isUuid,
} from '../../../../../../../lib/forward-to-api';

type Context = Readonly<{ params: Promise<{ holidayId: string }> }>;

export async function DELETE(
  request: Request,
  context: Context,
): Promise<NextResponse> {
  const { holidayId } = await context.params;
  if (!isUuid(holidayId)) return errorResponse('not_found');
  return forwardToApi(
    request,
    `/api/v1/users/me/holiday-settings/declared/${holidayId}`,
    'DELETE',
  );
}
