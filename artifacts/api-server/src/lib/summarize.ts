import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./logger";

const MODEL = "claude-opus-4-8";
const MAX_LEN = 100;

const SYSTEM = `You write ultra-concise fantasy football news synopses.
Given a single player-news headline, output one key-point synopsis of at most ${MAX_LEN} characters.
Rules:
- Base the synopsis ONLY on the headline. Never invent injuries, severity, timelines, stats, or outcomes that are not stated.
- Do not begin with the player's name; lead with the takeaway.
- Plain text only: no quotes, no markdown, no trailing ellipsis.
- Respond with the synopsis text and nothing else.`;

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env["ANTHROPIC_API_KEY"]) return null;
  if (!client) client = new Anthropic();
  return client;
}

/** True when an API key is configured, so ingest can decide whether to summarize. */
export function summariesEnabled(): boolean {
  return Boolean(process.env["ANTHROPIC_API_KEY"]);
}

/** Generate a <=100-char key-point synopsis for a headline, or null on failure. */
export async function summarize(title: string): Promise<string | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 64,
      system: SYSTEM,
      messages: [{ role: "user", content: `Headline: ${title}` }],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (!text) return null;
    return text.length > MAX_LEN ? text.slice(0, MAX_LEN).trimEnd() : text;
  } catch (err) {
    logger.error({ err }, "Summary generation failed");
    return null;
  }
}
