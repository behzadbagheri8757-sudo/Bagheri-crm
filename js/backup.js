/* backup.js — export/import JSON, auto-backup, undo restore, excel export
   Freeze blocker fix: application-level restore journal + deep validation.
*/
// ---------- backup / restore ----------
async function downloadFile(filename, blobParts, mime){
  const blob = (blobParts instanceof Blob) ? blobParts : new Blob([blobParts], {type:mime});
  // iOS Safari often just previews a blob link instead of saving it — the
  // share sheet's "Save to Files" is the reliable path on iPhone.
  try{
    if(navigator.canShare){
      const file = new File([blob], filename, {type:mime});
      if(navigator.canShare({files:[file]})){
        await navigator.share({files:[file], title:filename});
        return;
      }
    }
  }catch(e){
    // user cancelled the share sheet, or share isn't available — fall back below
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}

/** کلید اسنپ‌شات Prospect قبل از Restore (داخل همان baqeriDB، جدا از CRM) */
const PRERESTORE_PROSPECT_KEY = 'preRestoreProspect';
/** کلید اسنپ‌شات Intelligence قبل از Restore (داخل همان baqeriDB، جدا از CRM) */
const PRERESTORE_INTELLIGENCE_KEY = 'preRestoreIntelligence';
/** کلید اسنپ‌شات هدف فروش ماهانه قبل از Restore */
const PRERESTORE_TARGET_KEY = 'preRestoreSalesTarget';
/** کلید اسنپ‌شات Watch Lifecycle قبل از Restore */
const PRERESTORE_WATCH_KEY = 'preRestoreWatchLifecycle';
/** کلید اسنپ‌شات Game Center قبل از Restore */
const PRERESTORE_GAME_KEY = 'preRestoreGameState';

/**
 * دسترسی مستقیم به ProspectScoutDB (بدون وابستگی به لود بودن prospect-db.js)
 * تا Backup از صفحه تنظیمات هم کار کند.
 */
function openProspectScoutDbForBackup(){
  return new Promise((resolve, reject)=>{
    try{
      const req = indexedDB.open('ProspectScoutDB', 1);
      req.onupgradeneeded = (e)=>{
        const db = e.target.result;
        if(!db.objectStoreNames.contains('shops')) db.createObjectStore('shops',{keyPath:'id'});
        if(!db.objectStoreNames.contains('routes')) db.createObjectStore('routes',{keyPath:'id'});
        if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'key'});
      };
      req.onsuccess = (e)=> resolve(e.target.result);
      req.onerror = (e)=> reject(e.target.error);
    }catch(e){ reject(e); }
  });
}
function prospectBackupGetAll(db, storeName){
  return new Promise((resolve, reject)=>{
    const r = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    r.onsuccess = ()=> resolve(r.result||[]);
    r.onerror = ()=> reject(r.error);
  });
}
function prospectBackupGet(db, storeName, key){
  return new Promise((resolve, reject)=>{
    const r = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    r.onsuccess = ()=> resolve(r.result||null);
    r.onerror = ()=> reject(r.error);
  });
}
function prospectBackupPut(db, storeName, value){
  return new Promise((resolve, reject)=>{
    const r = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
    r.onsuccess = ()=> resolve(value);
    r.onerror = ()=> reject(r.error);
  });
}
function prospectBackupDelete(db, storeName, key){
  return new Promise((resolve, reject)=>{
    const r = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
    r.onsuccess = ()=> resolve(true);
    r.onerror = ()=> reject(r.error);
  });
}

/** خواندن بسته‌ی Prospect برای Backup — در صورت نبود DB یا خطا null */
async function exportProspectScoutBundle(){
  try{
    const db = await openProspectScoutDbForBackup();
    const shops = await prospectBackupGetAll(db, 'shops');
    const routes = await prospectBackupGetAll(db, 'routes');
    const dtRec = await prospectBackupGet(db, 'meta', 'dailyTarget');
    try{ db.close(); }catch(e){}
    return {
      version: 1,
      shops: shops || [],
      routes: routes || [],
      dailyTarget: (dtRec && dtRec.value) ? dtRec.value : null,
    };
  }catch(e){
    console.error('exportProspectScoutBundle failed', e);
    return null;
  }
}

/**
 * FIX 1 (audit P1): تمام delete/put مربوط به restore ProspectScout را در یک
 * IndexedDB readwrite transaction واحد (روی هر سه store: shops/routes/meta)
 * انجام می‌دهد. shops/routes با clear()+put() جایگزین کامل می‌شوند (همان اثر
 * نهایی delete-all-then-put-all قبلی، اما atomic)؛ meta فقط با یک put هدفمند
 * روی کلید dailyTarget دست می‌خورد و سایر کلیدهای meta دست‌نخورده می‌مانند —
 * دقیقاً همان رفتار قبلی. اگر هر request داخل این تراکنش خطا بدهد، خود
 * IndexedDB کل تراکنش را abort می‌کند و هیچ تغییری commit نمی‌شود، پس داده‌ی
 * قبلی Prospect دست‌نخورده باقی می‌ماند (all-or-nothing).
 */
function runProspectRestoreTx(db, bundle){
  return new Promise((resolve, reject)=>{
    let settled = false;
    const finish = (ok, err)=>{
      if(settled) return;
      settled = true;
      if(ok) resolve(true); else reject(err || new Error('prospect restore transaction failed'));
    };
    try{
      const tx = db.transaction(['shops','routes','meta'], 'readwrite');
      tx.oncomplete = ()=> finish(true);
      tx.onerror = (e)=> finish(false, (e && e.target && e.target.error) || tx.error);
      tx.onabort = ()=> finish(false, tx.error);

      const shopsStore = tx.objectStore('shops');
      const routesStore = tx.objectStore('routes');
      const metaStore = tx.objectStore('meta');

      shopsStore.clear();
      (bundle.shops||[]).forEach(s=> shopsStore.put(s));

      routesStore.clear();
      (bundle.routes||[]).forEach(r=> routesStore.put(r));

      if(bundle.dailyTarget != null){
        metaStore.put({key:'dailyTarget', value: bundle.dailyTarget});
      }
      // یک request ناموفق در این تراکنش (preventDefault نشده) به‌صورت خودکار
      // کل تراکنش را abort می‌کند؛ finish از طریق onerror/onabort صدا زده می‌شود.
    }catch(e){
      finish(false, e);
    }
  });
}

/** جایگزینی کامل داده‌ی Prospect از bundle بکاپ — فقط وقتی bundle معتبر است */
async function restoreProspectScoutBundle(bundle){
  if(!bundle || typeof bundle !== 'object') return false;
  if(!Array.isArray(bundle.shops) && !Array.isArray(bundle.routes) && bundle.dailyTarget == null) return false;
  let db = null;
  try{
    db = await openProspectScoutDbForBackup();
    await runProspectRestoreTx(db, bundle);
    return true;
  }catch(e){
    console.error('restoreProspectScoutBundle failed', e);
    return false;
  }finally{
    if(db){ try{ db.close(); }catch(e){} }
  }
}


