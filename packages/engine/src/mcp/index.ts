// The MCP server outside agents use to read the library and leave notes in its inbox.
export { AGENT_ACCESS_OFF, createAgentServer, serveStdio, type AgentAccess } from "./server.ts";
export { launchedBy, psParentOf, type ParentOf } from "./ancestry.ts";
