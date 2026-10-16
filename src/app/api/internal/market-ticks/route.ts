import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingTick = {
  symbol: string;
  quote: number;
  epoch: number;
  pip_size: number;
};

const MAX_TICKS_PER_REQUEST = 500;
const MAX_BODY_BYTES = 1_000_000;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function constantTimeTokenMatch(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes);
}

function parseTick(value: unknown): (IncomingTick & { last_digit: number }) | null {
  if (!value || typeof value !== "object") return null;
  const tick = value as Record<string, unknown>;
  if (typeof tick.symbol !== "string" || !/^[A-Za-z0-9_]{2,32}$/.test(tick.symbol)) return null;
  if (typeof tick.quote !== "number" || !Number.isFinite(tick.quote) || tick.quote <= 0) return null;
  if (typeof tick.epoch !== "number" || !Number.isSafeInteger(tick.epoch) || tick.epoch <= 0) return null;
  if (typeof tick.pip_size !== "number" || !Number.isInteger(tick.pip_size) || tick.pip_size < 0 || tick.pip_size > 10) return null;

  // Derive the final digit on the server rather than trusting a client-supplied value.
  const formattedQuote = tick.quote.toFixed(tick.pip_size);
  const digits = formattedQuote.replace(/\D/g, "");
  const lastDigit = Number(digits.at(-1));
  if (!Number.isInteger(lastDigit) || lastDigit < 0 || lastDigit > 9) return null;

  return {
    symbol: tick.symbol,
    quote: tick.quote,
    epoch: tick.epoch,
    pip_size: tick.pip_size,
    last_digit: lastDigit,
  };
}

export async function POST(request: Request) {
  const expectedToken = process.env.DERIV_TICK_INGEST_TOKEN;
  const authorization = request.headers.get("authorization") ?? "";
  const providedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

  if (!expectedToken || !providedToken || !constantTimeTokenMatch(providedToken, expectedToken)) {
    return jsonError("Unauthorized", 401);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonError("Request body too large", 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Expected a valid JSON body", 400);
  }

  const ticks = (body as { ticks?: unknown } | null)?.ticks;
  if (!Array.isArray(ticks) || ticks.length < 1 || ticks.length > MAX_TICKS_PER_REQUEST) {
    return jsonError(`ticks must be an array containing 1 to ${MAX_TICKS_PER_REQUEST} items`, 400);
  }

  const parsedTicks = ticks.map(parseTick);
  if (parsedTicks.some((tick) => tick === null)) {
    return jsonError("One or more ticks have invalid fields", 400);
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("market_ticks")
      .upsert(parsedTicks, {
        onConflict: "symbol,epoch,quote",
        ignoreDuplicates: true,
      })
      .select("id");

    if (error) {
      console.error("Deriv tick ingestion database error:", error.message);
      return jsonError("Could not persist market ticks", 500);
    }

    return NextResponse.json({
      ok: true,
      received: parsedTicks.length,
      inserted: data?.length ?? 0,
      duplicatesIgnored: parsedTicks.length - (data?.length ?? 0),
    }, { status: 202 });
  } catch (error) {
    console.error("Deriv tick ingestion failed:", error instanceof Error ? error.message : "unknown error");
    return jsonError("Tick ingestion is not configured", 500);
  }
}
