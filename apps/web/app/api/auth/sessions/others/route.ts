import { NextResponse } from 'next/server';

function sessionCookie(request: Request): string | null {
  const candidate = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => /^__Host-seshat_session=[A-Za-z0-9_-]{43}$/u.test(part));
  return candidate ?? null;
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const cookie = sessionCookie(request);
  if (cookie === null) return new NextResponse(null, { status: 401 });
  try {
    const url = new URL(
      '/api/v1/auth/sessions/others',
      process.env.SESHAT_API_URL ?? 'http://localhost:3001',
    );
    const upstream = await fetch(url, {
      method: 'DELETE',
      headers: { Cookie: cookie },
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
