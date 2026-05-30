export function parseUnits(amount: string, decimals: number): bigint {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(amount)) {
    throw new Error(`Invalid decimal amount: ${amount}`);
  }

  const [wholePart = "0", rawFraction = ""] = amount.split(".");
  if (rawFraction.length > decimals) {
    throw new Error(`Amount ${amount} has more than ${decimals} decimals`);
  }

  const paddedFraction = rawFraction.padEnd(decimals, "0");
  const whole = BigInt(wholePart) * 10n ** BigInt(decimals);
  const fraction = paddedFraction.length === 0 ? 0n : BigInt(paddedFraction);
  return whole + fraction;
}

export function formatUnits(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;

  if (fraction === 0n || decimals === 0) {
    return whole.toString();
  }

  const padded = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${padded}`;
}

export function compareDecimalStrings(left: string, right: string, decimals = 18): number {
  const leftUnits = parseUnits(left, decimals);
  const rightUnits = parseUnits(right, decimals);
  if (leftUnits === rightUnits) return 0;
  return leftUnits > rightUnits ? 1 : -1;
}
