export function consumeRecoveryToken(
  href: string,
  replaceUrl: (safeUrl: string) => void,
): string | null {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const tokenHash = fragment.get('token_hash');
  replaceUrl(`${url.pathname}${url.search}`);
  return tokenHash && /^[A-Za-z0-9_-]{1,2048}$/u.test(tokenHash)
    ? tokenHash
    : null;
}
