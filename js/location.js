/* js/location.js — Shared Location System (Region → Route → Neighborhood).
   Single source of truth for CRM (data.customers) and ProspectScout
   (prospectState.shops / ProspectScoutDB). Persisted inside the same
   CRM data blob (data.regions / data.routes / data.neighborhoods) —
   it rides along with the existing saveData()/loadData()/backup
   mechanism, so no new IndexedDB object store or DB_VERSION bump is
   needed. See Location System — Final Implementation Brief, section 1
   ("اگر راه ساده‌تر ... وجود دارد همان را انتخاب کن").

   Generic locationId: today it always resolves to a Neighborhood.id.
   getLocationById()/getLocationHierarchy() are the ONLY places that
   make that assumption — if a future entity (Street, map pin, ...)
   is added, extend the resolver there; nothing else in the app should
   ever compare locationId to a neighborhood id directly.

   Financial logic, Customer/Prospect business logic, and legacy
   region/route/routeId/neighborhoodId fields are never touched here.
*/
'use strict';

// ---------- low-level CRUD (Region) ----------
function listRegions(){
  return (data.regions || []).slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','fa'));
}
function getRegion(id){
  return (data.regions || []).find(r=>r.id===id) || null;
}
async function putRegion(payload){
  const name = (payload && payload.name || '').trim();
  if(!name) return {ok:false, reason:'نام منطقه را وارد کن'};
  if(!Array.isArray(data.regions)) data.regions = [];
  if(payload && payload.id){
    const r = data.regions.find(x=>x.id===payload.id);
    if(!r) return {ok:false, reason:'منطقه پیدا نشد'};
    r.name = name;
    await saveData();
    return {ok:true, region:r};
  }
  const r = {id: uid(), name};
  data.regions.push(r);
  await saveData();
  return {ok:true, region:r};
}
async function deleteRegion(id){
  const dependentRoutes = (data.routes||[]).filter(r=>r.regionId===id).length;
  if(dependentRoutes>0){
    return {ok:false, reason:'این منطقه '+dependentRoutes+' مسیر دارد و حذف نمی‌شود.'};
  }
  data.regions = (data.regions||[]).filter(r=>r.id!==id);
  await saveData();
  return {ok:true};
}

// ---------- low-level CRUD (Route) ----------
function listRoutes(regionId){
  let rows = (data.routes || []).slice();
  if(regionId) rows = rows.filter(r=>r.regionId===regionId);
  return rows.sort((a,b)=>(a.name||'').localeCompare(b.name||'','fa'));
}
function getRoute(id){
  return (data.routes || []).find(r=>r.id===id) || null;
}
async function putRoute(payload){
  const name = (payload && payload.name || '').trim();
  const regionId = payload && payload.regionId;
  if(!name) return {ok:false, reason:'نام مسیر را وارد کن'};
  if(!regionId || !getRegion(regionId)) return {ok:false, reason:'منطقه معتبر انتخاب کن'};
  if(!Array.isArray(data.routes)) data.routes = [];
  if(payload && payload.id){
    const r = data.routes.find(x=>x.id===payload.id);
    if(!r) return {ok:false, reason:'مسیر پیدا نشد'};
    r.name = name; r.regionId = regionId;
    await saveData();
    return {ok:true, route:r};
  }
  const r = {id: uid(), regionId, name};
  data.routes.push(r);
  await saveData();
  return {ok:true, route:r};
}
async function deleteRoute(id){
  const dependentNeighborhoods = (data.neighborhoods||[]).filter(n=>n.routeId===id).length;
  const customerRefs = (data.customers||[]).filter(c=>c.locationId===id).length;
  let prospectRefs = 0;
  try{
    if(typeof openProspectDatabase==='function'){
      if(!prospectDbInstance) await openProspectDatabase();
      const shops = await prospectDbGetAll('shops');
      prospectRefs = (shops||[]).filter(s=>s.locationId===id).length;
    }
  }catch(e){
    console.error('deleteRoute: prospect reference check failed', e);
    return {ok:false, reason:'بررسی وابستگی مغازه‌ها انجام نشد؛ مسیر حذف نشد.'};
  }
  if(dependentNeighborhoods>0 || customerRefs>0 || prospectRefs>0){
    const bits=[];
    if(dependentNeighborhoods>0) bits.push(dependentNeighborhoods+' محله');
    if(customerRefs>0) bits.push(customerRefs+' مشتری');
    if(prospectRefs>0) bits.push(prospectRefs+' مغازه بالقوه');
    return {ok:false, reason:'این مسیر به '+bits.join(' و ')+' متصل است و حذف نمی‌شود.'};
  }
  data.routes = (data.routes||[]).filter(r=>r.id!==id);
  await saveData();
  return {ok:true};
}

