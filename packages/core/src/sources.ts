import { parseEcbXml } from "./parsers/ecb.js";
import { parseFrankfurter } from "./parsers/frankfurter.js";
import { parseHsbcCbpr } from "./parsers/hsbc-cbpr.js";
import type { ParseResult } from "./types.js";

/** When a source is collected. Maps to cron triggers in the Worker. */
export type Schedule = "daily-morning" | "daily-ecb";

export interface SourceDefinition {
  id: string;
  label: string;
  url: string;
  schedule: Schedule;
  /** Alert if no successful snapshot within this many hours. */
  maxAgeHours: number;
  /** Status of the parser against the live page. */
  verified: "live" | "fixture-only";
  parse: (body: string) => ParseResult;
  notes?: string;
}

/**
 * Every source the collectors know about. Adding a source = add an entry here,
 * a parser with a fixture test, and nothing else.
 */
export const SOURCES: readonly SourceDefinition[] = [
  {
    id: "ecb-daily",
    label: "ECB euro reference rates (daily XML)",
    url: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
    schedule: "daily-ecb",
    maxAgeHours: 80, // no publication at weekends or TARGET holidays
    verified: "live",
    parse: (body) => parseEcbXml(body, "ecb-daily"),
    notes: "Published around 16:00 CET on TARGET working days, for information purposes only.",
  },
  {
    id: "frankfurter",
    label: "Frankfurter blended mid-market rates",
    url: "https://api.frankfurter.dev/v2/rates?base=EUR",
    schedule: "daily-ecb",
    maxAgeHours: 80,
    verified: "live",
    parse: (body) => parseFrankfurter(body, "frankfurter"),
    notes: "v2 returns row arrays with per-currency dates and also blends crypto tokens (skipped). Verified live 2026-11-23.",
  },
  {
    id: "issuer-hsbc-uk",
    label: "HSBC UK card markups over ECB (CBPR disclosure)",
    url: "https://www.hsbc.co.uk/cbpr/",
    schedule: "daily-morning",
    maxAgeHours: 30,
    verified: "live",
    parse: (body) => parseHsbcCbpr(body, "HSBC UK"),
  },
];

export const sourcesFor = (schedule: Schedule): SourceDefinition[] => SOURCES.filter((s) => s.schedule === schedule);
export const sourceById = (id: string): SourceDefinition | undefined => SOURCES.find((s) => s.id === id);
