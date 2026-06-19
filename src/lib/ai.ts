import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

export type Provider = "anthropic" | "openai" | "google";

export interface ModelOption {
  id: string;
  label: string;
  provider: Provider;
  model: string;
}

/** Model picker options, grouped by provider. */
export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    provider: "anthropic",
    model: "claude-opus-4-8",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    model: "claude-haiku-4-5",
  },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai", model: "gpt-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o mini", provider: "openai", model: "gpt-4o-mini" },
  {
    id: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    provider: "google",
    model: "gemini-2.0-flash",
  },
  { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", provider: "google", model: "gemini-1.5-pro" },
];

export const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
};

export function modelOption(id: string): ModelOption {
  return MODEL_OPTIONS.find((m) => m.id === id) ?? (MODEL_OPTIONS[0] as ModelOption);
}

const SYSTEM = `You are SchemaGuard's schema-design assistant. You design clean relational database schemas.

Given the current schema (as PostgreSQL DDL) and a request, return the COMPLETE desired schema as PostgreSQL CREATE TABLE statements.

Rules:
- Output ONLY SQL DDL. No prose, no explanation.
- Every table must have a primary key (use BIGSERIAL PRIMARY KEY for surrogate ids).
- Declare foreign keys with explicit REFERENCES and an ON DELETE action.
- Add an index on every foreign key column.
- Preserve existing tables and columns unless the request asks to change them.
- Use snake_case names and conventional pluralized table names.`;

export function resolveModel(option: ModelOption, apiKey: string) {
  switch (option.provider) {
    case "anthropic":
      return createAnthropic({
        apiKey,
        // Allow direct calls from the app's webview/browser context.
        headers: { "anthropic-dangerous-direct-browser-access": "true" },
      })(option.model);
    case "openai":
      return createOpenAI({ apiKey })(option.model);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(option.model);
  }
}

/** Ask the selected model to design/extend the schema, returning SQL DDL. */
export async function generateSchemaSql(
  option: ModelOption,
  apiKey: string,
  currentSql: string,
  prompt: string,
): Promise<string> {
  const { text } = await generateText({
    model: resolveModel(option, apiKey),
    system: SYSTEM,
    prompt:
      `Current schema:\n\n${currentSql.trim().length > 0 ? currentSql : "(empty — no tables yet)"}\n\n` +
      `Request: ${prompt}\n\n` +
      `Return the complete schema as PostgreSQL CREATE TABLE statements.`,
    maxOutputTokens: 8000,
  });
  return stripFences(text);
}

function stripFences(s: string): string {
  const fenced = /```(?:sql)?\s*([\s\S]*?)```/i.exec(s);
  return (fenced?.[1] ?? s).trim();
}
