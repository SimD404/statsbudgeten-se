# Statsbudgeten MCP server.
#
# Build:  docker build -f mcp.Dockerfile -t statsbudgeten-mcp .
#
# LLM client config (Claude Desktop / Claude Code / any MCP client):
#   {
#     "command": "docker",
#     "args": ["run", "-i", "--rm",
#              "-v", "/path/to/statsbudgeten-se:/app:ro",
#              "statsbudgeten-mcp"]
#   }
#
# Example:
#   docker run -i --rm -v $(pwd):/app:ro statsbudgeten-mcp

FROM oven/bun:1

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production
COPY . ./

CMD ["bun", "src/mcp.ts"]
