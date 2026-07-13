import { spawn as nodeSpawn } from "node:child_process";
import { chmod, lstat, mkdir } from "node:fs/promises";
import { homedir, platform as hostPlatform } from "node:os";
import { join } from "node:path";
import { CdpClient, discoverChatGptTarget } from "./cdp.js";

export interface BrowserLaunchResult { readonly ok: true; readonly status: "already_ready" | "started"; readonly endpoint: "http://127.0.0.1:9223"; }
type Spawned = { readonly once: (event: "error", listener: (error: Error) => void) => unknown; };
type Spawn = (command: string, args: readonly string[]) => Spawned;

const endpoint = "http://127.0.0.1:9223" as const;
const chatGptUrl = "https://chatgpt.com/";

export async function startBrowser(options: { readonly platform?: NodeJS.Platform; readonly home?: string; readonly fetch?: typeof globalThis.fetch; readonly spawn?: Spawn; readonly sleep?: (milliseconds: number) => Promise<void>; readonly endpointReady?: () => Promise<boolean>; readonly appReady?: () => Promise<boolean>; } = {}): Promise<BrowserLaunchResult> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const endpointReady = options.endpointReady ?? (() => endpointIsReady(fetcher));
  const appReady = options.appReady ?? (() => ready(fetcher));
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  if (await endpointReady()) {
    if (await waitForApp(appReady, sleep)) return { ok: true, status: "already_ready", endpoint };
    throw new Error("既存ChromeのChatGPT appがreadyになりません");
  }
  const current = options.platform ?? hostPlatform();
  if (current !== "darwin") throw new Error("browser startはmacOS以外を未対応として拒否します");
  const profile = join(options.home ?? homedir(), ".gpt-connector", "browser-profile");
  await ensurePrivateProfile(profile);
  const args = ["-na", "Google Chrome", "--args", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=9223", `--user-data-dir=${profile}`, "--window-position=-32000,-32000", "--no-first-run", "--no-default-browser-check", chatGptUrl];
  const spawn = options.spawn ?? ((command, values) => nodeSpawn(command, values, { detached: true, stdio: "ignore" }));
  const child = spawn("open", args);
  await spawnError(child);
  if (await waitForApp(appReady, sleep)) return { ok: true, status: "started", endpoint };
  throw new Error("browser start後にChatGPT appがreadyになりません");
}

async function waitForApp(appReady: () => Promise<boolean>, sleep: (milliseconds: number) => Promise<void>): Promise<boolean> { for (let attempt = 0; attempt < 25; attempt += 1) { if (await appReady()) return true; await sleep(200); } return false; }
async function endpointIsReady(fetcher: typeof globalThis.fetch): Promise<boolean> { try { const response = await fetcher(`${endpoint}/json/version`, { signal: AbortSignal.timeout(500) }); return response.ok; } catch { return false; } }
async function ready(fetcher: typeof globalThis.fetch): Promise<boolean> { try { const response = await fetcher(`${endpoint}/json/version`, { signal: AbortSignal.timeout(500) }); if (!response.ok) return false; const target = await discoverChatGptTarget(endpoint, fetcher); const client = await CdpClient.connect(target.webSocketDebuggerUrl, 500); try { const result = await client.call<{ result?: { value?: unknown } }>("Runtime.evaluate", { expression: "document.readyState === 'complete'", returnByValue: true }, 500); return result.result?.value === true; } finally { client.close(); } } catch { return false; } }
async function spawnError(child: Spawned): Promise<void> { await new Promise<void>((resolve, reject) => { child.once("error", reject); setTimeout(resolve, 0); }); }
async function ensurePrivateProfile(profile: string): Promise<void> { try { const info = await lstat(profile); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("browser profile pathが不正です"); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await mkdir(profile, { recursive: true, mode: 0o700 }); } await chmod(profile, 0o700); }
