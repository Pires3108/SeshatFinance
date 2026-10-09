import { createApiClient, type paths } from '@seshat/contracts';
import { NextResponse } from 'next/server';

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
    candidate.password.length > 0 &&
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

  const apiUrl = process.env.SESHAT_API_URL ?? 'http://localhost:3001';
  try {
    const { data, response } = await createApiClient(apiUrl).POST(
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
  } catch {
    return NextResponse.json(
      { error: 'registration_unavailable' },
      { status: 502 },
    );
  }
}
