/**
 * Unit Tests: MCP Tool Definitions
 *
 * Tests: CODRAGRAPH_TOOLS from tools.ts
 * - Full tool surface is exposed (24 tools as of harness/graphstore expansion)
 * - Each tool has valid name, description, inputSchema
 * - Required fields are correct
 * - Optional repo parameter is present on tools that need it
 */
import { describe, it, expect } from 'vitest';
import { CODRAGRAPH_TOOLS } from '../../src/mcp/tools.js';

// Tools that legitimately don't take a `repo` parameter:
//   - list_repos: repo discovery itself
//   - group_*: span all repos in a group
//   - harness_recipes_*: recipes are stored globally, not per-repo
const NON_REPO_TOOLS = new Set([
  'list_repos',
  'group_list',
  'group_sync',
  'harness_recipes_list',
  'harness_recipes_lookup',
]);

describe('CODRAGRAPH_TOOLS', () => {
  it('exports the full tool surface', () => {
    // Bumped from 13 → 24 after harness_* + graphstore_* tools landed.
    // Update if more tools are added.
    expect(CODRAGRAPH_TOOLS).toHaveLength(24);
  });

  it('contains all expected tool names', () => {
    const names = CODRAGRAPH_TOOLS.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_repos',
        'query',
        'cypher',
        'context',
        'detect_changes',
        'rename',
        'impact',
        'api_impact',
      ]),
    );
  });

  it('each tool has name, description, and inputSchema', () => {
    for (const tool of CODRAGRAPH_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(typeof tool.name).toBe('string');
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
    }
  });

  it('query tool requires "query" parameter', () => {
    const queryTool = CODRAGRAPH_TOOLS.find((t) => t.name === 'query')!;
    expect(queryTool.inputSchema.required).toContain('query');
    expect(queryTool.inputSchema.properties.query).toBeDefined();
    expect(queryTool.inputSchema.properties.query.type).toBe('string');
  });

  it('cypher tool requires "query" parameter', () => {
    const cypherTool = CODRAGRAPH_TOOLS.find((t) => t.name === 'cypher')!;
    expect(cypherTool.inputSchema.required).toContain('query');
  });

  it('context tool has no required parameters', () => {
    const contextTool = CODRAGRAPH_TOOLS.find((t) => t.name === 'context')!;
    expect(contextTool.inputSchema.required).toEqual([]);
  });

  it('impact tool requires target and direction', () => {
    const impactTool = CODRAGRAPH_TOOLS.find((t) => t.name === 'impact')!;
    expect(impactTool.inputSchema.required).toContain('target');
    expect(impactTool.inputSchema.required).toContain('direction');
  });

  it('rename tool requires new_name', () => {
    const renameTool = CODRAGRAPH_TOOLS.find((t) => t.name === 'rename')!;
    expect(renameTool.inputSchema.required).toContain('new_name');
  });

  it('detect_changes tool has no required parameters', () => {
    const detectTool = CODRAGRAPH_TOOLS.find((t) => t.name === 'detect_changes')!;
    expect(detectTool.inputSchema.required).toEqual([]);
  });

  it('list_repos tool has no parameters', () => {
    const listTool = CODRAGRAPH_TOOLS.find((t) => t.name === 'list_repos')!;
    expect(Object.keys(listTool.inputSchema.properties)).toHaveLength(0);
    expect(listTool.inputSchema.required).toEqual([]);
  });

  it('per-repo tools have optional repo parameter for backend selection', () => {
    for (const tool of CODRAGRAPH_TOOLS) {
      if (NON_REPO_TOOLS.has(tool.name)) continue;
      expect(tool.inputSchema.properties.repo, `${tool.name} missing repo prop`).toBeDefined();
      expect(tool.inputSchema.properties.repo.type).toBe('string');
      expect(tool.inputSchema.required).not.toContain('repo');
    }
  });

  it('group tools without backend repo param omit repo property', () => {
    for (const name of ['group_list', 'group_sync'] as const) {
      const tool = CODRAGRAPH_TOOLS.find((t) => t.name === name)!;
      expect(tool.inputSchema.properties).not.toHaveProperty('repo');
    }
  });

  it('impact, query, and context expose optional service with minLength', () => {
    for (const n of ['impact', 'query', 'context'] as const) {
      const tool = CODRAGRAPH_TOOLS.find((t) => t.name === n)!;
      const svc = tool.inputSchema.properties.service;
      expect(svc, n).toBeDefined();
      expect(svc!.minLength).toBe(1);
    }
  });

  it('impact schema bounds match cross-impact validation ranges', () => {
    const impact = CODRAGRAPH_TOOLS.find((t) => t.name === 'impact')!;
    expect(impact.inputSchema.properties.maxDepth.minimum).toBe(1);
    expect(impact.inputSchema.properties.maxDepth.maximum).toBe(32);
    expect(impact.inputSchema.properties.minConfidence.minimum).toBe(0);
    expect(impact.inputSchema.properties.minConfidence.maximum).toBe(1);
    expect(impact.inputSchema.properties.timeoutMs.maximum).toBe(3600000);
  });

  it('detect_changes scope has correct enum values', () => {
    const detectTool = CODRAGRAPH_TOOLS.find((t) => t.name === 'detect_changes')!;
    const scopeProp = detectTool.inputSchema.properties.scope;
    expect(scopeProp.enum).toEqual(['unstaged', 'staged', 'all', 'compare']);
  });

  it('api_impact tool has no required parameters', () => {
    const apiImpactTool = CODRAGRAPH_TOOLS.find((t) => t.name === 'api_impact')!;
    expect(apiImpactTool).toBeDefined();
    expect(apiImpactTool.inputSchema.required).toEqual([]);
    expect(apiImpactTool.inputSchema.properties.route).toBeDefined();
    expect(apiImpactTool.inputSchema.properties.file).toBeDefined();
    expect(apiImpactTool.inputSchema.properties.repo).toBeDefined();
  });

  it('impact relationTypes is array of strings', () => {
    const impactTool = CODRAGRAPH_TOOLS.find((t) => t.name === 'impact')!;
    const relProp = impactTool.inputSchema.properties.relationTypes;
    expect(relProp.type).toBe('array');
    expect(relProp.items).toEqual({ type: 'string' });
  });

  it('route_map description defers to api_impact for pre-change analysis', () => {
    const routeMapTool = CODRAGRAPH_TOOLS.find((t) => t.name === 'route_map')!;
    expect(routeMapTool.description).toContain('api_impact');
    expect(routeMapTool.description).toContain('pre-change analysis');
  });

  it('shape_check description defers to api_impact for pre-change analysis', () => {
    const shapeCheckTool = CODRAGRAPH_TOOLS.find((t) => t.name === 'shape_check')!;
    expect(shapeCheckTool.description).toContain('api_impact');
    expect(shapeCheckTool.description).toContain('pre-change analysis');
  });
});
