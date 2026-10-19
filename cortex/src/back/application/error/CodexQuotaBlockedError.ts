import { ValidationError } from "./ValidationError.ts";

export class CodexQuotaBlockedError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "CodexQuotaBlockedError";
  }
}
