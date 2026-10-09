import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  response.cookies.delete("tradebridge_deriv_access_token");
  response.cookies.delete("tradebridge_oauth_state");
  response.cookies.delete("tradebridge_pkce_verifier");
  return response;
}
