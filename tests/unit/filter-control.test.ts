import { afterEach, expect, it, vi } from 'vitest';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';
const source = buildSync({entryPoints:['webview/src/components/FilterControl.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react-dom','react/jsx-runtime']}).outputFiles[0].text;
afterEach(()=>vi.unstubAllGlobals());
it('synchronizes text and menu, clears all, and dismisses only on outside interaction', () => {
  const state:any[]=[]; let cursor=0; const pending:Array<()=>void>=[], cleanups=new Map<number,any>();
  const refs:any[]=[]; const listeners=new Map<string,any>();
  const hooks={useState:(initial:any)=>{const i=cursor++; if(!(i in state)) state[i]=initial;return[state[i],(v:any)=>{state[i]=v;}];},
    useRef:(initial:any)=>{const i=cursor++; if(!(i in state)) {state[i]={current:initial};refs.push(state[i]);}return state[i];},
    useMemo:(fn:any)=>fn(),useId:()=> 'filters',useLayoutEffect:(fn:any,deps:any[])=>{const i=cursor++;if(!state[i]||deps.some((d,j)=>d!==state[i][j])){state[i]=deps;pending.push(()=>{cleanups.get(i)?.();cleanups.set(i,fn());});}}};
  const dom=(prefix:string)=>({addEventListener:(k:string,v:any)=>listeners.set(prefix+k,v),removeEventListener:(k:string)=>listeners.delete(prefix+k)});
  vi.stubGlobal('document',{...dom('doc:'),body:{}}); vi.stubGlobal('window',{...dom('win:'),innerWidth:320,innerHeight:450});
  const realRequire=createRequire(path.join(process.cwd(),'package.json')); const mod={exports:{} as any};
  new Function('require','module','exports',source)((id:string)=>id==='react'?hooks:id==='react-dom'?{createPortal:(x:any)=>x}:realRequire(id),mod,mod.exports);
  let value='abc123'; const change=(v:string)=>{value=v;};
  const graph:any={repository:{root:'A'},currentBranch:'main',layout:{nodes:[{id:'a',kind:'commit',subject:'hello',oid:'abc123',refIds:['refs/heads/main']}],tracks:[]}};
  graph.layout.nodes.push(...Array.from({length:12},(_,i)=>({id:`feature-${i}`,kind:'commit',subject:'feature',refIds:[`refs/heads/feature/${i}`]})));
  const inside={}, field={}, outside={}, focus=vi.fn();
  const render=()=>{cursor=0;const tree=mod.exports.FilterControl({graph,value,onChange:change});refs[0].current={contains:(x:any)=>x===field,getBoundingClientRect:()=>({top:100,bottom:132,right:300})};refs[1].current={contains:(x:any)=>x===inside,scrollHeight:500,focus:vi.fn()};refs[2].current={focus};pending.splice(0).forEach(fn=>fn());return tree;};
  const all=(x:any):any[]=>!x?[]:Array.isArray(x)?x.flatMap(all):[x,...all(x.props?.children)];
  const button=(tree:any,label:string)=>all(tree).find(x=>x.props?.['aria-label']===label);
  let tree=render();expect(tree.type).toBe('div');expect(tree.props.onClick).toBeUndefined();
  button(tree,'Filter options').props.onClick();tree=render();
  const main=all(tree).find(x=>x.type==='label'&&all(x).some(c=>c.props?.title==='main'));
  all(main).find(x=>x.type==='input').props.onChange(); tree=render();
  expect(value).toBe('abc123 branch:main');expect(all(tree).find(x=>x.props?.title==='main').props.children).toBe('main');
  expect(all(tree).filter(x=>x.props?.className==='filter-option-list')).toHaveLength(3);
  const search=()=>all(tree).find(x=>x.props?.['aria-label']==='Search branches');
  search().props.onChange({target:{value:'feature/11'}});tree=render();
  expect(value).toBe('abc123 branch:main');
  expect(all(tree).some(x=>x.props?.title==='main')).toBe(false);
  expect(all(tree).filter(x=>x.props?.title?.startsWith('feature/'))).toHaveLength(1);
  expect(all(tree).some(x=>x.props?.title==='feature/11')).toBe(true);
  search().props.onChange({target:{value:'no-match'}});tree=render();
  expect(all(tree).some(x=>x.props?.role==='status'&&x.props.children==='No branches found')).toBe(true);
  search().props.onChange({target:{value:''}});tree=render();
  const restoredMain=all(tree).find(x=>x.type==='label'&&all(x).some(c=>c.props?.title==='main'));
  expect(all(restoredMain).find(x=>x.type==='input').props.checked).toBe(true);
  const textInput=all(tree).find(x=>x.type==='input'&&x.props.type==='search');textInput.props.onChange({target:{value:'def456 type:commit'}});tree=render();
  const commits=all(tree).find(x=>x.type==='label'&&all(x).some(c=>c.props?.title==='Commits'));
  expect(all(commits).find(x=>x.type==='input').props.checked).toBe(true);
  for(const kind of ['pointerdown','scroll','wheel']) {listeners.get('doc:'+kind)({target:inside});expect(button(render(),'Filter options (1)').props['aria-expanded']).toBe(true);}
  search().props.onChange({target:{value:'feature'}});tree=render();
  all(tree).find(x=>x.type==='button'&&x.props.children==='Clear all').props.onClick();tree=render();
  expect(value).toBe('');expect(search().props.value).toBe('');
  for(const kind of ['pointerdown','scroll','wheel']) {
    listeners.get('doc:'+kind)({target:outside});tree=render();expect(button(tree,'Filter options').props['aria-expanded']).toBe(false);
    button(tree,'Filter options').props.onClick();tree=render();
  }
  listeners.get('doc:keydown')({key:'Escape',preventDefault:vi.fn()});tree=render();expect(focus).toHaveBeenCalledOnce();expect(button(tree,'Filter options').props['aria-expanded']).toBe(false);
  button(tree,'Filter options').props.onClick();tree=render();graph.repository.root='B';tree=render();tree=render();expect(button(tree,'Filter options').props['aria-expanded']).toBe(false);
  cleanups.forEach(fn=>fn?.());expect(listeners.size).toBe(0);
});
