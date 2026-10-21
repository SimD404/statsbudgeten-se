/**
 * MCP server exposing the Swedish state budget data.
 *
 * Run:  bun src/mcp.ts
 * Speaks MCP over stdio. Data is read from data/<year>.json.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { BudgetJsonSchema } from "../types/BudgetJsonSchema";
import { buildIndex, search } from "./search";
import { inflationFactor, chooseBaseYear, type InflationRates } from "./inflation";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");

/** All available budget years, ascending. */
function listYears(): number[] {
  return readdirSync(dataDir)
    .filter((f) => /^\d{4}\.json$/.test(f))
    .map((f) => parseInt(f, 10))
    .sort((a, b) => a - b);
}

/** Load and validate one budget year. */
function loadYear(year: number) {
  const path = join(dataDir, `${year}.json`);
  const raw = readFileSync(path, "utf8");
  return BudgetJsonSchema.parse(JSON.parse(raw));
}

/** Load inflation rates (the `rates` field of data/inflation.json). */
let _inflationRates: InflationRates | null = null;
function loadInflationRates(): InflationRates {
  if (_inflationRates) return _inflationRates;
  const raw = readFileSync(join(dataDir, "inflation.json"), "utf8");
  const parsed = JSON.parse(raw);
  _inflationRates = parsed.rates as InflationRates;
  return _inflationRates;
}

const server = new McpServer({ name: "statsbudgeten", version: "0.1.0" });

server.registerTool(
  "list_years",
  {
    title: "List budget years",
    description: "Return the available budget years.",
    inputSchema: {},
  },
  async () => ({ content: [{ type: "text", text: JSON.stringify(listYears()) }] }),
);

server.registerTool(
  "get_overview",
  {
    title: "Budget overview",
    description:
      "Total expenses and revenues for a budget year, plus the list of expense areas (utgiftsområden) with their totals.",
    inputSchema: { year: z.number().int().describe("Budget year, e.g. 2024") },
  },
  async ({ year }) => {
    const b = loadYear(year);
    const areas = b.expenses.map((g) => ({ uo: g.uo, title: g.title, total: g.total }));
    const out = {
      year,
      expensesTotal: b.expensesTotal,
      revenuesTotal: b.revenuesTotal,
      areas,
    };
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  },
);

/** Return the top-N rows of an expense area by amount, plus a tail summary. */
function topRows(rows: { id: number; title: string; expense: number }[], n: number) {
  const sorted = [...rows].sort((a, b) => b.expense - a.expense);
  const top = sorted.slice(0, n).map((r) => ({ id: r.id, title: r.title, expense: r.expense }));
  const rest = sorted.slice(n);
  return { top, restCount: rest.length, restTotal: rest.reduce((s, r) => s + r.expense, 0) };
}

server.registerTool(
  "get_area",
  {
    title: "Expense area detail",
    description:
      "One utgiftsområde (expense area) with its line items (anslag). Returns the largest items plus a summary of the smaller ones.",
    inputSchema: {
      year: z.number().int().describe("Budget year, e.g. 2024"),
      uo: z.number().int().describe("Utgiftsområde number, 1-27"),
      top: z.number().int().min(1).max(50).optional().describe("How many largest items to return (default 15)"),
    },
  },
  async ({ year, uo, top = 15 }) => {
    const b = loadYear(year);
    const g = b.expenses.find((e) => e.uo === uo);
    if (!g) return { content: [{ type: "text", text: `No utgiftsområde ${uo} in ${year}` }], isError: true };
    const { top: topItems, restCount, restTotal } = topRows(g.rows, top);
    const out = { year, uo, title: g.title, total: g.total, items: topItems, restCount, restTotal };
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  },
);

