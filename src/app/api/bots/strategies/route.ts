import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };
const MAX_SOURCE_BYTES = 1_000_000;

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers });
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { supabase: null, user: null };
  return { supabase, user };
}

export async function GET() {
  try {
    const { supabase, user } = await authenticatedClient();
    if (!supabase || !user) return jsonError("unauthorized", 401);
    const { data, error } = await supabase
      .from("bot_strategy_definitions")
      .select("id,name,source_format,source_file_name,strategy_definition,status,created_at,updated_at")
      .eq("user_id", user.id)
      .eq("status", "draft")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) return jsonError("strategy_drafts_unavailable", 503);
    return NextResponse.json({ drafts: data ?? [] }, { headers });
  } catch {
    return jsonError("strategy_drafts_unavailable", 503);
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) {
    return jsonError("origin_not_allowed", 403);
  }
  let body: Record<string, unknown>;
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return jsonError("invalid_request", 400);
    body = value as Record<string, unknown>;
  } catch {
    return jsonError("invalid_request", 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const definition = body.strategy_definition;
  const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  const sourceContent = typeof body.source_content === "string" ? body.source_content : null;
  const sourceFileName = typeof body.source_file_name === "string" ? body.source_file_name.slice(0, 255) : null;
  if (!name || name.length > 80 || !definition || typeof definition !== "object" || Array.isArray(definition)) {
    return jsonError("invalid_strategy_definition", 400);
  }
  if (sourceContent && new TextEncoder().encode(sourceContent).byteLength > MAX_SOURCE_BYTES) {
    return jsonError("source_too_large", 413);
  }

  try {
    const { supabase, user } = await authenticatedClient();
    if (!supabase || !user) return jsonError("unauthorized", 401);
    const record = {
      user_id: user.id,
      name,
      source_format: body.source_format === "json" ? "json" : "native",
      source_file_name: sourceFileName,
      source_content: sourceContent,
      strategy_definition: definition,
      status: "draft",
    };
    const query = id
      ? supabase.from("bot_strategy_definitions").update({
          name: record.name,
          source_format: record.source_format,
          source_file_name: record.source_file_name,
          source_content: record.source_content,
          strategy_definition: record.strategy_definition,
          status: "draft",
        }).eq("id", id).eq("user_id", user.id).eq("status", "draft")
      : supabase.from("bot_strategy_definitions").insert(record);
    const { data, error } = await query.select("id,name,source_format,source_file_name,strategy_definition,status,created_at,updated_at").single();
    if (error || !data) return jsonError("strategy_draft_save_failed", 503);
    return NextResponse.json({ draft: data }, { status: id ? 200 : 201, headers });
  } catch {
    return jsonError("strategy_draft_save_failed", 503);
  }
}

export async function DELETE(request: NextRequest) {
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) {
    return jsonError("origin_not_allowed", 403);
  }
  const id = request.nextUrl.searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return jsonError("invalid_id", 400);
  try {
    const { supabase, user } = await authenticatedClient();
    if (!supabase || !user) return jsonError("unauthorized", 401);
    const { error } = await supabase.from("bot_strategy_definitions").delete()
      .eq("id", id).eq("user_id", user.id).eq("status", "draft");
    if (error) return jsonError("strategy_draft_delete_failed", 503);
    return NextResponse.json({ deleted: true }, { headers });
  } catch {
    return jsonError("strategy_draft_delete_failed", 503);
  }
}
