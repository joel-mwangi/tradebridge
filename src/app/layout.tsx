import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TradeBridge — Trading workspace",
  description: "A trading workspace foundation connected to Deriv.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
