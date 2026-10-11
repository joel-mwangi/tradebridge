import { notFound } from "next/navigation";
import TradingWorkspace from "../../components/trading/TradingWorkspace";

const SECTIONS = ["dashboard", "trade", "portfolio", "bots", "settings"] as const;
export type WorkspacePage = (typeof SECTIONS)[number];

export default async function WorkspaceSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!SECTIONS.includes(section as WorkspacePage)) notFound();
  return <TradingWorkspace page={section as WorkspacePage} />;
}
