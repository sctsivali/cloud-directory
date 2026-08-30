import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!token) return new NextResponse("token hilang", { status: 400 });
  const { rows } = await pool.query(
    `SELECT r.id, r.status, r.provider_id, p.name, p.website, p.hq_country
     FROM correction_requests r
     JOIN providers p ON p.id = r.provider_id
     WHERE r.token=$1 AND r.kind='rescan'`,
    [token],
  );
  const row = rows[0];
  if (!row) return new NextResponse("tautan tidak sah", { status: 404 });
  if (row.status === "approved") {
    return new NextResponse("Sudah diantrikan sebelumnya.", { status: 200 });
  }
  if (row.status !== "pending" && row.status !== "notified") {
    return new NextResponse("tautan kedaluwarsa", { status: 410 });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE correction_requests SET status='approved', used_at=now()
       WHERE id=$1 AND status IN ('pending','notified')`,
      [row.id],
    );
    const up = await client.query(
      `UPDATE provider_pipeline
          SET status='queued', reason='rescan approved via /correct', updated_at=now()
        WHERE website IS NOT NULL AND lower(website)=lower($1)
        RETURNING id`,
      [row.website],
    );
    if (!up.rowCount) {
      await client.query(
        `INSERT INTO provider_pipeline (name, website, country, status, reason)
         VALUES ($1,$2,$3,'queued','rescan approved via /correct')`,
        [row.name, row.website, row.hq_country],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    return new NextResponse("gagal antri rescan", { status: 500 });
  } finally {
    client.release();
  }
  return new NextResponse(
    `Rescan diantrikan untuk ${row.name}. Deep Intelligence Check jalan pada tick berikutnya.`,
    { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
