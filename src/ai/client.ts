import type { Config } from "../config";
import { logger } from "../utils/logger";

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface ChatCompletionResponse {
  choices: { message: { content: string; reasoning?: string }; finish_reason: string }[];
}

const SYSTEM_PROMPTS: Record<string, string> = {
  en: `You are a concise personal assistant. Given a list of tasks for the upcoming week, write a brief 2-3 sentence natural-language summary of what the week looks like. Mention key events, deadlines, and priorities. Be warm but brief. Do not list tasks — summarize them. Do not use markdown formatting.`,
  pl: `Jesteś zwięzłym osobistym asystentem. Na podstawie listy zadań na nadchodzący tydzień, napisz krótkie podsumowanie w 2-3 zdaniach opisujące jak wygląda ten tydzień. Wspomnij o kluczowych wydarzeniach, terminach i priorytetach. Bądź ciepły, ale zwięzły. Nie wypisuj zadań — podsumuj je. Nie używaj formatowania markdown. Bez ikonek`,
};

interface TaskSummaryInput {
  content: string;
  dueDate: string;
  project: string;
  priority: number;
}

function buildUserPrompt(tasks: TaskSummaryInput[]): string {
  const lines = tasks.map(
    (t) => `- [${t.project}] ${t.content} (due: ${t.dueDate}, priority: ${t.priority})`,
  );
  return `Tasks for the upcoming week:\n${lines.join("\n")}`;
}

export async function generateWeekSummary(
  config: Config,
  tasks: TaskSummaryInput[],
  lang: string,
): Promise<string | null> {
  if (!config.llmBaseUrl) {
    logger.debug("LLM not configured, skipping week summary");
    return null;
  }

  if (tasks.length === 0) {
    return null;
  }

  const systemPrompt = SYSTEM_PROMPTS[lang] ?? SYSTEM_PROMPTS["en"]!;
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: buildUserPrompt(tasks) },
  ];

  const url = `${config.llmBaseUrl.replace(/\/+$/, "")}/v1/chat/completions`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.llmApiKey) {
    headers["Authorization"] = `Bearer ${config.llmApiKey}`;
  }

  try {
    logger.info("Requesting week summary from LLM", { model: config.llmModel, taskCount: tasks.length });

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.llmModel,
        messages,
        max_tokens: 4096,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      logger.warn("LLM request failed", { status: response.status, statusText: response.statusText });
      return null;
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const choice = data.choices?.[0];
    const raw = choice?.message?.content?.trim();

    logger.debug("LLM response", {
      finishReason: choice?.finish_reason,
      contentLength: raw?.length ?? 0,
      hasReasoning: !!choice?.message?.reasoning,
    });

    if (!raw) {
      logger.warn("LLM returned empty content (reasoning models need higher max_tokens)", {
        finishReason: choice?.finish_reason,
      });
      return null;
    }

    // Strip <think>...</think> blocks from reasoning models (e.g. DeepSeek-R1, QwQ)
    const content = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    if (!content) {
      logger.warn("LLM response contained only reasoning, no summary");
      return null;
    }

    logger.info("Generated week summary", { length: content.length });
    return content;
  } catch (error) {
    logger.warn("Failed to generate week summary", { error: String(error) });
    return null;
  }
}
