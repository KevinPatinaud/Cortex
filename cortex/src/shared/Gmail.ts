export interface GmailWatch {
  id: string;
  projectId: string;
  instanceId: string;
  eventKey: string;
  threadId: string;
  subject: string;
  status: "active" | "paused" | "finished";
  lastCheckedAt: string | null;
  error: string | null;
}

export interface GmailStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  redirectUri: string;
  watches: GmailWatch[];
}

export interface GmailThreadSummary {
  id: string;
  subject: string;
  from: string;
  snippet: string;
}
