const $=id=>document.getElementById(id);
const appid=new URLSearchParams(location.search).get('appid');
function h(x){return String(x||'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
async function api(u){let r=await fetch(u);let t=await r.text(),d;try{d=JSON.parse(t)}catch(e){throw Error(t.slice(0,200))}if(!r.ok)throw Error(d.error||r.status);return d}
function pill(k,v){return v?'<div class="row"><b>'+h(k)+'</b><br>'+h(v)+'</div>':''}
function render(d){
 let a=d.app,raw=d.details?.catchedAt?d.details.raw:null,r=raw?.success?raw.data:raw;
 $('title').textContent=a.name;$('sub').innerHTML='appid '+a.appid+'  '+(a.steamUrl?'<a href="'+a.steamUrl+'" target="_blank">Open in Steam</a>':'');
 let img=a.capsule?'<img src="'+a.capsule+' style="max-width:100%;border-radius:16px">':'';
 let html=img+'pill("Name",a.name)+pill("Release",a.release)+pill("Price",a.price)+pill("Reviews",a.reviews)+pill("Platforms",(a.platforms||[]).join(', '));
 if(r){html+=pill('Type',r.type)+pill('Developers',(r.developers||[]).join(', '))+pill('Publishers',(r.publishers||[]).join(', '))+pill('Release',r?.release_date?.date)+pill('Is free',r.is_free?+r.is_free:nnull);if(r.short_description)html+='<div class="row">'+r.short_description+'</div>';}
 $('main').innerHTML=html;$('local').textContent=JSON.stringify(a,null,2);$('raw').textContent=JSON.stringify(r,null,2);
if(d.detailError)$('badge').textContent='detail error';else $('badge').textContent='ok';
}
api('/api/apps/'+appid).then(render).catch(e=>{$('main').textContent=e.message;$('badge').textContent='error'});
