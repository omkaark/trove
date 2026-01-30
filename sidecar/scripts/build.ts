import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, rename, mkdir, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const tauriRoot = join(projectRoot, '..', 'src-tauri');

/**
 * Resolves the Rust target triple for macOS builds.
 */
function getTargetTriple(): string {
  const arch = process.arch;

  if (process.platform !== 'darwin') {
    throw new Error('Sidecar build currently supports macOS only');
  }

  return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
}

async function main() {
  console.log('Building sidecar...');

  // Bundle with esbuild - use CJS format for pkg compatibility
  await build({
    entryPoints: [join(projectRoot, 'src', 'index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: join(projectRoot, 'dist', 'index.cjs'),
  });

  console.log('Bundled with esbuild');

  // Package with pkg
  const targetTriple = getTargetTriple();
  const pkgTarget = process.arch === 'arm64' ? 'node22-macos-arm64' : 'node22-macos-x64';
  const pkgPath = join(projectRoot, 'node_modules', '.bin', 'pkg');
  await exec(pkgPath, ['dist/index.cjs', '--target', pkgTarget, '--output', 'dist/trove-sidecar'], {
    cwd: projectRoot,
  });

  console.log('Packaged with pkg');

  const binariesDir = join(tauriRoot, 'binaries');
  await mkdir(binariesDir, { recursive: true });

  const srcPath = join(projectRoot, 'dist', 'trove-sidecar');
  const destPath = join(binariesDir, `trove-sidecar-${targetTriple}`);

  await moveFileSafe(srcPath, destPath);

  console.log(`Sidecar built: ${destPath}`);
}

/**
 * Moves a file, falling back to copy+unlink for cross-device moves.
 */
async function moveFileSafe(srcPath: string, destPath: string) {
  try {
    await rename(srcPath, destPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code !== 'EXDEV') {
      throw error;
    }
    await copyFile(srcPath, destPath);
    await unlink(srcPath);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
