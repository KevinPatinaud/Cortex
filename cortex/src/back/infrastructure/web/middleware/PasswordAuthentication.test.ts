import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import {
  createAuthenticationRouter,
  PasswordAuthentication,
  readAccessPassword,
  readSecureCookie,
  requireAuthentication
} from "./PasswordAuthentication.ts";

test("creates and validates an authenticated session", () => {
  const authentication = new PasswordAuthentication({
    password: "a-strong-password",
    secureCookie: true,
    createToken: () => "session-token"
  });

  const token = authentication.authenticate("a-strong-password");

  assert.equal(token, "session-token");
  assert.equal(
    authentication.isAuthenticated("theme=dark; cortex_session=session-token"),
    true
  );
  assert.match(authentication.createSessionCookie(token!), /HttpOnly/);
  assert.match(authentication.createSessionCookie(token!), /SameSite=Strict/);
  assert.match(authentication.createSessionCookie(token!), /Secure/);
});

test("rejects an incorrect password without creating a session", () => {
  const authentication = new PasswordAuthentication({
    password: "a-strong-password",
    secureCookie: false
  });

  assert.equal(authentication.authenticate("incorrect-password"), null);
  assert.equal(authentication.isAuthenticated(undefined), false);
});

test("expires and revokes sessions", () => {
  let currentTime = 1_000;
  const authentication = new PasswordAuthentication({
    password: "a-strong-password",
    secureCookie: false,
    sessionDurationMs: 100,
    now: () => currentTime,
    createToken: () => "session-token"
  });

  authentication.authenticate("a-strong-password");
  authentication.revoke("cortex_session=session-token");
  assert.equal(
    authentication.isAuthenticated("cortex_session=session-token"),
    false
  );

  authentication.authenticate("a-strong-password");
  currentTime = 1_101;
  assert.equal(
    authentication.isAuthenticated("cortex_session=session-token"),
    false
  );
});

test("validates authentication environment variables", () => {
  assert.equal(
    readAccessPassword("a-strong-password", "0.0.0.0"),
    "a-strong-password"
  );
  assert.equal(readAccessPassword(undefined, "127.0.0.1"), null);
  assert.equal(readAccessPassword(undefined, "localhost"), null);
  assert.equal(readAccessPassword(undefined, "::1"), null);
  assert.throws(
    () => readAccessPassword(undefined, "0.0.0.0"),
    /required for network access/
  );
  assert.throws(
    () => readAccessPassword("too-short", "127.0.0.1"),
    /at least 12/
  );
  assert.equal(readSecureCookie(undefined), false);
  assert.equal(readSecureCookie("true"), true);
  assert.equal(readSecureCookie("false"), false);
  assert.throws(() => readSecureCookie("yes"), /true or false/);
});

test("disables authentication for a local-only instance", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthenticationRouter(null));
  const server = app.listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/session`);

    assert.deepEqual(await response.json(), {
      authenticated: true,
      required: false
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("protects API routes until the client logs in", async () => {
  const authentication = new PasswordAuthentication({
    password: "a-strong-password",
    secureCookie: false,
    createToken: () => "session-token"
  });
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthenticationRouter(authentication));
  app.use("/api", requireAuthentication(authentication));
  app.get("/api/protected", (_request, response) => {
    response.json({ accessible: true });
  });
  const server = app.listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;
    const anonymousResponse = await fetch(`${baseUrl}/api/protected`);
    assert.equal(anonymousResponse.status, 401);

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "a-strong-password" })
    });
    assert.equal(loginResponse.status, 200);
    const sessionCookie = loginResponse.headers.get("set-cookie")?.split(";")[0];
    assert.ok(sessionCookie);

    const authenticatedResponse = await fetch(`${baseUrl}/api/protected`, {
      headers: { Cookie: sessionCookie }
    });
    assert.equal(authenticatedResponse.status, 200);
    assert.deepEqual(await authenticatedResponse.json(), { accessible: true });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
