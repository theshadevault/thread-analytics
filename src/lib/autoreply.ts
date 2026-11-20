import { and, eq, gt } from 'drizzle-orm';
import { getDb } from '@/db';
import { autoReplies } from '@/db/schema';
import { listAccounts, getAccessToken } from '@/lib/accounts';
import {
  listPosts,
  getConversation,
  createTextContainer,
  publishContainer,
  type ThreadMedia,
} from '@/lib/threads';

/**
 * Comment-to-get-the-link: when someone comments a product keyword under one of
 * our posts ("wardrobe", "War drobe!!", "WARDROBE 🙏"), reply to that comment
 * with the product link. Runs from the 5-minute publish cron.
 *
 * Accounts not listed here are never touched.
 */
interface Product {
  name: string;
  link: string;
  keywords: string[];
}

export const AUTO_REPLY: Record<string, Record<string, Product>> = {
  myrasharma808: {
    wardrobe: {
      name: 'Quiet Money Wardrobe',
      // Gumroad UTM short link → /l/wardrobe (clicks + sales show under Gumroad's UTM links).
      link: 'https://gum.co/u/fnf5bgsf',
      keywords: ['wardrobe'],
    },
    routine: {
      name: 'Quiet Glow Routine',
      // Gumroad UTM short link → /l/routine.
      link: 'https://gum.co/u/ev0vnvw4',
      keywords: ['glow', 'routine'],
    },
  },
};

/** Posts older than this are no longer scanned for comments. */
const LOOKBACK_DAYS = 3;
/** Spam guards: Threads flags accounts that fire off identical link replies. */
const MAX_PER_RUN = 10;
const MAX_PER_HOUR = 30;

/** Rotated per comment so the account never posts the same reply over and over. */
const TEMPLATES = [
  'Here you go 🤍 {link}',
  "Here's the {name}: {link}",
  'Sent! {link}',
  'Here it is 🤍 {link}',
  "Of course, here's the link: {link}",
  'Enjoy! The {name} is here: {link}',
];

// ---------------------------------------------------------------------------
// Keyword matching
// ---------------------------------------------------------------------------

/** Lowercase, strip accents, split on anything that isn't a letter. */
function words(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Loose, case-insensitive keyword match. For "wardrobe" all of these match:
 * "wardrobe", "Wardrobe", "WARDROBE!!", "war drobe", "War-drobe", "w a r d r o b e",
 * "wardrobes please", and typos like "wardrob" / "wadrobe" / "wardorbe".
 *
 * Typos are allowed in proportion to the keyword's length (2 for 7+ letters, 1
 * for 5-6, none for shorter ones), and are only checked against whole words or
 * 2-3 adjacent words joined, never against arbitrary slices of a sentence, so
 * "looking forward to being…" does not match "wardrobe". Short keywords like
 * "glow" must appear as a whole word, so "big low" doesn't count.
 */
export function matchesKeyword(text: string, keyword: string): boolean {
  const k = words(keyword).join('');
  const w = words(text);
  if (!k || !w.length) return false;
  const maxEdits = k.length >= 7 ? 2 : k.length >= 5 ? 1 : 0;

  for (const word of w) {
    if (k.length >= 6 ? word.includes(k) : word === k || word === `${k}s`) return true;
  }
  for (let span = 1; span <= 3; span++) {
    for (let i = 0; i + span <= w.length; i++) {
      const joined = w.slice(i, i + span).join('');
      if (joined === k || (maxEdits && editDistance(joined, k) <= maxEdits)) return true;
    }
  }
  // A spelled-out keyword ("w a r d r o b e", "g.l.o.w") in a short comment.
  const all = w.join('');
  if (all.length <= k.length + 3 && (all.includes(k) || (maxEdits && editDistance(all, k) <= maxEdits))) {
    return true;
  }
  return false;
}

/** The product a comment asks for, or null. */
export function productFor(text: string, products: Record<string, Product>): string | null {
  for (const [key, p] of Object.entries(products)) {
    if (p.keywords.some((kw) => matchesKeyword(text, kw))) return key;
  }
  return null;
}

