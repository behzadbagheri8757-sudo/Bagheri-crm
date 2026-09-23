/* prospect-core.js — prospects state & ops. Separate from CRM finance. */
const prospectState = {
  shops: [],
  routes: [],
  dailyTarget: null,
  ready: false,
};

async function loadProspectData(){
  if(!prospectDbInstance) await openProspectDatabase();
  const [shopsRaw, routesRaw] = await Promise.all([
    prospectDbGetAll('shops'),
    prospectDbGetAll('routes'),
  ]);
  prospectState.shops = shopsRaw.map(normalizeProspectShop);
  prospectState.routes = routesRaw.map(normalizeProspectRoute);
  await ensureProspectDailyTarget();
  prospectState.ready = true;
}

function prospectRouteName(routeId){
  const r = prospectState.routes.find(x=>x.id===routeId);
  return r ? r.name : '—';
}
function prospectNeighborhoodName(routeId, neighborhoodId){
  const r = prospectState.routes.find(x=>x.id===routeId);
  if(!r) return '—';
  const n = r.neighborhoods.find(x=>x.id===neighborhoodId);
  return n ? n.name : '—';
}

/** Days since the shop's latest evaluation visit. Missing/invalid → null. Read-only. */
function daysSinceLastEvaluation(shopId){
  if(!shopId || typeof prospectState === 'undefined' || !Array.isArray(prospectState.shops)) return null;
  const shop = prospectState.shops.find(function(s){ return s && s.id === shopId; });
  if(!shop || !Array.isArray(shop.visits) || !shop.visits.length) return null;
  let latest = null;
  for(let i = 0; i < shop.visits.length; i++){
    const visit = shop.visits[i];
    if(!visit || visit.type === 'snapshot_edit') continue;
    const d = visit.date;
    if(!d) continue;
    if(latest == null || String(d) > String(latest)) latest = d;
  }
  if(!latest) return null;
  if(typeof daysAgo !== 'function') return null;
  const n = daysAgo(latest);
  if(n == null || !isFinite(n) || n === Infinity) return null;
  return n;
}

async function persistProspectShop(shop){
  shop.updatedAt = prospectNowISO();
  await prospectDbPut('shops', shop);
}

async function createProspectShop(payload){
  const score = prospectComputeScore(payload.answers||{});
  const rank = prospectScoreToRank(score);
  const visit = normalizeProspectVisit({
    date: prospectNowISO(),
    answers: {...(payload.answers||{})},
    score, rank,
    scoringVersion: PROSPECT_SCORING_VERSION,
    tags: [...(payload.tags||[])],
  });
  const shop = normalizeProspectShop({
    name: (payload.name||'').trim(),
    // Shared Location System is the source of truth for new prospects.
    // Legacy routeId/neighborhoodId are retained only for old records.
    routeId: payload.routeId || null,
    neighborhoodId: payload.neighborhoodId || null,
    locationId: payload.locationId || null,
    latestScore: score,
    latestRank: rank,
    visits: [visit],
    status: (payload.tags||[]).includes('became_customer') ? 'converted' : 'active',
  });
  await persistProspectShop(shop);
  prospectState.shops.push(shop);
  if ((payload.tags || []).includes('became_customer') && !shop.linkedCustomerId) {
    try { await convertProspectToCustomer(shop.id); }
    catch (e) { console.error('Prospect conversion failed:', e); }
  }
  await registerProspectVisitForTarget();
  // Game Center hook (derived only — never rolls back CRM)
  if (typeof gameOnEvaluation === 'function') {
    try {
      await gameOnEvaluation(shop.id, visit.id, visit.date);
    } catch (e) {
      console.warn('Game hook failed:', e);
    }
  }
  return shop;
}

async function addProspectVisit(shopId, payload){
  const shop = prospectState.shops.find(s=>s.id===shopId);
  if(!shop) return null;
  const score = prospectComputeScore(payload.answers||{});
  const rank = prospectScoreToRank(score);
  const visit = normalizeProspectVisit({
    date: prospectNowISO(),
    answers: {...(payload.answers||{})},
    score, rank,
    scoringVersion: PROSPECT_SCORING_VERSION,
    tags: [...(payload.tags||[])],
  });
  shop.visits.push(visit);
  shop.latestScore = score;
  shop.latestRank = rank;
  if((payload.tags||[]).includes('became_customer')) shop.status = 'converted';
  await persistProspectShop(shop);
  if ((payload.tags || []).includes('became_customer') && !shop.linkedCustomerId) {
    try { await convertProspectToCustomer(shop.id); }
    catch (e) { console.error('Prospect conversion failed:', e); }
  }
  await registerProspectVisitForTarget();
  // Game Center hook (derived only — never rolls back CRM)
  if (typeof gameOnEvaluation === 'function') {
    try {
      await gameOnEvaluation(shop.id, visit.id, visit.date);
    } catch (e) {
      console.warn('Game hook failed:', e);
    }
  }
  return shop;
}

