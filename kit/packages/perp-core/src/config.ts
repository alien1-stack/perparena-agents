/**
 * @license
 * Copyright DreamDEX S.A.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://github.com/somnia-chain/dreamdex-bot-kit/blob/main/LICENSE
 */

// Config for the perp strategies. Endpoints and the signer come from .env; the
// per-market addresses (pool, MarginBank, stop registry) are read off the market
// row at runtime and are never configured, because a market can be re-pointed at
// a new pool without its symbol changing.
//
// NETWORK selects the deployment, the same variable the spot and EC families
// already read. Perps run on `hideki` (the Tokyo testnet, where the app's testnet
// accounts and Perps Arena live) and `testnet` (Shannon); `hideki` is the
// default. `mainnet` is accepted and picks the SDK's mainnet address preset, but
// it only starts once that preset (or PERP_ADDRESSES_JSON) names the perp
// singletons. Until dreamDEX publishes them it fails fast at startup, rather
// than connecting and trading against an empty market list.
//
// OWNER_ADDRESS turns on trading-key mode: PRIVATE_KEY is then a bot key linked
// to that DreamDEX account in the app (wallet → Link a bot → Perps), and every
// order the bot sends belongs to the account, not to the key. Leave it blank to
// trade the key's own MarginBank account.

import { defineChain, isAddress, getAddress, zeroAddress, type Chain } from "viem";
import {
  SOMNIA_MAINNET_ADDRESSES,
  SOMNIA_TESTNET_ADDRESSES,
  type SomniaMarketsAddresses,
} from "@somnia-chain/markets-sdk";
import { config as dotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export type Network = "hideki" | "testnet" | "mainnet";

let envLoaded = false;
/** Load the nearest .env walking up from `startDir`, so a strategy in
 *  strategies/<name> picks up the repo-root .env. Existing vars win. */
export function loadEnv(startDir = process.cwd()): void {
  if (envLoaded) return;
  envLoaded = true;
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return void dotenv({ path: candidate });
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dotenv();
}

/**
 * A numeric env var, or the fallback, never NaN.
 *
 * `Number(process.env.PERP_LEVERAG)` on a typo is NaN, and NaN flows straight
 * into a size or a cap and disables it without a word.
 */
export function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${name}="${raw}" is not a number. Unset it to use the default (${fallback}).`);
  }
  return n;
}

/** A boolean env var. Anything but "false"/"0" reads as true when set. */
export function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw !== "false" && raw !== "0";
}

/**
 * The OperatorPermissionsRegistry, which arming a stop order needs.
 *
 * It is NOT in the SDK's bundled address sets (neither SOMNIA_TESTNET_ADDRESSES
 * nor the mainnet one carries the key), so `placePerpStopOrder` throws
 * `NotConfiguredError` unless it is passed explicitly. Overridable from .env for
 * the redeploy case.
 */
const OPERATOR_REGISTRY: Record<Network, `0x${string}`> = {
  hideki: "0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a",
  testnet: "0x15C7e8CE38F021c5b45d098AaD788f63090bF20A",
  // No perp deployment on mainnet yet. Supply it with
  // OPERATOR_PERMISSIONS_REGISTRY or PERP_ADDRESSES_JSON.operatorPermissionsRegistry
  // once published; only stop orders need it.
  mainnet: "0x0000000000000000000000000000000000000000",
};

const ENDPOINTS: Record<Network, { rpc: string; ws: string; indexer: string; chainId: number }> = {
  hideki: {
    rpc: "https://api.hideki2.infra.testnet.somnia.network",
    ws: "wss://api.hideki2.infra.testnet.somnia.network/ws",
    indexer: "https://hideki-dev.smk.somnia.host/v1/graphql",
    chainId: 50383,
  },
  testnet: {
    rpc: "https://api.infra.testnet.somnia.network",
    ws: "wss://api.infra.testnet.somnia.network/ws",
    indexer: "https://dev.smk.somnia.host/v1/graphql",
    chainId: 50312,
  },
  mainnet: {
    rpc: "https://api.infra.mainnet.somnia.network",
    ws: "wss://api.infra.mainnet.somnia.network/ws",
    indexer: "https://prd.smk.somnia.host/v1/graphql",
    chainId: 5031,
  },
};

export interface PerpConfig {
  network: Network;
  chainId: number;
  rpcUrl: string;
  wsRpcUrl: string;
  indexerUrl: string;
  /** Registry that authorises the stop registry to place on the owner's behalf. */
  operatorRegistry: `0x${string}`;
  /**
   * The SDK address set for this network: the bundled preset, with any
   * PERP_ADDRESSES_JSON entries laid over it. On hideki/testnet with no override
   * this is exactly SOMNIA_TESTNET_ADDRESSES, as before.
   */
  addresses: PerpAddresses;
  /** The market to trade, app-canonical `BASE-PERP`. Blank means every market
   *  the account holds a position in, which only perp-guard uses. */
  symbol: string;
  /** Signer for writes; undefined = read-only. */
  privateKey?: `0x${string}`;
  /**
   * Trading-key mode: the DreamDEX account this key trades for. Orders, margin
   * and positions are the account's; the key only signs and pays gas.
   * Undefined = the key trades its own account.
   */
  owner?: `0x${string}`;
  /** When true, strategies log intended orders instead of sending them. */
  dryRun: boolean;
}

/** The networks a perp bot can run on, in the order the error lists them. */
const PERP_NETWORKS: readonly Network[] = ["hideki", "testnet", "mainnet"];

/**
 * The perp singletons of a deployment. `perpPoolFactory` is the one the SDK
 * reads (`addresses.perpPoolFactory`): with it, `loadMarkets()` finds the perp
 * pools on-chain even when the indexer has no perp rows, which is mainnet today.
 * `marginBank` and `priceFeedScheduler` are not SDK config keys (each market row
 * carries its own MarginBank), but they are accepted, validated and kept on
 * `config.addresses` so a published deployment can be passed in one piece.
 */
export const PERP_SINGLETONS = ["marginBank", "perpPoolFactory", "priceFeedScheduler"] as const;
export type PerpSingleton = (typeof PERP_SINGLETONS)[number];

/** The SDK's address set plus the perp singletons it does not model. */
export type PerpAddresses = SomniaMarketsAddresses & Partial<Record<PerpSingleton, `0x${string}`>>;

/**
 * The SDK address preset per network. Hideki uses the testnet set: the
 * singletons the SDK looks up sit at the same deterministic addresses there, and
 * the perp pool, MarginBank and stop registry come off each market row.
 */
const ADDRESS_PRESETS: Record<Network, SomniaMarketsAddresses> = {
  hideki: SOMNIA_TESTNET_ADDRESSES,
  testnet: SOMNIA_TESTNET_ADDRESSES,
  mainnet: SOMNIA_MAINNET_ADDRESSES,
};

/** The startup error for NETWORK=mainnet before the perp addresses exist. */
export const MAINNET_PERPS_NOT_LIVE =
  "dreamDEX perps are not live on mainnet yet: set PERP_ADDRESSES_JSON or upgrade @somnia-chain/markets-sdk";

const isSet = (a: unknown): a is `0x${string}` => typeof a === "string" && isAddress(a) && a !== zeroAddress;

/**
 * Parse PERP_ADDRESSES_JSON: a JSON object of address keys laid over the
 * network's preset, e.g.
 *
 *   PERP_ADDRESSES_JSON='{"perpPoolFactory":"0x…","marginBank":"0x…","priceFeedScheduler":"0x…"}'
 *
 * Accepted keys are the perp singletons, `operatorPermissionsRegistry`, and any
 * address key of the SDK presets. An unknown key, or a value that is not an
 * address, is an error rather than silently ignored: a typo here would
 * otherwise fall back to the preset and look configured.
 */
export function parsePerpAddressesJson(raw: string | undefined): Partial<PerpAddresses> {
  if (raw === undefined || raw.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`PERP_ADDRESSES_JSON is not valid JSON (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error('PERP_ADDRESSES_JSON must be a JSON object, e.g. {"perpPoolFactory":"0x…","marginBank":"0x…"}.');
  }
  const allowed = new Set<string>([
    ...PERP_SINGLETONS,
    "operatorPermissionsRegistry",
    ...[SOMNIA_TESTNET_ADDRESSES, SOMNIA_MAINNET_ADDRESSES].flatMap((p) =>
      Object.entries(p)
        .filter(([, v]) => typeof v === "string")
        .map(([k]) => k),
    ),
  ]);
  const out: Record<string, `0x${string}`> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!allowed.has(key)) {
      throw new Error(`PERP_ADDRESSES_JSON: unknown key "${key}". Known keys: ${[...allowed].sort().join(", ")}.`);
    }
    if (typeof value !== "string" || !isAddress(value)) {
      throw new Error(`PERP_ADDRESSES_JSON: ${key}=${JSON.stringify(value)} is not an address.`);
    }
    out[key] = getAddress(value);
  }
  return out as Partial<PerpAddresses>;
}

