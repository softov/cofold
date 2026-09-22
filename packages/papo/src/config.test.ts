import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigurationError } from '@cofold/commands';
import { indentOf, loadConfig, providerFor, providersOf, rememberConfig, splitModel, userConfigPath } from './config.js';

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
    expect(config).toMatchObject({ backend: 'cofold', providers: [], permissions: 'default', reasoning: 'off', theme: 'paper', shell: 'workbench' });
    expect(config.rules).toBeUndefined();
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
      providers: [{ id: 'lm', baseUrl: 'http://localhost:1234/v1' }], model: 'lm/qwen', permissions: 'acceptEdits',
    }));
    await writeFile(join(root, 'work', '.papo.json'), JSON.stringify({ permissions: 'bypassPermissions', theme: 'workbench' }));
    const config = loadConfig({ cwd: join(root, 'work'), env });
    expect(config.providers).toEqual([{ id: 'lm', baseUrl: 'http://localhost:1234/v1' }]);
    expect(config).toMatchObject({ model: 'lm/qwen', permissions: 'bypassPermissions', theme: 'workbench' });
  });

  it('adds the environment provider as default and lets PAPO_MODEL choose', async () => {
    await writeFile(join(root, 'config', 'papo', 'config.json'), JSON.stringify({ providers: [{ id: 'default', baseUrl: 'http://old' }, { id: 'or', baseUrl: 'http://or' }] }));
    const config = loadConfig({ cwd: join(root, 'work'), env: { ...env, PAPO_BASE_URL: 'http://new/v1', PAPO_API_KEY: 'k', PAPO_MODEL: 'default/m' } });
    expect(config.providers).toEqual([{ id: 'default', baseUrl: 'http://new/v1', apiKey: 'k' }, { id: 'or', baseUrl: 'http://or' }]);
    expect(config.model).toBe('default/m');
  });

  it('reads the family variables when papo has none of its own', () => {
    const config = loadConfig({ cwd: join(root, 'work'), env: { ...env, COFOLD_BASE_URL: 'http://lm/v1', COFOLD_API_KEY: 'k', COFOLD_MODEL: 'qwen3' } });
    expect(config.providers).toEqual([{ id: 'default', baseUrl: 'http://lm/v1', apiKey: 'k' }]);
    expect(config.model).toBe('default/qwen3');
    const own = loadConfig({ cwd: join(root, 'work'), env: { ...env, COFOLD_BASE_URL: 'http://lm/v1', PAPO_BASE_URL: 'http://mine/v1', PAPO_MODEL: 'default/x' } });
    expect(own.providers[0]?.baseUrl).toBe('http://mine/v1');
    expect(own.model).toBe('default/x');
  });

  it('picks the backend from the file or PAPO_BACKEND, and refuses one it does not know', async () => {
    await writeFile(join(root, 'config', 'papo', 'config.json'), JSON.stringify({ backend: 'claude' }));
    expect(loadConfig({ cwd: join(root, 'work'), env }).backend).toBe('claude');
    expect(loadConfig({ cwd: join(root, 'work'), env: { ...env, PAPO_BACKEND: 'cofold' } }).backend).toBe('cofold');
    expect(() => loadConfig({ cwd: join(root, 'work'), env: { ...env, PAPO_BACKEND: 'gemini' } })).toThrow('PAPO_BACKEND must be cofold or claude');
    await writeFile(join(root, 'config', 'papo', 'config.json'), JSON.stringify({ backend: 'gemini' }));
    expect(() => loadConfig({ cwd: join(root, 'work'), env })).toThrow('config.backend must be one of cofold, claude');
  });

  it('names the key that is wrong, and the file it read', async () => {
    const file = join(root, 'config', 'papo', 'config.json');
    await writeFile(file, JSON.stringify({ permissions: 'sometimes' }));
    expect(() => loadConfig({ cwd: join(root, 'work'), env })).toThrow(/config\.permissions must be one of default, acceptEdits, bypassPermissions, dontAsk \(read: .*config\.json\)/);
    // The old three names are gone (cli/03 F8): a file that still says one is told the four.
    await writeFile(file, JSON.stringify({ permissions: 'destructive' }));
    expect(() => loadConfig({ cwd: join(root, 'work'), env })).toThrow('config.permissions must be one of default, acceptEdits, bypassPermissions, dontAsk');
    await writeFile(file, JSON.stringify({ providers: [{ id: 'a/b', baseUrl: 'x' }] }));
    expect(() => loadConfig({ cwd: join(root, 'work'), env })).toThrow('config.providers.id must be');
    await writeFile(file, JSON.stringify({ colour: 'red' }));
    expect(() => loadConfig({ cwd: join(root, 'work'), env })).toThrow('config.colour is not a field');
  });

  it('reads the rule lists and refuses a rule without a tool or with a key it does not know', async () => {
    const file = join(root, 'config', 'papo', 'config.json');
    await writeFile(file, JSON.stringify({ rules: { deny: [{ tool: 'shell_exec', match: 'rm *' }], allow: [{ tool: 'web_fetch' }] } }));
    expect(loadConfig({ cwd: join(root, 'work'), env }).rules).toEqual({ deny: [{ tool: 'shell_exec', match: 'rm *' }], allow: [{ tool: 'web_fetch' }] });
    await writeFile(file, JSON.stringify({ rules: { deny: [{ match: 'rm *' }] } }));
    expect(() => loadConfig({ cwd: join(root, 'work'), env })).toThrow(/config\.rules\.deny/);
    await writeFile(file, JSON.stringify({ rules: { deny: [{ tool: '' }] } }));
    expect(() => loadConfig({ cwd: join(root, 'work'), env })).toThrow(/config\.rules\.deny/);
    await writeFile(file, JSON.stringify({ rules: { block: [] } }));
    expect(() => loadConfig({ cwd: join(root, 'work'), env })).toThrow(/config\.rules\.block/);
  });
});

