import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createMobileDevice, type MobileDevice } from "./mobile-device-auth";

const PAIRING_TTL_MS = 2 * 60 * 1000;

interface PairingTicketRecord {
  id: string;
  secretHash: string;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
  device?: Omit<MobileDevice, "tokenHash">;
}

export interface MobilePairingTicket {
  id: string;
  secret: string;
  createdAt: string;
  expiresAt: string;
}

declare global {
  var __piMobilePairingTickets: Map<string, PairingTicketRecord> | undefined;
}

function tickets(): Map<string, PairingTicketRecord> {
  return globalThis.__piMobilePairingTickets ??= new Map();
}

function secretHash(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function equalHash(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function pruneExpiredTickets(now = Date.now()): void {
  for (const [id, ticket] of tickets()) {
    const expiry = new Date(ticket.expiresAt).getTime();
    const consumed = ticket.consumedAt ? new Date(ticket.consumedAt).getTime() : null;
    if (expiry <= now || (consumed !== null && consumed + PAIRING_TTL_MS <= now)) tickets().delete(id);
  }
}

export function createMobilePairingTicket(now = new Date()): MobilePairingTicket {
  pruneExpiredTickets(now.getTime());
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const record: PairingTicketRecord = {
    id,
    secretHash: secretHash(secret),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PAIRING_TTL_MS).toISOString(),
  };
  tickets().set(id, record);
  return { id, secret, createdAt: record.createdAt, expiresAt: record.expiresAt };
}

export function getMobilePairingTicketStatus(id: string): { status: "pending" | "paired" | "expired"; expiresAt?: string; device?: Omit<MobileDevice, "tokenHash"> } {
  const record = tickets().get(id);
  if (!record || new Date(record.expiresAt).getTime() <= Date.now()) return { status: "expired" };
  if (record.consumedAt && record.device) return { status: "paired", expiresAt: record.expiresAt, device: record.device };
  return { status: "pending", expiresAt: record.expiresAt };
}

export async function redeemMobilePairingTicket(
  id: string,
  secret: string,
  deviceName: string,
  path?: string,
): Promise<{ status: "invalid" | "expired" | "consumed" } | { status: "paired"; token: string; device: Omit<MobileDevice, "tokenHash"> }> {
  const record = tickets().get(id);
  if (!record || !secret || !equalHash(record.secretHash, secretHash(secret))) return { status: "invalid" };
  if (new Date(record.expiresAt).getTime() <= Date.now()) return { status: "expired" };
  if (record.consumedAt) return { status: "consumed" };

  // Reserve the ticket before the async file update so concurrent scans cannot
  // mint two device tokens from the same QR code.
  record.consumedAt = new Date().toISOString();
  try {
    const result = await createMobileDevice(deviceName, path);
    record.device = result.device;
    return { status: "paired", ...result };
  } catch (error) {
    delete record.consumedAt;
    throw error;
  }
}

export function clearMobilePairingTicketsForTests(): void {
  tickets().clear();
}
