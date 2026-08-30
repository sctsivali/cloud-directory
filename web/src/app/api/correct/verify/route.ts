import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!token) return new NextResponse("token hilang", { status: 400 });
  const { rows } = await pool.query(
    `SELECT r.id, r.status, r.provider_id, r.requester_email, p.name
     FROM correction_requests r
     JOIN providers p ON p.id = r.provider_id
     WHERE r.token=$1 AND r.kind='claim'`,
    [token],
  );
  const row = rows[0];
  if (!row) return new NextResponse("tautan tidak sah", { status: 404 });
  if (row.status === "verified") {
    return new NextResponse("Claim sudah terverifikasi.", { status: 200 });
  }
  if (row.status !== "pending" && row.status !== "notified") {
    return new NextResponse("tautan kedaluwarsa", { status: 410 });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE correction_requests SET status='verified', used_at=now()
       WHERE id=$1 AND status IN ('pending','notified')`,
      [row.id],
    );
    await client.query(
      `INSERT INTO provider_claims (provider_id, email)
       VALUES ($1,$2)
       ON CONFLICT (provider_id) DO UPDATE SET email=EXCLUDED.email, verified_at=now()`,
      [row.provider_id, row.requester_email],
    );
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
    return new NextResponse("gagal verifikasi claim", { status: 500 });
  } finally {
    client.release();
  }
  return new NextResponse(
    `Claim ${row.name} terverifikasi untuk ${row.requester_email}.`,
    { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
