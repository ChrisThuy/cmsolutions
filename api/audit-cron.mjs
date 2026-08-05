import { crawlSite } from "../lib/audit/crawl.mjs";
import {
  diffIssues,
  fingerprint,
  rpc,
  sendEmail,
  siteOrigin,
} from "../lib/audit/watch-store.mjs";

/*
  The weekly run. Scheduled by vercel.json, not reachable by a visitor.

  ── the rule that makes this worth subscribing to ──────────────────────────

  Silence unless something changed.

  A weekly email saying "still fine" is how a monitoring service teaches people
  to ignore it, and the one week it matters the message looks like all the
  others. So a run that finds the same problems as last week sends nothing at
  all. Mail goes out when a problem appears, or when one is fixed — and the
  first run is a special case, because there is nothing to compare against yet.
*/

/** Watches handled per invocation. Bounded so one run cannot become unbounded work. */
const BATCH = 15;

export default async function handler(req, res) {
  /*
    Vercel signs scheduled invocations with CRON_SECRET. Without this check the
    endpoint is a button any visitor can press to make us crawl every watched
    site and send email — which is both an amplifier and a way to burn a
    subscriber's goodwill.
  */
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron] CRON_SECRET is not set; refusing to run");
    return res.status(503).json({ error: "Not configured." });
  }
  if (req.headers.authorization !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Not authorised." });
  }

  let due;
  try {
    const rows = await rpc("due_audit_watches", { p_interval: "7 days", p_limit: BATCH });
    due = Array.isArray(rows) ? rows : rows ? [rows] : [];
  } catch (cause) {
    console.error("[cron] could not read due watches:", cause?.message);
    return res.status(503).json({ error: "Could not read the queue." });
  }

  const outcome = { checked: 0, notified: 0, unchanged: 0, failed: 0 };

  for (const watch of due) {
    try {
      const report = await crawlSite(watch.url);
      const print = fingerprint(report.issues);

      const recorded = await rpc("record_audit_snapshot", {
        p_watch_id: watch.id,
        p_pages: report.counts.pages,
        p_fingerprint: print,
        p_summary: report,
      });
      outcome.checked++;

      // Nothing to say. This is the common case and it is the point.
      if (!recorded?.changed) {
        outcome.unchanged++;
        continue;
      }

      const { appeared, resolvedCount } = diffIssues(recorded.previous_fingerprint, report.issues);
      const unsubscribeUrl = `${siteOrigin()}/api/watch-confirm?u=${encodeURIComponent(watch.unsubscribe_token)}`;
      const host = new URL(report.site).hostname;

      const lines = [
        `Something changed on ${host} since we last looked.`,
        "",
      ];

      if (appeared.length) {
        lines.push(appeared.length === 1 ? "NEW PROBLEM" : `NEW PROBLEMS (${appeared.length})`, "");
        for (const issue of appeared) {
          lines.push(`• ${issue.label} — ${issue.status.toUpperCase()}`);
          lines.push(`  On ${issue.pages.length} of ${report.counts.pages} page(s) checked.`);
          if (issue.fix) lines.push(`  Fix: ${issue.fix}`);
          lines.push("");
        }
      }

      if (resolvedCount > 0) {
        lines.push(
          resolvedCount === 1
            ? "One problem we flagged before is now fixed."
            : `${resolvedCount} problems we flagged before are now fixed.`,
          "",
        );
      }

      lines.push(
        `Full report: ${siteOrigin()}/free-website-audit-tool`,
        "",
        "You are getting this because you asked us to watch this site.",
        `Stop at any time: ${unsubscribeUrl}`,
        "",
        "— CM Solutions",
      );

      const sent = await sendEmail({
        to: watch.email,
        subject: appeared.length
          ? `${host}: ${appeared.length} new issue${appeared.length === 1 ? "" : "s"}`
          : `${host}: fixed`,
        text: lines.join("\n"),
        unsubscribeUrl,
      });

      if (sent.ok) {
        await rpc("mark_audit_notified", { p_watch_id: watch.id });
        outcome.notified++;
      } else {
        // Recorded as a failure rather than counted as delivered: a run that
        // silently could not tell anyone is the failure mode this whole
        // feature exists to avoid.
        outcome.failed++;
        console.error(`[cron] ${host} changed but the email failed: ${sent.message ?? sent.reason}`);
      }
    } catch (cause) {
      outcome.failed++;
      // One unreachable site must not stop the rest of the batch.
      console.error(`[cron] ${watch.url} failed:`, cause?.message);
    }
  }

  console.info(
    `[cron] checked ${outcome.checked}, notified ${outcome.notified}, ` +
      `unchanged ${outcome.unchanged}, failed ${outcome.failed}`,
  );

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(outcome);
}
