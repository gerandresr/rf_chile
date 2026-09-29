export type Instrument={code:string;type:"BTP"|"BTU";coupon:number|null;maturityMonth:number;maturityYear:number};
export type HistoryRow={date:string;values:Record<string,number>};
export type RFData={sourceSheet:string;lastMarketDate:string;instruments:Instrument[];history:HistoryRow[]};
export function isActiveInstrument(i:Instrument,now=new Date()){const c=now.getFullYear()*12+now.getMonth();const m=i.maturityYear*12+i.maturityMonth-1;return c<=m+1}
export function maturityLabel(i:Instrument){return `${String(i.maturityMonth).padStart(2,"0")}/${String(i.maturityYear).slice(-2)}`}
export function formatPercent(v:number|null|undefined,d=2){return v==null||Number.isNaN(v)?"—":`${v.toFixed(d)}%`}
export function formatBp(v:number|null|undefined,d=1){return v==null||Number.isNaN(v)?"—":`${v>0?"+":""}${v.toFixed(d)}`}
export function observations(data:RFData,code:string){return data.history.map(r=>({date:r.date,value:r.values[code]})).filter((r):r is {date:string;value:number}=>typeof r.value==="number")}
export function instrumentSnapshot(data:RFData,code:string){const o=observations(data,code);if(!o.length)return null;const l=o[o.length-1],p=o.at(-2),w=o.at(-6),m=o.at(-22);return{date:l.date,value:l.value,d1:p?(l.value-p.value)*100:null,w1:w?(l.value-w.value)*100:null,m1:m?(l.value-m.value)*100:null}}
export function rollingVolatility(obs:{date:string;value:number}[],window:number){const ch=obs.map((p,i)=>i===0?null:(p.value-obs[i-1].value)*100);return obs.map((p,i)=>{if(i<window)return{date:p.date,value:null as number|null};const w=ch.slice(i-window+1,i+1);if(w.some(x=>x==null))return{date:p.date,value:null as number|null};const n=w as number[];const mean=n.reduce((a,b)=>a+b,0)/n.length;const variance=n.reduce((a,b)=>a+(b-mean)**2,0)/(n.length-1);return{date:p.date,value:Math.sqrt(variance)}}).filter((p):p is {date:string;value:number}=>p.value!=null)}
