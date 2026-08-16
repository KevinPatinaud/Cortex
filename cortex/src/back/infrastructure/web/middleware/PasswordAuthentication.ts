import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";

const SESSION_COOKIE_NAME = "cortex_session";
const DEFAULT_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

interface Session {
  expiresAt: number;
}

interface PasswordAuthenticationOptions {
  password: string;
  secureCookie: boolean;
  sessionDurationMs?: number;
  now?: () => number;
  createToken?: () => string;
}

export class PasswordAuthentication {
  private readonly sessions = new Map<string, Session>();
  private readonly passwordBuffer: Buffer;
  private readonly sessionDurationMs: number;
  private readonly now: () => number;
  private readonly createToken: () => string;

  constructor(private readonly options: PasswordAuthenticationOptions) {
    this.passwordBuffer = this.hashPassword(options.password);
    this.sessionDurationMs = options.sessionDurationMs ?? DEFAULT_SESSION_DURATION_MS;
    this.now = options.now ?? Date.now;
    this.createToken = options.createToken ??
      (() => randomBytes(32).toString("base64url"));
  }

  authenticate(password: unknown): string | null {
    if (typeof password !== "string" || !this.passwordMatches(password)) {
      return null;
    }

    this.deleteExpiredSessions();
    const token = this.createToken();
    this.sessions.set(token, { expiresAt: this.now() + this.sessionDurationMs });
    return token;
  }

  isAuthenticated(cookieHeader: string | undefined): boolean {
    const token = this.readSessionToken(cookieHeader);

    if (!token) {
      return false;
    }

    const session = this.sessions.get(token);

    if (!session || session.expiresAt <= this.now()) {
      this.sessions.delete(token);
      return false;
    }

    return true;
  }

  revoke(cookieHeader: string | undefined): void {
    const token = this.readSessionToken(cookieHeader);

    if (token) {
      this.sessions.delete(token);
    }
  }

  createSessionCookie(token: string): string {
    return [
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      "HttpOnly",
      "SameSite=Strict",
      "Path=/",
      `Max-Age=${Math.floor(this.sessionDurationMs / 1000)}`,
      ...(this.options.secureCookie ? ["Secure"] : [])
    ].join("; ");
  }

  createExpiredSessionCookie(): string {
    return [
      `${SESSION_COOKIE_NAME}=`,
      "HttpOnly",
      "SameSite=Strict",
      "Path=/",
      "Max-Age=0",
      ...(this.options.secureCookie ? ["Secure"] : [])
    ].join("; ");
  }

  private passwordMatches(password: string): boolean {
    return timingSafeEqual(this.hashPassword(password), this.passwordBuffer);
  }

  private hashPassword(password: string): Buffer {
    return createHash("sha256").update(password, "utf8").digest();
  }

  private readSessionToken(cookieHeader: string | undefined): string | null {
    if (!cookieHeader) {
      return null;
    }

    for (const cookie of cookieHeader.split(";")) {
      const separatorIndex = cookie.indexOf("=");

      if (separatorIndex === -1) {
        continue;
      }

      const name = cookie.slice(0, separatorIndex).trim();

      if (name === SESSION_COOKIE_NAME) {
        try {
          return decodeURIComponent(cookie.slice(separatorIndex + 1).trim());
        } catch {
          return null;
        }
      }
    }

    return null;
  }

  private deleteExpiredSessions(): void {
    const currentTime = this.now();

    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= currentTime) {
        this.sessions.delete(token);
      }
    }
  }
}

export function createAuthenticationRouter(
  authentication: PasswordAuthentication | null
): Router {
  const router = Router();

  router.get("/session", (request, response) => {
    response.json({
      authenticated: authentication === null ||
        authentication.isAuthenticated(request.headers.cookie),
      required: authentication !== null
    });
  });

  router.post("/login", (request, response) => {
    if (!authentication) {
      response.json({ authenticated: true, required: false });
      return;
    }

    const token = authentication.authenticate(request.body?.password);

    if (!token) {
      response.status(401).json({ error: "Incorrect password." });
      return;
    }

    response.setHeader("Set-Cookie", authentication.createSessionCookie(token));
    response.json({ authenticated: true, required: true });
  });

  router.post("/logout", (request, response) => {
    if (!authentication) {
      response.json({ authenticated: true, required: false });
      return;
    }

    authentication.revoke(request.headers.cookie);
    response.setHeader("Set-Cookie", authentication.createExpiredSessionCookie());
    response.json({ authenticated: false, required: true });
  });

  return router;
}

export function requireAuthentication(
  authentication: PasswordAuthentication
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    if (authentication.isAuthenticated(request.headers.cookie)) {
      next();
      return;
    }

    response.status(401).json({ error: "Authentication required." });
  };
}

export function readAccessPassword(
  value: string | undefined,
  host: string
): string | null {
  if (!value && isLoopbackHost(host)) {
    return null;
  }

  if (!value || value.length < 12) {
    throw new Error(
      "The CORTEX_PASSWORD variable is required for network access and must contain at least 12 characters."
    );
  }

  return value;
}

export function readPasswordArgument(args: string[]): string | undefined {
  const inlineArgument = args.find((argument) => argument.startsWith("--password="));

  if (inlineArgument) {
    return inlineArgument.slice("--password=".length);
  }

  const argumentIndex = args.indexOf("--password");

  if (argumentIndex === -1) {
    return undefined;
  }

  const value = args[argumentIndex + 1];

  if (!value || value.startsWith("--")) {
    throw new Error("The --password argument requires a value.");
  }

  return value;
}

export function requireServerPassword(
  isServerMode: boolean,
  value: string | undefined
): string | undefined {
  if (isServerMode && !value) {
    throw new Error(
      "The start:server command requires --password or CORTEX_PASSWORD."
    );
  }

  return value;
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function readSecureCookie(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "") {
    return false;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error("The CORTEX_SECURE_COOKIE variable must be true or false.");
}
