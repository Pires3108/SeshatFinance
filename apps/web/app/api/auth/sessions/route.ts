import { NextResponse } from 'next/server';

const API_PATH = '/api/v1/auth/sessions';

type Credentials = Readonly<{ email: string; password: string }>;

function isSafeSessionCookie(
  cookie: string | null,
  operation: 'login' | 'logout',
): cookie is string {
  if (cookie === null || /[\r\n,]/u.test(cookie)) return false;
  const parts = cookie.split(';').map((part) => part.trim());
  const expectedValue = operation === 'login' ? '[A-Za-z0-9_-]{43}' : '';
  if (
    !new RegExp(`^__Host-seshat_session=${expectedValue}$`, 'u').test(
      parts[0] ?? '',
    )
  )
    return false;
  const attributes = parts.slice(1).map((part) => part.toLowerCase());
  const expectedAge = operation === 'login' ? 'max-age=43200' : 'max-age=0';
  return (
    attributes.length === 5 &&
    new Set(attributes).size === 5 &&
    ['httponly', 'secure', 'samesite=lax', 'path=/', expectedAge].every(
      (attribute) => attributes.includes(attribute),
    )
  );
}

function isCredentials(value: unknown): value is Credentials {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.email === 'string' &&
    candidate.email.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(candidate.email) &&
    typeof candidate.password === 'string' &&
    candidate.password.length > 0 &&
    candidate.password.length <= 1024
  );
}

function apiUrl(): URL {
  return new URL(
    API_PATH,
    process.env.SESHAT_API_URL ?? 'http://localhost:3001',
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  if (!isCredentials(input)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  try {
    const upstream = await fetch(apiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      cache: 'no-store',
    });
    if (upstream.status === 401) {
      return NextResponse.json(
        { error: 'invalid_credentials' },
        { status: 401 },
      );
    }
    const cookie = upstream.headers.get('set-cookie');
    if (upstream.status !== 204 || !isSafeSessionCookie(cookie, 'login')) {
      return NextResponse.json({ error: 'login_unavailable' }, { status: 502 });
    }
    return new NextResponse(null, {
      status: 204,
      headers: { 'Set-Cookie': cookie },
    });
  } catch {
    return NextResponse.json({ error: 'login_unavailable' }, { status: 502 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const upstream = await fetch(apiUrl(), {
      method: 'GET',
      headers: { Cookie: request.headers.get('cookie') ?? '' },
      cache: 'no-store',
    });
    return new NextResponse(null, {
      status:
        upstream.status === 204 ? 204 : upstream.status === 401 ? 401 : 503,
    });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const upstream = await fetch(apiUrl(), {
      method: 'DELETE',
      headers: { Cookie: request.headers.get('cookie') ?? '' },
      cache: 'no-store',
    });
    if (upstream.status !== 204) {
      return NextResponse.json(
        { error: 'logout_unavailable' },
        { status: 502 },
      );
    }
    const cookie = upstream.headers.get('set-cookie');
    if (!isSafeSessionCookie(cookie, 'logout')) {
      return NextResponse.json(
        { error: 'logout_unavailable' },
        { status: 502 },
      );
    }
    return new NextResponse(null, {
      status: 204,
      headers: { 'Set-Cookie': cookie },
    });
  } catch {
    return NextResponse.json({ error: 'logout_unavailable' }, { status: 502 });
  }
}
