import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Resolve a runtime dependency without hardcoding anyone's home directory.
 *
 * The plugin normally lives inside a DSH profile
 * (`<home>/.dsh/profiles/<name>/node_modules/dsh-model-manager`), where its
 * dependencies sit next to it. Order: an explicit override, normal resolution
 * from the repo, then the usual DSH profile layouts.
 */
export function resolveDep(spec) {
  const attempts = [];
  if (process.env.DSH_DEP_MODULES) attempts.push(join(process.env.DSH_DEP_MODULES, 'package.json'));
  attempts.push(new URL('../package.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const home = homedir();
  for (const profile of ['desktop', 'web', 'cli']) {
    attempts.push(join(home, '.dsh', 'profiles', profile, 'node_modules', 'dsh-model-manager', 'package.json'));
  }
  attempts.push(join(home, '.dsh', 'profiles', 'node_modules', 'dsh-model-manager', 'package.json'));
  const tried = [];
  for (const base of attempts) {
    if (!existsSync(base)) continue;
    tried.push(base);
    try {
      return createRequire(base).resolve(spec);
    } catch {
      // try the next layout
    }
  }
  throw new Error(`Cannot resolve ${spec}; set DSH_DEP_MODULES to a node_modules directory (tried: ${tried.join(', ') || 'nothing'})`);
}
