import { NextResponse } from "next/server";
import { redeemMobilePairingTicket } from "@/lib/mobile-pairing";

const noStore = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  try {
    const body = await req.json() as { id?: string; secret?: string; name?: string };
    if (typeof body.id !== "string" || typeof body.secret !== "string") {
      return NextResponse.json({ error: "Pairing ticket is required" }, { status: 400, headers: noStore });
    }
    const result = await redeemMobilePairingTicket(
      body.id,
      body.secret,
      typeof body.name === "string" ? body.name : "Pure Mobile",
    );
    if (result.status === "paired") return NextResponse.json({ token: result.token, device: result.device }, { status: 201, headers: noStore });
    if (result.status === "expired") return NextResponse.json({ error: "Pairing code expired" }, { status: 410, headers: noStore });
    if (result.status === "consumed") return NextResponse.json({ error: "Pairing code was already used" }, { status: 409, headers: noStore });
    return NextResponse.json({ error: "Invalid pairing code" }, { status: 401, headers: noStore });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500, headers: noStore });
  }
}
