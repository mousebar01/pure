import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
import test from "node:test";

const jiti = createJiti(import.meta.url);
async function subject() { return jiti.import("./mobile-pairing.ts"); }

test("pairing tickets are single-use and never expose the secret in status", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "pure-mobile-pairing-")), "devices.json");
  const { clearMobilePairingTicketsForTests, createMobilePairingTicket, getMobilePairingTicketStatus, redeemMobilePairingTicket } = await subject();
  clearMobilePairingTicketsForTests();
  const ticket = createMobilePairingTicket(new Date(Date.now() - 1000));
  assert.equal(getMobilePairingTicketStatus(ticket.id).status, "pending");
  const paired = await redeemMobilePairingTicket(ticket.id, ticket.secret, "Test phone", path);
  assert.equal(paired.status, "paired");
  assert.equal(getMobilePairingTicketStatus(ticket.id).status, "paired");
  assert.equal((await redeemMobilePairingTicket(ticket.id, ticket.secret, "Second phone", path)).status, "consumed");
  assert.equal(JSON.stringify(getMobilePairingTicketStatus(ticket.id)).includes(ticket.secret), false);
});

test("pairing tickets reject incorrect secrets", async () => {
  const { clearMobilePairingTicketsForTests, createMobilePairingTicket, redeemMobilePairingTicket } = await subject();
  clearMobilePairingTicketsForTests();
  const ticket = createMobilePairingTicket();
  assert.equal((await redeemMobilePairingTicket(ticket.id, "wrong", "Phone")).status, "invalid");
});
