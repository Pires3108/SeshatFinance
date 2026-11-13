import type { NextResponse } from 'next/server';

import { forwardToApi } from '../../../../../../lib/forward-to-api';

export function PUT(request: Request): Promise<NextResponse> {
  return forwardToApi(
    request,
    '/api/v1/users/me/holiday-settings/location',
    'PUT',
  );
}
