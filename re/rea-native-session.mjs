import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {reaLaunch,target,workspace} from './rea-env.mjs';

// A private REA MCP connection with process-local dependencies. No client or
// system configuration is changed and no target executable is launched.
const option=(name)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
// The queue loop exits after this many minutes without a new queue entry.
const idleMs=Number(option('--idle-minutes')??20)*60000;
const out = option('--out') ? path.resolve(workspace,option('--out')) : path.join(workspace, 're', 'sessions', 'default');
const inputSnapshot = option('--resume') ? path.resolve(workspace,option('--resume')) : undefined;
fs.mkdirSync(out, {recursive:true});
const queue = path.join(out,'queue.jsonl');
const exportOnly = process.argv.includes('--export-snapshot');
if (!fs.existsSync(queue)) fs.writeFileSync(queue,'');
const launch=reaLaunch();
const child = spawn(launch.command, launch.args, {
  cwd:workspace, windowsHide:true, stdio:['pipe','pipe','pipe'], env:launch.env
});
child.stderr.pipe(fs.createWriteStream(path.join(out,'server-stderr.log'),{flags:'a'}));
let seq=0;
const pending = new Map();
readline.createInterface({input:child.stdout}).on('line', line=>{
  let obj; try {obj=JSON.parse(line)} catch {fs.appendFileSync(path.join(out,'non-json.log'),line+'\n');return;}
  if (obj.id!==undefined && pending.has(obj.id)) {
    const p=pending.get(obj.id);pending.delete(obj.id);clearTimeout(p.timer);
    if(obj.error)p.reject(new Error(JSON.stringify(obj.error)));else p.resolve(obj.result);
  }
});
child.on('exit',(code,signal)=>{
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error(`REA exited ${code}/${signal}`));}
  pending.clear();
});
function rpc(method,params) {
  const id=++seq;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('REA request timeout'));},660000);
    pending.set(id,{resolve,reject,timer});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
}
async function call(id,name,args) {
  console.log(`START ${id} ${name}`);
  const r=await rpc('tools/call',{name,arguments:args});
  fs.writeFileSync(path.join(out,id+'.json'),JSON.stringify(r,null,2));
  console.log(`DONE ${id} error=${Boolean(r.isError)}`);
  return r;
}
try {
  fs.writeFileSync(path.join(out,'initialize.json'),JSON.stringify(await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'sketchpad-investigation',version:'1.0'}}),null,2));
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const catalog=await rpc('tools/list',{});
  fs.writeFileSync(path.join(out,'tool-catalog.json'),JSON.stringify(catalog,null,2));
  await call('session-before','binary_session',{});
  const openArgs={path:target,provider_id:'ghidra'};
  if(inputSnapshot)openArgs.snapshot_path=inputSnapshot;
  else if(exportOnly)openArgs.snapshot_path=path.join(out,'snapshot.json');
  const opened=await call(exportOnly?'open-restored':'open','open_binary',openArgs);
  if(opened.isError)throw new Error('REA could not open/restore target; see retained open reply.');
  if(exportOnly){
    await call('export-restored','export_evidence_bundle',{path:path.join(out,'evidence-bundle.json'),overwrite:true});
    await call('close-restored','close_binary',{});
  } else {
  if(!process.argv.includes('--skip-seeds')) {
  const overview=await call('overview','binary_overview',{});
  if (!overview.isError) {
    await call('gsp4-strings','search_strings',{pattern:'GSP4'});
    await call('procedures-seeds','search_procedures',{pattern:'WinMain|entry|CArchive|ReadFile|WriteFile|CreateFile|fread|fwrite',mode:'regex'});
    await call('entry','procedure_pseudo_code',{procedure:'0x005edda0'});
  }
  }
  console.log('READY for queue');
  const seen=new Set();
  let stop=false;
  let idleDeadline=Date.now()+idleMs;
  while(!stop && Date.now()<idleDeadline) {
    const lines=fs.readFileSync(queue,'utf8').split(/\r?\n/).filter(Boolean);
    for(const line of lines){
      const job=JSON.parse(line);if(seen.has(job.id))continue;seen.add(job.id);
      idleDeadline=Date.now()+idleMs;
      // A reused session directory never repeats a query whose result exists.
      if(!job.stop&&fs.existsSync(path.join(out,job.id+'.json'))){console.log(`SKIP ${job.id} (result exists)`);continue;}
      if(job.stop){stop=true;break;}
      try{await call(job.id,job.name,job.args||{});}catch(e){fs.writeFileSync(path.join(out,job.id+'.error.txt'),String(e));console.error(job.id,String(e));}
    }
    if(!stop)await new Promise(r=>setTimeout(r,250));
  }
  await call('export','export_evidence_bundle',{path:path.join(out,'evidence-bundle.json'),overwrite:true});
  await call('close','close_binary',{snapshot_path:path.join(out,'snapshot.json'),overwrite:true});
  }
} catch(e) {
  fs.writeFileSync(path.join(out,'fatal.txt'),String(e));console.error(e);
} finally {child.stdin.end();}
