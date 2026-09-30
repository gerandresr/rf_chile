export type Instrument={code:string;type:"BTP"|"BTU";coupon:number|null;maturityMonth:number;maturityYear:number};
export type HistoryRow={date:string;values:Record<string,number>};
export type RFData={sourceSheet:string;lastMarketDate:string;instruments:Instrument[];history:HistoryRow[]};

export function isActiveInstrument(i:Instrument,now=new Date()){
  const c=now.getFullYear()*12+now.getMonth();
  const m=i.maturityYear*12+i.maturityMonth-1;
  return c<=m+1;
}

export function maturityLabel(i:Instrument){
  return `${String(i.maturityMonth).padStart(2,"0")}/${String(i.maturityYear).slice(-2)}`;
}

export function formatPercent(v:number|null|undefined,d=2){
  return v==null||Number.isNaN(v)?"—":`${v.toFixed(d)}%`;
}

export function formatBp(v:number|null|undefined,d=1){
  return v==null||Number.isNaN(v)?"—":`${v>0?"+":""}${v.toFixed(d)}`;
}

export function observations(data:RFData,code:string){
  return data.history
    .map(r=>({date:r.date,value:r.values[code]}))
    .filter((r):r is {date:string;value:number}=>typeof r.value==="number");
}

function previousObservationBefore(obs:{date:string;value:number}[],cutoff:string){
  for(let i=obs.length-1;i>=0;i--){
    if(obs[i].date<cutoff)return obs[i];
  }
  return null;
}

function firstObservationFrom(obs:{date:string;value:number}[],cutoff:string){
  return obs.find(o=>o.date>=cutoff)??null;
}

export function instrumentSnapshot(data:RFData,code:string){
  const o=observations(data,code);
  if(!o.length)return null;

  const l=o[o.length-1];
  const p=o.at(-2);
  const lastDate=new Date(`${l.date}T00:00:00`);
  const year=lastDate.getFullYear();
  const month=lastDate.getMonth()+1;
  const monthStart=`${year}-${String(month).padStart(2,"0")}-01`;
  const yearStart=`${year}-01-01`;

  // MTD: cierre previo al inicio del mes. Si el instrumento todavía no tenía
  // historia, usa su primera observación disponible dentro del mes.
  const mtdBase=previousObservationBefore(o,monthStart)??firstObservationFrom(o,monthStart);

  // YTD: cierre previo al inicio del año. Si no existe, usa la primera
  // observación disponible del año (por ejemplo, un bono emitido durante el año).
  const ytdBase=previousObservationBefore(o,yearStart)??firstObservationFrom(o,yearStart);

  return{
    date:l.date,
    value:l.value,
    d1:p?(l.value-p.value)*100:null,
    mtd:mtdBase?(l.value-mtdBase.value)*100:null,
    ytd:ytdBase?(l.value-ytdBase.value)*100:null,
  };
}

export function rollingVolatility(obs:{date:string;value:number}[],window:number){
  const ch=obs.map((p,i)=>i===0?null:(p.value-obs[i-1].value)*100);
  return obs
    .map((p,i)=>{
      if(i<window)return{date:p.date,value:null as number|null};
      const w=ch.slice(i-window+1,i+1);
      if(w.some(x=>x==null))return{date:p.date,value:null as number|null};
      const n=w as number[];
      const mean=n.reduce((a,b)=>a+b,0)/n.length;
      const variance=n.reduce((a,b)=>a+(b-mean)**2,0)/(n.length-1);
      return{date:p.date,value:Math.sqrt(variance)};
    })
    .filter((p):p is {date:string;value:number}=>p.value!=null);
}
