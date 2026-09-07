import type { AgentUseCase } from "../../usecase/AgentUseCase.ts";

/** A single non-overlapping scan; suspended workflows do not occupy execution slots. */
export class WorkflowWaitScheduler {
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;
  private controller = new AbortController();
  constructor(private readonly agents: AgentUseCase, private readonly intervalMs = 1000) {}

  start(): void {
    if (this.timer) return;
    this.controller = new AbortController();
    const tick = async () => {
      if (this.scanning) return;
      this.scanning = true;
      try { await this.agents.wakeWaitingWorkflows(new Date(), { background: true, signal: this.controller.signal }); }
      catch (error) { console.error("Unable to scan workflow waits:", error); }
      finally { this.scanning = false; }
    };
    this.timer = setInterval(() => void tick(), this.intervalMs);
    this.timer.unref();
    void tick();
  }

  stop(): void {
    this.controller.abort();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
