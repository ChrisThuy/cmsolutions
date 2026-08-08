/*
  Who art-directs the site.

  The builder's split is: the model supplies taste, code supplies
  correctness. That means the model is genuinely swappable — it returns a
  design spec that lib/sitegen/spec.mjs validates and lib/sitegen/render.mjs
  turns into a page. Nothing downstream cares who wrote the spec, only that
  it passes validation.

  So this file is the one place the studio is chosen, and it is chosen by
  environment variable rather than by editing code:

    SITEGEN_STUDIO = kimi      Kimi K3 through OpenRouter   (default)
                   = anthropic Claude Opus 5 direct

  ── why both paths, rather than replacing one with the other ──

  The two providers fail differently and neither is under our control. If
  OpenRouter is down, or the model is deprecated, or a schema-mode change
  breaks structured output, the tool should fall back rather than return an
  error to someone who came to see a website. Falling back is only possible
  if both paths stay working, so both stay working.

  ── on structured output ──

  This is the part that makes the difference between providers real.

  The Anthropic path uses messages.parse() with zodOutputFormat, where the
  SDK enforces the schema and the model is re-prompted on a mismatch. The
  OpenRouter path uses response_format: json_schema, which OpenRouter
  advertises for Kimi K3 — but "advertises" is not "guarantees", so the
  result is parsed and validated here before anything downstream sees it.
  A spec that does not validate is a failure of this function, not a
  surprise three files later.
*/

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const STUDIOS = {
  kimi: {
    label: "Kimi K3",
    via: "openrouter",
    model: "moonshotai/kimi-k3",
    keyVar: "OPENROUTER_API_KEY",
    /*
      Art direction is the part worth thinking about.

      K3 is a reasoning model and exposes reasoning_effort, so it is set
      high here rather than left at the provider's default. This is one
      call per site with a person waiting on the result — the marginal
      seconds buy a better concept, and the concept is the entire product.
      It is not a hot path where latency is the thing being optimised.
    */
    reasoningEffort: "high",
  },
  anthropic: {
    label: "Claude Fable 5",
    via: "anthropic",
    model: "claude-fable-5",
    keyVar: "ANTHROPIC_API_KEY",
    /*
      Art direction is the whole product here, so this runs at high effort.

      Effort is the depth control on Fable 5 — the thinking parameter is not.
      Thinking is always on and any explicit `thinking` config is a 400, so
      there is deliberately none in viaAnthropic below. Do not add one back.
    */
    effort: "high",
  },
};

/*
  Anthropic is the default studio.

  It was `kimi`, from when OpenRouter was the primary and Claude the fallback.
  That inverted when the OpenRouter key started returning 401 "User not found"
  on every request: the default studio was dead, so every build paid a failed
  call before falling through to the one that works. Kimi stays in the list —
  a second provider is the whole point of the two-studio design — but it is
  no longer what runs first.
*/
export const chosenStudio = () => STUDIOS[process.env.SITEGEN_STUDIO ?? "anthropic"] ?? STUDIOS.anthropic;

/** Which studios could actually run, given the keys present. */
export const availableStudios = () =>
  Object.entries(STUDIOS).filter(([, s]) => Boolean(process.env[s.keyVar])).map(([k]) => k);

/*
  Recovers the JSON object from a reply that is mostly JSON.

  Schema mode is meant to guarantee a bare object, and mostly does. But a
  reasoning model asked to think hard will sometimes wrap the answer in a
  ```json fence, or open with a sentence before it — and a strict parse then
  throws away a perfectly good spec over punctuation. This shipped and broke
  a real build, which is exactly the failure the fallback was supposed to
  absorb and could not, because the second studio then ran out of clock.

  Deliberately narrow: strip a fence, otherwise take the outermost braces.
  It does not try to repair broken JSON — a truncated object should fail
  loudly rather than be half-guessed into something that validates.
*/
export function unwrapJson(text) {
  let out = String(text).trim();

  const fenced = out.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) out = fenced[1].trim();

  if (!out.startsWith("{")) {
    const first = out.indexOf("{");
    const last = out.lastIndexOf("}");
    if (first !== -1 && last > first) out = out.slice(first, last + 1);
  }
  return out;
}

