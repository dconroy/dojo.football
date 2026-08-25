import { afterEach, describe, expect, it } from "vitest";
import {
  createDemoToken,
  getDemoClaims,
  readDemoToken,
} from "@/auth/demo-session";
import { DEMO_TOKEN_HEADER, NO_DEMO_TOKEN } from "@/lib/demo-token";

const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

afterEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = originalKey;
});

describe("demo session tokens", () => {
  it("round-trips a seat-bound play session", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "test-demo-secret";
    const token = await createDemoToken({
      roomId: "demo:room-123",
      slot: 7,
      role: "play",
      sessionId: "lease-456",
    });

    await expect(readDemoToken(token)).resolves.toMatchObject({
      roomId: "demo:room-123",
      slot: 7,
      role: "play",
      sessionId: "lease-456",
    });
  });

  it("round-trips a spectator without assigning a seat", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "test-demo-secret";
    const token = await createDemoToken({
      roomId: "demo:room-123",
      slot: null,
      role: "watch",
      sessionId: null,
    });

    await expect(readDemoToken(token)).resolves.toMatchObject({
      slot: null,
      role: "watch",
      sessionId: null,
    });
  });

  it("rejects seat and lease tampering", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "test-demo-secret";
    const token = await createDemoToken({
      roomId: "demo:room-123",
      slot: 3,
      role: "play",
      sessionId: "lease-456",
    });

    await expect(readDemoToken(token.replace(".3.play.", ".4.play."))).resolves.toBeNull();
    await expect(readDemoToken(token.replace("lease-456", "lease-999"))).resolves.toBeNull();
  });

  it("reads a tab token from the request header", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "test-demo-secret";
    const token = await createDemoToken({
      roomId: "demo:tab-room",
      slot: 2,
      role: "play",
      sessionId: "tab-lease",
    });
    const request = new Request("https://dojo.test/api/draft", {
      headers: { [DEMO_TOKEN_HEADER]: token },
    });

    await expect(getDemoClaims(request)).resolves.toMatchObject({
      roomId: "demo:tab-room",
      slot: 2,
      sessionId: "tab-lease",
    });
  });

  it("does not fall back to another tab's cookie when the sentinel is sent", async () => {
    const request = new Request("https://dojo.test/api/draft", {
      headers: { [DEMO_TOKEN_HEADER]: NO_DEMO_TOKEN },
    });
    await expect(getDemoClaims(request)).resolves.toBeNull();
  });
});
