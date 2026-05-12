export const playgroundMcpProxyPath = "/api/mcp-proxy";

export function playgroundMcpTransportProxyFor(mcpUrl: string): string | undefined {
  const normalizedUrl = normalizeMcpProxyPolicyUrl(mcpUrl);

  return normalizedUrl && isPublicHttpsMcpUrl(normalizedUrl) ? playgroundMcpProxyPath : undefined;
}

function normalizeMcpProxyPolicyUrl(url: string): string | null {
  try {
    const normalizedUrl = new URL(url);
    normalizedUrl.hash = "";

    return normalizedUrl.toString();
  } catch {
    return null;
  }
}

function isPublicHttpsMcpUrl(url: string): boolean {
  const parsed = new URL(url);

  return parsed.protocol === "https:" && !isBlockedMcpHostname(parsed.hostname);
}

export function normalizeMcpHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[(?<address>.*)\]$/u, "$<address>");
}

export function isBlockedMcpHostname(hostname: string): boolean {
  const normalized = normalizeMcpHostname(hostname);

  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    (isMcpIpAddress(normalized) && isBlockedMcpIpAddress(normalized))
  );
}

export function isMcpIpAddress(address: string): boolean {
  const normalized = normalizeMcpHostname(address);

  return parseIpv4Address(normalized) !== null || normalized.includes(":");
}

export function isBlockedMcpIpAddress(address: string): boolean {
  const normalized = normalizeMcpHostname(address);
  const ipv4Address = parseIpv4Address(normalized) ?? parseIpv4MappedIpv6Address(normalized);
  if (ipv4Address) {
    return isBlockedIpv4Address(ipv4Address);
  }

  return isBlockedIpv6Address(normalized);
}

function parseIpv4Address(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const bytes = parts.map((part) => Number(part));
  return bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255) ? bytes : null;
}

function parseIpv4MappedIpv6Address(address: string): number[] | null {
  const dottedIpv4 = address.match(/^::ffff:(?<ipv4>\d+\.\d+\.\d+\.\d+)$/u)?.groups?.ipv4;
  if (dottedIpv4) {
    return parseIpv4Address(dottedIpv4);
  }

  const hexIpv4 = address.match(/^::ffff:(?<high>[0-9a-f]{1,4}):(?<low>[0-9a-f]{1,4})$/u)?.groups;
  if (!hexIpv4) {
    return null;
  }

  const high = Number.parseInt(hexIpv4.high, 16);
  const low = Number.parseInt(hexIpv4.low, 16);
  if (!Number.isInteger(high) || !Number.isInteger(low)) {
    return null;
  }

  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isBlockedIpv4Address(parts: number[]): boolean {
  const [first = 0, second = 0] = parts;

  const blockedRanges: Array<readonly [number, number, number, number]> = [
    [0, 0, 0, 255],
    [10, 0, 10, 255],
    [100, 64, 100, 127],
    [127, 0, 127, 255],
    [169, 254, 169, 254],
    [172, 16, 172, 31],
    [192, 168, 192, 168],
    [198, 18, 198, 19],
    [224, 0, 255, 255],
  ];

  return blockedRanges.some(
    ([fromFirst, fromSecond, toFirst, toSecond]) =>
      (first > fromFirst || (first === fromFirst && second >= fromSecond)) &&
      (first < toFirst || (first === toFirst && second <= toSecond)),
  );
}

function isBlockedIpv6Address(address: string): boolean {
  const firstHextetText = address.split(":")[0] ?? "";
  const firstHextet = Number.parseInt(firstHextetText, 16);

  return (
    address === "::" ||
    address === "::1" ||
    address.startsWith("2001:db8:") ||
    Number.isNaN(firstHextet) ||
    (firstHextet & 0xfe00) === 0xfc00 ||
    (firstHextet & 0xffc0) === 0xfe80 ||
    (firstHextet & 0xff00) === 0xff00
  );
}
