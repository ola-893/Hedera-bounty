export function entityIdToSolidityAddress(entityId: string): string {
  const { shard, realm, num } = parseEntityId(entityId);
  return `0x${toFixedHex(shard, 4)}${toFixedHex(realm, 8)}${toFixedHex(num, 8)}`;
}

export function encodeV2Path(tokenIds: string[], fees: number[]): string {
  if (tokenIds.length < 2) {
    throw new Error("SaucerSwap V2 path requires at least two tokens.");
  }

  if (fees.length !== tokenIds.length - 1) {
    throw new Error("SaucerSwap V2 path requires one fee per hop.");
  }

  let encoded = stripHexPrefix(entityIdToSolidityAddress(tokenIds[0] ?? ""));
  for (let index = 0; index < fees.length; index += 1) {
    encoded += toFixedHex(BigInt(fees[index] ?? 3000), 3);
    encoded += stripHexPrefix(entityIdToSolidityAddress(tokenIds[index + 1] ?? ""));
  }
  return `0x${encoded}`;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = stripHexPrefix(hex);
  if (clean.length % 2 !== 0) {
    throw new Error("Hex string must contain an even number of characters.");
  }
  return Uint8Array.from(clean.match(/.{1,2}/g)?.map((part) => Number.parseInt(part, 16)) ?? []);
}

export function stripHexPrefix(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function parseEntityId(entityId: string): { shard: bigint; realm: bigint; num: bigint } {
  const parts = entityId.split(".");
  if (parts.length !== 3) {
    throw new Error(`Invalid Hedera entity id: ${entityId}`);
  }
  return {
    shard: BigInt(parts[0] ?? "0"),
    realm: BigInt(parts[1] ?? "0"),
    num: BigInt(parts[2] ?? "0")
  };
}

function toFixedHex(value: bigint, bytes: number): string {
  const width = bytes * 2;
  const hex = value.toString(16);
  if (hex.length > width) {
    throw new Error(`Value ${value.toString()} does not fit into ${bytes} bytes.`);
  }
  return hex.padStart(width, "0");
}