server.registerTool(
  "get_posting",
  {
    title: "Single line item",
    description: "One anslag (expense line item) within a utgiftsområde.",
    inputSchema: {
      year: z.number().int().describe("Budget year, e.g. 2024"),
      uo: z.number().int().describe("Utgiftsområde number, 1-27"),
      id: z.number().int().describe("Anslag id within the area"),
    },
  },
  async ({ year, uo, id }) => {
    const b = loadYear(year);
    const g = b.expenses.find((e) => e.uo === uo);
    if (!g) return { content: [{ type: "text", text: `No utgiftsområde ${uo} in ${year}` }], isError: true };
    const row = g.rows.find((r) => r.id === id);
    if (!row) return { content: [{ type: "text", text: `No anslag ${id} in UO ${uo} ${year}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify({ year, uo, area: g.title, ...row }, null, 2) }] };
  },
);

server.registerTool(
  "get_revenue_area",
  {
    title: "Revenue area detail",
    description:
      "One inkomsttyp (revenue type) with its inkomsttitlar. Returns the largest items plus a summary of the smaller ones.",
    inputSchema: {
      year: z.number().int().describe("Budget year, e.g. 2024"),
      id_start: z.number().int().describe("Inkomsttyp id (e.g. 1000)"),
      top: z.number().int().min(1).max(50).optional().describe("How many largest items to return (default 15)"),
    },
  },
  async ({ year, id_start, top = 15 }) => {
    const b = loadYear(year);
    const g = b.revenues.find((r) => r.id_start === id_start);
    if (!g) return { content: [{ type: "text", text: `No inkomsttyp ${id_start} in ${year}` }], isError: true };
    const { top: topItems, restCount, restTotal } = topRows(
      g.rows.map((r) => ({ id: r.id, title: r.title, expense: r.revenue })),
      top,
    );
    const out = { year, id_start, title: g.title, total: g.total, items: topItems, restCount, restTotal };
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  },
);

server.registerTool(
  "search",
  {
    title: "Search budget",
    description:
      "Search across all utgiftsområden, inkomsttyper and their postings for a given year. Case- and diacritic-insensitive (e.g. 'forsvar' finds 'Försvar'). Returns top 10 hits ranked by relevance and amount.",
    inputSchema: {
      query: z.string().min(1).describe("Search terms, e.g. 'försvar' or 'utbildning'"),
      year: z.number().int().describe("Budget year, e.g. 2024"),
    },
  },
  async ({ query, year }) => {
    const b = loadYear(year);
    const index = buildIndex(b);
    const hits = search(index, query, 10);
    const results = hits.map((h) => ({
      type: h.view === "exp" ? "expense" : "revenue",
      group: h.group,
      groupTitle: h.groupTitle,
      id: h.id,
      title: h.title,
      amount: h.v,
    }));
    return { content: [{ type: "text", text: JSON.stringify({ query, year, count: results.length, results }, null, 2) }] };
  },
);

server.registerTool(
  "get_history",
  {
    title: "Area history across years",
    description:
      "Total amount for one utgiftsområde (or inkomsttyp) across all available budget years. Optionally inflation-adjusted to a common price level.",
    inputSchema: {
      uo: z.number().int().describe("Utgiftsområde number (1-27) for expenses, or inkomsttyp id (e.g. 1000) for revenues"),
      view: z.enum(["exp", "rev"]).optional().describe("'exp' for utgiftsområde (default), 'rev' for inkomsttyp"),
      adjust: z.boolean().optional().describe("If true, inflation-adjust all values to the latest year's price level (default false)"),
    },
  },
  async ({ uo, view = "exp", adjust = false }) => {
    const years = listYears();
    const rates = adjust ? loadInflationRates() : null;
    const baseYear = adjust && rates ? chooseBaseYear(rates, years) : null;

    const entries: { year: number; title: string; amount: number; adjusted?: number }[] = [];
    for (const y of years) {
      const b = loadYear(y);
      let amount: number | undefined;
      let title: string | undefined;
      if (view === "exp") {
        const g = b.expenses.find((e) => e.uo === uo);
        if (g) { amount = g.total; title = g.title; }
      } else {
        const g = b.revenues.find((r) => r.id_start === uo);
        if (g) { amount = g.total; title = g.title; }
      }
      if (amount == null) continue;
      const entry: { year: number; title: string; amount: number; adjusted?: number } = { year: y, title: title!, amount };
      if (adjust && baseYear != null && rates) {
        const f = inflationFactor(rates, y, baseYear);
        if (f != null) entry.adjusted = Math.round(amount * f);
      }
      entries.push(entry);
    }
    if (entries.length === 0) {
      return { content: [{ type: "text", text: `No ${view === "exp" ? "utgiftsområde" : "inkomsttyp"} ${uo} found in any year.` }], isError: true };
    }
    const out: Record<string, unknown> = { uo, view, entries };
    if (baseYear != null) out.baseYear = baseYear;
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("statsbudgeten MCP server running on stdio");
