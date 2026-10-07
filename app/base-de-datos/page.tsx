"use client";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
type Item = { code: string; source: string };
export default function DatabasePage() {
  const [items,setItems]=useState<Item[]>([]); const [selected,setSelected]=useState<Set<string>>(new Set());
  useEffect(()=>{fetch("/api/database-instruments").then(r=>r.json()).then(setItems)},[]);
  const filtered=items;
  const groups=useMemo(()=>{const r:Record<string,Item[]>={"Bonos en Pesos":[],"Bonos en UF":[],DPF:[],Otros:[]}; filtered.forEach(i=>r[i.code.startsWith("BTP")?"Bonos en Pesos":i.code.startsWith("BTU")?"Bonos en UF":i.code.startsWith("DPF")?"DPF":"Otros"].push(i)); return Object.entries(r).filter(([,v])=>v.length)},[filtered]);
  const toggle=(code:string)=>setSelected(prev=>{const n=new Set(prev); n.has(code)?n.delete(code):n.add(code); return n});
  return <AppShell><div className="page-head"><div><div className="eyebrow">Históricos</div><h1>Base de Datos</h1><p className="muted">Selecciona uno o más instrumentos para preparar una descarga de datos históricos.</p></div></div>
  <section className="panel"><div className="panel-head"><div><h2>Seleccionar instrumentos</h2><div className="muted">{selected.size} seleccionados</div></div></div>
  <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:18}}><button type="button" onClick={()=>setSelected(new Set(items.map(i=>i.code)))}>Seleccionar todos</button><button type="button" onClick={()=>setSelected(new Set())}>Limpiar selección</button></div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:28,alignItems:"start"}}>{groups.map(([name,list])=><div key={name}><h3>{name}</h3><div style={{display:"grid",gap:8}}>{list.map(item=><label key={item.code} style={{display:"flex",alignItems:"center",gap:9,cursor:"pointer"}}><input type="checkbox" checked={selected.has(item.code)} onChange={()=>toggle(item.code)}/><span>{item.code}</span></label>)}</div></div>)}</div>
  {!items.length&&<p className="muted">Cargando instrumentos históricos…</p>}<div style={{marginTop:24,display:"flex",justifyContent:"flex-end"}}><button type="button" disabled={selected.size===0} title="La generación del archivo se agregará después">Descargar</button></div></section></AppShell>;
}
