const DEFAULT_DRAFT = 'Placeholder draft: Deep Mode is connected. Personalized outreach logic will be added in later steps.';

export const stubLayers = Object.freeze({
  memory: async () => ({
    status: 'skipped',
    detail: 'Resume-to-profile matching is a placeholder in Step 1.'
  }),
  company: async () => ({
    status: 'skipped',
    detail: 'Company research is a placeholder in Step 1.'
  }),
  approach: async () => ({
    status: 'done',
    detail: 'Placeholder draft returned; personalized writing is added later.',
    draft: DEFAULT_DRAFT
  })
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
      const output = await layerFunctions[layer](ctx);
      const status = output?.status || 'done';
      const detail = output?.detail || 'Layer complete.';
      layerResults[layer] = { status, detail };
      if (output?.cached !== undefined) layerResults[layer].cached = output.cached;
      if (output?.draft) layerResults[layer].draft = output.draft;
      await emit({ type: 'progress', layer, status, detail });
    } catch (error) {
      const detail = error?.message || 'Layer failed.';
      layerResults[layer] = { status: 'error', detail };
      await emit({ type: 'progress', layer, status: 'error', detail });
    }
  }

  const draftText = layerResults.approach?.draft || DEFAULT_DRAFT;
  const draft = {
    variant: 'short',
    text: draftText,
    charCount: draftText.length,
    claims: []
  };

  return {
    runId,
    profileUrl: profile.profileUrl || '',
    startedAt,
    layers: layerResults,
    matches: [],
    strategy: {
      mode: 'fallback',
      primary: { evidenceIds: [], angle: 'Step 1 placeholder' },
      supporting: [],
      askSize: 'small',
      tone: 'neutral',
      rationale: 'Personalized strategy is not implemented in the Step 1 skeleton.'
    },
    drafts: [draft],
    critique: null,
    sources: []
  };
}
