/**
 * Session-scoped runtime: owns the LanguageManager singleton for the current
 * cwd and the resolved config. Rebuilt on session_start (new cwd) and torn
 * down on session_shutdown.
 */

import { loadConfig, type LSServerConfig } from "./config.ts";
import { LanguageManager } from "./lsp/manager.ts";

let manager: LanguageManager | null = null;
let servers: Record<string, LSServerConfig> = {};
let extraPaths: string[] = [];

// silence server logs unless explicitly re-enabled
const debugLog = (_msg: string): void => {};

/** Reset for a new session/cwd; disposes any old servers. */
export function initRuntime(cwd: string): LanguageManager {
	manager?.dispose();
	manager = null;
	const cfg = loadConfig();
	servers = cfg.servers;
	extraPaths = cfg.extraPaths;
	manager = new LanguageManager(cwd, servers, extraPaths, debugLog);
	return manager;
}

export function getManager(cwd: string): LanguageManager {
	if (!manager) return initRuntime(cwd);
	return manager;
}

export function getServers(): Record<string, LSServerConfig> {
	return servers;
}
