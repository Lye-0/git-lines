import fs from 'node:fs/promises';
import path from 'node:path';
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function gallery(run) {
  const cases = JSON.parse(await fs.readFile(path.join(run,'cases.json'),'utf8'));
  const captures = [];
  for(let index=0; index<cases.length; index++) {
    const metadata = JSON.parse(await fs.readFile(path.join(run,'images',`${index}.json`),'utf8'));
    if(metadata.index!==index || metadata.name!==cases[index].name || metadata.mode!==cases[index].mode) throw new Error(`Capture mismatch: ${index}`);
    const pages = metadata.pages ?? [{imageFile:metadata.imageFile}];
    if(!pages.length) throw new Error(`Empty capture: ${index}`);
    for(const page of pages) {
      if(!new RegExp(`^${index}(?:-\\d+)?\\.(png|jpg)$`).test(page.imageFile)) throw new Error('Invalid image name');
      await fs.access(path.join(run,'images',page.imageFile));
    }
    captures.push({...metadata,pages});
  }
  const groups = [];
  for(let i=0;i<cases.length;i+=2) {
    if(cases[i].name!==cases[i+1]?.name) throw new Error('Expected paired modes');
    groups.push(`<section data-name="${escape(cases[i].name)}"><h2>${escape(cases[i].name)}</h2><p>Fixed target: ${escape(cases[i+1].fixedBranch ?? 'Auto / Unknown')}</p><div class="pair">${[i,i+1].map(n=>`<div><h3>${cases[n].mode==='legacy'?'Standard':'Default Fixed'}</h3>${captures[n].pages.map((page,p)=>`<figure><figcaption>${p+1} / ${captures[n].pages.length}${page.viewport ? ` · x=${Math.round(page.viewport.left)}, y=${Math.round(page.viewport.top)}`:''}</figcaption><a href="images/${page.imageFile}" target="_blank"><img loading="lazy" src="images/${page.imageFile}" alt="${escape(cases[n].name)} ${cases[n].mode} ${p+1}"></a></figure>`).join('')}</div>`).join('')}</div></section>`);
  }
  const totalImages = captures.reduce((sum,c)=>sum+c.pages.length,0);
  await fs.writeFile(path.join(run,'capture-results.json'),JSON.stringify({scenarios:groups.length,cases:cases.length,images:totalImages,captures},null,2));
  await fs.writeFile(path.join(run,'index.html'),`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Git Lines — ${groups.length} scenarios</title><style>body{background:#111519;color:#e4e9ed;font:16px system-ui;margin:32px}header{position:sticky;top:0;background:#111519ed;padding:12px 0;z-index:1}h1{font-size:28px;margin:0 0 12px}h2{font-size:20px;margin-top:40px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0 0 20px}figcaption{margin:10px 0;color:#9dddea}img{width:100%;border:1px solid #364149;border-radius:8px}input{font:inherit;padding:10px;width:min(420px,90%);background:#20272d;color:inherit;border:1px solid #58666f;border-radius:6px}section[hidden]{display:none}@media(max-width:800px){.pair{grid-template-columns:1fr}}</style><header><h1>Git Lines — ${groups.length}シナリオ / ${cases.length}通り</h1><label>シナリオを検索 <input id="filter" placeholder="113 / merge / remote..."></label></header><p>実際のVS Code画面をComputer Useで自動撮影。${totalImages}枚。Compact / Reflog On。画像をクリックすると原寸表示します。長い・幅広い履歴は重なりを持たせて分割しています。</p><p>撮影完了と履歴表示の正しさは別です。この一覧は目視比較用で、全グラフの意味的な正しさを保証するものではありません。</p>${groups.join('')}<script>document.querySelector('#filter').addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('section').forEach(s=>s.hidden=!s.dataset.name.toLowerCase().includes(q))})</script></html>`);
  return {scenarios:groups.length,cases:cases.length,images:totalImages,path:path.join(run,'index.html')};
}
