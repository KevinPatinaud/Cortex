import { CopilotClient } from "@github/copilot-sdk";

type CopilotSession = Awaited<ReturnType<CopilotClient["createSession"]>>;

export class CopilotService {
  async ask(prompt: string, model: string): Promise<string> {
    const client = new CopilotClient();
    let session: CopilotSession | undefined;

    try {
      await this.withinTimeout(client.start(), 30_000);
      session = await client.createSession({});
      client.listModels().then((models) => {
        console.log("Modeles disponibles :", models);
      });

      await session.setModel(model, {
        reasoningEffort: "low",
        reasoningSummary: "none"
      });

      const result = await session.sendAndWait({ prompt }, 30_000);
      const answer = result?.data.content;

      if (!answer) {
        throw new Error("Copilot n'a renvoye aucune reponse.");
      }

      return answer;
    } finally {
      await session?.disconnect();
      await client.stop();
    }
  }

  private withinTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("Copilot n'a pas repondu a temps.")), timeout);
      })
    ]);
  }
}
