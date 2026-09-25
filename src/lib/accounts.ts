import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { accounts, type Account } from '@/db/schema';
import { encryptToken, decryptToken } from '@/lib/crypto';

/** Public shape safe to expose to the client — never includes the token. */
export interface PublicAccount {
  threadsUserId: string;
  username: string;
  displayName: string | null;
  tokenExpiresAt: string;
}

function toPublic(a: Account): PublicAccount {
  return {
    threadsUserId: a.threadsUserId,
    username: a.username,
    displayName: a.displayName,
    tokenExpiresAt: a.tokenExpiresAt.toISOString(),
  };
}

export async function listAccounts(): Promise<PublicAccount[]> {
  const rows = await getDb().select().from(accounts);
  return rows.map(toPublic);
}

/** Fetch a single account row (internal — includes encrypted token). */
export async function getAccountRow(threadsUserId: string): Promise<Account | null> {
  const rows = await getDb()
    .select()
    .from(accounts)
    .where(eq(accounts.threadsUserId, threadsUserId))
    .limit(1);
  return rows[0] ?? null;
}

/** Decrypt and return the stored long-lived token for an account. */
export async function getAccessToken(threadsUserId: string): Promise<string | null> {
  const row = await getAccountRow(threadsUserId);
  return row ? decryptToken(row.accessTokenEncrypted) : null;
}

export async function upsertAccount(params: {
  threadsUserId: string;
  username: string;
  displayName: string | null;
  accessToken: string;
  expiresInSeconds: number;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + params.expiresInSeconds * 1000);
  const encrypted = encryptToken(params.accessToken);
  await getDb()
    .insert(accounts)
    .values({
      threadsUserId: params.threadsUserId,
      username: params.username,
      displayName: params.displayName,
      accessTokenEncrypted: encrypted,
      tokenExpiresAt: expiresAt,
    })
    .onConflictDoUpdate({
      target: accounts.threadsUserId,
      set: {
        username: params.username,
        displayName: params.displayName,
        accessTokenEncrypted: encrypted,
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      },
    });
}

/** Update just the token + expiry (used by the refresh cron). */
export async function updateToken(params: {
  threadsUserId: string;
  accessToken: string;
  expiresInSeconds: number;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + params.expiresInSeconds * 1000);
  await getDb()
    .update(accounts)
    .set({
      accessTokenEncrypted: encryptToken(params.accessToken),
      tokenExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(accounts.threadsUserId, params.threadsUserId));
}
