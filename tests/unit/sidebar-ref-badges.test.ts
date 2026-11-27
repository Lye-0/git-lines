import { afterEach, expect, it, vi } from 'vitest';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';
const source=buildSync({entryPoints:['webview/src/components/SidebarRefBadges.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime']}).outputFiles[0].text;
afterEach(()=>vi.unstubAllGlobals());
it('rechecks each row on resize, preserves full ref identities in icons and overflow, and disconnects observers',()=>{
  const values:any[]=[];let cursor=0;const refs:any[]=[];const effects:Array<()=>void>=[];const cleanups:any[]=[];
  const hooks={useState:(v:any)=>{const i=cursor++;if(!(i in values))values[i]=v;return[values[i],(next:any)=>values[i]=typeof next==='function'?next(values[i]):next];},
    useRef:(v:any)=>{const i=cursor++;if(!(i in values)){values[i]={current:v};refs.push(values[i]);}return values[i];},
    useLayoutEffect:(fn:any,deps:any[])=>{const i=cursor++;if(!values[i]||deps.some((d,j)=>d!==values[i][j])){values[i]=deps;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}}};
  let onResize!:()=>void;const disconnect=vi.fn(),observe=vi.fn();
  vi.stubGlobal('ResizeObserver',class{constructor(fn:()=>void){onResize=fn;} observe=observe;disconnect=disconnect;});
  vi.stubGlobal('getComputedStyle',()=>({display:'flex',columnGap:'4px'}));
  const realRequire=createRequire(path.join(process.cwd(),'package.json')),mod={exports:{} as any};
  new Function('require','module','exports',source)((id:string)=>id==='react'?hooks:realRequire(id),mod,mod.exports);
  const props={badges:[{kind:'local',name:'main',fullName:'refs/heads/main',isDefault:true},{kind:'remote',name:'origin/main',fullName:'refs/remotes/origin/main'},{kind:'tag',name:'release',fullName:'refs/tags/release'}],ghosts:[],tracks:[{id:'main',refNames:['refs/heads/main','refs/remotes/origin/main'],color:'cyan'}]};
  const heading:any={clientWidth:300,children:[]};const subject={scrollWidth:400,classList:{contains:(c:string)=>c==='subject'}};
  const render=()=>{cursor=0;const tree=mod.exports.SidebarRefBadges(props);refs[0].current={parentElement:heading};refs[1].current={getBoundingClientRect:()=>({width:200})};refs[2].current={getBoundingClientRect:()=>({width:24})};heading.children=[subject,refs[0].current];effects.splice(0).forEach(fn=>fn());return tree;};
  const visible=(tree:any)=>tree.props.children[0];
  render();let tree=render();expect(tree.props['data-mode']).toBe('names');expect(visible(tree)).toHaveLength(3);expect(observe).toHaveBeenCalledTimes(3);
  heading.clientWidth=290;onResize();tree=render();expect(tree.props['data-mode']).toBe('names');
  heading.clientWidth=280;onResize();tree=render();expect(tree.props['data-mode']).toBe('icons');
  expect(visible(tree)).toHaveLength(3);
  subject.scrollWidth=10;onResize();tree=render();expect(tree.props['data-mode']).toBe('names');
  subject.scrollWidth=400;heading.clientWidth=100;onResize();tree=render();expect(tree.props['data-mode']).toBe('icons');
  expect(visible(tree).map((b:any)=>b.props.title)).toEqual(props.badges.map(b=>b.fullName+(b.isDefault?' · default':'')));
  expect(visible(tree)[0].props.style['--badge-color']).toBe('cyan');
  heading.clientWidth=60;onResize();tree=render();expect(visible(tree)).toHaveLength(0);
  expect(tree.props.children[1].props.title).toContain('refs/remotes/origin/main');
  expect(tree.props.children[1].props['aria-label']).toContain('3 more refs');
  expect(tree.props.children[2].props['aria-hidden']).toBe('true');
  const marker={classList:{contains:()=>false},getBoundingClientRect:()=>({width:100})};
  heading.children=[marker,subject,refs[0].current];heading.clientWidth=120;onResize();tree=render();
  expect(tree.props.style.maxWidth).toBeGreaterThanOrEqual(24);
  heading.clientWidth=300;onResize();tree=render();expect(tree.props['data-mode']).toBe('names');
  cleanups.forEach(fn=>fn?.());expect(disconnect).toHaveBeenCalledOnce();
});
