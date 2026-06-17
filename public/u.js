const D=document,$=i=>D.getElementById(i);
let syncTimer=null;
async function A(u,o){let r=await fetch(u,o||{});let j=await r.json();if(!r.ok)throw Error(j.error||r.status);return j}
function R(x){return '<div class="row">'+x+'</div>'}
function prog(s){
 let c=s.crawl||{};
 let parts=[];
 parts.push('<b>games</b> '+(s.total||0));
 parts.push('<b>commits</b> '+(s.commits||0));
 if(c){
  parts.push('<b>crawl collected</b> '+(c.collected||s.total||0));
  if(c.totalKnown) parts.push('<b>steam total</b> '+c.totalKnown);
  if(c.start!==undefined) parts.push('<b>next page start</b> '+c.start);
  if(c.done!==undefined) parts.push('<b>done</b> '+c.done);
  if(c.totalKnown){
    let p=Math.min(100,Math.round(((c.collected||s.total||0)/c.totalKnown)*100));
    parts.push('<progress max="100" value="'+p+'" style="width:100%"></progress> '+p+'%');
  }
 }
 if(s.lastError) parts.push('<b>error</b> '+s.lastError.message);
 return parts.join('<br>');
}
async function K(){try{let s=await A('/api/settings');$('ks').innerHTML=s.steamApiKeySaved?'saved <b>'+s.steamApiKeyMasked+'</b>':(s.note||'not saved')}catch(e){$('ks').textContent=e.message}}
async function S(){try{let s=await A('/api/status');$('badge').textContent=s.running?'syncing':(s.lastError?'error':'ok');$('st').innerHTML=prog(s);C();if(!s.running&&syncTimer){clearInterval(syncTimer);syncTimer=null}}catch(e){$('st').textContent=e.message}}
async function save(){try{let k=$('k').value.trim();let j=await A('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({steamApiKey:k})});$('ks').innerHTML='saved <b>'+(j.steamApiKeyMasked||'ok')+'</b>';S()}catch(e){$('ks').textContent=e.message}}
async function sync(){
 try{
  $('st').innerHTML='sync started...<br><progress></progress>';
  if(!syncTimer)syncTimer=setInterval(S,2000);
  let r=await A('/api/sync',{method:'POST'});
  $('st').innerHTML='sync batch done<br><b>games</b> '+r.total+'<br><b>changed</b> '+r.changed;
  await S();await F();
 }catch(e){$('st').textContent=e.message;S()}
}
async function F(){try{let q=$('q').value;let d=await A('/api/apps?q='+encodeURIComponent(q)+'&limit=100');$('r').innerHTML=(d.apps||[]).map(x=>R('<b>'+x.name+'</b><br>'+x.appid)).join('')||''}catch(e){$('r').textContent=e.message}}
async function C(){try{let d=await A('/api/commits?limit=20');$('c').innerHTML=(d.commits||[]).map(x=>R(x.createdAt+'<br>total '+x.total+' | +'+x.diff.added+' -'+x.diff.removed+' renamed '+x.diff.renamed)).join('')}catch(e){$('c').textContent=e.message}}
$('sk').onclick=save;$('sy').onclick=sync;$('rf').onclick=S;$('find').onclick=F;$('q').onkeydown=e=>{if(e.key==='Enter')F()};
K();S();setInterval(S,10000);
