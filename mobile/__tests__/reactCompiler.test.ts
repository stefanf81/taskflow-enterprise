import fs from 'fs';
import path from 'path';
import { transformSync } from '@babel/core';

/**
 * React Compiler (app.json `experiments.reactCompiler`) memoises components at build time, but it
 * silently skips every function it cannot prove follows the Rules of React. A ref read or written
 * during render once made it skip BookingScreen and HomeScreen, the two largest screens, with no
 * warning anywhere (BENCHMARKS.md §61). This compiles every source file with the compiler's
 * logger and fails on any function it gave up on.
 */

const root = path.resolve(__dirname, '..');
// The compiler and the TypeScript syntax plugin Metro uses come with babel-preset-expo.
const presetDir = path.dirname(require.resolve('babel-preset-expo/package.json'));
const fromPreset = (id: string) => require.resolve(id, { paths: [presetDir] });

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [file] : [];
  });
}

interface CompilerEvent {
  kind: string;
  fnLoc?: { start?: { line?: number } } | null;
  detail?: { reason?: string; options?: { reason?: string } };
}

describe('React Compiler coverage', () => {
  it('compiles every component and hook in src/ without bailing out', () => {
    const files = [...sourceFiles(path.join(root, 'src')), path.join(root, 'App.tsx')];
    const failures: string[] = [];
    let compiled = 0;

    for (const file of files) {
      transformSync(fs.readFileSync(file, 'utf8'), {
        filename: file,
        babelrc: false,
        configFile: false,
        plugins: [
          [fromPreset('@babel/plugin-syntax-typescript'), { isTSX: file.endsWith('.tsx') }],
          [
            fromPreset('babel-plugin-react-compiler'),
            {
              target: '19',
              panicThreshold: 'none',
              logger: {
                logEvent(_filename: string | null, event: CompilerEvent) {
                  if (event.kind === 'CompileSuccess') compiled += 1;
                  if (event.kind === 'CompileError') {
                    const reason = event.detail?.reason ?? event.detail?.options?.reason;
                    const line = event.fnLoc?.start?.line ?? '?';
                    failures.push(`${path.relative(root, file)}:${line} ${reason ?? event.kind}`);
                  }
                },
              },
            },
          ],
        ],
      });
    }

    expect(failures).toEqual([]);
    // Guards the check itself: a misconfigured plugin would compile nothing and report nothing.
    expect(compiled).toBeGreaterThan(40);
  }, 60000);
});
