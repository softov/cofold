import type { AppIdentity } from '@cofold/model-openai-compat';
import type { ModelProvider } from '@cofold/agents';
import { providersOf } from '@cofold/model-openai-compat';
import type { CopapoConfig } from './types/config.js';

export const VERSION = '0.1.0';

/** Who copapo's model calls say they come from: the User-Agent, and OpenRouter's referer and title. */
export const COPAPO_APP: AppIdentity = { name: 'copapo', version: VERSION, url: 'https://github.com/softov/cofold' };

/** The configured providers, each naming copapo on its requests; a provider's own `headers` still win. */
export function providersFor(config: Pick<CopapoConfig, 'providers'>): Map<string, ModelProvider> {
  return providersOf(config.providers, { app: COPAPO_APP });
}
