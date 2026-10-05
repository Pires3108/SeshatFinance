import { NextResponse } from 'next/server';

type Completion = Readonly<{ tokenHash: string; password: string }>;

function isCompletion(value: unknown): value is Completion {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.tokenHash === 'string' &&
    input.tokenHash.length > 0 &&
    input.tokenHash.length <= 512 &&
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
  if (!isCompletion(input))
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  try {
    const upstream = await fetch(
      new URL(
        '/api/v1/auth/password-recovery-completions',
        process.env.SESHAT_API_URL ?? 'http://localhost:3001',
      ),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        cache: 'no-store',
      },
    );
    if (upstream.status === 204) return new NextResponse(null, { status: 204 });
    if (upstream.status !== 400)
      return NextResponse.json(
        { error: 'recovery_unavailable' },
        { status: 503 },
      );
    return NextResponse.json(
      { error: 'invalid_or_expired_recovery_link' },
      { status: 400 },
    );
  } catch {
    return NextResponse.json(
      { error: 'recovery_unavailable' },
      { status: 503 },
    );
  }
}