/**
 * The address set for `network`: the SDK preset, with PERP_ADDRESSES_JSON laid
 * over it.
 *
 * On mainnet this is the readiness gate. If neither the preset nor the override
 * names a `perpPoolFactory`, there is no way to find a perp pool (the mainnet
 * indexer has no perp rows either), so a run would connect, find nothing, and
 * sit there looking healthy. It throws instead, before any connection is made.
 * Testnets are not gated: their perp markets are on the indexer.
 */
export function resolvePerpAddresses(network: Network, overrideRaw = process.env.PERP_ADDRESSES_JSON): PerpAddresses {
  const preset = ADDRESS_PRESETS[network];
  const override = parsePerpAddressesJson(overrideRaw);
  // No override: hand back the preset object itself, so hideki/testnet runs are
  // byte-for-byte what they were before this switch existed.
  const merged: PerpAddresses = Object.keys(override).length ? { ...preset, ...override } : preset;
  if (network === "mainnet" && !isSet(merged.perpPoolFactory)) {
    const missing = PERP_SINGLETONS.filter((k) => !isSet(merged[k]));
    throw new Error(
      `${MAINNET_PERPS_NOT_LIVE}\n` +
        `  SOMNIA_MAINNET_ADDRESSES in the installed SDK has no ${missing.join(", ")}, and PERP_ADDRESSES_JSON ` +
        `${Object.keys(override).length ? "does not supply perpPoolFactory" : "is unset"}.\n` +
        `  Once dreamDEX publishes the mainnet perp deployment: ` +
        `PERP_ADDRESSES_JSON='{"perpPoolFactory":"0x…","marginBank":"0x…","priceFeedScheduler":"0x…"}'`,
    );
  }
  return merged;
}

