const $ = id => document.getElementById(id);
const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalized = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();
const searchKey = value => normalized(value).replace(/\s/g,'').replace(/[×＊]/g,'*');
const hasPrice = row => String(row[6] ?? '').trim() !== '';
const prefix = 'toolquotes.v1:' + new URL('.', location.href).pathname;
function makeGroups(rows) {
  const drawingCodes = new Map(), groups = new Map();
  for (const [, , code, drawing] of rows) {
    if (!code || !drawing) continue;
    const key = normalized(drawing);
    if (!drawingCodes.has(key)) drawingCodes.set(key,new Set());
    drawingCodes.get(key).add(normalized(code));
  }
  for (const row of rows) {
    const [, , code, drawing, name, spec] = row.map(normalized);
    const codes = drawingCodes.get(drawing);
    let key;
    if (code || codes?.size === 1) key = ['编码',code || [...codes][0]];
    else if (drawing) key = ['图号',drawing];
    else if (name && spec) key = ['名称＋规格',name,spec];
    else key = ['原表行',row[13]];
    const id = JSON.stringify(key);
    if (!groups.has(id)) groups.set(id,{key, rows:[]});
    groups.get(id).rows.push(row);
  }
  for (const g of groups.values()) {
    g.rows.sort((a,b)=>b[0].localeCompare(a[0]) || b[13]-a[13]);
    const quotes = g.rows.filter(hasPrice);
    g.latest = quotes.filter(r=>r[0]===quotes[0][0]);
    g.multi = new Set(quotes.map(r=>r[0])).size>1;
    g.search = g.rows.map(r=>r.slice(2,6).map(searchKey).join(' ')).join(' ');
  }
  return [...groups.values()].sort((a,b)=>b.rows[0][0].localeCompare(a.rows[0][0])||b.rows[0][13]-a.rows[0][13]);
}
function historyRow(r) {
  const fields = [[4,'产品'],[5,'规格'],[2,'编码'],[3,'图号'],[1,'经销商'],[12,'终端客户'],[9,'材料'],[7,'工厂'],[8,'货期'],[10,'备注'],[11,'外委加工']];
  return '<article><div class="topline"><time>'+r[0]+'</time><span>原表第 '+r[13]+' 行</span></div><strong>'+escapeText(hasPrice(r)?r[6]:'未填报价')+'</strong>'+fields.filter(([i])=>r[i]).map(([i,label])=>'<p>'+label+'　'+escapeText(r[i])+'</p>').join('')+'</article>';
}
function card(g) {
  const r = g.rows[0], latest = g.latest, date = latest[0]?.[0];
  const label = g.key[0]==='名称＋规格'?'按名称＋规格归组，请核实':g.key[0]+' '+g.key[1];
  const prices = latest.map(a=>'<strong>'+escapeText(a[6])+'</strong><div class="sub">'+escapeText(a[1] || '经销商未填')+'</div>').join('');
  const warning = date && r[0]>date?'<div class="note">'+r[0]+' 有较新报备，报价未填</div>':'';
  return '<section class="card"><div class="body"><div class="topline">'+escapeText(label)+'</div><h2>'+escapeText(r[4] || '产品名称未填')+'</h2><div class="sub">'+escapeText(r[5])+'</div><div class="price"><div class="pricehead"><b>最新报价</b><time>'+(date??'')+'</time></div>'+(prices||'暂无报价')+warning+'</div></div><details><summary>历史记录（'+g.rows.length+'）</summary>'+g.rows.map(historyRow).join('')+'</details></section>';
}
let groups, limit = 24, pending;
function render() {
  const terms = $('search').value.trim().split(/\s+/).map(searchKey);
  const matches = groups.filter(g=>(!$('multi').checked||g.multi)&&terms.every(t=>g.search.includes(t)));
  $('count').textContent=matches.length+' 组产品';
  $('results').innerHTML=matches.slice(0,limit).map(card).join('') || '<p>未找到匹配产品。请缩短关键词或调整筛选。</p>';
  $('more').hidden=matches.length<=limit;
}
function loadRows(rows) {
  groups=makeGroups(rows);
  if(!groups.length){render();$('meta').textContent='选择手机里的报备表，即可查询最新和历史报价';$('importBtn').textContent='导入报备表';$('results').innerHTML='';return;}
  $('importBtn').textContent='更新报备表';
  $('meta').textContent='报备截至 '+groups[0].rows[0][0]+'　·　'+rows.length.toLocaleString()+' 条记录';
  limit=24; render();
}
function filter() { limit=24;render();window.scrollTo(0,0); }
$('search').oninput=filter;
$('multi').onchange=filter;
$('more').onclick=()=>{limit+=24;render()};
function isoDate(v, system1904) {
  if (/^\d+(\.\d+)?$/.test(v) && Number(v)<100000) {
    const ms=Date.UTC(system1904?1904:1899,system1904?0:11,system1904?1:30)+Math.floor(Number(v))*86400000;
    return new Date(ms).toISOString().slice(0,10);
  }
  const m=String(v).match(/^(\d{4})[-年/.](\d{1,2})[-月/.](\d{1,2})(日|$|T|\s)/);
  if (m) { const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3])); if(d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[3])return d.toISOString().slice(0,10); }
  throw Error('日期格式无法识别，请检查原表日期。');
}
async function readWorkbook(file) {
  const zip=await JSZip.loadAsync(file);
  const xml=async path=>{const part=zip.file(path);if(!part)throw Error('工作表不完整。');return new DOMParser().parseFromString(await part.async('string'),'application/xml')};
  const texts=node=>[...node.getElementsByTagNameNS('*','t')].map(t=>t.textContent).join('');
  const strings=zip.file('xl/sharedStrings.xml')?[...(await xml('xl/sharedStrings.xml')).getElementsByTagNameNS('*','si')].map(texts):[];
  const book=await xml('xl/workbook.xml'),rels=await xml('xl/_rels/workbook.xml.rels');
  const mode=['1','true'].includes(book.querySelector('workbookPr')?.getAttribute('date1904'));
  const expected=['日期','经销商','商品编码','产品图号','产品名称','产品规格','报价','加工工厂','货期','材料','备注','外委加工','终端客户'];
  for(const sheet of book.getElementsByTagNameNS('*','sheet')){
    const rel=[...rels.documentElement.children].find(r=>r.getAttribute('Id')===sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'));
    if(!rel)continue;
    const path=new URL(rel.getAttribute('Target'),'https://local.invalid/xl/workbook.xml').pathname.slice(1);
    const doc=await xml(path);let cols;const data=[];
    for(const row of doc.getElementsByTagNameNS('*','row')){
      const vals=[];
      for(const c of row.children){
        const letters=(c.getAttribute('r')||'').match(/^[A-Z]+/)?.[0];if(!letters)continue;
        const idx=[...letters].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1;
        const type=c.getAttribute('t'),v=c.getElementsByTagNameNS('*','v')[0]?.textContent??'';
        vals[idx]=type==='s'?strings[Number(v)]:type==='inlineStr'?texts(c):v;
      }
      if(!cols){const candidate=expected.map(h=>vals.findIndex(v=>v?.trim()===h));if([0,2,3,4,5,6].every(i=>candidate[i]>=0))cols=candidate;continue}
      const r=cols.map(i=>vals[i]??'');if(r.every(v=>!v))continue;
      if(!r[0])throw Error('第 '+row.getAttribute('r')+' 行缺少日期，请补充后导入。');
      r[0]=isoDate(r[0],mode);r.push(Number(row.getAttribute('r')));data.push(r);
    }
    if(data.length)return data;
  }
  throw Error('没有找到含日期、商品编码、产品图号、产品名称、产品规格和报价的报备明细。');
}
$('importBtn').onclick=()=>$('file').click();
$('file').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  $('importBtn').disabled=true;$('status').textContent='正在读取报备表…';
  try{pending=await readWorkbook(file);const last=pending.map(r=>r[0]).sort().pop();
    $('preview').textContent=file.name+'\n共 '+pending.length+' 条记录，截至 '+last+'。确认后用整份报备表替换本机查询数据。';
    $('status').textContent='';$('update').showModal();
  }catch(err){$('status').textContent='导入失败。'+err.message}
  finally{event.target.value='';$('importBtn').disabled=false}
};
$('cancel').onclick=()=>$('update').close();
$('apply').onclick=()=>{
  if(!pending)return;loadRows(pending);
  try{localStorage.setItem(prefix,JSON.stringify(pending));$('status').textContent='报备表已更新并保存在当前浏览器。'}
  catch{$('status').textContent='本次查询已更新。浏览器未能保存，下次打开需重新导入。'}
  pending=null;$('update').close();
};
try{const saved=localStorage.getItem(prefix);if(!saved)throw Error();loadRows(JSON.parse(saved))}
catch{loadRows(JSON.parse($('seed').textContent))}
