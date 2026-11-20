import test from 'node:test';
import assert from 'node:assert/strict';
import { embed, hashEmbeddingText, keywordEmbed, keywordTokens } from '../src/utils/embeddings.js';
import { cosine } from '../src/utils/matcher.js';

function makeStorage() {
  const values = {};
  let writes = 0;
  return {
    values,
    get writes() { return writes; },
    async getLocal(keys) {
      const result = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (Object.prototype.hasOwnProperty.call(values, key)) result[key] = values[key];
      }
      return result;
    },
    async setLocal(items) {
      writes += 1;
      Object.assign(values, items);
    }
  };
}

test('keyword embeddings normalize small synonym groups', () => {
  const ai = keywordEmbed('AI');
  const artificialIntelligence = keywordEmbed('artificial intelligence');
  assert.equal(ai.length, 512);
  assert.equal(cosine(ai, artificialIntelligence), 1);
  assert.ok(keywordTokens('RAG pipeline').includes('retrieval'));
});

test('shared-school facts score above unrelated keyword facts', async () => {
  const vectors = await embed([
    'D. J. Sanghvi College of Engineering',
    'Harvard University',
    'Jazz performance and music composition'
  ]);
  assert.ok(cosine(vectors[0], keywordEmbed('DJSCE College of Engineering')) > cosine(vectors[0], vectors[2]));
  assert.ok(cosine(vectors[0], keywordEmbed('DJSCE College of Engineering')) > cosine(vectors[1], vectors[2]));
});

test('keyword vectors are cached locally and reused by normalized text hash', async () => {
  const storage = makeStorage();
  const first = await embed(['Shared university fact'], { storage });
  const second = await embed(['Shared university fact'], { storage });

  assert.deepEqual(second, first);
  assert.equal(storage.writes, 1);
  assert.ok(Object.keys(storage.values.vecCache).every((key) => key.startsWith('keyword:local:')));
  assert.equal(hashEmbeddingText(' Shared   university fact '), hashEmbeddingText('shared university fact'));
});

test('local embeddings do not require a provider key or network access', async () => {
  const vectors = await embed(['Python and machine learning']);
  assert.equal(vectors.length, 1);
  assert.equal(vectors[0].length, 512);
});
