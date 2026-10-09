import type { paths } from '@seshat/contracts';
import { NextResponse } from 'next/server';

import { createServerApiClient } from '../../../../lib/create-server-api-client';

type PasswordRecoveryRequest =
  paths['/api/v1/auth/password-recovery-requests']['post']['requestBody']['content']['application/json'];

function isPasswordRecoveryRequest(
  value: unknown,
): value is PasswordRecoveryRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.email === 'string' &&
    candidate.email.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(candidate.email)
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  if (!isPasswordRecoveryRequest(input)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  try {
    const { data, response } = await createServerApiClient().POST(
      '/api/v1/auth/password-recovery-requests',
      { body: input, cache: 'no-store' },
    );
    if (response.status !== 202 || data?.status !== 'accepted') {
      throw new Error('Recovery API unavailable.');
    }
    return NextResponse.json({ status: 'accepted' }, { status: 202 });
  } catch {
    return NextResponse.json(
      { error: 'recovery_unavailable' },
      { status: 502 },
    );
  }
}
