# Statsbudgeten

**[statsbudgeten.se](https://statsbudgeten.se)** shows Sweden's state budget as an
interactive treemap: every utgiftsområde and inkomsttyp is a tile sized by its
amount. Click a tile to drill into its anslag or inkomsttitlar, see how an area
or a single posting has developed over the years, switch budget year, adjust
for inflation, or search for any posting by name.

All amounts come unchanged from the official sources. The site is independent
and has no connection to Regeringskansliet or SCB.

- **Budget:** [Statens budget som Excel](https://www.regeringen.se/sveriges-regering/finansdepartementet/statens-budget/statens-budget-som-excel/)
  from Regeringskansliet, Finansdepartementet. One workbook per budget year.
- **Inflation:** [Inflation i Sverige](https://www.scb.se/hitta-statistik/statistik-efter-amne/priser-och-ekonomiska-tendenser/priser/konsumentprisindex-kpi/pong/tabell-och-diagram/historiska-tal/inflation-i-sverige/)
  from SCB, consumer price index (KPI), annual averages.

## Running it

Requires [Bun](https://bun.sh) 1.4 or newer (the lockfile is in Bun's version 2
format). There are no runtime dependencies beyond React and Zod; the xlsx files
are read by a small built-in parser.

```bash
bun install
bun run web        # http://localhost:3000, with hot reload
bun test           # parsers, inflation math, markdown, routes, search
```

The server lists every `data/<year>.json` it finds. With more than one year
present, the year picker lets you switch budget year and every area and posting
gets a history line chart. The URL mirrors what is on screen (`src/web/routes.ts`):

| URL | View |
|---|---|
| `/` | Overview: inkomster vs utgifter per year |
| `/utgifter`, `/inkomster` | Treemap of all utgiftsområden / inkomsttyper |
| `/utgifter/6` | Utgiftsområde 6: its history graph above the treemap of its anslag |
| `/utgifter/6/3` | …with anslag 3 focused, so the graph shows that anslag |
| `/utgifter/6/ovriga`, `/utgifter/6/ovriga/23` | The "Övriga" bundle of small postings, optionally with one focused |
| `/inkomster/1000/1111` | Inkomsttyp 1000 with inkomsttitel 1111 focused |
| `/sok?q=försvar` | Search over areas and postings in the selected year |
| `/om` | About page, written in `content/om.md` |
| `…?year=2024` | Budget year (omitted for the latest year) |
| `…?inflation=1` | Amounts adjusted for inflation |
| `…?andel=inkomster` | Graphs in percent of the year's revenues (`andel=utgifter`: of expenses) |

## MCP server

The budget data is also exposed as an [MCP](https://modelcontextprotocol.io) server
(`src/mcp.ts`), so an LLM client can query it directly without a browser.

```bash
bun src/mcp.ts   # speaks MCP over stdio
```

### Tools

| Tool | Description |
|------|-------------|
| `list_years` | Available budget years |
| `get_overview(year)` | Totals + all expense/revenue areas |
| `get_area(year, uo, top?)` | One utgiftsområde with top-N anslag |
| `get_posting(year, uo, id)` | Single anslag |
| `get_revenue_area(year, id)` | One inkomsttyp with its inkomsttitlar |
| `search(query, year)` | Full-text search across areas and postings |
| `get_history(uo, adjust?)` | Area values across all years (optionally inflation-adjusted) |

### Register in an MCP client

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "statsbudgeten": {
      "command": "bun",
      "args": ["/path/to/statsbudgeten-se/src/mcp.ts"]
    }
  }
}
```

**Claude Code** (`.mcp.json` in project root):

```json
{
  "mcpServers": {
    "statsbudgeten": {
      "command": "bun",
      "args": ["src/mcp.ts"]
    }
  }
}
```

### Docker (with mcp-shell)

The [spike repo](../) ships a Dockerfile that wraps this server with
[mcp-shell](https://github.com/sonirico/mcp-shell), giving the LLM shell access
(run scripts, edit files) alongside the budget tools.

```bash
# Build (from the spike repo root)
docker build -t statsbudgeten-mcp-devenv .
```

Register in your MCP client:

```json
{
  "mcpServers": {
    "statsbudgeten": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "/path/to/statsbudgeten-se:/app",
        "-v", "/path/to/mcp-shell.yaml:/etc/mcp-shell/security.yaml:ro",
        "statsbudgeten-mcp-devenv"
      ]
    }
  }
}
```

The container's main process is `mcp-shell` (stdio MCP). The entrypoint runs
`bun install` on first start; `node_modules` persists in the volume mount.

### Smoke test (no LLM client needed)

```bash
bun src/mcp.ts <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_years","arguments":{}}}
EOF
```

Expect three JSON-RPC responses: server info, tool list, and the years array.

## Data

The official workbooks live in `examples/` and are converted to JSON in `data/`
by scripts that validate every subtotal against the sheet's own sums. The JSON
files are committed, so a checkout runs without converting anything.

```bash
bun run convert                  # every examples/<year>.xlsx -> data/<year>.json
bun run convert path/to/2027.xlsx
bun run convert-inflation        # examples/inflation.xlsx -> data/inflation.json
```

- `docs/BUDGET_SCHEMA.md` describes the JSON shape and how the workbooks map to it,
  including the layout quirks that differ between years.
- `data/README.md` describes the inflation file and how amounts are re-expressed
  in the latest year's prices.
- `types/` holds the Zod schemas; `index.ts` re-exports the parsers and schemas
  for use as a library.

Adding a budget year is a matter of dropping the workbook into `examples/` and
running `bun run convert`. The web app adapts to whatever years are present.

## How it is built

Bun serves `src/web/index.html`, which bundles the React app in `src/web/frontend.tsx`
with no build step. The treemap and the line charts are drawn with plain DOM and
SVG, without a charting library. The about page is a small Markdown subset
(`src/markdown.ts`) parsed at bundle time by a Bun macro (`src/web/content.macro.ts`);
the `[sources]` line becomes download links for the workbooks in `examples/`,
which the server serves at `/examples/<file>`.

Link previews show the chart the page shows: the server fills in the share tags
(`og:title`, `og:description`, `og:image`) for each app URL and draws the image
on demand at `/social/<page>.png`, for example `/social/utgifter/6.png?year=2024`.
The image is the same model as the app (`src/web/model.ts`) written as SVG and
rasterised with resvg (`src/social.ts`), using the bundled Inter font so it looks
the same on every machine. The about and search pages use the static `/social.png`. The *Dela* button on
every chart page offers the same image as a square, 4:5 or 9:16 (`?format=square`,
`portrait`, `story`) for posting, through the system share sheet or as a download.

Google Analytics is wired up in `src/web/analytics.ts` (measurement ID at the top
of the file). It is not loaded on localhost. Each URL change is reported as a page
view and flipping the inflation toggle is an event.

## Deploying

The repo ships with a `fly.toml` (app `statsbudgeten-se`, region `arn`/Stockholm)
and a `Dockerfile`. First time, `fly launch --no-deploy` to create the app under
your own account, then:

```bash
fly deploy
```

The server respects `PORT` and disables dev mode when `NODE_ENV=production`,
both set by the Fly config.

## Credits

Made by Albert ([proddalbert.se](https://proddalbert.se), @ProddAlbert). Most of the
code was written together with [Claude](https://claude.com) (Anthropic's AI
assistant, via Claude Code) from Albert's design, data models and direction,
with Albert reviewing and steering the work. No AI is involved in the numbers
themselves; they are parsed verbatim from the official workbooks.

## License

The code is released under the [MIT License](LICENSE). The budget workbooks are
public documents from Regeringskansliet and the inflation series is open data
from SCB; both are redistributed here unchanged, with attribution.
