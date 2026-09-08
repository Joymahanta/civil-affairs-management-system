(()=>{
 const $=s=>document.querySelector(s);
 const api=async(u,o={})=>{const r=await fetch(u,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(o.headers||{})},...o});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Request failed.');return d};
 function patch(){const gate=$('#rs-gate');if(!gate)return;const sub=gate.querySelector('.sub');if(sub)sub.textContent='Sign in with a mobile number or email address registered in the Workforce staff register.';const label=gate.querySelector('label');if(label)label.textContent='Workforce mobile number or email';}
 async function refreshSession(){try{const d=await api('/api/resident/session');if(!d.authenticated)return;const name=$('#rs-user-name');if(name)name.textContent='Signed in: '+(d.user?.name||'Workforce staff');}catch(_) {}}
 function patchQuarter(){const original=window.fetch;if(window.__camsResidentFetchPatched)return;window.__camsResidentFetchPatched=true;window.fetch=async(...args)=>{const r=await original(...args);return r;};const observer=new MutationObserver(()=>patch());observer.observe(document.body,{childList:true,subtree:true});patch();refreshSession();}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',patchQuarter,{once:true});else patchQuarter();
})();