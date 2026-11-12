import { NextResponse } from 'next/server';

const noStore = { 'Cache-Control': 'no-store' };
const changeScopes = new Set(['reinterpret_existing', 'new_items_only']);
const refundPresentations = new Set(['separate-income', 'expense-offset']);

function refundPresentationOf(profile: Record<string, unknown>): string {
  return typeof profile.refundPresentation === 'string' &&
    refundPresentations.has(profile.refundPresentation)
    ? profile.refundPresentation
    : 'separate-income';
}

type ProfileError =
  'unauthorized' | 'forbidden' | 'unavailable' | 'invalid_input' | 'conflict';

const errorStatus: Readonly<Record<ProfileError, number>> = {
  unauthorized: 401,
  forbidden: 403,
  unavailable: 503,
  invalid_input: 400,
  conflict: 409,
};

function errorResponse(error: ProfileError): NextResponse {
  return NextResponse.json(
    { error },
    { status: errorStatus[error], headers: noStore },
  );
}

function sessionCookie(request: Request): string | undefined {
  return /(?:^|;\s*)(__Host-seshat_session=[A-Za-z0-9_-]{43})(?:;|$)/u.exec(
    request.headers.get('cookie') ?? '',
  )?.[1];
}

function profileUrl(): URL {
  return new URL(
    '/api/v1/users/me/profile',
    process.env.SESHAT_API_URL ?? 'http://localhost:3001',
  );
}

function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function upstreamError(status: number): ProfileError {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 400) return 'invalid_input';
  if (status === 409) return 'conflict';
  return 'unavailable';
}

export async function GET(request: Request): Promise<NextResponse> {
  const session = sessionCookie(request);
  if (!session) return errorResponse('unauthorized');
  try {
    const response = await fetch(profileUrl(), {
      headers: { Cookie: session },
      cache: 'no-store',
    });
    if (response.status === 401 || response.status === 403)
      return errorResponse(upstreamError(response.status));
    if (!response.ok) return errorResponse('unavailable');
    const profile: unknown = await response.json();
    if (!isRecord(profile) || !isValidTimeZone(profile.timeZone))
      return errorResponse('unavailable');
    return NextResponse.json(
      {
        timeZone: profile.timeZone,
        refundPresentation: refundPresentationOf(profile),
      },
      { headers: noStore },
    );
  } catch {
    return errorResponse('unavailable');
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const session = sessionCookie(request);
  if (!session) return errorResponse('unauthorized');
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return errorResponse('invalid_input');
  }
  if (!isRecord(input)) return errorResponse('invalid_input');
  const refundOnly =
    input.timeZone === undefined &&
    typeof input.refundPresentation === 'string' &&
    refundPresentations.has(input.refundPresentation);
  if (
    !refundOnly &&
    (!isValidTimeZone(input.timeZone) ||
      typeof input.timeZoneChangeScope !== 'string' ||
      !changeScopes.has(input.timeZoneChangeScope))
  )
    return errorResponse('invalid_input');
  try {
    const current = await fetch(profileUrl(), {
      headers: { Cookie: session },
      cache: 'no-store',
    });
    if (!current.ok) return errorResponse(upstreamError(current.status));
    const profile: unknown = await current.json();
    if (!isRecord(profile)) return errorResponse('unavailable');
    const response = await fetch(profileUrl(), {
      method: 'PATCH',
      headers: { Cookie: session, 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        displayName: profile.displayName,
        locale: profile.locale,
        presentationCurrency: profile.presentationCurrency,
        ...(refundOnly
          ? {
              timeZone: profile.timeZone,
              refundPresentation: input.refundPresentation,
            }
          : {
              timeZone: input.timeZone,
              timeZoneChangeScope: input.timeZoneChangeScope,
            }),
      }),
    });
    if (!response.ok) return errorResponse(upstreamError(response.status));
    return NextResponse.json(
      refundOnly
        ? { refundPresentation: input.refundPresentation }
        : { timeZone: input.timeZone },
      { headers: noStore },
    );
  } catch {
    return errorResponse('unavailable');
  }
}
