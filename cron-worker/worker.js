// Cloudflare Worker that drives the ThreadAnalytics publish scheduler.
//
// Vercel's Hobby plan can't run cron more than once/day, so this Worker pings
// the publish endpoint every 5 minutes (see wrangler.toml `crons`). Cloudflare
// cron triggers are a core, reliable product — they fire on schedule, and every
// run is visible via `wrangler tail` / the Cloudflare dashboard.
//
// The CRON_SECRET is a Worker *secret* (set with `wrangler secret put`), so it
// never lives in this file or the repo.

const PUBLISH_URL = 'https://thread-analytics-lovat.vercel.app/api/cron/publish';

async function drain(env) {
  const res = await fetch(PUBLISH_URL, {
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  });
  const body = await res.text();
  console.log(`[publish-cron] ${res.status} ${body}`);
  return { status: res.status, body };
}

export default {
  // Cloudflare invokes this on the schedule in wrangler.toml.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(drain(env));
  },

  // Hitting the Worker's URL triggers the same drain — handy for a manual
  // "publish due now" and for verifying the wiring without waiting 5 minutes.
  async fetch(request, env, ctx) {
    const { status, body } = await drain(env);
    return new Response(body, {
      status,
      headers: { 'content-type': 'application/json' },
    });
  },
};
