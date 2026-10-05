import {
  isAccount,
  isBalance,
  projectAccount,
  type Account,
  type AccountBalance,
} from './account-contract';

export type AccountApiResult<T> =
  | Readonly<{ status: 'ok'; value: T }>
  | Readonly<{
      status: 'unauthorized' | 'forbidden' | 'not-found' | 'unavailable';
    }>;

function apiUrl(path: string): URL {
  return new URL(path, process.env.SESHAT_API_URL ?? 'http://localhost:3001');
}

async function request(
  path: string,
  cookie: string,
  init?: RequestInit,
): Promise<Response | null> {
  try {
    const headers = new Headers(init?.headers);
    const session =
      /(?:^|;\s*)(__Host-seshat_session=[A-Za-z0-9_-]{43})(?:;|$)/u.exec(
        cookie,
      )?.[1];
    headers.set('Cookie', session ?? '');
    return await fetch(apiUrl(path), {
      ...init,
      headers,
      cache: 'no-store',
    });
  } catch {
    return null;
  }
}

function failure(status: number | undefined): AccountApiResult<never> {
  if (status === 401) return { status: 'unauthorized' };
  if (status === 403) return { status: 'forbidden' };
  if (status === 404) return { status: 'not-found' };
  return { status: 'unavailable' };
}

async function body(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function listAccounts(
  cookie: string,
  lifecycle: string,
): Promise<AccountApiResult<readonly Account[]>> {
  const response = await request(
    `/api/v1/accounts?lifecycle=${encodeURIComponent(lifecycle)}`,
    cookie,
  );
  if (response?.status !== 200) return failure(response?.status);
  const data = await body(response);
  if (!Array.isArray(data) || !data.every(isAccount))
    return { status: 'unavailable' };
  return { status: 'ok', value: data.map(projectAccount) };
}

export async function getAccount(
  cookie: string,
  id: string,
): Promise<AccountApiResult<Account>> {
  const response = await request(`/api/v1/accounts/${id}`, cookie);
  if (response?.status !== 200) return failure(response?.status);
  const data = await body(response);
  return isAccount(data)
    ? { status: 'ok', value: projectAccount(data) }
    : { status: 'unavailable' };
}

export async function getBalance(
  cookie: string,
  id: string,
): Promise<AccountApiResult<AccountBalance>> {
  const response = await request(`/api/v1/accounts/${id}/balance`, cookie);
  if (response?.status !== 200) return failure(response?.status);
  const data = await body(response);
  return isBalance(data)
    ? { status: 'ok', value: data }
    : { status: 'unavailable' };
}

export async function changeLifecycle(
  cookie: string,
  id: string,
  action: string,
): Promise<AccountApiResult<Account>> {
  const response = await request(`/api/v1/accounts/${id}/lifecycle`, cookie, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (response?.status !== 200) return failure(response?.status);
  const data = await body(response);
  return isAccount(data)
    ? { status: 'ok', value: projectAccount(data) }
    : { status: 'unavailable' };
}