/* ==========================================================================
   PROSPECT EVALUATION V2 — Snapshot + Event model (spec §4, §11, §13-§15).
   Independent of the legacy createProspectShop/addProspectVisit above.
   Evaluation is a CURRENT SNAPSHOT; a Visit is an independent REPEATABLE
   EVENT. Initial evaluation writes the Snapshot + one 'initial' visit event.
   A follow-up visit never re-runs the full evaluation: it only appends a
   lightweight event, optionally editing one Snapshot answer.
   ========================================================================== */

async function createProspectShopV2(payload){
  const profile = payload.profile;
  const result = prospectComputeScoreV2(profile, payload.answers || {});
  const nowIso = prospectNowISO();
  const snapshot = {
    profile: profile,
    businessType: payload.businessType || null,
    answers: {...(payload.answers || {})},
    score: result.score,
    rank: result.rank,
    knownCount: result.knownCount,
    scoringVersion: PROSPECT_SCORING_VERSION_V2,
    updatedAt: nowIso,
  };
  const visit = normalizeProspectVisit({
    date: nowIso,
    type: 'initial',
    answers: {...(payload.answers || {})},
    score: result.score,
    rank: result.rank,
    knownCount: result.knownCount,
    scoringVersion: PROSPECT_SCORING_VERSION_V2,
    tags: [...(payload.tags || [])],
  });
  const shop = normalizeProspectShop({
    name: (payload.name || '').trim(),
    routeId: payload.routeId || null,
    neighborhoodId: payload.neighborhoodId || null,
    locationId: payload.locationId || null,
    scoringVersion: PROSPECT_SCORING_VERSION_V2,
    profile: profile,
    businessType: payload.businessType || null,
    snapshot: snapshot,
    latestScore: result.score != null ? result.score : 0,
    latestRank: result.rank,
    visits: [visit],
    status: (payload.tags || []).includes('became_customer') ? 'converted' : 'active',
  });
  await persistProspectShop(shop);
  prospectState.shops.push(shop);
  if ((payload.tags || []).includes('became_customer') && !shop.linkedCustomerId) {
    try { await convertProspectToCustomer(shop.id); }
    catch (e) { console.error('Prospect conversion failed:', e); }
  }
  await registerProspectVisitForTarget();
  // Game Center hook (derived only — never rolls back CRM)
  if (typeof gameOnEvaluation === 'function') {
    try {
      await gameOnEvaluation(shop.id, visit.id, visit.date);
    } catch (e) {
      console.warn('Game hook failed:', e);
    }
  }
  return shop;
}

/**
 * Lightweight Follow-up Visit (spec §13). Records an event (outcome tags,
 * note, next follow-up date) WITHOUT repeating the 4-question evaluation.
 * If `payload.snapshotEdit` is given ({questionId, value}), only that one
 * Snapshot answer is changed and the score/rank/knownCount recompute —
 * everything else about the Snapshot is left untouched (spec §14-§15).
 */
/**
 * Targeted Snapshot answer edit from the current Snapshot UI.
 * This records an audit/history event but does NOT count as a new prospect
 * visit and does not increment the daily visit target.
 */
async function editProspectSnapshotAnswer(shopId, questionId, newValue){
  const shop = prospectState.shops.find(s=>s.id===shopId);
  if(!shop || !shop.snapshot || !questionId) return null;
  const questions = (typeof PROSPECT_QUESTIONS_V2 !== 'undefined' && shop.snapshot.profile)
    ? (PROSPECT_QUESTIONS_V2[shop.snapshot.profile] || []) : [];
  const question = questions.find(q=>q.id===questionId);
  if(!question || !question.options.some(o=>o.key===newValue)) return null;

  const oldValue = shop.snapshot.answers ? shop.snapshot.answers[questionId] : null;
  if(oldValue === newValue) return shop;

  shop.snapshot.answers = shop.snapshot.answers || {};
  shop.snapshot.answers[questionId] = newValue;
  const result = prospectComputeScoreV2(shop.snapshot.profile, shop.snapshot.answers);
  shop.snapshot.score = result.score;
  shop.snapshot.rank = result.rank;
  shop.snapshot.knownCount = result.knownCount;
  shop.snapshot.updatedAt = prospectNowISO();
  shop.latestScore = result.score != null ? result.score : 0;
  shop.latestRank = result.rank;

  const editEvent = normalizeProspectVisit({
    date: prospectNowISO(),
    type: 'snapshot_edit',
    scoringVersion: PROSPECT_SCORING_VERSION_V2,
    score: result.score,
    rank: result.rank,
    knownCount: result.knownCount,
    snapshotEdit: { questionId: questionId, from: (oldValue != null ? oldValue : null), to: newValue },
  });
  shop.visits.push(editEvent);
  await persistProspectShop(shop);
  return shop;
}

