import { requestJson } from "./apiClient.ts";

export interface AuthenticationStatus {
  authenticated: boolean;
  required: boolean;
}

export function getAuthenticationStatus(): Promise<AuthenticationStatus> {
  return requestJson("/api/auth/session");
}

export function login(password: string): Promise<AuthenticationStatus> {
  return requestJson("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
}

export function logout(): Promise<AuthenticationStatus> {
  return requestJson("/api/auth/logout", { method: "POST" });
}
