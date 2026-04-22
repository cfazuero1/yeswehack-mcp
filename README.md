# YesWeHack MCP Server – Usage Guide

This guide explains how to connect to the YesWeHack MCP server using Claude and how to request available programs.

---

## Prerequisites

Make sure you have:

- Node.js (v18 or later recommended)
- `npx` available
- `tsx` installed (or accessible via npx)
- Claude CLI installed and configured

---

## Adding the MCP Server to Claude

Run the following command to register the MCP server:

```bash
claude mcp add yeswehack -- npx tsx /home/cloud/.claude/mcp-servers/yeswehack/server.ts
```

---

## Promt Request

In Claude, you can ask:

Show me available programs from yeswehack

Or more explicitly:

Use the yeswehack MCP and list all programs
