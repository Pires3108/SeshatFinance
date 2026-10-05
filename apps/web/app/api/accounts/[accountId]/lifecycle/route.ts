import { NextResponse } from 'next/server';

import { changeLifecycle } from '../../../../accounts/account-api';
import { errorResponse } from '../../route';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const actions = new Set([
  'archive',
  'unarchive',
  'move-to-trash',
  'restore-from-trash',
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
): Promise<NextResponse> {
  const { accountId } = await context.params;
  if (!uuid.test(accountId)) return errorResponse('not-found');
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    !('action' in input) ||
    typeof input.action !== 'string' ||
    !actions.has(input.action)
  )
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const result = await changeLifecycle(
    request.headers.get('cookie') ?? '',
    accountId,
    input.action,
  );
  if (result.status !== 'ok') return errorResponse(result.status);
  return NextResponse.json(
    { lifecycle: result.value.lifecycle },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
