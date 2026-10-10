import { ApiClientError, type paths } from '@seshat/contracts';
import { NextResponse } from 'next/server';

import { createServerApiClient } from '../../../../lib/create-server-api-client';

type Registration =
  paths['/api/v1/auth/registrations']['post']['requestBody']['content']['application/json'];

function isRegistration(value: unknown): value is Registration {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.displayName === 'string' &&
    candidate.displayName.trim().length > 0 &&
    candidate.displayName.length <= 120 &&
    typeof candidate.email === 'string' &&
    candidate.email.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.email) &&
    typeof candidate.password === 'string' &&
    candidate.password.length >= 12 &&
    candidate.password.length <= 1024
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  if (!isRegistration(input)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  try {
    const { data, response } = await createServerApiClient().POST(
      '/api/v1/auth/registrations',
      { body: input, cache: 'no-store' },
    );
    if (response.status !== 202 || data?.status !== 'confirmation_required') {
      return NextResponse.json(
        { error: 'registration_unavailable' },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { status: 'confirmation_required' },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 422) {
      return NextResponse.json({ error: 'password_rejected' }, { status: 422 });
    }
    return NextResponse.json(
      { error: 'registration_unavailable' },
      { status: 502 },
    );
  }
}
