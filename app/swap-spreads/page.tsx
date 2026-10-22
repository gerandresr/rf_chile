import { SwapSpreadsDashboard } from "@/components/SwapSpreadsDashboard";
import { swapSpreadData } from "@/lib/swap-spreads.server";
import "./swap-spreads.css";

export const metadata = { title: "Swap Spreads · RF Chilena" };

export default function Page() {
  return <SwapSpreadsDashboard data={swapSpreadData()} />;
}
