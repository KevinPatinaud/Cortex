import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DEFAULT_PROMPT_CHAT_SETTINGS, type PromptChat, type PromptChatDefaults, type PromptChatSummary, type QueuedPrompt, type QueuedPromptStatus } from "../../../shared/PromptQueue.ts";

export interface StoredPromptChat extends PromptChat { sessionId: string | null; automaticTitle?: boolean }

/** A prompt and its conversation session are committed together before advancing. */
export class SqlitePromptQueueRepository {
  private readonly db: Database.Database;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prompt_chats (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS queued_prompts (
        id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES prompt_chats(id), status TEXT NOT NULL, value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS queued_prompts_chat ON queued_prompts(chat_id);
      CREATE TABLE IF NOT EXISTS prompt_queue_settings (id INTEGER PRIMARY KEY CHECK(id=1), concurrency INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS prompt_chat_defaults (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    `);
  }

  close(): void { this.db.close(); }
  transaction<T>(operation: () => T): T { return this.db.transaction(operation)(); }
  concurrency(): number {
    return (this.db.prepare("SELECT concurrency FROM prompt_queue_settings WHERE id=1").get() as { concurrency: number } | undefined)?.concurrency ?? 2;
  }
  setConcurrency(value: number): void {
    this.db.prepare("INSERT INTO prompt_queue_settings VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET concurrency=excluded.concurrency").run(value);
  }
  defaults(): PromptChatDefaults {
    const row = this.db.prepare("SELECT value FROM prompt_chat_defaults WHERE id=1").get() as { value: string } | undefined;
    return row ? JSON.parse(row.value) : { ...DEFAULT_PROMPT_CHAT_SETTINGS };
  }
  saveDefaults(value: PromptChatDefaults): void {
    this.db.prepare("INSERT INTO prompt_chat_defaults VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(JSON.stringify(value));
  }
  chats(): StoredPromptChat[] {
    return (this.db.prepare("SELECT value FROM prompt_chats ORDER BY rowid").all() as { value: string }[]).map(row => JSON.parse(row.value));
  }
  summaries(): PromptChatSummary[] {
    return this.chats().map(({ sessionId, automaticTitle, ...chat }) => {
      const counts: Record<QueuedPromptStatus, number> = { queued: 0, running: 0, completed: 0, failed: 0, interrupted: 0, cancelled: 0 };
      for (const row of this.db.prepare("SELECT status, COUNT(*) AS count FROM queued_prompts WHERE chat_id=? GROUP BY status").all(chat.id) as { status: QueuedPromptStatus; count: number }[]) counts[row.status] = row.count;
      const head = this.head(chat.id);
      return { ...chat, counts, nextScheduledAt: head?.status === "queued" ? head.scheduledAt ?? null : null };
    });
  }
  chat(id: string): StoredPromptChat | null {
    const row = this.db.prepare("SELECT value FROM prompt_chats WHERE id=?").get(id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }
  saveChat(chat: StoredPromptChat): void {
    this.db.prepare("INSERT INTO prompt_chats VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(chat.id, JSON.stringify(chat));
  }
  prompts(chatId: string): QueuedPrompt[] {
    return (this.db.prepare("SELECT value FROM queued_prompts WHERE chat_id=? ORDER BY rowid").all(chatId) as { value: string }[]).map(row => JSON.parse(row.value));
  }
  head(chatId: string): QueuedPrompt | undefined {
    const row = this.db.prepare("SELECT value FROM queued_prompts WHERE chat_id=? AND status NOT IN ('completed','cancelled') ORDER BY rowid LIMIT 1")
      .get(chatId) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  lastStarted(chatId: string): string {
    const row = this.db.prepare("SELECT json_extract(value, '$.startedAt') AS started FROM queued_prompts WHERE chat_id=? AND json_extract(value, '$.startedAt') IS NOT NULL ORDER BY rowid DESC LIMIT 1")
      .get(chatId) as { started: string } | undefined;
    return row?.started ?? "";
  }
  prompt(chatId: string, id: string): QueuedPrompt | null {
    const row = this.db.prepare("SELECT value FROM queued_prompts WHERE chat_id=? AND id=?").get(chatId, id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }
  savePrompt(prompt: QueuedPrompt): void {
    this.db.prepare("INSERT INTO queued_prompts VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, value=excluded.value")
      .run(prompt.id, prompt.chatId, prompt.status, JSON.stringify(prompt));
  }
  deleteChat(id: string): void {
    this.transaction(() => {
      this.db.prepare("DELETE FROM queued_prompts WHERE chat_id=?").run(id);
      this.db.prepare("DELETE FROM prompt_chats WHERE id=?").run(id);
    });
  }
}