/**
 * Read and validate the environment.
 *
 * `NETWORK=mainnet` goes through {@link resolvePerpAddresses}, which refuses to
 * start until the perp singletons are known: from the SDK's mainnet preset once
 * a release carries them, or from PERP_ADDRESSES_JSON before that.
 */
export function loadConfig(): PerpConfig {
  loadEnv();
  const raw = (process.env.NETWORK ?? "hideki").trim().toLowerCase();
  if (!PERP_NETWORKS.includes(raw as Network)) {
    throw new Error(
      `NETWORK="${raw}" is not a perp network. Use NETWORK=hideki (Perps Arena), NETWORK=testnet (Shannon) or NETWORK=mainnet.`,
    );
  }
  const network = raw as Network;
  const addresses = resolvePerpAddresses(network);
  const ep = ENDPOINTS[network];
  const pk = (process.env.PRIVATE_KEY ?? "").trim();
  const registry = (process.env.OPERATOR_PERMISSIONS_REGISTRY ?? "").trim();
  const ownerRaw = (process.env.OWNER_ADDRESS ?? "").trim();
  if (ownerRaw && !isAddress(ownerRaw)) {
    throw new Error(
      `OWNER_ADDRESS="${ownerRaw}" is not an address. It should be your DreamDEX account (0x followed by 40 hex characters), ` +
        "or blank to trade this key's own account.",
    );
  }

  return {
    network,
    chainId: Math.trunc(envNum("CHAIN_ID", ep.chainId)),
    rpcUrl: process.env.RPC_URL ?? ep.rpc,
    wsRpcUrl: process.env.WS_RPC_URL ?? ep.ws,
    indexerUrl: process.env.INDEXER_URL ?? ep.indexer,
    // .env wins, then an address set that carries one (PERP_ADDRESSES_JSON, or a
    // future SDK preset), then the table above. Today's presets carry none, so
    // hideki/testnet resolve exactly as before.
    operatorRegistry: (registry ||
      (isSet(addresses.operatorPermissionsRegistry) ? addresses.operatorPermissionsRegistry : OPERATOR_REGISTRY[network])) as `0x${string}`,
    addresses,
    symbol: (process.env.PERP_SYMBOL ?? "").trim(),
    privateKey: pk ? (pk as `0x${string}`) : undefined,
    owner: ownerRaw ? getAddress(ownerRaw) : undefined,
    dryRun: envBool("DRY_RUN", true),
  };
}

/** The viem chain for this config. */
export function makeChain(cfg: PerpConfig): Chain {
  return defineChain({
    id: cfg.chainId,
    name: `somnia-${cfg.chainId}`,
    nativeCurrency:
      cfg.chainId === 5031
        ? { name: "Somnia", symbol: "SOMI", decimals: 18 }
        : { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl], webSocket: [cfg.wsRpcUrl] } },
  });
}
