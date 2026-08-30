import crypto from "crypto";
import { pool } from "./db";

export type ProviderChoice = { id: string; name: string; website: string | null };

export async function listProviderChoices(): Promise<ProviderChoice[]> {
  const { rows } = await pool.query<ProviderChoice>(
    `SELECT id, name, website FROM providers ORDER BY name`,
  );
  return rows;
}

export function newToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function siteHost(website: string | null): string {
  if (!website) return "";
  try {
    const h = new URL(website).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return "";
  }
}

export function emailMatchesSite(email: string, website: string | null): boolean {
  const at = email.toLowerCase().trim().split("@");
  if (at.length !== 2) return false;
  const ed = at[1];
  const host = siteHost(website);
  if (!ed || !host) return false;
  return ed === host || host.endsWith("." + ed);
}

export async function recentRescan(providerId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM correction_requests
     WHERE kind='rescan' AND provider_id=$1 AND created_at > now() - interval '1 day'
     LIMIT 1`,
    [providerId],
  );
  return rows.length > 0;
}
