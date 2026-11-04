import { NextResponse } from 'next/server';

export async function GET(request: Request): Promise<NextResponse> {
  const session =
    /(?:^|;\s*)(__Host-seshat_session=[A-Za-z0-9_-]{43})(?:;|$)/u.exec(
      request.headers.get('cookie') ?? '',
    )?.[1];
  if (!session)
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  try {
    const response = await fetch(
      new URL(
        '/api/v1/users/me/profile',
        process.env.SESHAT_API_URL ?? 'http://localhost:3001',
      ),
      { headers: { Cookie: session }, cache: 'no-store' },
    );
    if (response.status === 401 || response.status === 403)
      return NextResponse.json(
        { error: response.status === 401 ? 'unauthorized' : 'forbidden' },
        { status: response.status, headers: { 'Cache-Control': 'no-store' } },
      );
    if (!response.ok)
      return NextResponse.json(
        { error: 'unavailable' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    const profile: unknown = await response.json();
    if (
      typeof profile !== 'object' ||
      profile === null ||
      !('timeZone' in profile) ||
      typeof profile.timeZone !== 'string'
    )
      return NextResponse.json(
        { error: 'unavailable' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    try {
      new Intl.DateTimeFormat('pt-BR', { timeZone: profile.timeZone });
    } catch {
      return NextResponse.json(
        { error: 'unavailable' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(
      { timeZone: profile.timeZone },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { error: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
