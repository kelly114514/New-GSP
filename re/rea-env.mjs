import fs from 'node:fs';
import path from 'node:path';

// Locates REA and the untracked Ghidra/JDK toolchain (re/tools, see
// re/toolchain.md). GSP_ANALYSIS_TOOLS and REA_SCRIPT override discovery.
export const workspace = decodeURIComponent(path.dirname(path.dirname(
  new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))));

function toolsDir() {
  const candidates = [process.env.GSP_ANALYSIS_TOOLS, path.join(workspace, 're', 'tools')].filter(Boolean);
  const found = candidates.find(dir => fs.existsSync(path.join(dir, 'ghidra')));
  if (!found) throw new Error(`Ghidra/JDK toolchain not found; tried ${candidates.join(', ')}. See re/toolchain.md.`);
  return found;
}

export function reaLaunch() {
  const tools = toolsDir();
  const script = process.env.REA_SCRIPT ?? 'C:\\tools\\rea\\runtime\\node_modules\\rea-agents\\scripts\\rea.mjs';
  const env = {
    GHIDRA_INSTALL_DIR: path.join(tools, 'ghidra', 'ghidra_12.1.4_PUBLIC'),
    JAVA_HOME: path.join(tools, 'jdk', 'jdk-21.0.12.1+1'),
    REA_ANALYSIS_PROVIDER: 'ghidra',
    REA_GHIDRA_STARTUP_TIMEOUT_MS: '600000',
  };
  for (const [name, file] of [['REA', script], ['Ghidra', env.GHIDRA_INSTALL_DIR], ['JDK', env.JAVA_HOME]])
    if (!fs.existsSync(file)) throw new Error(`${name} not found: ${file}. See re/toolchain.md.`);
  return {command: process.execPath, args: [script, 'mcp'], env: {...process.env, ...env}};
}

export const target = path.join(workspace, 're', 'unpacked', 'GSP5chs.exe');