/* ============================================================
   Intelligence backup / restore (bagheri_intelligence_db)
   Additive only. Does not touch CRM or ProspectScout.
   Runtime DBs stay separate; one user-facing backup file.
   ============================================================ */
const INTELLIGENCE_DB_NAME = 'bagheri_intelligence_db';
const INTELLIGENCE_DB_VERSION = 3;
const INTELLIGENCE_STORES = ['occurrences', 'seller_feedback', 'baseline_cache'];
const INTELLIGENCE_LS_KEYS = {
  occurrences: 'bagheri_intelligence_occurrences',
  seller_feedback: 'bagheri_intelligence_seller_feedback',
  baseline_cache: 'bagheri_intelligence_baseline_cache'
};

function openIntelligenceDbForBackup(){
  return new Promise((resolve, reject)=>{
    try{
      const req = indexedDB.open(INTELLIGENCE_DB_NAME, INTELLIGENCE_DB_VERSION);
      req.onupgradeneeded = (e)=>{
        const db = e.target.result;
        if(!db.objectStoreNames.contains('occurrences')){
          db.createObjectStore('occurrences', { keyPath: 'key' });
        }
        if(!db.objectStoreNames.contains('seller_feedback')){
          db.createObjectStore('seller_feedback', { keyPath: 'id' });
        }
        if(!db.objectStoreNames.contains('baseline_cache')){
          db.createObjectStore('baseline_cache', { keyPath: 'key' });
        }
      };
      req.onsuccess = (e)=> resolve(e.target.result);
      req.onerror = (e)=> reject(e.target.error);
    }catch(e){ reject(e); }
  });
}

function intelligenceBackupGetAll(db, storeName){
  return new Promise((resolve, reject)=>{
    try{
      if(!db.objectStoreNames.contains(storeName)){
        resolve([]);
        return;
      }
      const r = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      r.onsuccess = ()=> resolve(r.result || []);
      r.onerror = ()=> reject(r.error);
    }catch(e){ reject(e); }
  });
}

async function exportIntelligenceBundle(){
  let db = null;
  try{
    db = await openIntelligenceDbForBackup();
    let occurrences = await intelligenceBackupGetAll(db, 'occurrences');
    let seller_feedback = await intelligenceBackupGetAll(db, 'seller_feedback');
    let baseline_cache = await intelligenceBackupGetAll(db, 'baseline_cache');
    // localStorage is the synchronous mirror used by the Intelligence modules
    // for immediate state. Prefer it when present so a backup taken immediately
    // after a write cannot capture a stale async IDB mirror.
    try{
      const occRaw=localStorage.getItem(INTELLIGENCE_LS_KEYS.occurrences);
      if(occRaw){ const map=JSON.parse(occRaw); if(map && typeof map==='object' && !Array.isArray(map)) occurrences=Object.keys(map).map(k=>({key:k,dates:Array.isArray(map[k])?map[k]:[]})); }
      const fbRaw=localStorage.getItem(INTELLIGENCE_LS_KEYS.seller_feedback);
      if(fbRaw){ const arr=JSON.parse(fbRaw); if(Array.isArray(arr)) seller_feedback=arr; }
      const baseRaw=localStorage.getItem(INTELLIGENCE_LS_KEYS.baseline_cache);
      if(baseRaw){ const map=JSON.parse(baseRaw); if(map && typeof map==='object' && !Array.isArray(map)) baseline_cache=Object.keys(map).map(k=>map[k]).filter(Boolean); }
    }catch(lsErr){ console.warn('exportIntelligenceBundle localStorage mirror read failed',lsErr); }
    return { dbVersion: INTELLIGENCE_DB_VERSION, occurrences: occurrences || [], seller_feedback: seller_feedback || [], baseline_cache: baseline_cache || [] };
  }catch(e){
    console.error('exportIntelligenceBundle failed', e);
    return null;
  }finally{
    if(db){ try{ db.close(); }catch(e){} }
  }
}

function runIntelligenceRestoreTx(db, bundle){
  return new Promise((resolve, reject)=>{
    let settled = false;
    const finish = (ok, err)=>{
      if(settled) return;
      settled = true;
      if(ok) resolve(true); else reject(err || new Error('intelligence restore transaction failed'));
    };
    try{
      const storeNames = INTELLIGENCE_STORES.filter(function(name){
        return db.objectStoreNames.contains(name);
      });
      if(!storeNames.length){
        finish(false, new Error('no intelligence stores present'));
        return;
      }
      const tx = db.transaction(storeNames, 'readwrite');
      tx.oncomplete = ()=> finish(true);
      tx.onerror = (e)=> finish(false, (e && e.target && e.target.error) || tx.error);
      tx.onabort = ()=> finish(false, tx.error);

      storeNames.forEach(function(name){
        const store = tx.objectStore(name);
        store.clear();
        const rows = (bundle && Array.isArray(bundle[name])) ? bundle[name] : [];
        rows.forEach(function(row){
          if(row != null) store.put(row);
        });
      });
    }catch(e){
      finish(false, e);
    }
  });
}

async function restoreIntelligenceBundle(bundle){
  if(!bundle || typeof bundle !== 'object') return false;
  if(!Array.isArray(bundle.occurrences) && !Array.isArray(bundle.seller_feedback) && !Array.isArray(bundle.baseline_cache)){
    return false;
  }
  let db = null;
  try{
    db = await openIntelligenceDbForBackup();
    await runIntelligenceRestoreTx(db, {
      occurrences: Array.isArray(bundle.occurrences) ? bundle.occurrences : [],
      seller_feedback: Array.isArray(bundle.seller_feedback) ? bundle.seller_feedback : [],
      baseline_cache: Array.isArray(bundle.baseline_cache) ? bundle.baseline_cache : []
    });

    try{
      if(typeof localStorage !== 'undefined' && localStorage){
        const occMap = Object.create(null);
        (bundle.occurrences || []).forEach(function(row){
          if(row && row.key != null && Array.isArray(row.dates)){
            occMap[row.key] = row.dates.slice();
          }
        });
        localStorage.setItem(INTELLIGENCE_LS_KEYS.occurrences, JSON.stringify(occMap));

        localStorage.setItem(
          INTELLIGENCE_LS_KEYS.seller_feedback,
          JSON.stringify(Array.isArray(bundle.seller_feedback) ? bundle.seller_feedback : [])
        );

        const baseMap = Object.create(null);
        (bundle.baseline_cache || []).forEach(function(row){
          if(row && row.key != null) baseMap[row.key] = row;
        });
        localStorage.setItem(INTELLIGENCE_LS_KEYS.baseline_cache, JSON.stringify(baseMap));
      }
    }catch(lsErr){
      console.warn('intelligence localStorage mirror refresh failed', lsErr);
    }
    return true;
  }catch(e){
    console.error('restoreIntelligenceBundle failed', e);
    return false;
  }finally{
    if(db){ try{ db.close(); }catch(e){} }
  }
}


/* ============================================================
   Watch Lifecycle backup / restore (bagheri_watch_db) — additive
   ============================================================ */
