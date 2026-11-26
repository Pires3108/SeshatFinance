import { NextResponse } from 'next/server';

import { forwardToApi } from '../../../lib/forward-to-api';

const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/u;

export function GET(request: Request): Promise<NextResponse> {
  const month = new URL(request.url).searchParams.get('month');
  if (month !== null && !MONTH.test(month)) {
    return Promise.resolve(
      NextResponse.json({ error: 'invalid_filter' }, { status: 400 }),
    );
  }
  return forwardToApi(
    request,
    month === null ? '/api/v1/budgets' : `/api/v1/budgets?month=${month}`,
    'GET',
  );
}

export function POST(request: Request): Promise<NextResponse> {
  return forwardToApi(request, '/api/v1/budgets', 'POST', { idempotent: true });
}
