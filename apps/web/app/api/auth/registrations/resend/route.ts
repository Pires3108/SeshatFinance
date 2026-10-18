import type { paths } from '@seshat/contracts';
import { NextResponse } from 'next/server';

import { createServerApiClient } from '../../../../../lib/create-server-api-client';

type Resend =
  paths['/api/v1/auth/registrations/resend']['post']['requestBody']['content']['application/json'];

function isResend(value: unknown): value is Resend {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const email = (value as Record<string, unknown>).email;
  return (
    typeof email === 'string' &&
    email.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  if (!isResend(input)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  try {
    const { data, response } = await createServerApiClient().POST(
      '/api/v1/auth/registrations/resend',
      { body: input, cache: 'no-store' },
    );
    if (response.status === 202 && data?.status === 'confirmation_required') {
      return NextResponse.json(
        { status: 'confirmation_required' },
        { status: 202 },
      );
    }
    return NextResponse.json({ error: 'resend_unavailable' }, { status: 503 });
  } catch {
    return NextResponse.json({ error: 'resend_unavailable' }, { status: 503 });
  }
}
