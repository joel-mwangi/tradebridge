import { notFound } from "next/navigation";

const SECTIONS = ["dashboard", "markets", "trade", "portfolio", "bots", "settings"] as const;

/**
 * The persistent parent layout renders the workspace. This page validates that
 * the requested single-segment URL is one of the supported workspace sections.
 */
export default async function WorkspaceSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!SECTIONS.includes(section as (typeof SECTIONS)[number])) notFound();
  return null;
}
