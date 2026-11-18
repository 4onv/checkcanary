import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const maxFileBytes = 256 * 1024;
const maxTotalBytes = 8 * 1024 * 1024;
const maxFiles = 100;

function requireFields(value, allowed, label) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new Error('Invalid ' + label + ' fields.');
  }
}

export async function readBounded(file, limit) {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('Expected a regular input file within the size limit.');
    const buffer = Buffer.allocUnsafe(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== stat.size) throw new Error('An input file changed size during reading.');
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

function portablePath(name) {
  return typeof name === 'string' && name.length <= 240 &&
    /^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/u.test(name) &&
    !name.split('/').some(part => part === '.' || part === '..' || part.endsWith('.') ||
      /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part));
}

function evidence(value, label, required = true) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.length < 1 || value.length > 10 ||
      value.some(item => typeof item !== 'string' || !item || item.length > 4096)) {
    throw new Error(label + ' needs 1 to 10 nonempty outputIncludes strings of up to 4,096 characters.');
  }
  return value;
}

function validateFiles(files) {
  if (!object(files)) throw new Error('Workspace files must be an object.');
  const paths = Object.keys(files);
  if (!paths.length || paths.length > maxFiles) throw new Error('Declare 1 to 100 workspace files.');
  const folded = paths.map(path => path.toLowerCase());
  if (paths.some(path => !portablePath(path)) || new Set(folded).size !== paths.length ||
      folded.some(path => folded.some(other => other !== path && other.startsWith(path + '/')))) {
    throw new Error('Workspace paths must be distinct portable relative files without directory conflicts.');
  }
  return paths;
}

export async function loadPlan(file) {
  const manifest = await realpath(file);
  let input;
  try {
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBounded(manifest, 512 * 1024)));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) throw new Error('The plan must contain valid UTF-8 JSON.');
    throw error;
  }
  requireFields(input, ['version','name','command','files','canaries','timeoutMs','baselineEvidence'], 'plan');
  if (input.version !== 1 || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200) {
    throw new Error('Expected a version 1 plan with a nonempty name of up to 200 characters.');
  }
  const command = input.command;
  if (!Array.isArray(command) || !command.length || command.length > 64 ||
      command.some(arg => typeof arg !== 'string' || arg.includes('\0') || arg.length > 8192) || !command[0]) {
    throw new Error('command must be an executable and up to 63 arguments, with no shell expansion.');
  }
  const timeoutMs = input.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new Error('timeoutMs must be an integer from 100 to 120,000.');
  }
  const paths = validateFiles(input.files);
  if (!Array.isArray(input.canaries) || !input.canaries.length || input.canaries.length > 50) {
    throw new Error('Declare 1 to 50 canaries.');
  }
  const names = new Set();
  const definitions = input.canaries.map(canary => {
    requireFields(canary, ['id','replace','expect'], 'canary');
    if (typeof canary.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(canary.id) || names.has(canary.id)) {
      throw new Error('Canary IDs must be unique lowercase slugs of up to 64 characters.');
    }
    names.add(canary.id);
    if (!object(canary.replace) || !Object.keys(canary.replace).length ||
        Object.keys(canary.replace).some(path => !paths.includes(path))) {
      throw new Error('Canary replacements must name at least one declared workspace file.');
    }
    requireFields(canary.expect, ['exitCode','outputIncludes'], 'expected failure');
    if (!Number.isInteger(canary.expect.exitCode) || canary.expect.exitCode < 1 || canary.expect.exitCode > 125) {
      throw new Error('Every canary needs an expected exit code from 1 to 125.');
    }
    return { id: canary.id, replace: canary.replace,
      expect: { exitCode: canary.expect.exitCode, outputIncludes: evidence(canary.expect.outputIncludes, 'Expected failure') } };
  });
  const root = dirname(manifest);
  const cache = new Map();
  let total = 0;
  async function fixture(source) {
    if (!portablePath(source)) throw new Error('Fixture sources must be portable relative file paths within the plan directory.');
    if (!cache.has(source)) {
      const absolute = await realpath(resolve(root, source));
      const back = relative(root, absolute);
      if (isAbsolute(back) || back === '..' || back.startsWith('..' + sep)) {
        throw new Error('A fixture source resolves outside the plan directory.');
      }
      const bytes = await readBounded(absolute, maxFileBytes);
      total += bytes.length;
      if (total > maxTotalBytes) throw new Error('Fixture contents exceed 8 MiB.');
      cache.set(source, bytes);
    }
    return cache.get(source);
  }
  const files = {};
  for (const path of paths) Object.defineProperty(files, path, {
    value: await fixture(input.files[path]), enumerable: true,
  });
  const canaries = [];
  for (const canary of definitions) {
    const replacements = {};
    for (const [path, source] of Object.entries(canary.replace)) Object.defineProperty(replacements, path, {
      value: await fixture(source), enumerable: true,
    });
    if (Object.entries(replacements).every(([path, bytes]) => bytes.equals(files[path]))) {
      throw new Error('Each canary must change the bytes of at least one workspace file.');
    }
    canaries.push({ id: canary.id, replacements, expect: canary.expect });
  }
  const baselineEvidence = evidence(input.baselineEvidence,'Baseline',false);
  const inputs = { version: 1, command, timeoutMs, baselineEvidence,
    files: Object.entries(files).map(([path, bytes]) => [path, bytes.toString('base64')]),
    canaries: canaries.map(canary=>({ ...canary, replacements: Object.entries(canary.replacements)
      .map(([path,bytes])=>[path,bytes.toString('base64')]) })) };
  const planSha256 = createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
  return { name: input.name, command, timeoutMs, files, canaries, baselineEvidence, planSha256 };
}