async function exportWatchLifecycleBundleForBackup(){
  try{
    if(typeof exportWatchLifecycleBundle === 'function'){
      return await exportWatchLifecycleBundle();
    }
  }catch(e){
    console.error('exportWatchLifecycleBundleForBackup failed', e);
  }
  return null;
}

async function restoreWatchLifecycleBundleForBackup(bundle){
  try{
    if(!bundle) return true;
    if(typeof restoreWatchLifecycleBundle === 'function'){
      return await restoreWatchLifecycleBundle(bundle);
    }
  }catch(e){
    console.error('restoreWatchLifecycleBundleForBackup failed', e);
    return false;
  }
  return true;
}

function _validateWatchLifecycleBundle(bundle){
  if(!_isPlainObject(bundle)) return false;
  if(bundle.version != null && Number(bundle.version) !== 1) return false;
  if(!Array.isArray(bundle.occurrences)) return false;
  for(const row of bundle.occurrences){
    if(!_isPlainObject(row) || row.id == null || row.customerId == null || !row.watchCategory) return false;
    if(row.status != null && !['active','resolved','dismissed'].includes(String(row.status))) return false;
  }
  return true;
}

async function exportGameStateForBackup(){
  try{
    if(typeof gameLoadMeta !== 'function' || typeof gameLoadLedger !== 'function') return null;
    const gameMeta = await gameLoadMeta();
    const gameLedger = await gameLoadLedger();
    return { gameMeta: _deepClone(gameMeta), gameLedger: _deepClone(gameLedger) };
  }catch(e){
    console.error('exportGameStateForBackup failed', e);
    return null;
  }
}

async function restoreGameStateForBackup(game){
  if(!game || !_validateGameState(game.gameMeta, game.gameLedger)) throw new Error('Game Center state invalid');
  const metaKey = (typeof GAME_CONFIG !== 'undefined' && GAME_CONFIG.storage && GAME_CONFIG.storage.metaKey) || 'gameMeta';
  const ledgerKey = (typeof GAME_CONFIG !== 'undefined' && GAME_CONFIG.storage && GAME_CONFIG.storage.ledgerKey) || 'gameLedger';
  await dbPut(metaKey, _deepClone(game.gameMeta));
  await dbPut(ledgerKey, _deepClone(game.gameLedger));
  const actual = await exportGameStateForBackup();
  if(!actual || _stableJson(actual)!==_stableJson(game)) throw new Error('Game Center restore verification failed');
  return true;
}

function _validateGameState(meta, ledger){
  if(!_isPlainObject(meta) || !Array.isArray(ledger)) return false;
  if(meta.schemaVersion != null && (!Number.isInteger(Number(meta.schemaVersion)) || Number(meta.schemaVersion)<1)) return false;
  if(meta.currentStreak != null && !_isFiniteNonNegative(meta.currentStreak)) return false;
  if(meta.bestStreak != null && !_isFiniteNonNegative(meta.bestStreak)) return false;
  if(meta.monthlyTargetClaimedFor != null && typeof meta.monthlyTargetClaimedFor !== 'string') return false;
  if(meta.dailyQuestTargets != null && !_isPlainObject(meta.dailyQuestTargets)) return false;
  const ids=new Set();
  for(const e of ledger){
    if(!_isPlainObject(e) || e.id==null || String(e.id)==='' || e.key==null || String(e.key)==='') return false;
    const id=String(e.id); if(ids.has(id)) return false; ids.add(id);
    if(e.xp != null && !Number.isFinite(Number(e.xp))) return false;
    if(e.reversed != null && typeof e.reversed !== 'boolean') return false;
    if(e.date != null && typeof e.date !== 'string') return false;
  }
  return true;
}

