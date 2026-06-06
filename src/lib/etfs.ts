// Curated ETF universe organized by category.
// Used by the "ETFs" universe selector and the "Sectors only" preset.

import type { TickerInfo } from "./universe";

export interface EtfInfo extends TickerInfo {
  category: "broad" | "sector" | "thematic" | "commodity_bond" | "volatility";
}

export const ETFS: EtfInfo[] = [
  // Broad market
  { symbol: "SPY", name: "SPDR S&P 500 ETF", category: "broad" },
  { symbol: "QQQ", name: "Invesco Nasdaq 100", category: "broad" },
  { symbol: "IWM", name: "iShares Russell 2000", category: "broad" },
  { symbol: "DIA", name: "SPDR Dow Jones Industrial", category: "broad" },
  { symbol: "VTI", name: "Vanguard Total Stock Market", category: "broad" },
  // Sectors (Select Sector SPDR)
  { symbol: "XLE", name: "Energy Select Sector", category: "sector" },
  { symbol: "XLF", name: "Financial Select Sector", category: "sector" },
  { symbol: "XLK", name: "Technology Select Sector", category: "sector" },
  { symbol: "XLU", name: "Utilities Select Sector", category: "sector" },
  { symbol: "XLV", name: "Health Care Select Sector", category: "sector" },
  { symbol: "XLY", name: "Consumer Discretionary", category: "sector" },
  { symbol: "XLP", name: "Consumer Staples", category: "sector" },
  { symbol: "XLI", name: "Industrials Select Sector", category: "sector" },
  { symbol: "XLB", name: "Materials Select Sector", category: "sector" },
  { symbol: "XLRE", name: "Real Estate Select Sector", category: "sector" },
  { symbol: "XLC", name: "Communication Services", category: "sector" },
  // Thematic
  { symbol: "ARKK", name: "ARK Innovation ETF", category: "thematic" },
  { symbol: "SOXX", name: "iShares Semiconductor", category: "thematic" },
  { symbol: "SMH", name: "VanEck Semiconductor", category: "thematic" },
  { symbol: "KWEB", name: "KraneShares CSI China Internet", category: "thematic" },
  { symbol: "IBIT", name: "iShares Bitcoin Trust", category: "thematic" },
  // Commodities & bonds
  { symbol: "GLD", name: "SPDR Gold Shares", category: "commodity_bond" },
  { symbol: "SLV", name: "iShares Silver Trust", category: "commodity_bond" },
  { symbol: "USO", name: "United States Oil Fund", category: "commodity_bond" },
  { symbol: "TLT", name: "iShares 20+ Yr Treasury", category: "commodity_bond" },
  { symbol: "HYG", name: "iShares High Yield Corp Bond", category: "commodity_bond" },
  { symbol: "UUP", name: "Invesco DB US Dollar Bullish", category: "commodity_bond" },
  // Volatility
  { symbol: "VXX", name: "iPath VIX Short-Term Futures", category: "volatility" },
];

export const SECTOR_ETFS: EtfInfo[] = ETFS.filter((e) => e.category === "sector");