describe('rememberConfig', () => {
  const read = async (file: string): Promise<{ text: string; json: Record<string, unknown> }> => {
    const text = await readFile(file, 'utf8');
    return { text, json: JSON.parse(text) as Record<string, unknown> };
  };

  it('names the user file under XDG_CONFIG_HOME, else ~/.config', () => {
    expect(userConfigPath({ XDG_CONFIG_HOME: '/xdg' })).toBe(join('/xdg', 'papo', 'config.json'));
    expect(userConfigPath({}, '/home/me')).toBe(join('/home/me', '.config', 'papo', 'config.json'));
  });

  it('reads a file\'s indentation from its first indented line', () => {
    expect(indentOf('{\n    "a": 1\n}\n')).toBe('    ');
    expect(indentOf('{\n\t"a": 1\n}')).toBe('\t');
    expect(indentOf('{"a":1}')).toBe('  ');
  });

  it('creates the user file, folder and all, when no file sets the field', async () => {
    const fresh = { XDG_CONFIG_HOME: join(root, 'fresh') };
    const files = await rememberConfig({ cwd: join(root, 'work'), env: fresh, patch: { model: 'lm/qwen' } });
    const file = join(root, 'fresh', 'papo', 'config.json');
    expect(files).toEqual([file]);
    const { text, json } = await read(file);
    expect(json).toEqual({ model: 'lm/qwen' });
    expect(text).toBe('{\n  "model": "lm/qwen"\n}\n');
    expect(loadConfig({ cwd: join(root, 'work'), env: fresh }).model).toBe('lm/qwen');
  });

  it('keeps the user file\'s indentation and its other fields', async () => {
    const file = join(root, 'config', 'papo', 'config.json');
    await writeFile(file, `${JSON.stringify({ providers: [{ id: 'lm', baseUrl: 'http://localhost:1234/v1' }], model: 'lm/old', theme: 'workbench' }, null, 4)}\n`);
    const files = await rememberConfig({ cwd: join(root, 'work'), env, patch: { model: 'lm/new', reasoning: 'high' } });
    expect(files).toEqual([file]);
    const { text, json } = await read(file);
    expect(json).toEqual({ providers: [{ id: 'lm', baseUrl: 'http://localhost:1234/v1' }], model: 'lm/new', theme: 'workbench', reasoning: 'high' });
    expect(text).toBe(`${JSON.stringify(json, null, 4)}\n`);
  });

  it('writes each field into the file that sets it, and one no file sets into the user file', async () => {
    const user = join(root, 'config', 'papo', 'config.json');
    const project = join(root, 'work', '.papo.json');
    await writeFile(user, JSON.stringify({ providers: [{ id: 'lm', baseUrl: 'http://lm' }], model: 'lm/user' }));
    await writeFile(project, JSON.stringify({ model: 'lm/project' }));
    const files = await rememberConfig({ cwd: join(root, 'work', 'deeper'), env, patch: { model: 'lm/picked', permissions: 'acceptEdits' } });
    expect(files).toEqual([project, user]);
    expect((await read(project)).json).toEqual({ model: 'lm/picked' });
    expect((await read(user)).json).toEqual({ providers: [{ id: 'lm', baseUrl: 'http://lm' }], model: 'lm/user', permissions: 'acceptEdits' });
    const config = loadConfig({ cwd: join(root, 'work', 'deeper'), env });
    expect(config).toMatchObject({ model: 'lm/picked', permissions: 'acceptEdits' });
  });

  it('writes into the --config file when that is where the field comes from', async () => {
    const explicit = join(root, 'explicit.json');
    await writeFile(explicit, JSON.stringify({ reasoning: 'low' }));
    const files = await rememberConfig({ cwd: join(root, 'work'), env, path: explicit, patch: { reasoning: 'medium' } });
    expect(files).toEqual([explicit]);
    expect((await read(explicit)).json).toEqual({ reasoning: 'medium' });
  });

  it('writes nothing for an empty model or an empty patch', async () => {
    expect(await rememberConfig({ cwd: join(root, 'work'), env, patch: { model: '' } })).toEqual([]);
    expect(await rememberConfig({ cwd: join(root, 'work'), env, patch: {} })).toEqual([]);
    await expect(readFile(join(root, 'config', 'papo', 'config.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses to rewrite a file that is not JSON', async () => {
    const file = join(root, 'config', 'papo', 'config.json');
    await writeFile(file, '{ "model": ');
    await expect(rememberConfig({ cwd: join(root, 'work'), env, patch: { model: 'lm/x' } })).rejects.toBeInstanceOf(ConfigurationError);
    expect(await readFile(file, 'utf8')).toBe('{ "model": ');
  });
});

describe('model references', () => {
  it('splits at the first slash only', () => {
    expect(splitModel('or/qwen/qwen3-8b')).toEqual({ provider: 'or', modelId: 'qwen/qwen3-8b' });
    expect(() => splitModel('qwen')).toThrow('<provider>/<model>');
    expect(() => splitModel('or/')).toThrow('<provider>/<model>');
  });

  it('finds the provider by id and says which are configured when it is missing', () => {
    const config = { backend: 'cofold' as const, providers: [{ id: 'a', baseUrl: 'http://a' }, { id: 'b', baseUrl: 'http://b' }], permissions: 'acceptEdits' as const, reasoning: 'off' as const, instructions: '', tools: { files: false, shell: false, web: false, memory: false }, context: { maxTokens: 32_000, autoCompact: false }, theme: 'paper', shell: 'workbench' };
    const providers = providersOf(config);
    expect(providers.map((provider) => provider.id)).toEqual(['openai-compat:a', 'openai-compat:b']);
    expect(providerFor(providers, config, 'b/m')).toEqual({ provider: providers[1], modelId: 'm' });
    expect(() => providerFor(providers, config, 'c/m')).toThrow('configured: a, b');
    expect(() => providerFor([], { ...config, providers: [] }, 'c/m')).toThrow('no provider is configured');
  });
});
