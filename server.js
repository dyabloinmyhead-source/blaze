import express from "express";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const app=express();
const PORT=process.env.PORT||8080;
const ROOT=process.env.DATA_DIR||"./data";
const DB=path.join(ROOT,"steamdb");
const STATE=path.join(DB,"state.json");
const CURRENT=path.join(DB,"current.json");
const OBJECTS=path.join(DB,"objects");
const COMMITS=path.join(DB,"commits");
const URLS=[
  "https://api."+"steampowered.com/ISteamApps/GetAppList/v0002/?format=json",
  "https://api."+"steampowered.com/ISteamApps/GetAppList/v2/"
];

app.use(express.json({limit:"1mb"}));
app.use(express.static("public"));

async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,"utf8"))}catch{return fallback}}
async function writeJson(file,data){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(data,null,2))}
function sha(data){return crypto.createHash("sha1").update(JSON.stringify(data)).digest("hex")}

async function fetchApps(){
  let last;
  for(const url of URLS){
    try{
      const r=await fetch(url,{headers:{"User-Agent":"Blaze Steam GitDB","Accept":"application/json"}});
      if(!r.ok){last=new Error(`Steam app list HTTP ${r.status}`);continue}
      const j=await r.json();
      const apps=j?.applist?.apps||j?.response?.apps||[];
      if(Array.isArray(apps)&&apps.length){
        return apps.filter(x=>x&&x.appid&&x.name).map(x=>({appid:+x.appid,name:String(x.name).trim()})).sort((a,b)=>a.appid-b.appid);
      }
      last=new Error("Steam app list empty");
    }catch(e){last=e}
  }
  throw last||new Error("Steam app list failed");
}

function diff(prev,next){
  const p=new Map(prev.map(x=>[x.appid,x])), n=new Map(next.map(x=>[x.appid,x]));
  const added=[], removed=[], renamed=[];
  for(const x of next){const old=p.get(x.appid); if(!old) added.push(x); else if(old.name!==x.name) renamed.push({appid:x.appid,oldName:old.name,newName:x.name})}
  for(const x of prev) if(!n.has(x.appid)) removed.push(x);
  return {added,removed,renamed};
}

let running=false,lastSync=null,lastError=null;

async function sync(reason="manual"){
  if(running) return {ok:false,running:true};
  running=true;
  try{
    await fs.mkdir(OBJECTS,{recursive:true}); await fs.mkdir(COMMITS,{recursive:true});
    const apps=await fetchApps();
    const object=sha(apps);
    const state=await readJson(STATE,{head:null,commits:[]});
    const prev=state.head?await readJson(path.join(OBJECTS,state.head+".json"),[]):[];
    const d=diff(prev,apps);
    const changed=state.head!==object;
    let commit=null;
    await writeJson(path.join(OBJECTS,object+".json"),apps);
    await writeJson(CURRENT,apps);
    if(changed){
      commit={id:crypto.randomUUID(),object,parent:state.head,createdAt:new Date().toISOString(),reason,total:apps.length,diff:{added:d.added.length,removed:d.removed.length,renamed:d.renamed.length},samples:{added:d.added.slice(0,25),removed:d.removed.slice(0,25),renamed:d.renamed.slice(0,25)}};
      await writeJson(path.join(COMMITS,commit.id+".json"),commit);
      await writeJson(STATE,{head:object,updatedAt:commit.createdAt,commits:[commit.id,...(state.commits||[])].slice(0,2000)});
    }
    lastSync={at:new Date().toISOString(),reason,changed,total:apps.length};
    lastError=null;
    return {ok:true,changed,commit,total:apps.length,diff:d};
  }catch(e){
    lastError={at:new Date().toISOString(),message:e.message};
    throw e;
  }finally{running=false}
}

setTimeout(()=>sync("startup").catch(e=>console.error(e.message)),1500);
setInterval(()=>sync("hourly").catch(e=>console.error(e.message)),3600000);

app.get("/health",(req,res)=>res.json({ok:true,app:"blaze-steam-gitdb"}));
app.get("/api/status",async(req,res)=>{
  const state=await readJson(STATE,{head:null,commits:[]});
  const apps=await readJson(CURRENT,[]);
  res.json({ok:true,total:apps.length,head:state.head,commits:(state.commits||[]).length,updatedAt:state.updatedAt||null,running,lastSync,lastError});
});
app.post("/api/sync",async(req,res)=>{try{res.json(await sync("manual"))}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.get("/api/apps",async(req,res)=>{
  let apps=await readJson(CURRENT,[]);
  const q=String(req.query.q||"").toLowerCase();
  const limit=Math.min(+req.query.limit||100,1000);
  if(q) apps=apps.filter(x=>String(x.appid).includes(q)||x.name.toLowerCase().includes(q));
  res.json({ok:true,total:apps.length,apps:apps.slice(0,limit)});
});
app.get("/api/apps/:id",async(req,res)=>{
  const id=+req.params.id, apps=await readJson(CURRENT,[]);
  const item=apps.find(x=>x.appid===id);
  if(!item) return res.status(404).json({ok:false,error:"not found"});
  res.json({ok:true,app:item});
});
app.get("/api/commits",async(req,res)=>{
  const state=await readJson(STATE,{commits:[]});
  const out=[];
  for(const id of (state.commits||[]).slice(0,+req.query.limit||50)){
    const c=await readJson(path.join(COMMITS,id+".json"),null); if(c) out.push(c);
  }
  res.json({ok:true,commits:out});
});
app.listen(PORT,()=>console.log("Blaze Steam GitDB on "+PORT));
