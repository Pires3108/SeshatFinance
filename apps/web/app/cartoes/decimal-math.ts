/** Exact decimal subtraction on strings with the same scale, no floats. */
export function subtractDecimal(
  minuend: string,
  subtrahend: string,
  scale: number,
): string {
  const toMinor = (value: string): bigint => {
    const negative = value.startsWith('-');
    const [whole = '0', fraction = ''] = value.replace('-', '').split('.');
    const minor = BigInt(
      `${whole}${fraction.padEnd(scale, '0').slice(0, scale)}`,
    );
    return negative ? -minor : minor;
  };
  const result = toMinor(minuend) - toMinor(subtrahend);
  const negative = result < 0n;
  const digits = (negative ? -result : result)
    .toString()
    .padStart(scale + 1, '0');
  const value =
    scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${value}` : value;
}
