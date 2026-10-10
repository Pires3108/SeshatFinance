import { NextResponse } from 'next/server';

const API_PATH = '/api/v1/auth/password-recovery-completions';

type RecoveryCompletion = Readonly<{ tokenHash: string; password: string }>;

function isRecoveryCompletion(value: unknown): value is RecoveryCompletion {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.tokenHash === 'string' &&
    /^[A-Za-z0-9_-]{1,2048}$/u.test(input.tokenHash) &&
    typeof input.password === 'string' &&
    input.password.length > 0 &&
    input.password.length <= 1024
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  if (!isRecoveryCompletion(input)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  try {
    const upstream = await fetch(
      new URL(API_PATH, process.env.SESHAT_API_URL ?? 'http://localhost:3001'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        cache: 'no-store',
      },
    );
    if (upstream.status === 204) return new NextResponse(null, { status: 204 });
    if (upstream.status === 400)
      return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
    return NextResponse.json(
      { error: 'recovery_unavailable' },
      { status: 503 },
    );
  } catch {
    return NextResponse.json(
      { error: 'recovery_unavailable' },
      { status: 503 },
    );
  }
}
