/* prospect-db.js — separate IndexedDB for prospects (does NOT touch baqeriDB) */
const PROSPECT_DB_NAME = 'ProspectScoutDB';
const PROSPECT_DB_VERSION = 1;
let prospectDbInstance = null;

function openProspectDatabase(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(PROSPECT_DB_NAME, PROSPECT_DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains('shops')) db.createObjectStore('shops',{keyPath:'id'});
      if(!db.objectStoreNames.contains('routes')) db.createObjectStore('routes',{keyPath:'id'});
      if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'key'});
    };
    req.onsuccess = (e)=>{ prospectDbInstance = e.target.result; resolve(prospectDbInstance); };
    req.onerror = (e)=>{ reject(e.target.error); };
  });
}
function prospectStore(name, mode){ return prospectDbInstance.transaction(name, mode).objectStore(name); }
function prospectDbGetAll(name){
  return new Promise((resolve,reject)=>{
    const r = prospectStore(name,'readonly').getAll();
    r.onsuccess=()=>resolve(r.result||[]); r.onerror=()=>reject(r.error);
  });
}
function prospectDbGet(name,key){
  return new Promise((resolve,reject)=>{
    const r = prospectStore(name,'readonly').get(key);
    r.onsuccess=()=>resolve(r.result||null); r.onerror=()=>reject(r.error);
  });
}
function prospectDbPut(name,value){
  return new Promise((resolve,reject)=>{
    const r = prospectStore(name,'readwrite').put(value);
    r.onsuccess=()=>resolve(value); r.onerror=()=>reject(r.error);
  });
}
function prospectDbDelete(name,key){
  return new Promise((resolve,reject)=>{
    const r = prospectStore(name,'readwrite').delete(key);
    r.onsuccess=()=>resolve(true); r.onerror=()=>reject(r.error);
  });
}

/**
 * A visit is a repeatable EVENT (spec: Evaluation V2, §4). Legacy visits
 * (scoringVersion 1, no `type`) keep their original full-evaluation shape
 * and rank fallback behavior — untouched for backward compatibility.
 * V2 events (`type` 'initial' | 'followup' | 'snapshot_edit') carry a possibly-null
 * score/rank/knownCount and MUST NOT receive a computed fallback rank:
 * `rank || prospectScoreToRank(0)` would silently turn "no rank yet" into
 * a false "D", which is exactly what the V2 model forbids for incomplete
 * prospects.
 */
function normalizeProspectVisit(raw){
  const scoringVersion = raw.scoringVersion || 1;
  const isV2 = scoringVersion >= 2;
  return {
    id: raw.id || (typeof uid==='function'?uid():String(Date.now())),
    date: raw.date || prospectNowISO(),
    // 'legacy' = old full 10Q evaluation visit; 'initial' = V2 first evaluation;
    // 'followup' = V2 lightweight follow-up event; 'snapshot_edit' = targeted
    // Snapshot answer audit event (does not count as a visit).
    type: raw.type || 'legacy',
    answers: (raw.answers && typeof raw.answers==='object') ? raw.answers : {},
    score: typeof raw.score==='number' ? raw.score : (isV2 ? null : 0),
    rank: isV2 ? (raw.rank || null) : (raw.rank || prospectScoreToRank(typeof raw.score==='number'?raw.score:0)),
    knownCount: typeof raw.knownCount==='number' ? raw.knownCount : null,
    scoringVersion: scoringVersion,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    // V2 follow-up fields (spec §13-§15). Harmless/unused on legacy visits.
    note: typeof raw.note==='string' ? raw.note : '',
    nextFollowUpDate: raw.nextFollowUpDate || null,
    // { questionId, from, to } when this follow-up included a targeted
    // Snapshot edit (spec §14); null otherwise.
    snapshotEdit: (raw.snapshotEdit && typeof raw.snapshotEdit==='object') ? raw.snapshotEdit : null,
  };
}
/**
 * Current-state Snapshot (spec §11) for V2 prospects. Independent of the
 * Visit History log — editing the Snapshot never rewrites past visits.
 */
function normalizeProspectSnapshot(raw){
  if(!raw || typeof raw!=='object') return null;
  return {
    profile: raw.profile || null,
    businessType: raw.businessType || null,
    answers: (raw.answers && typeof raw.answers==='object') ? {...raw.answers} : {},
    score: typeof raw.score==='number' ? raw.score : null,
    rank: raw.rank || null,
    knownCount: typeof raw.knownCount==='number' ? raw.knownCount : 0,
    scoringVersion: raw.scoringVersion || (typeof PROSPECT_SCORING_VERSION_V2!=='undefined' ? PROSPECT_SCORING_VERSION_V2 : 2),
    updatedAt: raw.updatedAt || prospectNowISO(),
  };
}
function normalizeProspectShop(raw){
  const scoringVersion = raw.scoringVersion || 1;
  const isV2 = scoringVersion >= 2;
  return {
    id: raw.id || (typeof uid==='function'?uid():String(Date.now())),
    schemaVersion: raw.schemaVersion || 1,
    name: raw.name || '(بدون نام)',
    routeId: raw.routeId || null,
    neighborhoodId: raw.neighborhoodId || null,
    // Shared Location System reference (js/location.js) — separate from the
    // legacy routeId/neighborhoodId above, which keep managing ProspectScout's
    // own route/neighborhood list untouched.
    locationId: raw.locationId!==undefined ? raw.locationId : null,
    status: raw.status==='converted' ? 'converted' : 'active',
    linkedCustomerId: raw.linkedCustomerId || null,
    createdAt: raw.createdAt || prospectNowISO(),
    updatedAt: raw.updatedAt || raw.createdAt || prospectNowISO(),
    // scoringVersion 1 = legacy 10-question model. 2 = profile-aware V2
    // Snapshot/Event model (spec §35: never mix the two on one shop).
    scoringVersion: scoringVersion,
    profile: raw.profile || null,
    businessType: raw.businessType || null,
    snapshot: normalizeProspectSnapshot(raw.snapshot),
    latestScore: typeof raw.latestScore==='number' ? raw.latestScore : 0,
    latestRank: isV2 ? (raw.latestRank || null) : (raw.latestRank || prospectScoreToRank(typeof raw.latestScore==='number'?raw.latestScore:0)),
    visits: Array.isArray(raw.visits) ? raw.visits.map(normalizeProspectVisit) : [],
  };
}
function normalizeProspectRoute(raw){
  return {
    id: raw.id || (typeof uid==='function'?uid():String(Date.now())),
    schemaVersion: 1,
    name: raw.name || '(بدون نام)',
    createdAt: raw.createdAt || prospectNowISO(),
    neighborhoods: Array.isArray(raw.neighborhoods) ? raw.neighborhoods.map(n=>({id:n.id||(typeof uid==='function'?uid():String(Date.now())), name:n.name||''})) : [],
  };
}
