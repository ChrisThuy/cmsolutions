/*
  Replaces the HTML behind an existing demo.

  The editor renders locally, so by the time this is called the visitor
  already has the page they want. This only makes the live link show it.

  ── the thing this endpoint must not become ──

  It takes a slug and a document and writes the document. Left open, that is
  a way to overwrite anybody's demo with anything, on our origin, under a URL
  they are currently sending to their own clients.

  Three things stop that:

    · the slug must exist and not have expired — this can only replace, never
      create, so it cannot be used to plant a page at a chosen address;
    · the same per-IP allowance as building, so it cannot be hammered;
    · the size cap the column already enforces, checked here too so an
      oversized body is refused before it crosses the network to the database.

  What it deliberately does not do is verify that the caller is the person
  who built the demo, because there are no accounts. A slug is unguessable —
  eight hex characters on top of a readable stem — and possession of it is
  the only claim anyone has. That is honest for a thirty-day sales artefact
  and would not be enough for anything that mattered more.
*/

import { rpc } from "../lib/audit/watch-store.mjs";

const MAX_HTML = 400_000;
const SAVES_PER_IP_HOUR = 40;

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress ?? null;
}

async function consumeAllowance(key) {
  const url = process.env.AUDIT_SUPABASE_URL;
  const anonKey = process.env.AUDIT_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[demo-update] rate limiting is not configured; refusing");
    return false;
  }
  try {
    const response = await fetch(`${url}/rest/v1/rpc/consume_rate_limit`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_bucket: "sitegen:demo-update:ip",
        p_key: key,
        p_max: SAVES_PER_IP_HOUR,
        p_window: "1 hour",
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row?.allowed === true;
  } catch {
    // Fail closed, same rule as everywhere else: a database blip must not
    // turn this into an unlimited write endpoint.
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "That request could not be read." });
  }

  const slug = String(body?.slug ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(slug)) {
    return res.status(400).json({ error: "That demo link is not valid." });
  }

  const html = String(body?.html ?? "");
  if (!html.startsWith("<!doctype html")) {
    return res.status(400).json({ error: "That does not look like a page." });
  }
  if (html.length > MAX_HTML) {
    return res.status(413).json({ error: "That page is larger than a demo can hold." });
  }

  const ip = clientIp(req);
  if (!ip) return res.status(400).json({ error: "We could not process that request." });
  if (!(await consumeAllowance(ip))) {
    return res.status(429).json({ error: "That is a lot of saves from one connection. Try again shortly." });
  }

  try {
    const updated = await rpc("update_site_demo", {
      p_slug: slug,
      p_html: html,
      p_concept: String(body?.concept ?? "").slice(0, 200) || null,
    }, { withSecret: false });

    if (updated !== true) {
      return res.status(404).json({ error: "That demo has expired or never existed." });
    }
  } catch (cause) {
    console.error("[demo-update] failed:", cause?.message);
    return res.status(502).json({ error: "That could not be saved. Try again." });
  }

  return res.status(200).json({ ok: true, slug });
}
