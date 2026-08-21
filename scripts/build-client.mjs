import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

import { build } from 'esbuild';

const packageId = 'dsh-plugin-web-notify';
const outputPath = new URL('../client.js', import.meta.url);
const check = process.argv.includes('--check');

const result = await build({
  entryPoints: [new URL('../client/index.ts', import.meta.url).pathname],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  write: false,
});

const bundled = result.outputFiles[0].text.trimEnd();
const output = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(packageId)},
  factory: () => {
    const module = { exports: {} };
    const exports = module.exports;
${bundled.split('\n').map((line) => line === '' ? '' : `    ${line}`).join('\n')}
    return module.exports;
  },
});
`;

if (check) {
  let current;
  try {
    current = await readFile(outputPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (current !== output) {
    console.error('client.js is stale; run pnpm build:client');
    process.exitCode = 1;
  }
} else {
  await writeFile(outputPath, output);
}