async function addFollowUpVisit(shopId, payload){
  const shop = prospectState.shops.find(s=>s.id===shopId);
  if(!shop) return null;

  let snapshotEditRecord = null;
  if(payload.snapshotEdit && payload.snapshotEdit.questionId && shop.snapshot){
    const qId = payload.snapshotEdit.questionId;
    const newValue = payload.snapshotEdit.value;
    const oldValue = shop.snapshot.answers ? shop.snapshot.answers[qId] : null;
    if(newValue !== oldValue){
      shop.snapshot.answers = shop.snapshot.answers || {};
      shop.snapshot.answers[qId] = newValue;
      const result = prospectComputeScoreV2(shop.snapshot.profile, shop.snapshot.answers);
      shop.snapshot.score = result.score;
      shop.snapshot.rank = result.rank;
      shop.snapshot.knownCount = result.knownCount;
      shop.snapshot.updatedAt = prospectNowISO();
      shop.latestScore = result.score != null ? result.score : 0;
      shop.latestRank = result.rank;
      snapshotEditRecord = { questionId: qId, from: (oldValue != null ? oldValue : null), to: newValue };
    }
  }

  const visit = normalizeProspectVisit({
    date: prospectNowISO(),
    type: 'followup',
    tags: [...(payload.tags || [])],
    note: payload.note || '',
    nextFollowUpDate: payload.nextFollowUpDate || null,
    snapshotEdit: snapshotEditRecord,
    scoringVersion: PROSPECT_SCORING_VERSION_V2,
    // Record the Snapshot's score/rank AT THE TIME of this visit for the
    // Visit History timeline — the Snapshot itself is the current-state
    // source of truth (spec §36), this is just a point-in-time echo of it.
    score: shop.snapshot ? shop.snapshot.score : null,
    rank: shop.snapshot ? shop.snapshot.rank : null,
    knownCount: shop.snapshot ? shop.snapshot.knownCount : null,
  });
  shop.visits.push(visit);
  if((payload.tags || []).includes('became_customer')) shop.status = 'converted';
  await persistProspectShop(shop);
  if ((payload.tags || []).includes('became_customer') && !shop.linkedCustomerId) {
    try { await convertProspectToCustomer(shop.id); }
    catch (e) { console.error('Prospect conversion failed:', e); }
  }
  if (visit.type === 'followup' && !snapshotEditRecord) {
    await registerProspectVisitForTarget();
  }
  // Game Center hook (derived only — never rolls back CRM)
  if (typeof gameOnEvaluation === 'function') {
    try {
      await gameOnEvaluation(shop.id, visit.id, visit.date);
    } catch (e) {
      console.warn('Game hook failed:', e);
    }
  }
  return shop;
}

/** Edit an existing V2 follow-up visit only inside the UI edit window. */
async function editProspectFollowUpVisit(shopId, visitId, payload){
  const shop = prospectState.shops.find(s=>s.id===shopId);
  if(!shop || !Array.isArray(shop.visits)) return null;
  const visit = shop.visits.find(v=>v && v.id===visitId);
  if(!visit || visit.type !== 'followup') throw new Error('این ویزیت قابل ویرایش نیست');
  const ts = new Date(visit.date).getTime();
  if(!isFinite(ts) || Date.now() - ts < 0 || Date.now() - ts > (3 * 60 * 60 * 1000)) {
    throw new Error('مهلت ویرایش این ویزیت تمام شده است');
  }
  visit.tags = Array.isArray(payload.tags) ? [...payload.tags] : [];
  visit.note = typeof payload.note === 'string' ? payload.note : '';
  visit.nextFollowUpDate = payload.nextFollowUpDate || null;
  await persistProspectShop(shop);
  return shop;
}

async function deleteProspectShop(id){
  const shop = prospectState.shops.find(s=>s.id===id);
  // Reverse any Game Center XP claimed for this shop's evaluations (derived only — never touches Prospect/CRM data)
  if (shop && Array.isArray(shop.visits) && typeof gameOnEvaluationDeleted === 'function') {
    for (const v of shop.visits) {
      try { await gameOnEvaluationDeleted(id, v.id); } catch (e) { console.warn('Game reverse failed:', e); }
    }
  }
  prospectState.shops = prospectState.shops.filter(s=>s.id!==id);
  await prospectDbDelete('shops', id);
}

