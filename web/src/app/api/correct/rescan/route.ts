import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { listProviderChoices, newToken, recentRescan } from "@/lib/correct";

export async function GET() {
  const providers = await listProviderChoices();
  return NextResponse.json({
    providers: providers.map((p) => ({ id: p.id, name: p.name })),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    provider_id?: string;
    email?: string;
  } | null;
  const providerId = (body?.provider_id || "").trim();
  const email = (body?.email || "").trim() || null;
  if (!providerId) {
    return NextResponse.json({ error: "pilih penyedia" }, { status: 400 });
  }
  const { rows: p } = await pool.query(
    `SELECT id, name, website FROM providers WHERE id=$1`,
    [providerId],
  );
  if (!p[0]) return NextResponse.json({ error: "penyedia tidak ada" }, { status: 404 });
  if (await recentRescan(providerId)) {
    return NextResponse.json(
      { error: "rescan untuk penyedia ini sudah diminta dalam 24 jam" },
      { status: 429 },
    );
  }
  const token = newToken();
  await pool.query(
    `INSERT INTO correction_requests (kind, provider_id, requester_email, token, status)
     VALUES ('rescan', $1, $2, $3, 'pending')`,
    [providerId, email, token],
  );
  return NextResponse.json({ ok: true });
}
