export function consumeConfirmationToken(
  href: string,
  replaceUrl: (safeUrl: string) => void,
): string | null {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const tokenHash = fragment.get('token_hash');
  fragment.delete('token_hash');
  url.hash = fragment.size === 0 ? '' : fragment.toString();
  replaceUrl(`${url.pathname}${url.search}${url.hash}`);
  return tokenHash;
}
