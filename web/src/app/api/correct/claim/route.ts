import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { emailMatchesSite, newToken } from "@/lib/correct";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    provider_id?: string;
    email?: string;
  } | null;
  const providerId = (body?.provider_id || "").trim();
  const email = (body?.email || "").trim().toLowerCase();
  if (!providerId || !email || !email.includes("@")) {
    return NextResponse.json({ error: "penyedia dan email wajib" }, { status: 400 });
  }
  const { rows } = await pool.query(
    `SELECT id, name, website FROM providers WHERE id=$1`,
    [providerId],
  );
  if (!rows[0]) return NextResponse.json({ error: "penyedia tidak ada" }, { status: 404 });
  if (!emailMatchesSite(email, rows[0].website)) {
    return NextResponse.json(
      { error: "email harus domain yang sama dengan situs resmi" },
      { status: 400 },
    );
  }
  const { rows: claimed } = await pool.query(
    `SELECT email FROM provider_claims WHERE provider_id=$1`,
    [providerId],
  );
  if (claimed[0]) {
    return NextResponse.json({ error: "penyedia ini sudah di-claim" }, { status: 409 });
  }
  const token = newToken();
  await pool.query(
    `INSERT INTO correction_requests (kind, provider_id, requester_email, token, status)
     VALUES ('claim', $1, $2, $3, 'pending')`,
    [providerId, email, token],
  );
  return NextResponse.json({ ok: true });
}
