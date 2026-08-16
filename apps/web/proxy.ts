import { NextResponse, type NextRequest } from "next/server";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import {
  isValidBasicAuthorization,
  isWebPasswordEnabled,
} from "@/lib/web-auth";
import { isValidMobileBearerAuthorization } from "@/lib/mobile-device-auth";

export function proxy(request: NextRequest) {
  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  const isTrustedRequest = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    if (!isApiRequest) {
      return new NextResponse("Untrusted request", { status: 403 });
    }
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const password = process.env.PURE_PASSWORD;
  const authorization = request.headers.get("authorization");
  const isMobileDeviceManagement = request.nextUrl.pathname === "/api/mobile/devices";
  const isMobilePairingRedemption = request.nextUrl.pathname === "/api/mobile/pairing/redeem";
  if (
    isWebPasswordEnabled(password)
    && !isMobilePairingRedemption
    && !isValidBasicAuthorization(authorization, password)
    && (!isApiRequest || isMobileDeviceManagement || !isValidMobileBearerAuthorization(authorization))
  ) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="pure", charset="UTF-8"',
      },
    });
  }

  return NextResponse.next();
}

export const config = { matcher: ["/", "/api/:path*"] };