function replyText(commentId: string, p: Product): string {
  let h = 0;
  for (const c of commentId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TEMPLATES[h % TEMPLATES.length].replace('{name}', p.name).replace('{link}', p.link);
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface AutoReplyResult {
  account: string;
  commentId: string;
  commenter: string;
  comment: string;
  product: string;
  reply: string;
  status: 'replied' | 'failed' | 'would_reply';
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Scan recent posts of every configured account and answer new keyword comments.
 * `dryRun` lists what would be answered without posting or recording anything.
 * No new reply is started once `budgetMs` has passed, so the caller's function
 * timeout never cuts one off halfway.
 */
export async function runAutoReplies(opts: { dryRun?: boolean; budgetMs?: number } = {}): Promise<{
  scannedPosts: number;
  results: AutoReplyResult[];
  skipped?: string;
}> {
  if (process.env.AUTOREPLY_DISABLED === '1') {
    return { scannedPosts: 0, results: [], skipped: 'AUTOREPLY_DISABLED=1' };
  }
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);
  const outOfTime = () => Date.now() > deadline;
  const db = getDb();
  const results: AutoReplyResult[] = [];
  let scannedPosts = 0;

  for (const account of await listAccounts()) {
    const products = AUTO_REPLY[account.username];
    if (!products) continue;
    const token = await getAccessToken(account.threadsUserId);
    if (!token) continue;

    // Everything we've already handled for this account inside the window, for
    // the "once per person per post" rule and the hourly cap.
    const since = new Date(Date.now() - (LOOKBACK_DAYS + 1) * 86_400_000);
    const done = await db
      .select({ commentId: autoReplies.commentId, postId: autoReplies.postId, commenter: autoReplies.commenter, createdAt: autoReplies.createdAt })
      .from(autoReplies)
      .where(and(eq(autoReplies.threadsUserId, account.threadsUserId), gt(autoReplies.createdAt, since)));
    const seenComment = new Set(done.map((r) => r.commentId));
    const seenPerson = new Set(done.map((r) => `${r.postId}|${r.commenter.toLowerCase()}`));
    const hourAgo = Date.now() - 3_600_000;
    let budget = Math.min(MAX_PER_RUN, MAX_PER_HOUR - done.filter((r) => r.createdAt.getTime() > hourAgo).length);

    const posts = await listPosts({
      threadsUserId: account.threadsUserId,
      accessToken: token,
      since: Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 86_400,
      maxPosts: 60,
    });

    for (const post of posts) {
      if (budget <= 0 || outOfTime()) break;
      if (post.media_type === 'REPOST_FACADE') continue;
      scannedPosts++;
      let convo: ThreadMedia[];
      try {
        convo = await getConversation(post.id, 'id,text,username,timestamp,replied_to', token);
      } catch {
        continue; // one unreadable post shouldn't stop the run
      }
      const me = account.username.toLowerCase();
      // Comments we already answered by hand count as handled.
      const answeredByMe = new Set(
        convo.filter((m) => m.username?.toLowerCase() === me && m.replied_to?.id).map((m) => m.replied_to!.id),
      );

      for (const c of convo) {
        if (budget <= 0 || outOfTime()) break;
        const who = c.username?.toLowerCase();
        if (!who || who === me || !c.text) continue;
        if (seenComment.has(c.id) || answeredByMe.has(c.id)) continue;
        if (seenPerson.has(`${post.id}|${who}`)) continue;
        const key = productFor(c.text, products);
        if (!key) continue;

        const reply = replyText(c.id, products[key]);
        const base = { account: account.username, commentId: c.id, commenter: c.username!, comment: c.text, product: key, reply };
        seenComment.add(c.id);
        seenPerson.add(`${post.id}|${who}`);
        budget--;

        if (opts.dryRun) {
          results.push({ ...base, status: 'would_reply' });
          continue;
        }

        // Claim the comment first: if another run already did, the insert is a no-op.
        const claimed = await db
          .insert(autoReplies)
          .values({
            commentId: c.id,
            threadsUserId: account.threadsUserId,
            postId: post.id,
            commenter: c.username!,
            commentText: c.text,
            product: key,
            replyText: reply,
            commentedAt: c.timestamp ? new Date(c.timestamp) : null,
          })
          .onConflictDoNothing()
          .returning({ id: autoReplies.commentId });
        if (!claimed.length) continue;

        try {
          const creationId = await createTextContainer({
            threadsUserId: account.threadsUserId,
            accessToken: token,
            text: reply,
            replyToId: c.id,
          });
          await sleep(2000); // text containers need a moment before publishing
          const replyId = await publishContainer({ threadsUserId: account.threadsUserId, accessToken: token, creationId });
          await db
            .update(autoReplies)
            .set({ status: 'replied', replyId, repliedAt: new Date() })
            .where(eq(autoReplies.commentId, c.id));
          results.push({ ...base, status: 'replied' });
        } catch (err) {
          const error = err instanceof Error ? err.message : 'reply failed';
          await db.update(autoReplies).set({ status: 'failed', error }).where(eq(autoReplies.commentId, c.id));
          results.push({ ...base, status: 'failed', error });
        }
        // Space replies out a little so they don't land as a burst.
        await sleep(1500 + Math.floor(Math.random() * 2500));
      }
    }
  }
  return { scannedPosts, results };
}
