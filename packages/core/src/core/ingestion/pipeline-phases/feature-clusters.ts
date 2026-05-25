/**
 * Phase: featureClusters
 *
 * Creates human-facing FeatureCluster nodes above algorithmic Community nodes.
 * This is the layer agents query for product/domain areas such as Settings,
 * AI, Auth, MCP, or Ingestion before drilling into exact symbols.
 *
 * @deps    processes, structure
 * @reads   graph (all nodes and relationships)
 * @writes  graph (FeatureCluster nodes, FEATURE_MEMBER_OF, FEATURE_DEPENDS_ON)
 */

import type { PipelinePhase, PipelineContext, PhaseResult } from './types.js';
import { getPhaseOutput } from './types.js';
import type { StructureOutput } from './structure.js';
import {
  processFeatureClusters,
  type FeatureClusterDetectionResult,
} from '../feature-cluster-processor.js';
import { generateId } from '../../../lib/utils.js';
import { isDev } from '../utils/env.js';

export interface FeatureClustersOutput {
  featureClusterResult: FeatureClusterDetectionResult;
}

export const featureClustersPhase: PipelinePhase<FeatureClustersOutput> = {
  name: 'featureClusters',
  deps: ['processes', 'structure'],

  async execute(
    ctx: PipelineContext,
    deps: ReadonlyMap<string, PhaseResult<unknown>>,
  ): Promise<FeatureClustersOutput> {
    const { totalFiles } = getPhaseOutput<StructureOutput>(deps, 'structure');

    ctx.onProgress({
      phase: 'feature_clusters',
      percent: 99,
      message: 'Building feature clusters...',
      stats: { filesProcessed: totalFiles, totalFiles, nodesCreated: ctx.graph.nodeCount },
    });

    const featureClusterResult = await processFeatureClusters(
      ctx.graph,
      (message, progress) => {
        ctx.onProgress({
          phase: 'feature_clusters',
          percent: Math.round(99 + progress * 0.009),
          message,
          stats: { filesProcessed: totalFiles, totalFiles, nodesCreated: ctx.graph.nodeCount },
        });
      },
      {
        repo: ctx.options?.featureClusterRepo,
        lastIndexedCommit: ctx.options?.lastIndexedCommit,
      },
    );

    if (isDev) {
      console.log(
        `Feature clustering: ${featureClusterResult.stats.totalClusters} clusters, ${featureClusterResult.stats.totalMemberships} memberships`,
      );
    }

    featureClusterResult.clusters.forEach((cluster) => {
      ctx.graph.addNode({
        id: cluster.id,
        label: 'FeatureCluster' as const,
        properties: {
          name: cluster.name,
          filePath: '',
          slug: cluster.slug,
          featureKind: cluster.featureKind,
          summary: cluster.summary,
          description: cluster.description,
          repo: cluster.repo,
          service: cluster.service,
          signals: cluster.signals,
          memberCount: cluster.memberCount,
          entryPointIds: cluster.entryPointIds,
          routes: cluster.routes,
          tools: cluster.tools,
          testCoverageHints: cluster.testCoverageHints,
          lastIndexedCommit: cluster.lastIndexedCommit,
          confidence: cluster.confidence,
          source: 'heuristic',
        },
      });
    });

    featureClusterResult.memberships.forEach((membership) => {
      ctx.graph.addRelationship({
        id: generateId('FEATURE_MEMBER_OF', `${membership.nodeId}->${membership.clusterId}`),
        sourceId: membership.nodeId,
        targetId: membership.clusterId,
        type: 'FEATURE_MEMBER_OF',
        confidence: membership.confidence,
        reason: membership.signals.join('|'),
      });
    });

    featureClusterResult.dependencies.forEach((dependency) => {
      ctx.graph.addRelationship({
        id: generateId(
          'FEATURE_DEPENDS_ON',
          `${dependency.sourceClusterId}->${dependency.targetClusterId}`,
        ),
        sourceId: dependency.sourceClusterId,
        targetId: dependency.targetClusterId,
        type: 'FEATURE_DEPENDS_ON',
        confidence: dependency.confidence,
        reason: `member-dependency|edges:${dependency.edgeCount}|types:${dependency.relationshipTypes.join(',')}`,
      });
    });

    return { featureClusterResult };
  },
};
