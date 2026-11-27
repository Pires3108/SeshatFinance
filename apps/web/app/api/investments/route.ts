import type { NextResponse } from 'next/server';

import { forwardToApi } from '../../../lib/forward-to-api';

export function GET(request: Request): Promise<NextResponse> {
  return forwardToApi(request, '/api/v1/investments', 'GET');
}

export function POST(request: Request): Promise<NextResponse> {
  return forwardToApi(request, '/api/v1/investments', 'POST', {
    idempotent: true,
  });
}
