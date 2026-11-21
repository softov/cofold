// Lists the real model catalogues through the built @cofold/model-openai-compat
// and prints what fromWireModel made of them. Needs `pnpm build` first and the
// provider keys in the environment; a provider without its key is skipped.
//
//   node scripts/live-models.mjs
import { openaiCompatProvider } from '../packages/model-openai-compat/dist/index.js';

const providers = [
  { name: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', key: process.env.DEEPSEEK_API_KEY, pick: () => true },
  { name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', key: process.env.OPENROUTER_API_KEY, pick: (m) => /^deepseek\//.test(m.id) },
];

for (const { name, baseUrl, key, pick } of providers) {
  if (!key) {
    console.log(`${name}: skipped, no API key in the environment`);
    continue;
  }
  const list = await openaiCompatProvider({ baseUrl, apiKey: key }).listModels();
  console.log(`${name}: ${list.length} models`);
  for (const m of list.filter(pick).slice(0, 4)) {
    console.log(`  ${m.id} contextTokens=${m.contextTokens} maxOutputTokens=${m.maxOutputTokens} images=${m.features.images}`);
  }
}
