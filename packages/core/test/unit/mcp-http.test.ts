import { describe, expect, it } from 'vitest';
import {
  MCP_HTTP_ENDPOINT,
  getMcpHttpRouteGuidance,
  getUnsupportedMcpRestRouteResponse,
} from '../../src/server/mcp-http.js';

describe('MCP HTTP route guidance', () => {
  it('explains that HTTP MCP uses StreamableHTTP rather than REST tool routes', () => {
    expect(getMcpHttpRouteGuidance()).toEqual({
      endpoint: '/api/mcp',
      transport: 'streamable-http',
      note: 'HTTP MCP is a protocol endpoint, not a REST tools namespace.',
      unsupportedRestExample: '/api/mcp/tools/list',
      powershellHealthCheck:
        "Invoke-RestMethod -Uri 'http://127.0.0.1:4747/api/info' -TimeoutSec 10",
      clientInstruction:
        'Point an MCP client at http://127.0.0.1:4747/api/mcp using StreamableHTTP.',
    });
    expect(MCP_HTTP_ENDPOINT).toBe('/api/mcp');
  });

  it('returns actionable JSON for unsupported probes such as /api/mcp/tools/list', () => {
    expect(getUnsupportedMcpRestRouteResponse('/api/mcp/tools/list')).toMatchObject({
      error: 'Unsupported MCP HTTP REST route',
      code: 'MCP_HTTP_REST_ROUTE_UNSUPPORTED',
      unsupportedRoute: '/api/mcp/tools/list',
      endpoint: '/api/mcp',
      transport: 'streamable-http',
    });
  });
});