async function exportBackupJSON(){
  const stamp = todayISO();
  // سازگاری: همان فیلدهای data در ریشه؛ prospectScout و intelligence اختیاری و اضافه
  const payload = JSON.parse(JSON.stringify(data));
  payload.backupFormatVersion = 3;
  // Settings that affect the dashboard/game are part of the user-visible state.
  payload.settings = { monthlySalesTarget: getMonthlySalesTarget() };
  payload.exportedAt = new Date().toISOString();

  const prospect = await exportProspectScoutBundle();
  if(prospect) payload.prospectScout = prospect;

  const intelligence = await exportIntelligenceBundle();
  if(intelligence) payload.intelligence = intelligence;

  const watchLifecycle = await exportWatchLifecycleBundleForBackup();
  if(watchLifecycle) payload.watchLifecycle = watchLifecycle;

  const gameState = await exportGameStateForBackup();
  if(!gameState) throw new Error('Game Center state unavailable; full backup was not created');
  payload.gameMeta = gameState.gameMeta;
  payload.gameLedger = gameState.gameLedger;

  await downloadFile(`baqeri-backup-${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json');
  showToast('فایل بکاپ آماده شد');
}

function _isPlainObject(v){ return !!v && typeof v === 'object' && !Array.isArray(v); }

/**
 * Compatibility normalization for older backup envelopes.
 * Mutates parsed in place so validate + restore see the current contract.
 * Does not invent CRM financial data.
 */
function _normalizeBackupEnvelope(parsed){
  if(!_isPlainObject(parsed)) return parsed;
  // Older exports stored Intelligence under intelligenceState
  if(parsed.intelligence == null && _isPlainObject(parsed.intelligenceState)){
    parsed.intelligence = parsed.intelligenceState;
  }
  // Older Intelligence envelopes used `version`; current export uses `dbVersion`.
  // Align shape so post-commit verification (exportIntelligenceBundle) does not
  // false-negative on otherwise valid restores.
  if(_isPlainObject(parsed.intelligence)){
    var intel = parsed.intelligence;
    if(intel.dbVersion == null && intel.version != null){
      intel.dbVersion = Number(intel.version);
    }
    if(Object.prototype.hasOwnProperty.call(intel, 'version')){
      delete intel.version;
    }
  }
  return parsed;
}

/** Inventory layer sources produced by stock.js + db.js (including migration). */
const _LAYER_SOURCES = new Set([
  'purchase','manual-in','manual-adjust','sale-return','sale-revert',
  'legacy-opening','migration-gap'
]);

function _isFiniteNonNegative(v){ return Number.isFinite(Number(v)) && Number(v) >= 0; }
function _isIsoDateOnly(v){
  if(typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0,10) === v;
}
function _isIsoTimestamp(v){
  if(typeof v !== 'string' || !v) return false;
  const d = new Date(v);
  return !isNaN(d.getTime()) && /T/.test(v);
}
function _uniqueIds(arr){
  const seen = new Set();
  for(const row of arr){
    if(!_isPlainObject(row) || row.id == null || String(row.id)==='') return false;
    const id=String(row.id); if(seen.has(id)) return false; seen.add(id);
  }
  return true;
}
function _validateProspectBundle(bundle, customerIds, locationIds, currentSchema){
  if(!_isPlainObject(bundle)) return false;
  if(bundle.version != null && Number(bundle.version) !== 1) return false;
  if(!Array.isArray(bundle.shops) || !Array.isArray(bundle.routes)) return false;
  if(bundle.dailyTarget != null && !_isPlainObject(bundle.dailyTarget)) return false;
  if(!_uniqueIds(bundle.shops) || !_uniqueIds(bundle.routes)) return false;
  const routeIds = new Set(bundle.routes.map(r=>String(r.id)));
  for(const r of bundle.routes){
    if(typeof r.name !== 'string') return false;
    if(r.createdAt != null && !_isIsoTimestamp(r.createdAt)) return false;
    if(!Array.isArray(r.neighborhoods)) return false;
    const nids=new Set();
    for(const n of r.neighborhoods){
      if(!_isPlainObject(n) || n.id==null || String(n.id)==='' || typeof n.name!=='string') return false;
      const id=String(n.id); if(nids.has(id)) return false; nids.add(id);
    }
  }
  for(const sh of bundle.shops){
    // locationId is optional (legacy ProspectScout shops omit it; normalizeProspectShop defaults null)
    const required=['name','routeId','neighborhoodId','status','createdAt','updatedAt','latestScore','latestRank','visits'];
    if(currentSchema>=3){ for(const k of required){ if(!(k in sh)) return false; } }
    if(typeof sh.name !== 'string') return false;
    // Orphan routeId/neighborhoodId allowed when routes[] is empty or missing that id
    // (legacy exports kept shop FKs after routes were cleared). Enforce only when present.
    if(sh.routeId != null && routeIds.size && !routeIds.has(String(sh.routeId))) return false;
    if(sh.neighborhoodId != null){
      const r=sh.routeId!=null ? bundle.routes.find(x=>String(x.id)===String(sh.routeId)) : null;
      if(r && !r.neighborhoods.some(n=>String(n.id)===String(sh.neighborhoodId))) return false;
    }
    if(sh.locationId != null && !locationIds.has(String(sh.locationId))) return false;
    if(sh.linkedCustomerId != null && !customerIds.has(String(sh.linkedCustomerId))) return false;
    if(sh.status != null && sh.status !== 'active' && sh.status !== 'converted') return false;
    if(sh.createdAt != null && !_isIsoTimestamp(sh.createdAt)) return false;
    if(sh.updatedAt != null && !_isIsoTimestamp(sh.updatedAt)) return false;
    if(sh.latestScore != null && (!Number.isFinite(Number(sh.latestScore)) || Number(sh.latestScore)<0 || Number(sh.latestScore)>100)) return false;
    if(sh.latestRank != null && !['A+','A','B','C','D'].includes(String(sh.latestRank))) return false;
    if(!Array.isArray(sh.visits)) return false;
    const vids=new Set();
    for(const v of sh.visits){
      if(!_isPlainObject(v) || v.id==null || String(v.id)==='') return false;
      const vid=String(v.id); if(vids.has(vid)) return false; vids.add(vid);
      if(v.date!=null && !_isIsoTimestamp(v.date)) return false;
      if(v.answers!=null && !_isPlainObject(v.answers)) return false;
      if(v.score!=null && (!Number.isFinite(Number(v.score)) || Number(v.score)<0 || Number(v.score)>100)) return false;
      if(v.rank!=null && !['A+','A','B','C','D'].includes(String(v.rank))) return false;
      if(v.scoringVersion!=null && (!Number.isInteger(Number(v.scoringVersion)) || Number(v.scoringVersion)<1)) return false;
      if(v.tags!=null && !Array.isArray(v.tags)) return false;
    }
  }
  if(bundle.dailyTarget != null){
    const dt=bundle.dailyTarget;
    if(typeof dt.date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(dt.date)) return false;
    if(!_isFiniteNonNegative(dt.target) || !_isFiniteNonNegative(dt.count)) return false;
    if(!_isPlainObject(dt.hit) || !_isPlainObject(dt.lastMsg)) return false;
  }
  return true;
}

const _INTEL_CONFIRMED_CATEGORIES = new Set([
  'PURCHASE_DECLINE_SEVERE','PURCHASE_DECLINE_MILD','PURCHASE_GROWTH','BEHIND_PATTERN',
  'CONSECUTIVE_NO_ORDER','BASKET_SHRINK','KEY_PRODUCT_LOST','LONG_NO_VISIT','VISIT_OVERDUE',
  'VISIT_CONVERSION_LOW','CHECK_BOUNCED','PAYMENT_OVERDUE','SKU_DELAY','SKU_QUANTITY_DROP',
  'SKU_FREQUENCY_DROP','LINE_DROP','COMBINED_SKU_DETERIORATION','MULTI_SKU_DECLINE'
]);
const _INTEL_FEEDBACK_REASONS = new Set(['competitor_bought','still_stock','no_need','price_issue','liquidity']);
const _INTEL_FEEDBACK_SOURCES = new Set(['visit','invoice']);
const _INTEL_BASELINE_REASONS = new Set(['establish','shift']);
function _validateIntelligenceBundle(bundle, customerIds, productIds){
  if(!_isPlainObject(bundle)) return false;
  if(bundle.dbVersion != null && Number(bundle.dbVersion) !== 3) return false;
  for(const k of ['occurrences','seller_feedback','baseline_cache']) if(!Array.isArray(bundle[k])) return false;
  const occKeys=new Set();
  for(const row of bundle.occurrences){
    if(!_isPlainObject(row) || typeof row.key!=='string' || !row.key) return false;
    if(occKeys.has(row.key)) return false; occKeys.add(row.key);
    if(!Array.isArray(row.dates)) return false;
    const parts=row.key.split('|'); if(parts.length<2 || !parts[0] || !parts[1]) return false;
    if(!customerIds.has(String(parts[0]))) return false;
    if(!_INTEL_CONFIRMED_CATEGORIES.has(parts[1])) return false;
    const pid=parts.slice(2).join('|');
    if(pid && pid!=='multi' && !productIds.has(String(pid))) return false;
    const dates=new Set();
    for(const d of row.dates){ if(!_isIsoDateOnly(d) || dates.has(d)) return false; dates.add(d); }
  }
  const fbIds=new Set();
  for(const f of bundle.seller_feedback){
    if(!_isPlainObject(f) || typeof f.id!=='string' || !f.id) return false;
    if(fbIds.has(f.id)) return false; fbIds.add(f.id);
    if(!customerIds.has(String(f.customerId))) return false;
    if(f.productId != null && f.productId !== '' && !productIds.has(String(f.productId))) return false;
    if(typeof f.signalCategory!=='string' || !_INTEL_CONFIRMED_CATEGORIES.has(f.signalCategory)) return false;
    if(f.reasonCode != null && !_INTEL_FEEDBACK_REASONS.has(String(f.reasonCode))) return false;
    if(f.comment != null && typeof f.comment!=='string') return false;
    if(!_isIsoTimestamp(f.createdAt)) return false;
    if(f.source != null && !_INTEL_FEEDBACK_SOURCES.has(String(f.source))) return false;
  }
  const baseKeys=new Set();
  for(const b of bundle.baseline_cache){
    if(!_isPlainObject(b) || typeof b.key!=='string' || !b.key) return false;
    if(baseKeys.has(b.key)) return false; baseKeys.add(b.key);
    if(!customerIds.has(String(b.customerId)) || b.productId == null || !productIds.has(String(b.productId))) return false;
    if(b.typicalCycle != null && !_isFiniteNonNegative(b.typicalCycle)) return false;
    if(b.typicalQuantity != null && !_isFiniteNonNegative(b.typicalQuantity)) return false;
    if(!Number.isInteger(Number(b.purchaseCount)) || Number(b.purchaseCount)<0) return false;
    if(!_isIsoTimestamp(b.updatedAt)) return false;
    if(b.reason != null && !_INTEL_BASELINE_REASONS.has(String(b.reason))) return false;
    if(b.key !== String(b.customerId)+'|'+String(b.productId)) return false;
  }
  return true;
}

function validateBackupShape(parsed){
  if(!_isPlainObject(parsed)) return false;
  _normalizeBackupEnvelope(parsed);
  const arrays = ['products','customers','invoices','payments','checks','suppliers'];
  if(!arrays.every(k => Array.isArray(parsed[k]))) return false;
  const schema = Number(parsed.schemaVersion || 1);
  if(!Number.isInteger(schema) || schema<1 || schema>3) return false;
  // schemaVersion 3 = CRM shape (inventoryLayers + location arrays).
  // Envelope extras (settings / prospectScout / intelligence) are optional on
  // older schema-3 files; validate when present.
  if(schema >= 3){
    if(!Array.isArray(parsed.inventoryLayers) || !Array.isArray(parsed.regions) || !Array.isArray(parsed.routes) || !Array.isArray(parsed.neighborhoods)) return false;
  }
  if(parsed.settings != null){
    if(!_isPlainObject(parsed.settings)) return false;
    if(parsed.settings.monthlySalesTarget != null && !_isFiniteNonNegative(parsed.settings.monthlySalesTarget)) return false;
  }
  if(!_uniqueIds(parsed.products) || !_uniqueIds(parsed.customers) || !_uniqueIds(parsed.invoices) || !_uniqueIds(parsed.payments) || !_uniqueIds(parsed.checks) || !_uniqueIds(parsed.suppliers)) return false;
  const productIds=new Set(parsed.products.map(x=>String(x.id)));
  const customerIds=new Set(parsed.customers.map(x=>String(x.id)));
  const invoiceIds=new Set(parsed.invoices.map(x=>String(x.id)));
  for(const inv of parsed.invoices){
    if(!customerIds.has(String(inv.customerId)) || !Array.isArray(inv.items)) return false;
    const invoiceNumericFields=['number','total','discount','prevBalance','cashPaid','checkPaid','cardPaid','transferPaid','newBalance'];
    for(const k of invoiceNumericFields){ if(inv[k] != null && !Number.isFinite(Number(inv[k]))) return false; }
    for(const it of inv.items){
      if(!_isPlainObject(it) || it.productId==null || !productIds.has(String(it.productId))) return false;
      for(const k of ['qty','price','buyPrice','discount','weight']){ if(it[k] != null && !Number.isFinite(Number(it[k]))) return false; }
      if(it.costAllocations != null){
        if(!Array.isArray(it.costAllocations)) return false;
        for(const a of it.costAllocations){
          if(!_isPlainObject(a)) return false;
          for(const k of ['qty','unitCost','cost']){ if(a[k] != null && !Number.isFinite(Number(a[k]))) return false; }
        }
      }
      if(it.cogs != null && !Number.isFinite(Number(it.cogs))) return false;
    }
  }
  for(const pay of parsed.payments){
    if(!customerIds.has(String(pay.customerId)) || (pay.invoiceId!=null && !invoiceIds.has(String(pay.invoiceId))) || !_isFiniteNonNegative(pay.amount)) return false;
  }
  for(const chk of parsed.checks){
    if(!customerIds.has(String(chk.customerId)) || (chk.invoiceId!=null && !invoiceIds.has(String(chk.invoiceId))) || !_isFiniteNonNegative(chk.amount)) return false;
  }
  if(schema>=3){
    const layerIds=new Set();
    for(const l of parsed.inventoryLayers){
      if(!_isPlainObject(l) || l.id==null || layerIds.has(String(l.id)) || !productIds.has(String(l.productId))) return false;
      layerIds.add(String(l.id));
      const src = l.source != null ? String(l.source) : 'purchase';
      if(!_LAYER_SOURCES.has(src)) return false;
      // purchase layers must reference a purchase; orphan layers (sale-return,
      // legacy-opening, manual-*, etc.) legitimately have purchaseId null
      if(src === 'purchase' && (l.purchaseId==null || String(l.purchaseId)==='')) return false;
      if(!_isFiniteNonNegative(l.qtyOriginal) || !_isFiniteNonNegative(l.qtyRemaining) || Number(l.qtyRemaining)>Number(l.qtyOriginal) || !_isFiniteNonNegative(l.unitCost)) return false;
      if(l.status!=null && !['open','depleted','voided'].includes(String(l.status))) return false;
      if(l.date!=null && !_isIsoDateOnly(String(l.date).slice(0,10))) return false;
    }
    if(!_uniqueIds(parsed.regions) || !_uniqueIds(parsed.routes) || !_uniqueIds(parsed.neighborhoods)) return false;
    const regionIds=new Set(parsed.regions.map(x=>String(x.id))), routeIds=new Set(parsed.routes.map(x=>String(x.id))), neighIds=new Set(parsed.neighborhoods.map(x=>String(x.id)));
    for(const r of parsed.routes){ if(r.regionId==null || !regionIds.has(String(r.regionId))) return false; }
    for(const n of parsed.neighborhoods){ if(n.routeId==null || !routeIds.has(String(n.routeId))) return false; }
    for(const c of parsed.customers){ if(c.locationId!=null && !neighIds.has(String(c.locationId)) && !routeIds.has(String(c.locationId))) return false; }
    if(parsed.prospectScout != null && !_validateProspectBundle(parsed.prospectScout, customerIds, new Set([...neighIds,...routeIds]), schema)) return false;
    // Optional additive: an intelligence bundle that fails validation (e.g. a
    // reasonCode/category from an older or newer app version than the current
    // whitelist) must not reject the whole backup — CRM data (customers,
    // invoices, payments, etc.) is authoritative and independent of this
    // read-only, best-effort analytics layer. Drop just the bundle.
    if(parsed.intelligence != null && !_validateIntelligenceBundle(parsed.intelligence, customerIds, productIds)){
      try{ console.warn('backup intelligence bundle invalid — ignoring (CRM data unaffected)'); }catch(_e){}
      delete parsed.intelligence;
    }
  } else {
    if(parsed.prospectScout!=null && !_validateProspectBundle(parsed.prospectScout, customerIds, new Set(), schema)) return false;
    if(parsed.intelligence!=null && !_validateIntelligenceBundle(parsed.intelligence, customerIds, productIds)){
      try{ console.warn('backup intelligence bundle invalid — ignoring (CRM data unaffected)'); }catch(_e){}
      delete parsed.intelligence;
    }
  }
  // Optional Game Center state: when present it is validated and restored;
  // older backups without these fields remain compatible and preserve current game state.
  if(parsed.gameMeta != null || parsed.gameLedger != null){
    if(!_validateGameState(parsed.gameMeta, parsed.gameLedger)) return false;
  }
  // Optional additive: invalid watchLifecycle must not reject whole backup
  if(parsed.watchLifecycle != null && !_validateWatchLifecycleBundle(parsed.watchLifecycle)){
    try{ console.warn('backup watchLifecycle invalid — ignoring'); }catch(_e){}
    delete parsed.watchLifecycle;
  }
  return true;
}

const RESTORE_JOURNAL_KEY = 'restoreJournal_v2';

function _deepClone(v){ return JSON.parse(JSON.stringify(v)); }
function _stableValue(v){
  if(Array.isArray(v)) return v.map(_stableValue);
  if(v && typeof v==='object'){
    const o={}; Object.keys(v).sort().forEach(k=>{ o[k]=_stableValue(v[k]); }); return o;
  }
  return v;
}
function _stableJson(v){ return JSON.stringify(_stableValue(v)); }

async function _readTargetState(){
  let localRaw=null, dbRaw=null;
  try{ localRaw=localStorage.getItem(SALES_TARGET_KEY); }catch(e){}
  try{ const r=await dbGet(SALES_TARGET_DB_KEY); dbRaw = r && Object.prototype.hasOwnProperty.call(r,'value') ? r.value : (r==null?null:r); }catch(e){}
  return { value:getMonthlySalesTarget(), localRaw, dbRaw };
}
async function _restoreTargetState(s){
  if(!s || typeof s!=='object') throw new Error('invalid target snapshot');
  _monthlySalesTargetCache = Math.max(0, Number(s.value)||0);
  if(typeof localStorage!=='undefined' && localStorage){
    if(s.localRaw == null) localStorage.removeItem(SALES_TARGET_KEY); else localStorage.setItem(SALES_TARGET_KEY, String(s.localRaw));
  }
  if(s.dbRaw == null) await dbDelete(SALES_TARGET_DB_KEY);
  else await dbPut(SALES_TARGET_DB_KEY, s.dbRaw);
}
async function _writeTargetValue(value){
  const n=Math.max(0,Number(value)||0);
  _monthlySalesTargetCache=n;
  try{ localStorage.setItem(SALES_TARGET_KEY,String(n)); }catch(e){ throw new Error('sales target localStorage write failed'); }
  await dbPut(SALES_TARGET_DB_KEY,n);
}
async function restoreProspectScoutBundleStrict(bundle){
  if(!_validateProspectBundle(bundle, new Set((data.customers||[]).map(x=>String(x.id))), new Set([...(data.neighborhoods||[]).map(x=>String(x.id)), ...(data.routes||[]).map(x=>String(x.id))]), Number(data.schemaVersion||3))) throw new Error('Prospect bundle validation failed');
  const db=await openProspectScoutDbForBackup();
  try{ await runProspectRestoreTx(db,bundle); } finally { try{db.close();}catch(e){} }
  return true;
}
async function restoreIntelligenceBundleStrict(bundle){
  if(!_validateIntelligenceBundle(bundle,new Set((data.customers||[]).map(x=>String(x.id))),new Set((data.products||[]).map(x=>String(x.id))))) throw new Error('Intelligence bundle validation failed');
  const db=await openIntelligenceDbForBackup();
  try{
    await runIntelligenceRestoreTx(db,bundle);
  }finally{ try{db.close();}catch(e){} }
  // localStorage mirrors are part of Intelligence state; failures are fatal.
  const occMap=Object.create(null); (bundle.occurrences||[]).forEach(r=>{occMap[r.key]=r.dates.slice();});
  const baseMap=Object.create(null); (bundle.baseline_cache||[]).forEach(r=>{baseMap[r.key]=r;});
  localStorage.setItem(INTELLIGENCE_LS_KEYS.occurrences,JSON.stringify(occMap));
  localStorage.setItem(INTELLIGENCE_LS_KEYS.seller_feedback,JSON.stringify(bundle.seller_feedback||[]));
  localStorage.setItem(INTELLIGENCE_LS_KEYS.baseline_cache,JSON.stringify(baseMap));
  return true;
}

async function _snapshotRestoreState(){
  const prospect=await exportProspectScoutBundle();
  const intelligence=await exportIntelligenceBundle();
  const game=await exportGameStateForBackup();
  if(!prospect || !intelligence || !game) throw new Error('complete subsystem snapshot unavailable');
  return {
    data:_deepClone(data),
    prospect:_deepClone(prospect),
    intelligence:_deepClone(intelligence),
    target:await _readTargetState(),
    game:_deepClone(game)
  };
}
async function _applyCrmSnapshot(snapshotData){
  const next=normalizeData(_deepClone(snapshotData));
  await dbPut(RECORD_KEY, JSON.stringify(next));
  data=next;
  if(typeof _lastPersistedData!=='undefined') _lastPersistedData=_deepClone(next);
}
async function _restoreSnapshot(snapshot){
  await _applyCrmSnapshot(snapshot.data);
  if(!await restoreProspectScoutBundleStrict(snapshot.prospect)) throw new Error('Prospect restore failed');
  if(!await restoreIntelligenceBundleStrict(snapshot.intelligence)) throw new Error('Intelligence restore failed');
  await _restoreTargetState(snapshot.target);
  await restoreGameStateForBackup(snapshot.game);
}
async function _readCurrentSemanticState(){
  const game=await exportGameStateForBackup();
  if(!game) throw new Error('Game Center state unavailable');
  return {data:_deepClone(data), prospect:await exportProspectScoutBundle(), intelligence:await exportIntelligenceBundle(), target:await _readTargetState(), game:_deepClone(game)};
}
function _semanticStateEqual(a,b){ return _stableJson(a)===_stableJson(b); }

async function _recoverPendingRestoreJournal(){
  const rec=await dbGet(RESTORE_JOURNAL_KEY);
  if(!rec || !rec.value) return {ok:true, recovered:false};
  let journal;
  try{ journal=JSON.parse(rec.value); }catch(e){ throw new Error('restore journal is corrupted'); }
  if(!journal || journal.version!==2 || !journal.snapshot) throw new Error('restore journal is invalid');
  try{
    await _restoreSnapshot(journal.snapshot);
    const actual=await _readCurrentSemanticState();
    if(!_semanticStateEqual(actual,journal.snapshot)) throw new Error('journal recovery verification failed');
    await dbDelete(RESTORE_JOURNAL_KEY);
    return {ok:true,recovered:true};
  }catch(e){
    console.error('Pending restore recovery failed; journal retained for retry',e);
    throw new Error('بازیابی ایمن اطلاعات ناقص است؛ برنامه بدون ادامه‌ی کار متوقف شد. دوباره برنامه را باز کنید.');
  }
}

async function _restoreParsedBackup(parsed){
  const previous=await _snapshotRestoreState();
  const targetValue = parsed.settings && Object.prototype.hasOwnProperty.call(parsed.settings,'monthlySalesTarget')
    ? Math.max(0,Number(parsed.settings.monthlySalesTarget)||0) : previous.target.value;
  const journal={version:2,status:'committing',createdAt:new Date().toISOString(),snapshot:previous,target:{value:targetValue}};
  await dbPut(RESTORE_JOURNAL_KEY, JSON.stringify(journal));
  try{
    // Preserve the user-visible Undo Restore snapshot only after the durable
    // journal exists, and before the first destructive commit.
    await dbPut(PRERESTORE_KEY, JSON.stringify(previous.data));
    await dbPut(PRERESTORE_PROSPECT_KEY, JSON.stringify(previous.prospect));
    await dbPut(PRERESTORE_INTELLIGENCE_KEY, JSON.stringify(previous.intelligence));
    await dbPut(PRERESTORE_TARGET_KEY, JSON.stringify(previous.target));
    await dbPut(PRERESTORE_GAME_KEY, JSON.stringify(previous.game));
    try{
      const wSnap = await exportWatchLifecycleBundleForBackup();
      if(wSnap) await dbPut(PRERESTORE_WATCH_KEY, JSON.stringify(wSnap));
    }catch(_we){}
    const nextData=normalizeData(_deepClone(parsed));
    await dbPut(RECORD_KEY, JSON.stringify(nextData));
    data=nextData;
    if(typeof _lastPersistedData!=='undefined') _lastPersistedData=_deepClone(nextData);
    if(parsed.prospectScout){ if(!await restoreProspectScoutBundleStrict(parsed.prospectScout)) throw new Error('Prospect restore failed'); }
    if(parsed.intelligence){ if(!await restoreIntelligenceBundleStrict(parsed.intelligence)) throw new Error('Intelligence restore failed'); }
    await _writeTargetValue(targetValue);
    if(parsed.gameMeta != null || parsed.gameLedger != null){
      if(!_validateGameState(parsed.gameMeta, parsed.gameLedger)) throw new Error('Game Center backup validation failed');
      await restoreGameStateForBackup({gameMeta:_deepClone(parsed.gameMeta), gameLedger:_deepClone(parsed.gameLedger)});
    }
    const expectedGame = (parsed.gameMeta != null || parsed.gameLedger != null)
      ? {gameMeta:_deepClone(parsed.gameMeta), gameLedger:_deepClone(parsed.gameLedger)}
      : previous.game;
    const expected={data:_deepClone(nextData),prospect:parsed.prospectScout ? _deepClone(parsed.prospectScout) : previous.prospect,intelligence:parsed.intelligence ? _deepClone(parsed.intelligence) : previous.intelligence,target:{value:targetValue,localRaw:String(targetValue),dbRaw:targetValue},game:expectedGame};
    const actual=await _readCurrentSemanticState();
    if(!_semanticStateEqual(actual,expected)) throw new Error('post-commit verification failed');
    // Additive Watch Lifecycle restore (best-effort; not part of semantic journal equality).
    // CRM data above has already committed successfully — a Watch Lifecycle
    // failure here must not roll back or fail the overall restore, but it
    // must not be silent either, since it means seller-entered watch
    // reasons/notes were not brought back.
    let watchLifecycleWarning = false;
    try{
      if(parsed.watchLifecycle){
        const wOk = await restoreWatchLifecycleBundleForBackup(parsed.watchLifecycle);
        if(!wOk) watchLifecycleWarning = true;
      }
    }catch(wErr){ console.warn('watchLifecycle restore skipped', wErr); watchLifecycleWarning = true; }
    await dbDelete(RESTORE_JOURNAL_KEY);
    return watchLifecycleWarning ? 'warn' : true;
  }catch(e){
    console.error('restore commit failed; attempting journaled rollback',e);
    try{
      await _restoreSnapshot(previous);
      const actual=await _readCurrentSemanticState();
      if(!_semanticStateEqual(actual,previous)) throw new Error('rollback verification failed');
      await dbDelete(RESTORE_JOURNAL_KEY);
      return false;
    }catch(re){
      console.error('CRITICAL: restore rollback incomplete; journal retained',re);
      try{ window.__bagheriRestoreRecoveryBlocked = true; }catch(_e){}
      try{
        if(typeof document !== 'undefined' && document.body){
          document.body.innerHTML = '<div style="padding:28px 18px;text-align:center;direction:rtl;font-family:sans-serif;"><h2>بازیابی کامل نشد</h2><p style="line-height:1.8">برای جلوگیری از کار روی داده‌ی ناهماهنگ، برنامه متوقف شد. برنامه را دوباره باز کنید تا بازیابی ایمن خودکار انجام شود.</p></div>';
        }
      }catch(_e){}
      throw new Error('بازیابی انجام نشد و بازگردانی کامل نشد؛ برنامه متوقف شد تا بازیابی ایمن انجام شود.');
    }
  }
}

async function importBackupJSON(file){
  try{
    const parsed=JSON.parse(await file.text());
    _normalizeBackupEnvelope(parsed);
    if(!validateBackupShape(parsed)){ showToast('این فایل، فایل بکاپ معتبر یا کامل نیست'); return; }
    const ok=await _restoreParsedBackup(parsed);
    if(ok==='warn'){ render(); showToast('اطلاعات بازیابی شد؛ اما تاریخچهٔ Watch بازیابی نشد'); }
    else if(ok){ render(); showToast('اطلاعات با موفقیت بازیابی شد'); }
    else { render(); showToast('بازیابی انجام نشد؛ اطلاعات قبلی حفظ شد'); }
  }catch(e){
    console.error('importBackupJSON failed',e);
    showToast(e && e.message ? e.message : 'بازیابی انجام نشد');
  }
}

async function undoLastRestore(){
  try{
    const snap=await dbGet(PRERESTORE_KEY), pSnap=await dbGet(PRERESTORE_PROSPECT_KEY), iSnap=await dbGet(PRERESTORE_INTELLIGENCE_KEY), tSnap=await dbGet(PRERESTORE_TARGET_KEY), gSnap=await dbGet(PRERESTORE_GAME_KEY);
    if(!snap || !snap.value || !pSnap || !pSnap.value || !iSnap || !iSnap.value || !tSnap || !tSnap.value || !gSnap || !gSnap.value){ showToast('نسخه‌ی کامل قبل از بازیابی موجود نیست'); return; }
    const storedTarget=JSON.parse(tSnap.value);
    const storedGame=JSON.parse(gSnap.value);
    if(!_validateGameState(storedGame && storedGame.gameMeta, storedGame && storedGame.gameLedger)) throw new Error('Game Center pre-restore snapshot invalid');
    const previous={data:JSON.parse(snap.value),prospect:JSON.parse(pSnap.value),intelligence:JSON.parse(iSnap.value),target:(storedTarget && typeof storedTarget==='object' && !Array.isArray(storedTarget)) ? storedTarget : {value:Math.max(0,Number(storedTarget)||0),localRaw:String(Math.max(0,Number(storedTarget)||0)),dbRaw:Math.max(0,Number(storedTarget)||0)},game:storedGame};
    const current=await _snapshotRestoreState();
    const journal={version:2,status:'undoing',createdAt:new Date().toISOString(),snapshot:current};
    await dbPut(RESTORE_JOURNAL_KEY,JSON.stringify(journal));
    try{
      await _restoreSnapshot(previous);
      const actual=await _readCurrentSemanticState();
      if(!_semanticStateEqual(actual,previous)) throw new Error('undo verification failed');
      try{
        const wSnap = await dbGet(PRERESTORE_WATCH_KEY);
        if(wSnap && wSnap.value){
          await restoreWatchLifecycleBundleForBackup(JSON.parse(wSnap.value));
        }
      }catch(_wu){}
      await dbDelete(RESTORE_JOURNAL_KEY); await dbDelete(PRERESTORE_KEY); await dbDelete(PRERESTORE_PROSPECT_KEY); await dbDelete(PRERESTORE_INTELLIGENCE_KEY); await dbDelete(PRERESTORE_TARGET_KEY); await dbDelete(PRERESTORE_GAME_KEY);
      try{ await dbDelete(PRERESTORE_WATCH_KEY); }catch(_wd){}
      render(); showToast('به حالت قبل از بازیابی برگشت');
    }catch(e){
      try{ await _restoreSnapshot(current); const actual=await _readCurrentSemanticState(); if(!_semanticStateEqual(actual,current)) throw new Error('undo rollback verification failed'); await dbDelete(RESTORE_JOURNAL_KEY); }catch(re){ console.error('CRITICAL undo rollback incomplete',re); throw new Error('بازگردانی Undo کامل نشد؛ برنامه را دوباره باز کنید.'); }
      throw e;
    }
  }catch(e){ console.error('undoLastRestore failed',e); showToast(e.message || 'بازگرداندن انجام نشد'); }
}

function backupPayloadFromAutoOrFile(parsed){
  return parsed && typeof parsed === 'object' ? parsed : null;
}

// ---------- بکاپ خودکار ساده (fire-and-forget، هیچ‌وقت نباید جلوی ذخیره‌ی اصلی را بگیرد) ----------
async function getAutoBackupList(){
  const rec = await dbGet(AUTO_BACKUP_LIST_KEY);
  return (rec && rec.value) ? JSON.parse(rec.value) : [];
}

async function autoBackupTick(){
  const list = await getAutoBackupList();
  const last = list.length ? list[list.length-1].ts : 0;
  if(Date.now() - last < AUTO_BACKUP_INTERVAL_MS) return;
  const ts = Date.now();
  const key = AUTO_BACKUP_PREFIX + ts;
  const payload = JSON.parse(JSON.stringify(data));
  payload.backupFormatVersion = 3;
  payload.autoBackup = true;
  payload.exportedAt = new Date().toISOString();
  payload.settings = { monthlySalesTarget: getMonthlySalesTarget() };
  const prospect = await exportProspectScoutBundle();
  if(prospect) payload.prospectScout = prospect;
  const intelligence = await exportIntelligenceBundle();
  if(intelligence) payload.intelligence = intelligence;
  const watchLifecycle = await exportWatchLifecycleBundleForBackup();
  if(watchLifecycle) payload.watchLifecycle = watchLifecycle;
  const gameState = await exportGameStateForBackup();
  if(!gameState) throw new Error('auto backup payload missing Game Center state');
  payload.gameMeta = gameState.gameMeta;
  payload.gameLedger = gameState.gameLedger;
  if(!validateBackupShape(payload)) throw new Error('auto backup payload validation failed');
  await dbPut(key, JSON.stringify(payload));
  list.push({key, ts});
  while(list.length > AUTO_BACKUP_MAX){
    const old = list.shift();
    try{ await dbDelete(old.key); }catch(e){ /* retain metadata even if old blob is already gone */ }
  }
  await dbPut(AUTO_BACKUP_LIST_KEY, JSON.stringify(list));
}

async function restoreFromAutoBackup(key){
  if(!confirm('مطمئنی؟ اطلاعات فعلی با این نسخه‌ی بکاپ خودکار جایگزین می‌شه.')) return;
  try{
    const snap = await dbGet(key);
    if(!snap || !snap.value){ showToast('این نسخه‌ی بکاپ پیدا نشد'); return; }
    const parsed = JSON.parse(snap.value);
    const blob = new Blob([JSON.stringify(parsed)], {type:'application/json'});
    await importBackupJSON({ text: async()=>await blob.text() });
  }catch(e){
    console.error(e);
    showToast('بازیابی از بکاپ خودکار ممکن نشد');
  }
}

function exportExcel(){
  if(typeof XLSX === 'undefined'){
    showToast('کتابخانه اکسل لود نشد؛ برای این خروجی به اینترنت نیاز است');
    return;
  }
  const wb = XLSX.utils.book_new();

  const custRows = data.customers.map(c=>{
    const t = customerTotals(c.id);
    return {
      'نام فروشگاه': c.name, 'صاحب فروشگاه': c.ownerName||'', 'شماره تماس': c.phone||'',
      'منطقه': c.region||'', 'مسیر': c.route||'',
      'جمع فاکتورها': t.invTotal, 'مانده حساب': t.balance,
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(custRows.length?custRows:[{'نام فروشگاه':''}]), 'مشتریان');

  const invRows = [];
  data.invoices.forEach(i=>{
    const cust = data.customers.find(c=>c.id===i.customerId);
    i.items.forEach(it=>{
      invRows.push({
        'شماره فاکتور': i.number||'', 'تاریخ': i.date, 'مشتری': cust?cust.name:'',
        'کالا': it.name, 'تعداد': it.qty, 'قیمت واحد': it.price, 'جمع': it.qty*it.price - (it.discount||0),
      });
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(invRows.length?invRows:[{'شماره فاکتور':''}]), 'فاکتورها');

  const prodRows = data.products.map(p=>({
    'نام کالا': p.name, 'دسته‌بندی': p.category||'', 'قیمت خرید (FIFO)': Math.round(productFifoUnitCost(p.id)),
    'قیمت خرید (مبنای پیش‌فرض)': p.buy,
    'قیمت عمده': p.wholesale, 'قیمت مصرف‌کننده': p.retail, 'موجودی': p.stockQty,
    'ارزش ریالی موجودی (FIFO)': Math.round(productInventoryValue(p.id)),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prodRows.length?prodRows:[{'نام کالا':''}]), 'کالاها');

  const supRows = data.suppliers.map(s=>{
    const t = supplierTotals(s.id);
    return { 'تامین‌کننده': s.name, 'جمع خرید': t.purchaseTotal, 'جمع پرداخت': t.payTotal, 'بدهی': t.balance };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(supRows.length?supRows:[{'تامین‌کننده':''}]), 'تامین‌کننده‌ها');

  const wbArray = XLSX.write(wb, {bookType:'xlsx', type:'array'});
  const blob = new Blob([wbArray], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  downloadFile(`baqeri-report-${todayISO()}.xlsx`, blob).then(()=>{
    showToast('فایل اکسل آماده شد');
  });
}

