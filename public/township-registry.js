(()=>{
  const $=s=>document.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));

  const shops=[
    {no:'SM-01',name:'FreshMart Grocers',owner:'R. Das',category:'Grocery & provisions',phone:'+91 98765 12001',status:'Open',hours:'07:00–21:30',location:'Supermarket Block A'},
    {no:'SM-02',name:'STPS Pharmacy',owner:'P. Sharma',category:'Pharmacy',phone:'+91 98765 12002',status:'Open',hours:'08:00–22:00',location:'Supermarket Block A'},
    {no:'SM-03',name:'Township Bakery',owner:'M. Roy',category:'Bakery & snacks',phone:'+91 98765 12003',status:'Open',hours:'06:30–20:30',location:'Supermarket Block B'},
    {no:'SM-04',name:'Daily Needs',owner:'A. Singh',category:'Household supplies',phone:'+91 98765 12004',status:'Open',hours:'08:00–21:00',location:'Supermarket Block B'},
    {no:'SM-05',name:'Green Leaf Café',owner:'N. Bora',category:'Food & beverage',phone:'+91 98765 12005',status:'Closed for maintenance',hours:'09:00–22:00',location:'Supermarket Block C'},
    {no:'SM-06',name:'Mobile & Repair Hub',owner:'S. Verma',category:'Electronics & repair',phone:'+91 98765 12006',status:'Open',hours:'09:30–20:00',location:'Supermarket Block C'}
  ];

  const civilians=[
    {quarter:'F/12',resident:'Arun Sharma',family:4,occupation:'Electrical technician',phone:'+91 98100 11001',status:'Occupied',sector:'Sector 1'},
    {quarter:'F/18',resident:'Meena Das',family:3,occupation:'School teacher',phone:'+91 98100 11002',status:'Occupied',sector:'Sector 1'},
    {quarter:'G/04',resident:'Rajiv Kumar',family:5,occupation:'Plant operator',phone:'+91 98100 11003',status:'Occupied',sector:'Sector 2'},
    {quarter:'G/11',resident:'Priya Nair',family:2,occupation:'Accountant',phone:'+91 98100 11004',status:'Occupied',sector:'Sector 2'},
    {quarter:'H/07',resident:'Sanjay Roy',family:4,occupation:'Mechanical supervisor',phone:'+91 98100 11005',status:'Occupied',sector:'Sector 3'},
    {quarter:'H/16',resident:'Kavita Singh',family:3,occupation:'Nurse',phone:'+91 98100 11006',status:'Occupied',sector:'Sector 3'},
    {quarter:'J/03',resident:'Vikram Bora',family:1,occupation:'Plant apprentice',phone:'+91 98100 11007',status:'Occupied',sector:'Sector 4'},
    {quarter:'J/14',resident:'Anita Paul',family:4,occupation:'Civil office clerk',phone:'+91 98100 11008',status:'Occupied',sector:'Sector 4'},
    {quarter:'K/09',resident:'Rahul Mehta',family:0,occupation:'—',phone:'—',status:'Vacant',sector:'Sector 5'},
    {quarter:'K/17',resident:'Deepa Sharma',family:2,occupation:'Laboratory assistant',phone:'+91 98100 11010',status:'Occupied',sector:'Sector 5'}
  ];

  function styles(){
    if($('#township-registry-styles'))return;
    const s=document.createElement('style');s.id='township-registry-styles';
    s.textContent=`
      #supermarket-shops .registry-summary,#township-civilians .registry-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:18px}
      .registry-stat{background:#fff;border:1px solid #dfeae5;border-radius:14px;padding:15px 16px}.registry-stat .value{font:800 25px/1 Manrope,Arial,sans-serif;color:#123e32}.registry-stat .label{font-size:11px;color:#72817b;margin-top:6px}
      .registry-status{display:inline-flex;align-items:center;padding:5px 9px;border-radius:99px;background:#e8f4ef;color:#17684f;font-size:10px;font-weight:800}.registry-status.warn{background:#fff3df;color:#9a6415}.registry-status.vacant{background:#eef1f0;color:#687570}
      .registry-search{width:230px;max-width:100%}
      .registry-note{margin-bottom:18px;padding:12px 14px;border:1px solid #d9e9e2;background:#f4faf7;border-radius:12px;color:#536b62;font-size:11px;line-height:1.5}
      @media(max-width:800px){#supermarket-shops .registry-summary,#township-civilians .registry-summary{grid-template-columns:1fr}.registry-search{width:100%}}
    `;document.head.appendChild(s);
  }

  function addNav(){
    const settings=$('[data-admin-page="settings"]');
    if(!settings||settings.dataset.townshipNavReady)return;
    settings.dataset.townshipNavReady='1';
    const label=document.createElement('div');label.className='side-label';label.textContent='TOWNSHIP';settings.parentElement.insertBefore(label,settings);
    const make=(page,icon,text)=>{const b=document.createElement('button');b.className='side-nav';b.dataset.adminPage=page;b.innerHTML=`<span>${icon}</span><span>${text}</span>`;b.onclick=()=>show(page);settings.parentElement.insertBefore(b,label);return b};
    make('supermarket-shops','▥','Supermarket shops');
    make('township-civilians','♙','Township civilians');
  }

  function pageShell(id,eyebrow,title,sub,actions,body){
    const sec=document.createElement('section');sec.className='admin-page';sec.id=id;sec.innerHTML=`<div class="title-row"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="sub">${sub}</p></div><div class="action-line">${actions||''}</div></div>${body}`;$('.content').appendChild(sec);return sec;
  }

  function buildShops(){
    if($('#supermarket-shops'))return;
    const body=`<div class="registry-summary"><div class="registry-stat"><div class="value">${shops.length}</div><div class="label">Registered shops</div></div><div class="registry-stat"><div class="value">${shops.filter(x=>x.status==='Open').length}</div><div class="label">Currently open</div></div><div class="registry-stat"><div class="value">${shops.filter(x=>x.status!=='Open').length}</div><div class="label">Needs attention</div></div></div><div class="registry-note"><b>Development register</b> — This section currently uses hard-coded demonstration records. It is ready to be connected to a permanent supermarket/shop database later.</div><div class="card"><div class="card-head"><h2>Supermarket shop register</h2><input class="filter registry-search" id="shop-search" placeholder="Search shops, owner or category"></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Shop</th><th>Business</th><th>Owner / operator</th><th>Category</th><th>Contact</th><th>Hours</th><th>Status</th></tr></thead><tbody id="shop-body"></tbody></table></div></div>`;
    pageShell('supermarket-shops','Township commerce','Supermarket shops','Manage the township supermarket, its shop operators and day-to-day operating status.','<button class="button" id="shop-add-demo">＋ Add demo shop</button>',body);
    const render=()=>{const q=String($('#shop-search')?.value||'').toLowerCase();const rows=shops.filter(x=>Object.values(x).some(v=>String(v).toLowerCase().includes(q)));$('#shop-body').innerHTML=rows.map(x=>`<tr><td><b>${esc(x.no)}</b><br><span class="sub">${esc(x.location)}</span></td><td><b>${esc(x.name)}</b></td><td>${esc(x.owner)}<br><span class="sub">${esc(x.phone)}</span></td><td>${esc(x.category)}</td><td>${esc(x.phone)}</td><td>${esc(x.hours)}</td><td><span class="registry-status ${x.status==='Open'?'':'warn'}">${esc(x.status)}</span></td></tr>`).join('')||'<tr><td colspan="7" class="empty">No shops match your search.</td></tr>'};
    $('#shop-search').oninput=render;$('#shop-add-demo').onclick=()=>{const n=shops.length+1;shops.push({no:`SM-${String(n).padStart(2,'0')}`,name:'New Demo Shop',owner:'Demo operator',category:'General retail',phone:'+91 90000 00000',status:'Open',hours:'09:00–20:00',location:'Supermarket Block C'});render();};render();
  }

  function buildCivilians(){
    if($('#township-civilians'))return;
    const occupied=civilians.filter(x=>x.status==='Occupied');
    const families=occupied.reduce((n,x)=>n+x.family,0);
    const body=`<div class="registry-summary"><div class="registry-stat"><div class="value">${civilians.length}</div><div class="label">Quarter records</div></div><div class="registry-stat"><div class="value">${occupied.length}</div><div class="label">Occupied quarters</div></div><div class="registry-stat"><div class="value">${families}</div><div class="label">Residents in demo data</div></div></div><div class="registry-note"><b>Development register</b> — These civilian records are dummy data for interface development. They are not connected to the live resident database.</div><div class="card"><div class="card-head"><h2>Township civilian register</h2><input class="filter registry-search" id="civilian-search" placeholder="Search quarter, resident or sector"></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Quarter</th><th>Resident / head of household</th><th>Family</th><th>Occupation</th><th>Phone</th><th>Sector</th><th>Status</th></tr></thead><tbody id="civilian-body"></tbody></table></div></div>`;
    pageShell('township-civilians','Residential administration','Township civilians','View the civilian population assigned to township quarters and their occupancy status.','<button class="button" id="civilian-add-demo">＋ Add demo resident</button>',body);
    const render=()=>{const q=String($('#civilian-search')?.value||'').toLowerCase();const rows=civilians.filter(x=>Object.values(x).some(v=>String(v).toLowerCase().includes(q)));$('#civilian-body').innerHTML=rows.map(x=>`<tr><td><b>${esc(x.quarter)}</b></td><td><b>${esc(x.resident)}</b></td><td>${x.family?esc(x.family):'—'}</td><td>${esc(x.occupation)}</td><td>${esc(x.phone)}</td><td>${esc(x.sector)}</td><td><span class="registry-status ${x.status==='Occupied'?'':'vacant'}">${esc(x.status)}</span></td></tr>`).join('')||'<tr><td colspan="7" class="empty">No civilian records match your search.</td></tr>'};
    $('#civilian-search').oninput=render;$('#civilian-add-demo').onclick=()=>{const n=civilians.length+1;civilians.push({quarter:`L/${String(n).padStart(2,'0')}`,resident:'Demo Resident',family:3,occupation:'Township employee',phone:'+91 90000 00001',status:'Occupied',sector:'Sector 6'});render();};render();
  }

  function show(page){
    document.querySelectorAll('.admin-page').forEach(x=>x.classList.remove('active'));
    const target=document.getElementById(page);if(!target)return;target.classList.add('active');
    document.querySelectorAll('[data-admin-page]').forEach(x=>x.classList.toggle('active',x.dataset.adminPage===page));
    const crumb=$('#crumb');if(crumb)crumb.textContent=page==='supermarket-shops'?'Supermarket shops':'Township civilians';
  }

  function boot(){styles();addNav();buildShops();buildCivilians();
    document.querySelectorAll('[data-admin-page="supermarket-shops"],[data-admin-page="township-civilians"]').forEach(b=>b.onclick=()=>show(b.dataset.adminPage));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