async function addProspectRoute(name){
  const route = normalizeProspectRoute({name});
  await prospectDbPut('routes', route);
  prospectState.routes.push(route);
  return route;
}
async function deleteProspectRoute(id){
  prospectState.routes = prospectState.routes.filter(r=>r.id!==id);
  await prospectDbDelete('routes', id);
}
async function addProspectNeighborhood(routeId, name){
  const r = prospectState.routes.find(x=>x.id===routeId);
  if(!r) return;
  r.neighborhoods.push({id: typeof uid==='function'?uid():String(Date.now()), name: name.trim()});
  await prospectDbPut('routes', r);
}

/* ---- daily target ---- */
function defaultProspectDailyTarget(prevTarget, prevLastMsg){
  return { date: prospectTodayStr(), target: prevTarget||0, count:0, hit:{}, lastMsg: prevLastMsg||{} };
}
async function ensureProspectDailyTarget(){
  let rec = await prospectDbGet('meta','dailyTarget');
  let dt = rec ? rec.value : null;
  if(!dt || dt.date !== prospectTodayStr()){
    dt = defaultProspectDailyTarget(dt?dt.target:0, dt?dt.lastMsg:{});
    await prospectDbPut('meta', {key:'dailyTarget', value:dt});
  }
  prospectState.dailyTarget = dt;
  return dt;
}
async function setProspectDailyTargetValue(newTarget){
  const dt = await ensureProspectDailyTarget();
  dt.target = newTarget;
  prospectState.dailyTarget = dt;
  await prospectDbPut('meta', {key:'dailyTarget', value:dt});
}
async function registerProspectVisitForTarget(){
  const dt = await ensureProspectDailyTarget();
  dt.count += 1;
  if(dt.target > 0){
    const pct = (dt.count/dt.target)*100;
    if(pct>=100) dt.hit['100']=true;
    else if(pct>=80) dt.hit['80']=true;
    else if(pct>=50) dt.hit['50']=true;
  }
  prospectState.dailyTarget = dt;
  await prospectDbPut('meta', {key:'dailyTarget', value:dt});
}

/* ---- UI-only random milestone messages (no DB / no target logic change) ---- */
const PROSPECT_TARGET_MILESTONE_MSGS = {
  '50': [
    'نصف راه رو اومدی؛ عالی بود 👏',
    '۵۰٪ تارگت زده شد؛ همین‌طور ادامه بده',
    'نیمه راه پشت سر گذاشته شد؛ قوی باش'
  ],
  '80': [
    '۸۰٪ تموم شد؛ فقط یک قدم تا قهرمانی',
    'تقریباً رسیدی؛ عالی پیش می‌ری 🔥',
    '۸۰٪ تارگت؛ تمرکز روی خط پایان'
  ],
  '100': [
    'تارگت امروز کامل شد؛ آفرین 🎉',
    '۱۰۰٪ زدی؛ روزت عالی بود',
    'تارگت پر شد؛ کارت درسته 💪'
  ]
};

function _prospectTargetMsgStoreKey(dateStr){
  return 'baqeri_pt_msg_' + (dateStr || (typeof prospectTodayStr==='function' ? prospectTodayStr() : ''));
}

function _getShownProspectTargetMilestones(dateStr){
  try{
    return JSON.parse(sessionStorage.getItem(_prospectTargetMsgStoreKey(dateStr)) || '{}') || {};
  }catch(e){
    return {};
  }
}

function _markProspectTargetMilestoneShown(dateStr, key){
  const o = _getShownProspectTargetMilestones(dateStr);
  o[String(key)] = true;
  // prevent lower milestones from showing later in the same day
  if(key === '100'){ o['50']=true; o['80']=true; }
  if(key === '80'){ o['50']=true; }
  try{
    sessionStorage.setItem(_prospectTargetMsgStoreKey(dateStr), JSON.stringify(o));
  }catch(e){}
}

