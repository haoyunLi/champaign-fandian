import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the real API and SQL using SQLite, replacing only the Workers binding.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { shortCircuit: true, url: 'data:text/javascript,export const env = { get DB() { return globalThis.__fandianTestDB; }, get BUCKET() { return globalThis.__fandianTestBucket; } };' };
    if (specifier==='next/headers'||specifier==='next/navigation') return next(`${specifier}.js`,context);
    if (specifier.startsWith('@/')) return { shortCircuit: true, url: new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.ts')) return {
      shortCircuit: true, format: 'module', source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText,
    };
    return next(url, context);
  },
});
