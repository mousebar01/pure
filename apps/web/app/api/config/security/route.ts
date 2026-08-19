import { NextResponse } from "next/server";
import {
  getPureConfigStatus,
  setPurePassword,
  updatePureConfig,
  type PureNetworkMode,
} from "@/lib/pure-config";
import { getWebAuthStatus } from "@/lib/web-auth";

const noStore = { "Cache-Control": "no-store" };
export const dynamic = "force-dynamic";

export function GET() {
  const config = getPureConfigStatus();
  const auth = getWebAuthStatus();
  return NextResponse.json({ ...config, configured: auth.configured, source: auth.source, username: auth.username }, { headers: noStore });
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { username?: unknown; networkMode?: unknown };
    const username = body.username === undefined ? undefined : String(body.username);
    const networkMode = body.networkMode === undefined ? undefined : body.networkMode as PureNetworkMode;
    const config = updatePureConfig({ username, networkMode });
    const status = getPureConfigStatus();
    return NextResponse.json({
      ...status,
      source: status.source,
      username: config.auth.username,
      networkMode: config.network.mode,
    }, { headers: noStore });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers: noStore });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { password?: unknown };
    if (typeof body.password !== "string" || !body.password) {
      return NextResponse.json({ error: "请设置访问密码；Pure 不再自动生成随机密码。" }, { status: 400, headers: noStore });
    }
    const config = setPurePassword(body.password);
    return NextResponse.json({
      passwordConfigured: true,
      configured: true,
      source: "config",
      passwordSource: "config",
      username: config.auth.username,
      networkMode: config.network.mode,
    }, { status: 201, headers: noStore });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409, headers: noStore });
  }
}
