// A hand-written stdio server with the skills extension (SEP-2640): two pages of skills, skills/get, resources/read.
// SKILLS_OFF=1 drops the extension.
import { createInterface } from 'node:readline';

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const skill = (name, files) => ({
  uri: `skill://${name}/SKILL.md`,
  frontmatter: { name, description: `The ${name} skill` },
  resources: files.map((file) => ({ uri: `skill://${name}/${file}`, digest: `sha256:${'0'.repeat(64)}`, size: 1 })),
});
const skills = [skill('one', ['SKILL.md']), skill('two', ['SKILL.md', 'notes.md'])];
const files = { 'skill://one/SKILL.md': '---\nname: one\n---\nOne.', 'skill://two/SKILL.md': '---\nname: two\n---\nTwo.', 'skill://two/notes.md': 'Notes.' };
const calls = [];
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method !== undefined && message.id !== undefined) calls.push(message.method);
  switch (message.method) {
    case 'initialize':
      send({ id: message.id, result: {
        protocolVersion: message.params.protocolVersion,
        capabilities: process.env.SKILLS_OFF === '1' ? { tools: {} } : { tools: {}, resources: {}, extensions: { 'io.modelcontextprotocol/skills': {} } },
        serverInfo: { name: 'skills', version: '1' },
      } });
      break;
    case 'tools/list':
      send({ id: message.id, result: { tools: [{ name: 'calls', description: 'The methods called so far', inputSchema: { type: 'object' } }] } });
      break;
    case 'tools/call':
      send({ id: message.id, result: { structuredContent: { calls } } });
      break;
    case 'skills/list': {
      const second = message.params?.cursor === 'two';
      send({ id: message.id, result: { resultType: 'complete', skills: second ? skills.slice(1) : skills.slice(0, 1), ...(second ? {} : { nextCursor: 'two' }) } });
      break;
    }
    case 'skills/get': {
      const found = skills.find((one) => one.uri === message.params.uri);
      if (found) send({ id: message.id, result: { resultType: 'complete', skill: found } });
      else send({ id: message.id, error: { code: -32602, message: `no skill ${message.params.uri}` } });
      break;
    }
    case 'resources/read': {
      const text = files[message.params.uri];
      if (text === undefined) send({ id: message.id, error: { code: -32002, message: 'not found' } });
      else send({ id: message.id, result: { contents: [{ uri: message.params.uri, mimeType: 'text/markdown', text }] } });
      break;
    }
    default:
      if (message.id !== undefined) send({ id: message.id, error: { code: -32601, message: 'nope' } });
  }
});
