export interface DiscoveredPureServer {
  serverUrl: string;
  name: string;
  port: number;
}

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

export function isPrivateIpv4(ip: string): boolean {
  const parts = ipv4Parts(ip);
  if (!parts) return false;
  const [first, second] = parts;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

export function buildLocalCandidates(ip: string): string[] {
  const parts = ipv4Parts(ip);
  if (!parts || !isPrivateIpv4(ip)) return [];
  const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
  // Try the current host first, then the common gateway range. The bounded
  // /24 scan keeps discovery predictable and avoids probing public networks.
  return [ip, ...Array.from({ length: 254 }, (_, index) => `${prefix}.${index + 1}`).filter((candidate) => candidate !== ip)];
}

async function probe(address: string, port: number, timeoutMs: number): Promise<DiscoveredPureServer[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://${address}:${port}/api/mobile/discovery`, { signal: controller.signal });
    if (!response.ok) return [];
    const body = await response.json() as Partial<DiscoveredPureServer> & { service?: string };
    if (body.service !== "pure" || typeof body.serverUrl !== "string" || typeof body.name !== "string") return [];
    const resolvedPort = typeof body.port === "number" ? body.port : port;
    return [{ serverUrl: body.serverUrl, name: body.name, port: resolvedPort }];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function discoverLocalPureServers(ip: string, port = 30001): Promise<DiscoveredPureServer[]> {
  const candidates = buildLocalCandidates(ip);
  const results: DiscoveredPureServer[] = [];
  for (let start = 0; start < candidates.length; start += 24) {
    const batch = candidates.slice(start, start + 24);
    const found = await Promise.all(batch.map((address) => probe(address, port, 550)));
    for (const server of found.flat()) {
      if (!results.some((candidate) => candidate.serverUrl === server.serverUrl)) results.push(server);
    }
  }
  return results;
}
