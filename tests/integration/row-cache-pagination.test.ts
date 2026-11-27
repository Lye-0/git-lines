import { expect, it } from 'vitest';
import { createGitFixture } from '../fixtures/gitFixture.js';
import { GitClient } from '../../src/git/gitClient.js';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import { LayoutState } from '../../src/layout/layoutState.js';
import { assertRowInvariants } from '../../src/layout/rowLayout.js';

it('keeps a paginated linear DAG ordered as reflog-only ancestors become live in both modes',async()=>{
  const f=createGitFixture();
  try {
    const oids:string[]=[];
    for(let i=0;i<9;i++){
      const date=`${i>=3&&i<6?'2010':'2025'}-01-${String(i+1).padStart(2,'0')}T00:00:00Z`;
      f.run(['commit','--allow-empty','-m',`commit ${i}`],{GIT_AUTHOR_DATE:date,GIT_COMMITTER_DATE:date});
      oids.push(f.run(['rev-parse','HEAD']).trim());
    }
    // Only this temporary repo expires records. Older reflog objects remain
    // visible across an unread gap; no saved scenario is modified.
    f.run(['reflog','expire','--expire=2020-01-01T00:00:00Z','--all']);
    for(const showReflog of [true,false]){
      const client=new GitClient(),states=[new LayoutState(),new LayoutState()];
      for(const count of [3,8,9]){
        const s=await client.readSnapshot(f.root,count,showReflog);
        const evidence=await client.readBranchProtection(s);
        const facts=buildGraphFacts(s,{showReflog,branchEvidence:evidence});
        const before=structuredClone(facts);
        if(count===3&&showReflog) expect(facts.nodes.find(n=>n.oid===oids[2])?.kind).toBe('reflog-commit');
        for(const fixed of [false,true]){
          const state=states[Number(fixed)];
          const opts={visibleCommitCount:count,hasMore:s.hasMore,rowHeight:28,laneWidth:22,protectionReflogs:evidence,
            fixedDefault:fixed?{refName:'refs/heads/main',branch:'main',oid:oids[8],source:'manual' as const}:undefined};
          const layout=createGraphLayout(facts,{...opts,previousRows:state.layout?state.rows:undefined,previousLanes:state.lanes,previousNodeLanes:state.nodeLanes});
          assertRowInvariants(layout.nodes,layout.edges);
          expect(layout.edges).toEqual(facts.edges);
          expect(facts).toEqual(before);
          expect(layout.nodes.filter(n=>n.kind==='commit')).toHaveLength(count);
          if(count===9){
            const cold=createGraphLayout(facts,opts);
            expect(layout.nodes.map(n=>[n.id,n.row])).toEqual(cold.nodes.map(n=>[n.id,n.row]));
            const ordered=layout.nodes.filter(n=>n.kind==='commit').sort((a,b)=>a.row!-b.row!);
            expect(ordered.map(n=>n.oid)).toEqual([...oids].reverse());
            const byId=new Map(layout.nodes.map(n=>[n.id,n]));
            for(const edge of layout.edges.filter(e=>e.type==='parent')){
              expect(byId.get(edge.toNodeId)!.row!-byId.get(edge.fromNodeId)!.row!).toBe(1);
            }
          }
          state.set(layout);
        }
      }
    }
  } finally {f.dispose();}
},20000);
