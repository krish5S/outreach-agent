import { runMemoryLayer } from './memory.js';
import { runCompanyLayer } from './company.js';
import { runApproachLayer } from './approach.js';

export const stubLayers = Object.freeze({
  memory: async (ctx) => runMemoryLayer(ctx),
  company: async (ctx) => runCompanyLayer(ctx),
  approach: async (ctx) => runApproachLayer(ctx)
});

function makeRunId() {
  return 'run-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export async function runDeepPipeline(ctx = {}, { emit = async () => {}, layers = {} } = {}) {
  const profile = ctx.profileJSON || ctx.profile || {};
  const runId = ctx.runId || makeRunId();
  const startedAt = ctx.startedAt || new Date().toISOString();
  const layerFunctions = { ...stubLayers, ...layers };
  const layerResults = {};

  for (const layer of ['memory', 'company', 'approach']) {
    await emit({
      type: 'progress',
      layer,
      status: 'start',
      detail: 'Starting ' + layer + ' layer.'
    });

    try {
      const approachContext = layer === 'approach'
        ? {
            ...ctx,
            matches: [
              ...(Array.isArray(layerResults.memory?.matches) ? layerResults.memory.matches : []),
              ...(Array.isArray(layerResults.company?.matches) ? layerResults.company.matches : [])
            ],
            newsFacts: layerResults.company?.newsFacts || [],
            sources: layerResults.company?.sources || []
          }
        : ctx;
      const output = await layerFunctions[layer](approachContext);
      const status = output?.status || 'done';
      const detail = output?.detail || 'Layer complete.';
      layerResults[layer] = { status, detail };
      if (output?.cached !== undefined) layerResults[layer].cached = output.cached;
      if (output?.draft) layerResults[layer].draft = output.draft;
      if (Array.isArray(output?.matches)) layerResults[layer].matches = output.matches;
      if (Array.isArray(output?.drafts)) layerResults[layer].drafts = output.drafts;
      if (output?.strategy) layerResults[layer].strategy = output.strategy;
      if (Array.isArray(output?.evidencePack)) layerResults[layer].evidencePack = output.evidencePack;
      if (Array.isArray(output?.newsFacts)) layerResults[layer].newsFacts = output.newsFacts;
      if (Array.isArray(output?.sources)) layerResults[layer].sources = output.sources;
      await emit({ type: 'progress', layer, status, detail });
    } catch (error) {
      const detail = error?.message || 'Layer failed.';
      layerResults[layer] = { status: 'error', detail };
      await emit({ type: 'progress', layer, status: 'error', detail });
    }
  }

  const approachResult = layerResults.approach || {};
  const drafts = Array.isArray(approachResult.drafts)
    ? approachResult.drafts
    : approachResult.draft
      ? [{ variant: 'short', text: approachResult.draft, charCount: approachResult.draft.length, claims: [] }]
      : [];
  const combinedMatches = [
    ...(Array.isArray(layerResults.memory?.matches) ? layerResults.memory.matches : []),
    ...(Array.isArray(layerResults.company?.matches) ? layerResults.company.matches : [])
  ];

  return {
    runId,
    profileUrl: profile.profileUrl || '',
    startedAt,
    layers: layerResults,
    matches: combinedMatches,
    strategy: approachResult.strategy || null,
    drafts,
    critique: null,
    sources: layerResults.company?.sources || []
  };
}
