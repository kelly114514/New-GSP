import {spawn} from 'node:child_process';
import {reaLaunch} from './rea-env.mjs';

// stdio MCP entry for Claude Code (.mcp.json): REA with process-local Ghidra/JDK.
// No client, user or system configuration is changed.
let launch;
try {
  launch = reaLaunch();
} catch (e) {
  process.stderr.write(String(e) + '\n');
  process.exit(1);
}
const child = spawn(launch.command, launch.args, {env: launch.env, stdio: 'inherit', windowsHide: true});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
