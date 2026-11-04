import { NextResponse } from 'next/server';

import { isCivilDate, isPeriod, isTemporalView } from '../../../movimentacoes/temporal-contract';

export async function GET(request: Request): Promise<NextResponse> {
  const parameters = new URL(request.url).searchParams;
  const period = parameters.get('period');
  const date = parameters.get('date');
  if (period === null || !isPeriod(period) || date === null || !isCivilDate(date) ||
    [...parameters.keys()].some((key) => key !== 'period' && key !== 'date'))
    return NextResponse.json({ error: 'invalid_filter' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });

  const session = /(?:^|;\s*)(__Host-seshat_session=[A-Za-z0-9_-]{43})(?:;|$)/u.exec(
    request.headers.get('cookie') ?? '',
  )?.[1];
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  try {
    const url = new URL('/api/v1/transactions/temporal', process.env.SESHAT_API_URL ?? 'http://localhost:3001');
    url.searchParams.set('period', period);
    url.searchParams.set('date', date);
    const response = await fetch(url, { headers: { Cookie: session }, cache: 'no-store' });
    if (response.status === 401 || response.status === 403)
      return NextResponse.json({ error: response.status === 401 ? 'unauthorized' : 'forbidden' },
        { status: response.status, headers: { 'Cache-Control': 'no-store' } });
    if (!response.ok) return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    const body: unknown = await response.json();
    if (!isTemporalView(body)) return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
