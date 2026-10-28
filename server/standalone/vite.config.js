import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { resolveAllowedHosts } from '../../build/allowedHosts.js';
import { createBrowserViteConfig } from '../../build/vite.js';
import { localProviderPlugins } from '../providers/local.js';
import { localMcpPlugin } from '../mcp/plugin.js';
import { apiNotFoundPlugin } from './api-not-found.js';
import { googleTokenUnavailablePlugin } from './google-token-unavailable.js';
import { standaloneVoiceTools } from './voiceTools.js';
import { unwatchedRuntimeDirsPlugin } from './unwatched-cache.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Merge the checkout's dotenv files into `process.env`, the file value
 * winning over an EMPTY environment variable.
 *
 * Why an empty variable must not win: a deployment that exports
 * `CESIUM_ION_TOKEN=""` (a compose `environment:` entry, a CI default, a
 * shell that names a variable with nothing after it) would otherwise SHADOW
 * the real value the same key has in the mounted `.env` file — the file is
 * only consulted when the variable is undefined, and "" IS defined. The app
 * then bakes an empty token into the browser bundle and the globe never
 * renders, even though the secret is right there on disk.
 *
 * A deliberately CLEARED key still stays empty: the POWER UP panel removes a
 * key by commenting its assignment out of the file (`upsertDotenvValues`
 * with a `null` value), so the file no longer defines that name at all and
 * this merge has nothing to adopt — the empty variable survives untouched.
 *
 * @param {Record<string, string>} loaded The dotenv values (`loadEnv` output).
 * @param {Record<string, string|undefined>} env The environment to merge into.
 * @returns {Record<string, string|undefined>} The same environment object.
 */
export function mergeDotenvIntoEnv(loaded, env = process.env) {
  for (const [key, value] of Object.entries(loaded)) {
    const current = env[key];
    // Undefined OR empty/whitespace-only: the file is the better answer.
    if (current === undefined || String(current).trim() === '')
      env[key] = value;
  }
  return env;
}

/** Load this checkout's configuration and attach its local provider middleware. */
export default defineConfig(({ command, mode }) => {
  const loaded = loadEnv(mode, root, '');
  mergeDotenvIntoEnv(loaded, process.env);
  const tools = standaloneVoiceTools();
  return createBrowserViteConfig({
    plugins: [
      ...localProviderPlugins({ realtime: { tools }, gemini: { tools } }),
      localMcpPlugin(),
      googleTokenUnavailablePlugin(),
      apiNotFoundPlugin(),
      unwatchedRuntimeDirsPlugin(),
    ],
    googleApiKey: process.env.GOOGLE_MAPS_API_KEY,
    cesiumToken: process.env.CESIUM_ION_TOKEN,
    mapillaryToken: process.env.MAPILLARY_CLIENT_TOKEN,
    host: process.env.HOST,
    port: process.env.PORT,
    allowedHosts: resolveAllowedHosts(process.env.GEV_ALLOWED_HOSTS),
    command,
  });
});