function _pickProspectTargetMilestoneMsg(key){
  const list = PROSPECT_TARGET_MILESTONE_MSGS[String(key)] || [];
  if(!list.length) return '';
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * READ-ONLY vs target logic: uses current count/target only.
 * Does not write ProspectScoutDB / dailyTarget.
 * Queues a single toast (via sessionStorage) so navigation does not lose the message.
 */
function queueProspectTargetMilestoneMessage(dt){
  if(!dt || !(Number(dt.target) > 0)) return;
  const target = Number(dt.target) || 0;
  const count = Number(dt.count) || 0;
  const pct = (count / target) * 100;
  let key = null;
  if(pct >= 100) key = '100';
  else if(pct >= 80) key = '80';
  else if(pct >= 50) key = '50';
  else return;

  const dateStr = dt.date || (typeof prospectTodayStr==='function' ? prospectTodayStr() : '');
  const shown = _getShownProspectTargetMilestones(dateStr);
  if(shown[key]) return;

  _markProspectTargetMilestoneShown(dateStr, key);
  const msg = _pickProspectTargetMilestoneMsg(key);
  if(!msg) return;
  try{
    sessionStorage.setItem('baqeri_prospect_pending_toast', msg);
  }catch(e){}
  // If still on same page, show immediately as well
  if(typeof showToast === 'function'){
    try{ showToast(msg); }catch(e){}
  }
}

function flushProspectPendingToast(){
  try{
    const msg = sessionStorage.getItem('baqeri_prospect_pending_toast');
    if(!msg) return;
    sessionStorage.removeItem('baqeri_prospect_pending_toast');
    if(typeof showToast === 'function') showToast(msg);
  }catch(e){}
}

/**
 * Convert prospect shop → CRM customer (baqeri data.customers).
 * Does NOT copy evaluation visits into customer.visits.
 * Idempotent: if already linked, returns existing customer id.
 */
async function convertProspectToCustomer(shopId){
  const shop = prospectState.shops.find(s=>s.id===shopId);
  if(!shop) throw new Error('مغازه پیدا نشد');

  if(shop.linkedCustomerId){
    const existing = (typeof data!=='undefined' && data.customers)
      ? data.customers.find(c=>c.id===shop.linkedCustomerId) : null;
    if(existing){
      shop.status = 'converted';
      await persistProspectShop(shop);
      return { customerId: existing.id, created: false, customer: existing };
    }
  }

  // prevent duplicate by exact name match among active customers
  const name = (shop.name||'').trim();
  if(typeof data!=='undefined' && data.customers){
    const dup = data.customers.find(c =>
      (c.name||'').trim() === name && c.active !== false && !c._fromProspectId
    );
    // allow if linked to this shop via note marker
    const already = data.customers.find(c => c.prospectShopId === shop.id);
    if(already){
      shop.linkedCustomerId = already.id;
      shop.status = 'converted';
      await persistProspectShop(shop);
      if(typeof saveData==='function') await saveData();
      return { customerId: already.id, created: false, customer: already };
    }
    // FIX (independent audit): `dup` above was computed but never used, so a
    // customer with the exact same active name could be created a second
    // time. Reuse the existing customer instead of creating a duplicate —
    // no merge, no id change, no touching of its balance/history/invoices.
    if(dup){
      shop.linkedCustomerId = dup.id;
      shop.status = 'converted';
      await persistProspectShop(shop);
      return { customerId: dup.id, created: false, customer: dup };
    }
  }

  const sharedLocation = shop.locationId && typeof getLocationHierarchy === 'function'
    ? getLocationHierarchy(shop.locationId) : null;
  const region = sharedLocation && sharedLocation.region ? sharedLocation.region.name : prospectRouteName(shop.routeId);
  const route = sharedLocation && sharedLocation.route ? sharedLocation.route.name : prospectNeighborhoodName(shop.routeId, shop.neighborhoodId);
  const noteParts = [
    'تبدیل‌شده از ارزیابی مغازه',
    'امتیاز آخرین ارزیابی: ' + shop.latestScore + ' (رتبه ' + shop.latestRank + ')',
  ];
  const customer = {
    id: typeof uid==='function' ? uid() : ('c'+Date.now()),
    name: name,
    ownerName: '',
    phone: '',
    region: region !== '—' ? region : '',
    route: route !== '—' ? route : '',
    // carry the shared Location System reference over as-is; stays null if unset
    locationId: (shop.locationId && typeof getLocationHierarchy === 'function' && getLocationHierarchy(shop.locationId)) ? shop.locationId : null,
    address: '',
    note: noteParts.join(' — '),
    openingBalance: 0,
    visits: [],
    active: true,
    prospectShopId: shop.id,
  };
  if(typeof data==='undefined' || !data.customers){
    throw new Error('داده CRM در دسترس نیست');
  }
  data.customers.push(customer);
  if(typeof saveData==='function') await saveData();

  shop.linkedCustomerId = customer.id;
  shop.status = 'converted';
  await persistProspectShop(shop);

  return { customerId: customer.id, created: true, customer };
}
