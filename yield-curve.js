(() => {
  const state = {data:null, range:'1Y', curveChart:null, historyChart:null, spreadChart:null, breakevenChart:null};
  const RANGE_VALUES = ['1M','3M','6M','1Y','3Y','5Y','10Y','ALL'];
  const KEY_TENORS = ['3m','6m','1y','2y','3y','5y','7y','10y','20y','30y'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite = value => Number.isFinite(Number(value));
  const num = value => Number(value);
  const fmtPct = (value,digits=2) => finite(value) ? `${num(value).toFixed(digits)}%` : '—';
  const fmtB = value => {
    const n=num(value);
    if(!Number.isFinite(n)) return '—';
    return Math.abs(n)>=1000 ? `$${(n/1000).toFixed(2)}T` : `$${n.toLocaleString(undefined,{maximumFractionDigits:1})}B`;
  };
  const fmtBps = value => {
    const n=num(value);
    if(!Number.isFinite(n)) return '—';
    return `${n>0?'+':n<0?'−':''}${Math.abs(n).toFixed(0)} bps`;
  };
  const changeBps = (latest,first) => finite(latest)&&finite(first) ? (num(latest)-num(first))*100 : null;
  const dayMs = value => {
    const t=new Date(`${String(value||'').slice(0,10)}T00:00:00Z`).getTime();
    return Number.isFinite(t)?t:null;
  };
  const prettyDate = value => {
    const t=dayMs(value);
    return t==null?'—':new Date(t).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'});
  };

  function block(){ return state.data?.treasury_yield_curve || {}; }
  function nominal(){ return block().nominal?.history || []; }
  function real(){ return block().real?.history || []; }
  function spreads(){ return block().spreads?.history || []; }
  function breakeven(){ return block().breakeven?.history || []; }

  function cutoffFrom(latestDate,range){
    if(range==='ALL') return null;
    const d=new Date(`${latestDate}T00:00:00Z`);
    if(Number.isNaN(d.getTime())) return null;
    if(range.endsWith('M')) d.setUTCMonth(d.getUTCMonth()-Number(range.replace('M','')));
    else d.setUTCFullYear(d.getUTCFullYear()-Number(range.replace('Y','')));
    return d.getTime();
  }
  function filterRange(rows,range=state.range){
    const sorted=(rows||[]).slice().filter(r=>r?.date).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    if(!sorted.length||range==='ALL') return sorted;
    const cutoff=cutoffFrom(sorted.at(-1).date,range);
    return cutoff==null?sorted:sorted.filter(row=>(dayMs(row.date)??-Infinity)>=cutoff);
  }
  function sampleRows(rows,maxPoints=1200){
    if(rows.length<=maxPoints) return rows;
    const step=(rows.length-1)/(maxPoints-1);
    const out=[];
    for(let i=0;i<maxPoints;i++) out.push(rows[Math.round(i*step)]);
    return out;
  }
  function rowOnOrBefore(rows,date){
    let found=null;
    for(const row of rows){
      if(String(row.date)<=String(date)) found=row;
      else break;
    }
    return found;
  }
  function destroy(canvas){
    if(!canvas||!window.Chart) return;
    const existing=Chart.getChart(canvas);
    if(existing) existing.destroy();
  }

  function renderRanges(){
    const host=document.getElementById('yieldCurveRanges');
    if(!host) return;
    host.innerHTML=RANGE_VALUES.map(range=>`<button type="button" data-yield-range="${range}" class="${range===state.range?'active':''}">${range==='ALL'?'All':range}</button>`).join('');
    host.querySelectorAll('[data-yield-range]').forEach(button=>button.addEventListener('click',()=>{
      state.range=button.dataset.yieldRange;
      render();
    }));
  }

  function curveShape(spread2y,spread3m){
    if(!finite(spread2y)||!finite(spread3m)) return 'Mixed';
    if(num(spread2y)<0&&num(spread3m)<0) return 'Inverted';
    if(num(spread2y)>0&&num(spread3m)>0) return 'Upward sloping';
    return 'Mixed';
  }

  function renderCards(){
    const nrows=filterRange(nominal());
    const srows=filterRange(spreads());
    if(!nrows.length) return;
    const first=nrows[0], latest=nrows.at(-1);
    const firstSpread=srows[0]||{}, latestSpread=srows.at(-1)||{};
    const latestBreakeven=rowOnOrBefore(breakeven(),latest.date)||{};
    const refi=block().refinancing_context||{};
    const cards=[
      ['3M yield',fmtPct(latest['3m']),fmtBps(changeBps(latest['3m'],first['3m']))+' selected change'],
      ['2Y yield',fmtPct(latest['2y']),fmtBps(changeBps(latest['2y'],first['2y']))+' selected change'],
      ['10Y yield',fmtPct(latest['10y']),fmtBps(changeBps(latest['10y'],first['10y']))+' selected change'],
      ['30Y yield',fmtPct(latest['30y']),fmtBps(changeBps(latest['30y'],first['30y']))+' selected change'],
      ['10Y − 2Y',fmtBps(latestSpread['10y_2y_bps']),`${curveShape(latestSpread['10y_2y_bps'],latestSpread['10y_3m_bps'])} · ${fmtBps(num(latestSpread['10y_2y_bps'])-num(firstSpread['10y_2y_bps']))} change`],
      ['10Y − 3M',fmtBps(latestSpread['10y_3m_bps']),`${fmtBps(num(latestSpread['10y_3m_bps'])-num(firstSpread['10y_3m_bps']))} selected change`],
      ['10Y breakeven',fmtPct(latestBreakeven['10y']),`Nominal − real · ${prettyDate(latestBreakeven.date)}`],
      ['12M principal due',fmtB(refi.next_12m_principal_billions),'Current refinancing exposure from maturity wall'],
    ];
    const host=document.getElementById('yieldCurveCards');
    if(host) host.innerHTML=cards.map(([label,value,meta])=>`<div class="insight-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></div>`).join('');
    const meta=document.getElementById('yieldCurveMeta');
    if(meta) meta.textContent=`${state.range==='ALL'?'All available history':state.range} · ${nrows.length.toLocaleString()} nominal observations · ${prettyDate(first.date)} → ${prettyDate(latest.date)} · real curve through ${prettyDate(block().real_as_of)}`;
  }

  function drawCurve(){
    const canvas=document.getElementById('yieldCurveSnapshotChart');
    if(!canvas||!window.Chart) return;
    const nrows=filterRange(nominal());
    if(!nrows.length) return;
    const first=nrows[0], latest=nrows.at(-1);
    const latestReal=rowOnOrBefore(real(),latest.date)||block().real?.latest||{};
    const tenors=block().tenors||KEY_TENORS.map(key=>({key,label:key.toUpperCase()}));
    destroy(canvas);
    state.curveChart=new Chart(canvas,{
      type:'line',
      data:{labels:tenors.map(t=>t.label),datasets:[
        {label:`Latest nominal · ${latest.date}`,data:tenors.map(t=>latest[t.key]),borderWidth:2.4,pointRadius:3,pointHoverRadius:5,tension:.22,spanGaps:true},
        {label:`Start of ${state.range==='ALL'?'history':state.range} · ${first.date}`,data:tenors.map(t=>first[t.key]),borderWidth:1.8,pointRadius:2,pointHoverRadius:4,tension:.22,spanGaps:true,borderDash:[6,4]},
        {label:`Latest real (TIPS) · ${latestReal.date||'—'}`,data:tenors.map(t=>latestReal[t.key]??null),borderWidth:1.8,pointRadius:2,pointHoverRadius:4,tension:.22,spanGaps:true,borderDash:[2,4]},
      ]},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#dbe6f4'}},tooltip:{callbacks:{label:ctx=>` ${ctx.dataset.label}: ${fmtPct(ctx.parsed.y)}`}}},scales:{x:{grid:{display:false},ticks:{color:'#96a6ba'}},y:{grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:v=>`${Number(v).toFixed(1)}%`},title:{display:true,text:'Par yield',color:'#96a6ba'}}}}
    });
  }

  function drawHistory(){
    const canvas=document.getElementById('yieldHistoryChart');
    if(!canvas||!window.Chart) return;
    const rows=sampleRows(filterRange(nominal()));
    destroy(canvas);
    const defs=[['3m','3M'],['2y','2Y'],['10y','10Y'],['30y','30Y']];
    state.historyChart=new Chart(canvas,{type:'line',data:{labels:rows.map(r=>r.date),datasets:defs.map(([key,label])=>({label,data:rows.map(r=>r[key]),borderWidth:1.8,pointRadius:0,pointHoverRadius:4,tension:.08,spanGaps:true}))},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#dbe6f4'}},tooltip:{callbacks:{title:items=>prettyDate(items?.[0]?.label),label:ctx=>` ${ctx.dataset.label}: ${fmtPct(ctx.parsed.y)}`}}},scales:{x:{grid:{display:false},ticks:{color:'#96a6ba',maxTicksLimit:10}},y:{grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:v=>`${Number(v).toFixed(1)}%`},title:{display:true,text:'Yield',color:'#96a6ba'}}}}});
  }

  function drawSpreads(){
    const canvas=document.getElementById('yieldSpreadChart');
    if(!canvas||!window.Chart) return;
    const rows=sampleRows(filterRange(spreads()));
    destroy(canvas);
    const defs=[['10y_2y_bps','10Y − 2Y'],['10y_3m_bps','10Y − 3M'],['30y_10y_bps','30Y − 10Y']];
    state.spreadChart=new Chart(canvas,{type:'line',data:{labels:rows.map(r=>r.date),datasets:defs.map(([key,label])=>({label,data:rows.map(r=>r[key]),borderWidth:1.8,pointRadius:0,pointHoverRadius:4,tension:.08,spanGaps:true}))},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#dbe6f4'}},tooltip:{callbacks:{title:items=>prettyDate(items?.[0]?.label),label:ctx=>` ${ctx.dataset.label}: ${fmtBps(ctx.parsed.y)}`}}},scales:{x:{grid:{display:false},ticks:{color:'#96a6ba',maxTicksLimit:10}},y:{grid:{color:ctx=>Number(ctx.tick?.value)===0?'rgba(219,230,244,.30)':'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:v=>`${v} bps`},title:{display:true,text:'Curve spread',color:'#96a6ba'}}}}});
  }

  function drawBreakeven(){
    const canvas=document.getElementById('breakevenChart');
    if(!canvas||!window.Chart) return;
    const rows=sampleRows(filterRange(breakeven()));
    destroy(canvas);
    const defs=[['5y','5Y'],['10y','10Y'],['30y','30Y']];
    state.breakevenChart=new Chart(canvas,{type:'line',data:{labels:rows.map(r=>r.date),datasets:defs.map(([key,label])=>({label:`${label} breakeven`,data:rows.map(r=>r[key]),borderWidth:1.8,pointRadius:0,pointHoverRadius:4,tension:.08,spanGaps:true}))},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#dbe6f4'}},tooltip:{callbacks:{title:items=>prettyDate(items?.[0]?.label),label:ctx=>` ${ctx.dataset.label}: ${fmtPct(ctx.parsed.y)}`}}},scales:{x:{grid:{display:false},ticks:{color:'#96a6ba',maxTicksLimit:10}},y:{grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:v=>`${Number(v).toFixed(1)}%`},title:{display:true,text:'Nominal − real yield',color:'#96a6ba'}}}}});
  }

  function csvCell(value){
    const text=String(value??'');
    return /[",\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;
  }
  function downloadCsv(){
    const realMap=new Map(real().map(r=>[r.date,r]));
    const spreadMap=new Map(spreads().map(r=>[r.date,r]));
    const beMap=new Map(breakeven().map(r=>[r.date,r]));
    const header=['date',...KEY_TENORS.map(k=>`nominal_${k}_pct`),'real_5y_pct','real_7y_pct','real_10y_pct','real_20y_pct','real_30y_pct','spread_10y_2y_bps','spread_10y_3m_bps','spread_30y_10y_bps','breakeven_5y_pct','breakeven_10y_pct','breakeven_30y_pct'];
    const rows=[header];
    nominal().forEach(nrow=>{
      const r=realMap.get(nrow.date)||{}; const s=spreadMap.get(nrow.date)||{}; const b=beMap.get(nrow.date)||{};
      rows.push([nrow.date,...KEY_TENORS.map(k=>nrow[k]??''),r['5y']??'',r['7y']??'',r['10y']??'',r['20y']??'',r['30y']??'',s['10y_2y_bps']??'',s['10y_3m_bps']??'',s['30y_10y_bps']??'',b['5y']??'',b['10y']??'',b['30y']??'']);
    });
    const blob=new Blob([rows.map(row=>row.map(csvCell).join(',')).join('\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='treasury-yield-curve-history.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function render(){
    renderRanges();
    renderCards();
    drawCurve();
    drawHistory();
    drawSpreads();
    drawBreakeven();
    const note=document.getElementById('yieldCurveNote');
    if(note) note.textContent=block().note||'';
  }

  function init(data){
    state.data=data;
    const panel=document.getElementById('yieldCurvePanel');
    if(!panel) return;
    if(!nominal().length){
      panel.querySelector('.insight-body')?.replaceChildren(Object.assign(document.createElement('div'),{className:'empty-state',textContent:'Treasury yield-curve history is not available yet.'}));
      return;
    }
    render();
    document.getElementById('downloadYieldCurveCsv')?.addEventListener('click',downloadCsv);
  }

  if(window.treasuryData) init(window.treasuryData);
  else window.addEventListener('treasury:data-ready',event=>init(event.detail),{once:true});
})();
