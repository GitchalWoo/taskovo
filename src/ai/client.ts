import type { Config } from "../config";
import type { WeatherForecast } from "../weather/client";
import { logger } from "../utils/logger";
import { SYSTEM_PROMPTS } from "./prompts";

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface ChatCompletionResponse {
  choices: { message: { content: string; reasoning?: string }; finish_reason: string }[];
}

interface TaskSummaryInput {
  content: string;
  dueDate: string;
  project: string;
  priority: number;
}

function buildUserPrompt(tasks: TaskSummaryInput[], forecast: WeatherForecast | null): string {
  const lines = tasks.map(
    (t) => `- [${t.project}] ${t.content} (due: ${t.dueDate}, priority: ${t.priority})`,
  );
  let prompt = `Tasks for the upcoming week:\n${lines.join("\n")}`;

  if (forecast && forecast.days.length > 0) {
    const weatherLines = forecast.days.map(
      (d) => `- ${d.date}: ${d.condition}, ${d.tempMax}°/${d.tempMin}°C`,
    );
    prompt += `\n\nWeather forecast:\n${weatherLines.join("\n")}`;
  }

  return prompt;
}

export async function generateWeekSummary(
  config: Config,
  tasks: TaskSummaryInput[],
  lang: string,
  forecast: WeatherForecast | null = null,
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
    { role: "user", content: buildUserPrompt(tasks, forecast) },
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