// ---------- low-level CRUD (Neighborhood) ----------
function listNeighborhoods(routeId){
  let rows = (data.neighborhoods || []).slice();
  if(routeId) rows = rows.filter(n=>n.routeId===routeId);
  return rows.sort((a,b)=>(a.name||'').localeCompare(b.name||'','fa'));
}
function getNeighborhood(id){
  return (data.neighborhoods || []).find(n=>n.id===id) || null;
}
async function putNeighborhood(payload){
  const name = (payload && payload.name || '').trim();
  const routeId = payload && payload.routeId;
  if(!name) return {ok:false, reason:'نام محله را وارد کن'};
  if(!routeId || !getRoute(routeId)) return {ok:false, reason:'مسیر معتبر انتخاب کن'};
  if(!Array.isArray(data.neighborhoods)) data.neighborhoods = [];
  if(payload && payload.id){
    const n = data.neighborhoods.find(x=>x.id===payload.id);
    if(!n) return {ok:false, reason:'محله پیدا نشد'};
    n.name = name; n.routeId = routeId;
    await saveData();
    return {ok:true, neighborhood:n};
  }
  const n = {id: uid(), routeId, name};
  data.neighborhoods.push(n);
  await saveData();
  return {ok:true, neighborhood:n};
}
/** Counts references from BOTH CRM customers and ProspectScout shops (separate DB). */
async function countLocationReferences(neighborhoodId){
  const custCount = (data.customers||[]).filter(c=>c.locationId===neighborhoodId).length;
  let prospectCount = 0;
  try{
    if(typeof openProspectDatabase==='function'){
      if(!prospectDbInstance) await openProspectDatabase();
      const shops = await prospectDbGetAll('shops');
      prospectCount = (shops||[]).filter(s=>s.locationId===neighborhoodId).length;
    }
  }catch(e){
    console.error('countLocationReferences: prospect check failed', e);
  }
  return {custCount, prospectCount};
}
async function deleteNeighborhood(id){
  const {custCount, prospectCount} = await countLocationReferences(id);
  if(custCount>0 || prospectCount>0){
    const bits = [];
    if(custCount>0) bits.push(custCount+' مشتری');
    if(prospectCount>0) bits.push(prospectCount+' مغازه بالقوه');
    return {ok:false, reason:'این محله به '+bits.join(' و ')+' متصل است و حذف نمی‌شود.'};
  }
  data.neighborhoods = (data.neighborhoods||[]).filter(n=>n.id!==id);
  await saveData();
  return {ok:true};
}

// ---------- generic locationId resolver ----------
/** Today locationId always points to a Neighborhood.id. Central resolver —
    extend HERE if a future entity (Street, map pin, ...) is introduced. */
function getLocationById(locationId){
  if(!locationId) return null;
  const neighborhood = getNeighborhood(locationId);
  if(neighborhood) return {type:'neighborhood', entity:neighborhood};
  const route = getRoute(locationId);
  if(route) return {type:'route', entity:route};
  return null;
}
function getLocationHierarchy(locationId){
  const resolved = getLocationById(locationId);
  if(!resolved) return null;
  if(resolved.type === 'neighborhood') {
    const neighborhood = resolved.entity;
    const route = getRoute(neighborhood.routeId) || null;
    const region = route ? getRegion(route.regionId) : null;
    return {region, route, neighborhood};
  }
  const route = resolved.entity;
  const region = getRegion(route.regionId) || null;
  return {region, route, neighborhood:null};
}
function getLocationDisplayString(locationId){
  const h = getLocationHierarchy(locationId);
  if(!h) return '—';
  const parts = [];
  if(h.region) parts.push(h.region.name);
  if(h.route) parts.push(h.route.name);
  if(h.neighborhood) parts.push(h.neighborhood.name);
  return parts.length ? parts.join(' › ') : '—';
}

// ---------- assignment helpers (Customer / Prospect) ----------
async function setCustomerLocation(customerId, locationId){
  const c = (data.customers||[]).find(x=>x.id===customerId);
  if(!c) return false;
  if(locationId && !getLocationById(locationId)) return false;
  const previous = c.locationId || null;
  c.locationId = locationId || null;
  try{
    await saveData();
    return true;
  }catch(e){
    c.locationId = previous;
    throw e;
  }
}
/** Prospect lives in a separate DB (ProspectScoutDB) — persisted via persistProspectShop(). */
async function setProspectLocation(shopId, locationId){
  if(typeof prospectState==='undefined') return false;
  const shop = prospectState.shops.find(s=>s.id===shopId);
  if(!shop) return false;
  if(locationId && !getLocationById(locationId)) return false;
  const previous = shop.locationId || null;
  shop.locationId = locationId || null;
  try{
    if(typeof persistProspectShop==='function') await persistProspectShop(shop);
    return true;
  }catch(e){
    shop.locationId = previous;
    throw e;
  }
}

