import { ApiClientError, type paths } from '@seshat/contracts';
import { NextResponse } from 'next/server';

import { createServerApiClient } from '../../../../../lib/create-server-api-client';

type Confirmation =
  paths['/api/v1/auth/registrations/confirm']['post']['requestBody']['content']['application/json'];

function isConfirmation(value: unknown): value is Confirmation {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const tokenHash = (value as Record<string, unknown>).tokenHash;
  return (
    typeof tokenHash === 'string' && /^[A-Za-z0-9_-]{1,2048}$/.test(tokenHash)
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  if (!isConfirmation(input)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  try {
    const { response } = await createServerApiClient().POST(
      '/api/v1/auth/registrations/confirm',
      { body: input, cache: 'no-store' },
    );
    if (response.status === 204) return new NextResponse(null, { status: 204 });
    return NextResponse.json(
      { error: 'confirmation_unavailable' },
      { status: 503 },
    );
  } catch (error) {
    if (error instanceof ApiClientError && error.code === 'INVALID_REQUEST') {
      return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'confirmation_unavailable' },
      { status: 503 },
    );
  }
}
