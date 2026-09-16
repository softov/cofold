import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, providerFor, providersOf, splitModel } from './config.js';

let root: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'papo-config-'));
  await mkdir(join(root, 'config', 'papo'), { recursive: true });
  await mkdir(join(root, 'work'), { recursive: true });
  // Only the variables under test: the machine running this may have PAPO_* set.
  env = { XDG_CONFIG_HOME: join(root, 'config') };
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('loadConfig', () => {
  it('has defaults and no provider until one is written', () => {
    const config = loadConfig({ cwd: join(root, 'work'), env });
    expect(config).toMatchObject({ providers: [], permissions: 'destructive', reasoning: 'off', theme: 'paper', shell: 'workbench' });
    expect(config.tools).toEqual({ files: true, shell: true, web: true, memory: true });
    expect(config.instructions.length).toBeGreaterThan(10);
  });

  it('merges the tools block key by key and names a wrong one', async () => {
    const file = join(root, 'config', 'papo', 'config.json');
    await writeFile(file, JSON.stringify({ tools: { shell: false, web: { search: { duckduckgo: true } } } }));
    expect(loadConfig({ cwd: join(root, 'work'), env }).tools).toEqual({ files: true, shell: false, web: { search: { duckduckgo: true } }, memory: true });
    await writeFile(file, JSON.stringify({ tools: { web: { search: { bing: {} } } } }));
    expect(() => loadConfig({ cwd: join(root, 'work'), env })).toThrow(/config\.tools\.web/);
  });

  it('reads the user file, then the project file over it', async () => {
    await writeFile(join(root, 'config', 'papo', 'config.json'), JSON.stringify({
      providers: [{ id: 'lm', baseUrl: 'http://localhost:1234/v1' }], model: 'lm/qwen', permissions: 'ask',
    }));
    await writeFile(join(root, 'work', '.papo.json'), JSON.stringify({ permissions: 'auto', theme: 'workbench' }));
    const config = loadConfig({ cwd: join(root, 'work'), env });
    expect(config.providers).toEqual([{ id: 'lm', baseUrl: 'http://localhost:1234/v1' }]);
    expect(config).toMatchObject({ model: 'lm/qwen', permissions: 'auto', theme: 'workbench' });
  });

  it('adds the environment provider as default and lets PAPO_MODEL choose', async () => {
    await writeFile(join(root, 'config', 'papo', 'config.json'), JSON.stringify({ providers: [{ id: 'default', baseUrl: 'http://old' }, { id: 'or', baseUrl: 'http://or' }] }));
    const config = loadConfig({ cwd: join(root, 'work'), env: { ...env, PAPO_BASE_URL: 'http://new/v1', PAPO_API_KEY: 'k', PAPO_MODEL: 'default/m' } });
    expect(config.providers).toEqual([{ id: 'default', baseUrl: 'http://new/v1', apiKey: 'k' }, { id: 'or', baseUrl: 'http://or' }]);
    expect(config.model).toBe('default/m');
  });

  it('reads the family variables when papo has none of its own', () => {
    const config = loadConfig({ cwd: join(root, 'work'), env: { ...env, FACIO_BASE_URL: 'http://lm/v1', FACIO_API_KEY: 'k', FACIO_MODEL: 'qwen3' } });
    expect(config.providers).toEqual([{ id: 'default', baseUrl: 'http://lm/v1', apiKey: 'k' }]);
    expect(config.model).toBe('default/qwen3');
    const own = loadConfig({ cwd: join(root, 'work'), env: { ...env, FACIO_BASE_URL: 'http://lm/v1', PAPO_BASE_URL: 'http://mine/v1', PAPO_MODEL: 'default/x' } });
    expect(own.providers[0]?.baseUrl).toBe('http://mine/v1');
    expect(own.model).toBe('default/x');
  });

  it('names the key that is wrong, and the file it read', async () => {
    const file = join(root, 'config', 'papo', 'config.json');
    await writeFile(file, JSON.stringify({ permissions: 'sometimes' }));
    expect(() => loadConfig({ cwd: join(root, 'work'), env })).toThrow(/config\.permissions must be one of ask, destructive, auto \(read: .*config\.json\)/);
    await writeFile(file, JSON.stringify({ providers: [{ id: 'a/b', baseUrl: 'x' }] }));
    expect(() => loadConfig({ cwd: join(root, 'work'), env })).toThrow('config.providers.id must be');
    await writeFile(file, JSON.stringify({ colour: 'red' }));
    expect(() => loadConfig({ cwd: join(root, 'work'), env })).toThrow('config.colour is not a field');
  });
});

describe('model references', () => {
  it('splits at the first slash only', () => {
    expect(splitModel('or/qwen/qwen3-8b')).toEqual({ provider: 'or', modelId: 'qwen/qwen3-8b' });
    expect(() => splitModel('qwen')).toThrow('<provider>/<model>');
    expect(() => splitModel('or/')).toThrow('<provider>/<model>');
  });

  it('finds the provider by id and says which are configured when it is missing', () => {
    const config = { providers: [{ id: 'a', baseUrl: 'http://a' }, { id: 'b', baseUrl: 'http://b' }], permissions: 'ask' as const, reasoning: 'off' as const, instructions: '', theme: 'paper', shell: 'workbench' };
    const providers = providersOf(config);
    expect(providers.map((provider) => provider.id)).toEqual(['openai-compat:a', 'openai-compat:b']);
    expect(providerFor(providers, config, 'b/m')).toEqual({ provider: providers[1], modelId: 'm' });
    expect(() => providerFor(providers, config, 'c/m')).toThrow('configured: a, b');
    expect(() => providerFor([], { ...config, providers: [] }, 'c/m')).toThrow('no provider is configured');
  });
});
