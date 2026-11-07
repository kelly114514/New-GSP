// 从经整理的界面规格生成运行时菜单，仅保留短命令名与结构。
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const spec=JSON.parse(readFileSync(new URL('../../reference/spec/menus.json',import.meta.url),'utf8'));
const excluded=new Set([36866,36867]);
const clean=items=>items.flatMap(item=>{
  if(item.separator)return [{separator:true}];
  if(excluded.has(item.id)||!item.name)return [];
  if([...item.name].length>16)throw Error(`命令名超过限制: ${item.id}`);
  return [{id:item.id,name:item.name,...(item.access_key?{access:item.access_key}:{}),...(item.shortcut?{shortcut:item.shortcut}:{}),...(item.children?{children:clean(item.children)}:{})}];
});
const menus=spec.menus.filter(menu=>menu.name!=='帮助').map(menu=>({name:menu.name,items:clean(menu.items)}));
menus.push({name:'帮助',items:[{id:-1,name:'关于新版…',access:'A'}]});
writeFileSync(fileURLToPath(new URL('../src/menu-spec.json',import.meta.url)),JSON.stringify(menus,null,2)+'\n');
