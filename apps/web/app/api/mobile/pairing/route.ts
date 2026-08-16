import { NextResponse } from "next/server";
import { networkInterfaces } from "node:os";
import { createMobilePairingTicket, getMobilePairingTicketStatus } from "@/lib/mobile-pairing";

const noStore = { "Cache-Control": "no-store" };

function suggestedServerUrls(req: Request): string[] {
  const requestUrl = new URL(req.url);
  const host = req.headers.get("host") ?? requestUrl.host;
  const port = host.match(/:(\d+)$/)?.[1] ?? requestUrl.port;
  const urls = Object.values(networkInterfaces()).flatMap((addresses) => (addresses ?? [])
    .filter((address) => address.family === "IPv4" && !address.internal)
    .map((address) => `${requestUrl.protocol}//${address.address}${port ? `:${port}` : ""}`));
  return [...new Set(urls)];
}

export async function POST(req: Request) {
  return NextResponse.json(
    { ticket: createMobilePairingTicket(), suggestedServerUrls: suggestedServerUrls(req) },
    { status: 201, headers: noStore },
  );
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400, headers: noStore });
  return NextResponse.json(getMobilePairingTicketStatus(id), { headers: noStore });
}