// ---------- reusable UI: cascading Region → Route → Neighborhood picker ----------
function renderLocationPickerHTML(idPrefix, selectedLocationId){
  const h = getLocationHierarchy(selectedLocationId);
  const selRegionId = h && h.region ? h.region.id : '';
  const selRouteId = h && h.route ? h.route.id : '';
  const selNeighId = h && h.neighborhood ? h.neighborhood.id : '';
  const regions = listRegions();
  const routes = selRegionId ? listRoutes(selRegionId) : [];
  const neighborhoods = selRouteId ? listNeighborhoods(selRouteId) : [];
  const opt = (list, selId)=> '<option value="">— انتخاب نشده —</option>' +
    list.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===selId?'selected':'')+'>'+esc(x.name)+'</option>').join('');
  return (
    '<div class="field"><label>منطقه</label>' +
    '<select id="'+idPrefix+'-region">'+opt(regions, selRegionId)+'</select></div>' +
    '<div class="field"><label>مسیر</label>' +
    '<select id="'+idPrefix+'-route" '+(!selRegionId?'disabled':'')+'>'+opt(routes, selRouteId)+'</select></div>' +
    '<div class="field"><label>محله</label>' +
    '<select id="'+idPrefix+'-neigh" '+(!selRouteId?'disabled':'')+'>'+opt(neighborhoods, selNeighId)+'</select></div>'
  );
}
/** Wires cascading change handlers for a picker rendered by renderLocationPickerHTML.
    Returns {getValue} — getValue() returns the selected locationId (neighborhoodId) or null. */
function wireLocationPicker(idPrefix){
  const regionSel = document.getElementById(idPrefix+'-region');
  const routeSel = document.getElementById(idPrefix+'-route');
  const neighSel = document.getElementById(idPrefix+'-neigh');
  const opt = (list, selId)=> '<option value="">— انتخاب نشده —</option>' +
    list.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===selId?'selected':'')+'>'+esc(x.name)+'</option>').join('');
  if(regionSel) regionSel.addEventListener('change', function(){
    const rid = regionSel.value;
    if(routeSel){ routeSel.innerHTML = opt(rid?listRoutes(rid):[], ''); routeSel.disabled = !rid; }
    if(neighSel){ neighSel.innerHTML = opt([], ''); neighSel.disabled = true; }
  });
  if(routeSel) routeSel.addEventListener('change', function(){
    const rid = routeSel.value;
    if(neighSel){ neighSel.innerHTML = opt(rid?listNeighborhoods(rid):[], ''); neighSel.disabled = !rid; }
  });
  return {
    getValue(){
      if(neighSel && neighSel.value) return neighSel.value;
      if(routeSel && routeSel.value) return routeSel.value;
      return null;
    }
  };
}

/** Generic "Assign Location" sheet, reused by Customer and Prospect detail views.
    opts: {title, currentLocationId, onSave(locationId)} */
function openLocationAssignSheet(opts){
  opts = opts || {};
  const idPrefix = 'loc-assign';
  const current = opts.currentLocationId || null;
  const html =
    '<h3>'+esc(opts.title||'اختصاص موقعیت')+'</h3>' +
    '<div class="sub" style="margin-bottom:10px;">موقعیت فعلی: '+esc(getLocationDisplayString(current))+'</div>' +
    renderLocationPickerHTML(idPrefix, current) +
    '<div class="btn-row" style="margin-top:10px;">' +
    '<button type="button" class="btn" id="'+idPrefix+'-save">ذخیره</button>' +
    '<button type="button" class="btn secondary" id="'+idPrefix+'-clear">پاک کردن موقعیت</button>' +
    '</div>';
  openSheet(html);
  const picker = wireLocationPicker(idPrefix);
  const saveBtn = document.getElementById(idPrefix+'-save');
  const clearBtn = document.getElementById(idPrefix+'-clear');
  const run = async function(locationId){
    try{
      await opts.onSave(locationId);
      closeModal();
    }catch(e){
      console.error('openLocationAssignSheet save failed', e);
      showToast('ذخیره نشد، دوباره تلاش کن');
    }
  };
  if(saveBtn) saveBtn.addEventListener('click', function(){ run(picker.getValue()); });
  if(clearBtn) clearBtn.addEventListener('click', function(){ run(null); });
}
