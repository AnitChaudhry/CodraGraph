/**
 * `codragraph config` CLI subcommands — manage the unified
 * `~/.codragraph/config.json`. The file is shared by:
 *   - the codragraph CLI (wiki, semantic ops)
 *   - the codragraph-harness inference providers
 *   - the web settings panel (writes via /api/config)
 *
 * Subcommands:
 *   codragraph config list                          show configured providers
 *   codragraph config get <provider>                show one provider's settings (key redacted)
 *   codragraph config set <provider> --api-key <K>  store a key
 *   codragraph config set <provider> --base-url <U> --model <M>
 *   codragraph config remove <provider>             clear one provider
 *   codragraph config path                          print the config-file path
 */

import {
  getGlobalConfigPath,
  getProviderConfig,
  listProviderConfigs,
  loadCLIConfig,
  removeProviderConfig,
  setProviderConfig,
  type ProviderConfig,
  type ProviderName,
} from '../storage/repo-manager.js';

const VALID_PROVIDERS: ProviderName[] = [
  'claude',
  'openai',
  'opencode',
  'openrouter',
  'azure',
  'cursor',
  'custom',
];

const validateProvider = (raw: string): ProviderName => {
  if (!VALID_PROVIDERS.includes(raw as ProviderName)) {
    throw new Error(
      `Unknown provider "${raw}". Valid: ${VALID_PROVIDERS.join(', ')}`,
    );
  }
  return raw as ProviderName;
};

const redactKey = (key: string | undefined): string => {
  if (!key) return '(unset)';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
};

export const configListCommand = async (): Promise<void> => {
  const entries = await listProviderConfigs();
  if (entries.length === 0) {
    console.log(`(no providers configured — set one with: codragraph config set <provider> --api-key <KEY>)`);
    console.log(`config file: ${getGlobalConfigPath()}`);
    return;
  }
  console.log('provider'.padEnd(12), 'apiKey'.padEnd(8), 'model'.padEnd(28), 'baseUrl');
  for (const e of entries) {
    console.log(
      e.name.padEnd(12),
      (e.hasKey ? 'set' : '(unset)').padEnd(8),
      (e.model ?? '—').padEnd(28),
      e.baseUrl ?? '—',
    );
  }
  console.log('');
  console.log(`config file: ${getGlobalConfigPath()}`);
};

export const configGetCommand = async (provider: string): Promise<void> => {
  const name = validateProvider(provider);
  const config = await loadCLIConfig();
  const cfg = getProviderConfig(config, name);
  if (!cfg) {
    console.log(`(${name}: not configured)`);
    return;
  }
  console.log(`${name}:`);
  console.log(`  apiKey:  ${redactKey(cfg.apiKey)}`);
  if (cfg.model) console.log(`  model:   ${cfg.model}`);
  if (cfg.baseUrl) console.log(`  baseUrl: ${cfg.baseUrl}`);
  if (cfg.apiVersion) console.log(`  apiVersion: ${cfg.apiVersion}`);
  if (cfg.isReasoningModel !== undefined)
    console.log(`  isReasoningModel: ${cfg.isReasoningModel}`);
};

export interface ConfigSetOpts {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  apiVersion?: string;
  reasoningModel?: boolean;
}

export const configSetCommand = async (
  provider: string,
  opts: ConfigSetOpts,
): Promise<void> => {
  const name = validateProvider(provider);
  const patch: Partial<ProviderConfig> = {};
  if (opts.apiKey !== undefined) patch.apiKey = opts.apiKey;
  if (opts.baseUrl !== undefined) patch.baseUrl = opts.baseUrl;
  if (opts.model !== undefined) patch.model = opts.model;
  if (opts.apiVersion !== undefined) patch.apiVersion = opts.apiVersion;
  if (opts.reasoningModel !== undefined) patch.isReasoningModel = opts.reasoningModel;
  if (Object.keys(patch).length === 0) {
    console.error(
      'Nothing to set. Pass at least one of: --api-key, --base-url, --model, --api-version, --reasoning-model',
    );
    process.exitCode = 1;
    return;
  }
  await setProviderConfig(name, patch);
  console.log(`✓ ${name} updated`);
  if (patch.apiKey) console.log(`  apiKey:  ${redactKey(patch.apiKey)}`);
  if (patch.model) console.log(`  model:   ${patch.model}`);
  if (patch.baseUrl) console.log(`  baseUrl: ${patch.baseUrl}`);
};

export const configRemoveCommand = async (provider: string): Promise<void> => {
  const name = validateProvider(provider);
  await removeProviderConfig(name);
  console.log(`✓ ${name} cleared from ${getGlobalConfigPath()}`);
};

export const configPathCommand = async (): Promise<void> => {
  console.log(getGlobalConfigPath());
};