/*
  OpenRouter speaks the OpenAI chat shape. Kept as a plain fetch rather than
  pulling in another SDK: it is one POST, and a dependency whose only job is
  to build one POST is a dependency that will need upgrading for no reason.
*/
async function viaOpenRouter({ studio, system, user, schema, schemaName, maxTokens, signal, budgetMs }) {
  /* Bounded, because it was not. An unbounded call to someone else's API
     inside a function with a hard ceiling means one slow studio consumes the
     entire budget and the fallback never gets to run — which is how a
     recoverable failure became a failed build. */
  const deadline = AbortSignal.timeout(budgetMs ?? 170_000);
  const stop = signal ? AbortSignal.any([signal, deadline]) : deadline;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env[studio.keyVar]}`,
      "Content-Type": "application/json",
      // OpenRouter attributes traffic with these; they are not optional in
      // the sense that omitting them makes the request anonymous on the
      // dashboard, which makes a cost question unanswerable later.
      "HTTP-Referer": "https://cmsolutions.tech",
      // ASCII only. An em-dash here threw "Cannot convert argument to a
      // ByteString" before the request left the process — headers are
      // ByteStrings, and the house style uses em-dashes everywhere else.
      "X-Title": "CM Solutions website builder",
    },
    body: JSON.stringify({
      model: studio.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      /* Ask for the bill. Without this OpenRouter returns token counts but no
         cost, and per-model pricing changes underneath us — so "what did that
         build cost" becomes a trip to the dashboard instead of a number we
         were already handed. */
      usage: { include: true },
      ...(studio.reasoningEffort ? { reasoning: { effort: studio.reasoningEffort } } : {}),
      response_format: {
        type: "json_schema",
        json_schema: { name: schemaName, strict: true, schema },
      },
    }),
    signal: stop,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(`OpenRouter ${response.status}`);
    error.status = response.status;
    error.detail = detail.slice(0, 400);
    throw error;
  }

  const payload = await response.json();
  const choice = payload.choices?.[0];

  // Truncation here is the same silent failure the Anthropic path guards
  // against: a spec cut off mid-object can still parse if the model closed
  // its braces, and then chapters are simply missing with no error.
  if (choice?.finish_reason === "length") {
    const error = new Error("The studio ran out of room before it finished the design.");
    error.truncated = true;
    throw error;
  }

  const text = choice?.message?.content;
  if (!text) throw new Error("The studio returned nothing.");

  let parsed;
  try {
    parsed = JSON.parse(unwrapJson(text));
  } catch {
    // The first 200 characters are enough to tell prose from a fence from a
    // truncated object, and that is the difference between three fixes.
    const e = new Error("The studio returned something that was not valid JSON.");
    e.detail = `starts: ${String(text).slice(0, 200)}`;
    throw e;
  }

  return {
    parsed,
    usage: {
      input_tokens: payload.usage?.prompt_tokens ?? null,
      output_tokens: payload.usage?.completion_tokens ?? null,
      /* In dollars, as billed, including whatever the reasoning tokens cost.
         Null on the Anthropic path, which prices from a table rather than
         telling you — so callers must treat it as optional either way. */
      cost: typeof payload.usage?.cost === "number" ? payload.usage.cost : null,
    },
  };
}

async function viaAnthropic({ studio, system, user, zodSchema, schemaName, maxTokens, signal }) {
  const client = new Anthropic({ apiKey: process.env[studio.keyVar] });
  const response = await client.messages.parse({
    model: studio.model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    /* effort sits alongside format in the same object — it is the depth
       control, and on Fable 5 it is the only one. No `thinking` parameter:
       thinking is always on there and configuring it explicitly is a 400. */
    output_config: {
      format: zodOutputFormat(zodSchema, schemaName ?? "site_spec"),
      ...(studio.effort ? { effort: studio.effort } : {}),
    },
    signal,
  });

  if (response.stop_reason === "max_tokens") {
    const error = new Error("The studio ran out of room before it finished the design.");
    error.truncated = true;
    throw error;
  }

  return { parsed: response.parsed_output, usage: response.usage };
}

/**
 * Runs the design step and returns a validated spec.
 *
 * `zodSchema` is the source of truth for both paths — the Anthropic SDK
 * consumes it directly, and `jsonSchema` is the same shape rendered for
 * OpenRouter. Whichever path runs, the result is parsed through the zod
 * schema here, so a provider that honours the schema loosely is caught
 * before the spec reaches the renderer.
 */
export async function artDirect({
  system, user, zodSchema, jsonSchema, schemaName = "site_spec",
  maxTokens = 16000, signal, budgetMs, studio = chosenStudio(),
}) {
  if (!process.env[studio.keyVar]) {
    const error = new Error(`${studio.label} is not configured on this deployment.`);
    error.unconfigured = true;
    throw error;
  }

  const raw = studio.via === "openrouter"
    ? await viaOpenRouter({ studio, system, user, schema: jsonSchema, schemaName, maxTokens, signal, budgetMs })
    : await viaAnthropic({ studio, system, user, zodSchema, schemaName, maxTokens, signal });

  // The same gate for both, because "it validated on one provider" is not a
  // property of the spec, it is a property of that provider's strictness.
  const checked = zodSchema.safeParse(raw.parsed);
  if (!checked.success) {
    const error = new Error("The studio's design did not match the required shape.");
    error.issues = checked.error.issues.slice(0, 6).map((i) => `${i.path.join(".")}: ${i.message}`);
    throw error;
  }

  return { spec: checked.data, usage: raw.usage, studio };
}

export { z };
