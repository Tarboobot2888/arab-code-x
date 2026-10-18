// 🔥Diablo🔥Bot🔥 - Anime Complete System + PDF
import fetch from 'node-fetch';
import { generateWAMessageFromContent, proto } from 'baileys';
import PDFDocument from 'pdfkit';
import fs from 'fs';

global.animeSessions = global.animeSessions || {};
const CACHE = new Map();
const TTL = { PAST_SEASON: Infinity, CURRENT_SEASON: 30*60*1000, FUTURE_SEASON: 2*60*60*1000, ANIME_FINISHED: Infinity, ANIME_AIRING: 20*60*1000, ANIME_UPCOMING: 3*60*60*1000, GENRE_SEARCH: 60*60*1000, SEARCH_RESULTS: 60*60*1000, CHARACTERS: 6*60*60*1000, STAFF: 6*60*60*1000, RECOMMENDATIONS: 3*60*60*1000 };
function cacheGet(key){const e=CACHE.get(key);if(!e)return null;if(e.ttl===Infinity)return e.data;if(Date.now()-e.time<e.ttl)return e.data;CACHE.delete(key);return null;}
function cacheSet(key,data,ttl){CACHE.set(key,{data,time:Date.now(),ttl});}
function cacheStats(){let f=0,s=0,p=0;const n=Date.now();for(const [k,e]of CACHE){if(e.ttl===Infinity)p++;else if(n-e.time<e.ttl)f++;else s++;}return{total:CACHE.size,fresh:f,stale:s,permanent:p};}
function cacheClear(prefix=null){if(!prefix){CACHE.clear();return;}for(const k of [...CACHE.keys()]){if(k.startsWith(prefix))CACHE.delete(k);}}
function seasonTTL(y){const n=new Date().getFullYear();if(y<n)return TTL.PAST_SEASON;if(y===n)return TTL.CURRENT_SEASON;return TTL.FUTURE_SEASON;}
function animeTTL(s){if(s==='RELEASING')return TTL.ANIME_AIRING;if(s==='NOT_YET_RELEASED')return TTL.ANIME_UPCOMING;return TTL.ANIME_FINISHED;}
const translationCache=new Map();
async function translateToAr(text){if(!text)return'';let clean=text.replace(/<[^>]*>/g,'').trim();if(!clean)return'';if(clean.length>500)clean=clean.slice(0,500);if(/[\u0600-\u06FF]/.test(clean)&&clean.length>10)return clean;if(translationCache.has(clean))return translationCache.get(clean);try{const res=await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(clean)}&langpair=en|ar`,{timeout:8000});const data=await res.json();let tr=data?.responseData?.translatedText||clean;translationCache.set(clean,tr);return tr;}catch{return clean;}}
async function translateBatch(texts){const r=[];for(let t of texts){r.push(await translateToAr(t));await new Promise(x=>setTimeout(x,300));}return r;}
function cleanText(text,max=900){if(!text)return'لا يوجد وصف متاح.';let c=String(text).replace(/<br\s*\/?>/gi,' ').replace(/<\/?[^>]+>/g,'').replace(/\[Written by[^\]]*\]/gi,'').replace(/\[Source:[^\]]*\]/gi,'').replace(/\(Source:[^)]*\)/gi,'').replace(/[#*_~`>|\\]+/g,' ').replace(/\[[^\]]{0,30}\]/g,'').replace(/[\uFFFD\u200B-\u200F\u202A-\u202E]+/g,'').replace(/\s+/g,' ').replace(/\n{3,}/g,'\n\n').trim();if(c.length<15)return'لا يوجد وصف متاح.';if(c.length>max)c=c.slice(0,max)+'...';return c;}
function shortTitle(t,w=3){if(!t)return'بدون عنوان';const p=String(t).trim().split(/\s+/).filter(Boolean);return p.length<=w?t:p.slice(0,w).join(' ')+'…';}
const STATUS_MAP_AR={'RELEASING':'🟢 مستمر','FINISHED':'✅ مكتمل','NOT_YET_RELEASED':'⏳ قادم','CANCELLED':'❌ ملغي','HIATUS':'⏸️ متوقف'};
const SEASON_AR={WINTER:'شتاء',SPRING:'ربيع',SUMMER:'صيف',FALL:'خريف'};
const SEASON_EMOJI={WINTER:'❄️',SPRING:'🌸',SUMMER:'☀️',FALL:'🍂'};
function currentSeason(){const m=new Date().getMonth()+1;if(m>=1&&m<=3)return'WINTER';if(m>=4&&m<=6)return'SPRING';if(m>=7&&m<=9)return'SUMMER';return'FALL';}
function currentYear(){return new Date().getFullYear();}
function formatRemaining(s){if(!s||s<=0)return'الآن';const d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),mn=Math.floor((s%3600)/60);if(d>0)return`${d} يوم و ${h} ساعة`;if(h>0)return`${h} ساعة و ${mn} دقيقة`;return`${mn} دقيقة`;}
function formatAiringDate(ts){if(!ts)return'غير معروف';const d=new Date(ts*1000);return d.toLocaleString('ar-MA',{timeZone:'Africa/Casablanca',weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});}
async function sendInteractive(conn,m,body,footer,buttons){const interactiveMessage={body:{text:body},footer:{text:footer||'سيلانا بوت'},nativeFlowMessage:{buttons}};const msg=generateWAMessageFromContent(m.chat,{viewOnceMessage:{message:{interactiveMessage:proto.Message.InteractiveMessage.fromObject(interactiveMessage)}}},{quoted:m});await conn.relayMessage(m.chat,msg.message,{messageId:msg.key.id,additionalNodes:[{tag:'biz',attrs:{},content:[{tag:'interactive',attrs:{type:'native_flow',v:'1'},content:[{tag:'native_flow',attrs:{v:'9',name:'mixed'}}]}]}]});}

// ===== PDF عرض كامل =====
async function performFullView(conn,m,usedPrefix){
const session=global.animeSessions[m.sender];
if(!session)return conn.sendMessage(m.chat,{text:'❌ لا توجد جلسة.'},{quoted:m});
let list=session.results||session.seasonResults||session.genreResults;
let source=session.results?'بحث':session.seasonResults?`${SEASON_AR[session.seasonName]||''} ${session.seasonYear||''}`:session.genreAr||session.genreMultiNames||'تصنيف';
if(!list||!list.length)return conn.sendMessage(m.chat,{text:'❌ لا توجد نتائج للعرض'},{quoted:m});
let wait = await conn.sendMessage(m.chat,{text:`⏳ كنصاوب PDF فيه ${list.length} انمي بالصور...`},{quoted:m});
let pdfPath = `./anime_${Date.now()}.pdf`
let doc = new PDFDocument({ margin: 20, size: 'A4', autoFirstPage: false })
doc.pipe(fs.createWriteStream(pdfPath))
for(let i=0;i<list.length;i++){
  let a = list[i]
  let full = null
  try{ full = await fetchFullDetails(a.id) }catch{ full = a }
  let title = full.title?.english||full.title?.romaji||'بدون عنوان'
  let title2 = full.title?.native||full.title?.romaji||''
  let genres = (full.genres||[]).join(' / ') || 'غير معروف'
  let status = STATUS_MAP_AR[full.status]||full.status||'—'
  let year = full.seasonYear||full.startDate?.year||'?'
  let eps = full.episodes||'?'
  let score = full.averageScore? (full.averageScore/10).toFixed(1) : '?'
  let story = cleanText(full.description, 500)
  let storyAr = story.length>20? await translateToAr(story).catch(()=>story) : story
  doc.addPage()
  try{
    let imgUrl = full.coverImage?.extraLarge||full.coverImage?.large
    if(imgUrl){
      let r = await fetch(imgUrl)
      let buf = Buffer.from(await r.arrayBuffer())
      doc.image(buf, 30, 30, { width: 150, height: 210 })
    }
  }catch{}
  doc.fontSize(14).fillColor('black').text(`${i+1}. ${title}`, 200, 30, {width: 350, align:'left'})
  doc.fontSize(10).fillColor('gray').text(`الاسم الاخر: ${title2}`, 200, 55, {width: 350})
  doc.fontSize(10).fillColor('black')
  doc.text(`السنة: ${year} | الحالة: ${status}`, 200, 80, {width: 350})
  doc.text(`الحلقات: ${eps} | التقييم: ${score}/10`, 200, 95, {width: 350})
  doc.text(`النوع: ${full.format||'?'}`, 200, 110, {width: 350})
  doc.fillColor('#e67e22').text(`التصنيف: ${genres}`, 200, 125, {width: 350})
  doc.fillColor('black').fontSize(11).text(`القصة:`, 30, 260)
  doc.fontSize(9).text(storyAr, 30, 275, {width: 530, align:'right'})
  doc.fontSize(8).fillColor('gray').text(`anilist.co/anime/${full.id}`, 30, 780, {align:'center'})
}
doc.end()
await new Promise(r=>setTimeout(r,2500))
try{await conn.sendMessage(m.chat,{delete:wait.key})}catch{}
await conn.sendMessage(m.chat,{
  document: fs.readFileSync(pdfPath),
  mimetype: 'application/pdf',
  fileName: `${source}_${list.length}anime.pdf`,
  caption: `📚 *${source}* - ${list.length} انمي\nPDF فيه صورة + اسم + تصنيف + قصة`
},{quoted:m})
try{fs.unlinkSync(pdfPath)}catch{}
return sendInteractive(conn,m,`✅ *تم إنشاء PDF* - ${list.length} انمي`,'سيلانا بوت • PDF',[
{name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:'❌ إغلاق',id:`${usedPrefix}انمي-إغلاق`})},
{name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:'📚 القائمة',id:`${usedPrefix}انميات`})}
]);
}

async function fetchFullDetails(animeId){const key=`anime:${animeId}`;const cached=cacheGet(key);if(cached)return cached;const query=`query ($id: Int) { Media(id: $id, type: ANIME) { id title { romaji english native } description episodes duration averageScore popularity genres tags { name description rank isAdult } coverImage { large extraLarge } bannerImage trailer { id site } startDate { year month day } endDate { year month day } status format source season seasonYear studios { nodes { name } } nextAiringEpisode { episode timeUntilAiring airingAt } characters(sort: ROLE, perPage: 25) { edges { role node { id name { full native } image { large } description age gender } voiceActors(language: JAPANESE, sort: RELEVANCE) { id name { full } image { large } description languageV2 } } } staff(perPage: 25) { edges { role node { id name { full native } image { large } description } } } recommendations(perPage: 20, sort: RATING_DESC) { nodes { rating mediaRecommendation { id title { romaji english } coverImage { large } averageScore episodes format status } } } } }`;const res=await fetch('https://graphql.anilist.co/',{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'Mozilla/5.0 (Android 13)','Referer':'https://anilist.co/'},body:JSON.stringify({query,variables:{id:animeId}})});if(!res.ok)throw new Error(`HTTP ${res.status}`);const data=await res.json();const media=data.data?.Media;if(!media)return null;cacheSet(key,media,animeTTL(media.status));return media;}
async function sendAnimeDetail(conn,m,anime,usedPrefix){
const sessionKey=m.sender;const rawDesc=cleanText(anime.description,900);const translatedDesc=await translateToAr(rawDesc);const title=anime.title?.romaji||anime.title?.english||anime.title?.native||'بدون عنوان';const titleEn=anime.title?.english?` (${anime.title.english})`:'';const titleNative=anime.title?.native?`\n🇯🇵 الأصل: ${anime.title.native}`:'';const statusMap={'FINISHED':'مكتمل','RELEASING':'يعرض حالياً','NOT_YET_RELEASED':'لم يصدر بعد','CANCELLED':'ملغي','HIATUS':'متوقف مؤقتاً'};const formatMap={'TV':'تلفزيون','MOVIE':'فيلم','OVA':'أوفا','ONA':'أونا','SPECIAL':'خاص','MUSIC':'موسيقي'};const statusAr=statusMap[anime.status]||anime.status||'غير معروف';const formatAr=formatMap[anime.format]||anime.format||'';let tagsText='';if(anime.tags?.length){const filteredTags=anime.tags.filter(t=>!t.isAdult).slice(0,15);if(filteredTags.length){tagsText='\n🏷️ *العلامات:*\n';for(let tag of filteredTags){const percent=tag.rank?`${tag.rank}%`:'';const transName=await translateToAr(tag.name);tagsText+=`• ${transName} ${percent?`- ${percent}`:''}\n`;await new Promise(r=>setTimeout(r,200));}}}
const genresAr=anime.genres?.length?(await translateBatch(anime.genres)).join('، '):'';let airInfo='';if(anime.status==='RELEASING'){const total=anime.episodes||null;if(anime.nextAiringEpisode){const n=anime.nextAiringEpisode;const currentEp=n.episode-1;const remaining=total?total-currentEp:null;airInfo=`\n━━━━━━━━━━━━\n🟢 *مستمر*\n📺 الحالية: *${currentEp}*${total?` / ${total}`:''}\n`;if(remaining!==null)airInfo+=`⏳ المتبقية: *${remaining}*\n`;airInfo+=`━━━━━━━━━━━━\n📅 القادمة: *${n.episode}*\n🕐 ${formatAiringDate(n.airingAt)}\n⌛ متبقٍ: *${formatRemaining(n.timeUntilAiring)}*\n`;}else{airInfo=`\n🟢 *مستمر — ${anime.episodes||'؟'} حلقة*\n`;}}else if(anime.status==='NOT_YET_RELEASED'){airInfo=`\n⏳ *لم يُبث بعد*${anime.startDate?.year?` — ${anime.startDate.year}`:''}\n`;}
let replyText=`📺 *${title}*${titleEn}${titleNative}\n━━━━━━━━━━━━\n📀 ${formatAr} | 📌 ${statusAr}\n⭐ ${anime.averageScore||'—'}/100 | 👥 ${anime.popularity?anime.popularity.toLocaleString():''}\n📺 ${anime.episodes||'—'} حلقة | ⏱️ ${anime.duration?anime.duration+' د':''}\n`;if(anime.seasonYear)replyText+=`📅 ${anime.seasonYear} - ${anime.season?SEASON_AR[anime.season]:''}\n`;if(genresAr)replyText+=`🎭 ${genresAr}\n`;if(anime.studios?.nodes?.length)replyText+=`🏢 ${anime.studios.nodes.map(s=>s.name).join(', ')}\n`;replyText+=airInfo;replyText+=`━━━━━━━━━━━━\n📝 *القصة:*\n${translatedDesc}\n━━━━━━━━━━━━`;if(tagsText)replyText+=tagsText;replyText+=`\n🔗 https://anilist.co/anime/${anime.id}`;
const charactersMap=new Map();const staffMap=new Map();const recMap=new Map();(anime.characters?.edges||[]).forEach(e=>{if(e.node?.id)charactersMap.set(e.node.id.toString(),e);});(anime.staff?.edges||[]).forEach(e=>{if(e.node?.id)staffMap.set(e.node.id.toString(),e);});(anime.recommendations?.nodes||[]).forEach(n=>{if(n.mediaRecommendation?.id)recMap.set(n.mediaRecommendation.id.toString(),n);});global.animeSessions[sessionKey]={...global.animeSessions[sessionKey],currentAnime:anime,charactersMap,staffMap,recMap};
const buttons=[];if(charactersMap.size>0){const charRows=[];let idx=0;for(let [id,edge]of charactersMap){if(idx>=20)break;charRows.push({id:`${usedPrefix}انمي-شخصية ${id}`,title:`${edge.node.name.full.slice(0,30)}`,description:`${edge.role||''} - ${edge.voiceActors?.[0]?.name?.full||'بدون ممثل'}`});idx++;}buttons.push({name:'single_select',buttonParamsJson:JSON.stringify({title:'👥 الشخصيات',sections:[{title:`👥 شخصيات ${title.slice(0,20)}`,rows:charRows}]})});}
if(staffMap.size>0){const staffRows=[];let idx=0;for(let [id,edge]of staffMap){if(idx>=20)break;staffRows.push({id:`${usedPrefix}انمي-موظف ${id}`,title:`${edge.node.name.full.slice(0,30)}`,description:`${edge.role||''}`});idx++;}buttons.push({name:'single_select',buttonParamsJson:JSON.stringify({title:'🎬 طاقم العمل',sections:[{title:`🎬 طاقم ${title.slice(0,20)}`,rows:staffRows}]})});}
buttons.push({name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:'💡 التوصيات',id:`${usedPrefix}انمي-توصيات`})});buttons.push({name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:'❌ إغلاق',id:`${usedPrefix}انمي-إغلاق`})});
const interactiveMessage={body:{text:replyText},footer:{text:`سيلانا بوت • ${anime.episodes||'?'} حلقة • ${formatAr}`},nativeFlowMessage:{buttons}};const msg=generateWAMessageFromContent(m.chat,{viewOnceMessage:{message:{interactiveMessage:proto.Message.InteractiveMessage.fromObject(interactiveMessage)}}},{quoted:m});if(anime.coverImage?.extraLarge||anime.coverImage?.large){await conn.sendMessage(m.chat,{image:{url:anime.coverImage.extraLarge||anime.coverImage.large},caption:`🎬 ${title}`},{quoted:m});}await conn.relayMessage(m.chat,msg.message,{messageId:msg.key.id,additionalNodes:[{tag:'biz',attrs:{},content:[{tag:'interactive',attrs:{type:'native_flow',v:'1'},content:[{tag:'native_flow',attrs:{v:'9',name:'mixed'}}]}]}]});}

const ALL_GENRES=[
{ code:'Act', ar:'أكشن', en:'Action', type:'genre', emoji:'⚔️', group:'genres' },{ code:'Adv', ar:'مغامرة', en:'Adventure', type:'genre', emoji:'🗺️', group:'genres' },
{ code:'Com', ar:'كوميديا', en:'Comedy', type:'genre', emoji:'😂', group:'genres' },{ code:'Dra', ar:'دراما', en:'Drama', type:'genre', emoji:'🎭', group:'genres' },
{ code:'Ecc', ar:'إيتشي', en:'Ecchi', type:'genre', emoji:'💋', group:'genres' },{ code:'Fan', ar:'فانتازيا', en:'Fantasy', type:'genre', emoji:'🧙', group:'genres' },
{ code:'Hor', ar:'رعب', en:'Horror', type:'genre', emoji:'👻', group:'genres' },{ code:'Msh', ar:'فتاة سحرية', en:'Mahou Shoujo', type:'genre', emoji:'✨', group:'genres' },
{ code:'Mec', ar:'ميكا', en:'Mecha', type:'genre', emoji:'🤖', group:'genres' },{ code:'Mus', ar:'موسيقى', en:'Music', type:'genre', emoji:'🎵', group:'genres' },
{ code:'Mys', ar:'غموض', en:'Mystery', type:'genre', emoji:'🔍', group:'genres' },{ code:'Psy', ar:'نفسي', en:'Psychological', type:'genre', emoji:'🧠', group:'genres' },
{ code:'Rom', ar:'رومانسي', en:'Romance', type:'genre', emoji:'❤️', group:'genres' },{ code:'Sci', ar:'خيال علمي', en:'Sci-Fi', type:'genre', emoji:'🚀', group:'genres' },
{ code:'Sol', ar:'شريحة حياة', en:'Slice of Life', type:'genre', emoji:'🌱', group:'genres' },{ code:'Spo', ar:'رياضة', en:'Sports', type:'genre', emoji:'🏆', group:'genres' },
{ code:'Sup', ar:'خارق طبيعي', en:'Supernatural', type:'genre', emoji:'👽', group:'genres' },{ code:'Thr', ar:'إثارة', en:'Thriller', type:'genre', emoji:'🔥', group:'genres' },
{ code:'Isk', ar:'إيسيكاي', en:'Isekai', type:'tag', emoji:'🌍', group:'themes' },{ code:'Sch', ar:'مدرسة', en:'School', type:'tag', emoji:'🏫', group:'themes' },
];
function genreByCode(code){if(!code)return null;return ALL_GENRES.find(g=>g.code.toLowerCase()===code.toLowerCase().trim());}
function parseGenreCodes(input){if(!input)return[];return input.split(/[-+,\s]+/).map(s=>s.trim()).filter(Boolean).map(c=>genreByCode(c)).filter(Boolean);}
async function showAnimeMenu(conn,m,usedPrefix){
const body=`🔥 *نظام الأنمي الشامل - Diablo Bot* 🔥\n━━━━━━━━━━━━━━━━━━━━\n📚 *كل الأوامر في أزرار تفاعلية*\n━━━━━━━━━━━━━━━━━━━━\n🔎 البحث:.انمي + اسم\n📅 المواسم: تصفح كل سنة وموسم\n🎭 التصنيفات: تصنيفات\n🖼️ عرض كامل: PDF فيه كل النتائج\n\n👇 *اختر من الأزرار*`;
const sections=[
{title:'🔎 البحث الرئيسي',rows:[
{header:'بحث بالاسم',title:'🔎 بحث أنمي',description:'مثال: انمي ناروتو',id:`${usedPrefix}انمي ناروتو`},
]},
{title:'📅 المواسم',rows:[
{header:'كل المواسم',title:'📅 متصفح المواسم',description:'1950-2027',id:`${usedPrefix}انمي-مواسم`},
]},
{title:'🎭 التصنيفات',rows:[
{header:'كل التصنيفات',title:'🎭 قائمة التصنيفات',description:'140 تصنيف',id:`${usedPrefix}تصنيفات`},
]},
];
const buttons=[
{name:'single_select',buttonParamsJson:JSON.stringify({title:'📚 قائمة الأوامر الكاملة',sections})},
{name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:'🔎 بحث',id:`${usedPrefix}انمي`})},
{name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:'📅 المواسم',id:`${usedPrefix}انمي-مواسم`})},
{name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:'🎭 التصنيفات',id:`${usedPrefix}تصنيفات`})}
];
return sendInteractive(conn,m,body,'Diablo Bot',buttons);
}
function buildFilterSections(usedPrefix){
const now=new Date().getFullYear();const maxYear=now+2;
const statusRows=[{header:'🌐 إزالة',title:'كل الحالات',description:'بدون فلتر',id:`${usedPrefix}انمي-حالة 0`},{header:'🟢 يُبث',title:'🟢 مستمر',description:'الجارية',id:`${usedPrefix}انمي-حالة RELEASING`},{header:'✅ انتهى',title:'✅ مكتمل',description:'المنتهية',id:`${usedPrefix}انمي-حالة FINISHED`}];
const decades={};for(let y=maxYear;y>=1950;y--){const dec=Math.floor(y/10)*10;if(!decades[dec])decades[dec]=[];decades[dec].push(y);}
const sections=[{title:'📌 الحالة',rows:statusRows}];
for(const [dec,years]of Object.entries(decades).sort((a,b)=>b[0]-a[0])){sections.push({title:`📅 ${dec}s`,rows:years.map(y=>({header:`تصفية بسنة ${y}`,title:`${y}`,description:`أنميات ${y}`,id:`${usedPrefix}انمي-سنة ${y}`}))});}
return sections;
}
async function performSearch(conn,m,usedPrefix,waitMsg=null){
const sessionKey=m.sender;const session=global.animeSessions[sessionKey];if(!session?.searchQuery)return conn.sendMessage(m.chat,{text:'❌ لا توجد جلسة.'},{quoted:m});
if(waitMsg){try{await conn.sendMessage(m.chat,{delete:waitMsg.key});}catch{}}
const page=session.searchPage||1;const cacheKey=`search:${session.searchQuery}:${session.searchYear||'all'}:${session.searchStatus||'all'}:${page}`;let pageObj=cacheGet(cacheKey);
if(!pageObj){
const query=`query ($search: String, $page: Int, $status: MediaStatus, $year: Int) { Page(page: $page, perPage: 20) { pageInfo { hasNextPage lastPage total currentPage } media(search: $search, type: ANIME, status: $status, seasonYear: $year, sort: POPULARITY_DESC) { id title { romaji english native } coverImage { large } averageScore episodes status seasonYear format } } }`;
const variables={search:session.searchQuery,page};if(session.searchStatus)variables.status=session.searchStatus;if(session.searchYear)variables.year=session.searchYear;
try{const res=await fetch('https://graphql.anilist.co/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables})});const data=await res.json();pageObj=data.data?.Page;cacheSet(cacheKey,pageObj,TTL.SEARCH_RESULTS);}catch(e){return conn.sendMessage(m.chat,{text:`❌ ${e.message}`},{quoted:m});}
}
const mediaList=pageObj?.media||[];const pageInfo=pageObj?.pageInfo||{};session.results=mediaList;session.pageInfo=pageInfo;
if(!mediaList.length){return conn.sendMessage(m.chat,{text:`❌ لا توجد نتائج`},{quoted:m});}
const startIdx=(page-1)*20;const rows=mediaList.map((anime,index)=>{const title=anime.title?.english||anime.title?.romaji||anime.title?.native||'بدون عنوان';return{header:`${STATUS_MAP_AR[anime.status]||'—'}`,title:`${startIdx+index+1}. ${shortTitle(title,3)}`,description:`⭐${anime.averageScore?(anime.averageScore/10).toFixed(1):'?'} · 📺${anime.episodes||'?'}`,id:`${usedPrefix}انمي-اختيار ${anime.id}`};});
const sections=[];for(let i=0;i<rows.length;i+=10){sections.push({title:`📜 النتائج ${startIdx+i+1}`,rows:rows.slice(i,i+10)});}
const buttons=[{name:'single_select',buttonParamsJson:JSON.stringify({title:'📂 اختر أنمي',sections})},{name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:'📄 PDF لكل النتائج',id:`${usedPrefix}انمي-عرض-كامل`})}];
if(page>1)buttons.push({name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:'◀️ السابق',id:`${usedPrefix}انمي-سابق`})});
if(pageInfo.hasNextPage)buttons.push({name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:'▶️ التالي',id:`${usedPrefix}انمي-تالي`})});
let body=`🔎 *بحث:* "${session.searchQuery}"\n📄 صفحة ${pageInfo.currentPage||page} من ${pageInfo.lastPage||1}\n📊 الإجمالي: ${pageInfo.total||mediaList.length}\n\n📌 اختر أنمي أو حمل PDF لكل القائمة:`;return sendInteractive(conn,m,body,'سيلانا بوت • أنمي',buttons);
}
function buildSeasonYearSections(usedPrefix){
const nowYear=currentYear();const curSeason=currentSeason();const maxYear=nowYear+2;const minYear=1950;const decades={};
for(let y=maxYear;y>=minYear;y--){const dec=Math.floor(y/10)*10;if(!decades[dec])decades[dec]=[];decades[dec].push(y);}
const sections=[];for(const [dec,years]of Object.entries(decades).sort((a,b)=>b[0]-a[0])){sections.push({title:`📅 ${dec}s`,rows:years.map(y=>({header:`اختر موسم ${y}`,title:`${y}`,description:'شتاء · ربيع · صيف · خريف',id:`${usedPrefix}انمي-مواسم ${y}`}))});}return sections;
}
async function showSeasonYears(conn,m,usedPrefix){
const sections=buildSeasonYearSections(usedPrefix);
const buttons=[{name:'single_select',buttonParamsJson:JSON.stringify({title:'📅 اختر السنة',sections})},{name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:'❌ إغلاق',id:`${usedPrefix}انمي-إغلاق`})}];
return sendInteractive(conn,m,`📅 *متصفح المواسم*`,'سيلانا بوت • مواسم',buttons);
}
async function showSeasonPickerForYear(conn,m,usedPrefix,year){
const seasons=[{id:'WINTER',ar:'شتاء'},{id:'SPRING',ar:'ربيع'},{id:'SUMMER',ar:'صيف'},{id:'FALL',ar:'خريف'}];
const rows=seasons.map(s=>({header:`أنميات ${year}`,title:`${SEASON_EMOJI[s.id]} ${s.ar}`,description:s.id,id:`${usedPrefix}انمي-موسم ${year} ${s.id}`}));
const buttons=[{name:'single_select',buttonParamsJson:JSON.stringify({title:`📅 مواسم ${year}`,sections:[{title:`📅 مواسم سنة ${year}`,rows}]})},{name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:'↩️ رجوع',id:`${usedPrefix}انمي-مواسم`})}];
return sendInteractive(conn,m,`📅 *سنة ${year}* - اختر الموسم:`, 'سيلانا بوت', buttons);
}
async function performSeasonSearch(conn,m,usedPrefix,year,season,waitMsg=null){
const sessionKey=m.sender;const session=global.animeSessions[sessionKey]||{};global.animeSessions[sessionKey]=session;
if(waitMsg){try{await conn.sendMessage(m.chat,{delete:waitMsg.key});}catch{}}
const page=session.seasonPage||1;const cacheKey=`season:${year}:${season}:${page}`;let pageObj=cacheGet(cacheKey);
if(!pageObj){
const query=`query ($year: Int, $season: MediaSeason, $page: Int) { Page(page: $page, perPage: 30) { pageInfo { hasNextPage lastPage total currentPage } media(seasonYear: $year, season: $season, type: ANIME, sort: POPULARITY_DESC, isAdult: false) { id title { romaji english native } coverImage { large } averageScore episodes status format season seasonYear } } }`;
try{const res=await fetch('https://graphql.anilist.co/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables:{year,season,page}})});const data=await res.json();pageObj=data.data?.Page;cacheSet(cacheKey,pageObj,seasonTTL(year));}catch(e){return conn.sendMessage(m.chat,{text:`❌ ${e.message}`},{quoted:m});}
}
const mediaList=pageObj?.media||[];const pageInfo=pageObj?.pageInfo||{};session.seasonYear=year;session.seasonName=season;session.seasonResults=mediaList;session.seasonPageInfo=pageInfo;
if(!mediaList.length)return conn.sendMessage(m.chat,{text:'❌ لا توجد أنميات'},{quoted:m});
const startIdx=(page-1)*30;const rows=mediaList.map((anime,index)=>{const title=anime.title?.english||anime.title?.romaji||'بدون عنوان';return{header:`${STATUS_MAP_AR[anime.status]||'—'}`,title:`${startIdx+index+1}. ${shortTitle(title,3)}`,description:`⭐${anime.averageScore?(anime.averageScore/10).toFixed(1):'?'}`,id:`${usedPrefix}انمي-اختيار ${anime.id}`};});
const sections=[];for(let i=0;i<rows.length;i+=10){sections.push({title:`📜 النتائج`,rows:rows.slice(i,i+10)});}
const buttons=[{name:'single_select',buttonParamsJson:JSON.stringify({title:'📂 اختر أنمي',sections})},{name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:'📄 PDF لكل الموسم',id:`${usedPrefix}انمي-عرض-كامل`})}];
if(page>1)buttons.push({name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:'◀️ السابق',id:`${usedPrefix}انمي-موسم-سابق`})});
if(pageInfo.hasNextPage)buttons.push({name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:'▶️ التالي',id:`${usedPrefix}انمي-موسم-تالي`})});
return sendInteractive(conn,m,`📅 *${SEASON_AR[season]} ${year}* - ${pageInfo.total} انمي`, 'سيلانا', buttons);
}
async function showGenresList(conn,m,usedPrefix){
const sections=[{title:'📚 تصنيفات',rows:ALL_GENRES.map(g=>({header:`كود: ${g.code}`,title:`${g.emoji} ${g.ar}`,description:g.en,id:`${usedPrefix}تصنيف ${g.code}`}))}]
const buttons=[{name:'single_select',buttonParamsJson:JSON.stringify({title:'🎭 اختر تصنيفاً',sections})},{name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:'❌ إغلاق',id:`${usedPrefix}انمي-إغلاق`})}];
return sendInteractive(conn,m,`🎭 *كل التصنيفات* - ${ALL_GENRES.length}`, 'سيلانا', buttons);
}
async function fetchGenrePage(genre,page=1){
const cacheKey=`genre:${genre.code}:${page}`;const cached=cacheGet(cacheKey);if(cached)return cached;
const query=`query ($genre: String, $tag: String, $page: Int) { Page(page: $page, perPage: 30) { pageInfo { hasNextPage lastPage total currentPage } media(genre: $genre, tag: $tag, type: ANIME, sort: POPULARITY_DESC, isAdult: false) { id title { romaji english native } coverImage { large } averageScore episodes status format seasonYear startDate { year } } } }`;
const variables={page};if(genre.type==='genre')variables.genre=genre.en;else variables.tag=genre.en;
const res=await fetch('https://graphql.anilist.co/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables})});
const data=await res.json();const pageObj=data.data?.Page;cacheSet(cacheKey,pageObj,TTL.GENRE_SEARCH);return pageObj;
}
async function performGenreSearch(conn,m,usedPrefix,codesInput,waitMsg=null){
const sessionKey=m.sender;const session=global.animeSessions[sessionKey]||{};global.animeSessions[sessionKey]=session;
if(waitMsg){try{await conn.sendMessage(m.chat,{delete:waitMsg.key});}catch{}}
const genres=parseGenreCodes(codesInput);if(!genres.length)return conn.sendMessage(m.chat,{text:'❌ كود غير صالح'},{quoted:m});
const genre=genres[0];const page=session.genrePage||1;let pageObj;try{pageObj=await fetchGenrePage(genre,page);}catch(e){return conn.sendMessage(m.chat,{text:`❌ ${e.message}`},{quoted:m});}
const mediaList=pageObj?.media||[];const pageInfo=pageObj?.pageInfo||{};session.genreResults=mediaList;session.genrePageInfo=pageInfo;session.genreCode=genre.code;
const rows=mediaList.map((anime,index)=>{const title=anime.title?.english||anime.title?.romaji||'بدون عنوان';return{header:`${STATUS_MAP_AR[anime.status]||'—'}`,title:`${index+1}. ${shortTitle(title,3)}`,description:`⭐${anime.averageScore?(anime.averageScore/10).toFixed(1):'?'}`,id:`${usedPrefix}انمي-اختيار ${anime.id}`};});
const sections=[];for(let i=0;i<rows.length;i+=10){sections.push({title:`📜 النتائج`,rows:rows.slice(i,i+10)});}
const buttons=[{name:'single_select',buttonParamsJson:JSON.stringify({title:'📂 اختر أنمي',sections})},{name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:'📄 PDF لكل التصنيف',id:`${usedPrefix}انمي-عرض-كامل`})}];
return sendInteractive(conn,m,`${genre.emoji} *${genre.ar}* - ${pageInfo.total} انمي`, 'سيلانا', buttons);
}

const handler=async(m,{conn,args,usedPrefix,command})=>{
if(command==='انميات'||command==='animes'){return showAnimeMenu(conn,m,usedPrefix);}
if(command==='انمي-عرض-كامل'||command==='anime-fullview'){return performFullView(conn,m,usedPrefix);}
if(command==='انمي-اختيار'||command==='anime-choice'){const session=global.animeSessions[m.sender];if(!session)return conn.sendMessage(m.chat,{text:`❌ لا توجد جلسة.`},{quoted:m});const match=(m.text||'').match(/\d+/);if(!match)return conn.sendMessage(m.chat,{text:`❌ معرّف غير صالح.`},{quoted:m});const waitMsg=await conn.sendMessage(m.chat,{text:`⏳ جاري التحميل...`},{quoted:m});try{const anime=await fetchFullDetails(parseInt(match[0]));if(!anime)throw new Error('لا توجد تفاصيل');await conn.sendMessage(m.chat,{delete:waitMsg.key});await sendAnimeDetail(conn,m,anime,usedPrefix);}catch(e){await conn.sendMessage(m.chat,{text:`❌ ${e.message}`},{quoted:m});}return;}
if(command==='انمي-سنة'||command==='anime-year'){const session=global.animeSessions[m.sender];const y=parseInt(args[0]);if(args[0]==='0')session.searchYear=null;else session.searchYear=y;session.searchPage=1;return performSearch(conn,m,usedPrefix);}
if(command==='انمي-حالة'||command==='anime-status'){const session=global.animeSessions[m.sender];if(args[0]==='0')session.searchStatus=null;else session.searchStatus=args[0];session.searchPage=1;return performSearch(conn,m,usedPrefix);}
if(command==='انمي-تالي'||command==='anime-next'){const session=global.animeSessions[m.sender];session.searchPage++;return performSearch(conn,m,usedPrefix);}
if(command==='انمي-سابق'||command==='anime-prev'){const session=global.animeSessions[m.sender];if(session.searchPage>1)session.searchPage--;return performSearch(conn,m,usedPrefix);}
if(command==='انمي-مواسم'||command==='anime-seasons'){if(!args[0])return showSeasonYears(conn,m,usedPrefix);return showSeasonPickerForYear(conn,m,usedPrefix,parseInt(args[0]));}
if(command==='انمي-موسم'||command==='anime-season'){global.animeSessions[m.sender]=global.animeSessions[m.sender]||{};global.animeSessions[m.sender].seasonPage=1;const waitMsg=await conn.sendMessage(m.chat,{text:`⏳ جاري الجلب...`},{quoted:m});return performSeasonSearch(conn,m,usedPrefix,parseInt(args[0]),args[1],waitMsg);}
if(command==='انمي-موسم-تالي'){const s=global.animeSessions[m.sender];s.seasonPage++;return performSeasonSearch(conn,m,usedPrefix,s.seasonYear,s.seasonName);}
if(command==='انمي-موسم-سابق'){const s=global.animeSessions[m.sender];if(s.seasonPage>1)s.seasonPage--;return performSeasonSearch(conn,m,usedPrefix,s.seasonYear,s.seasonName);}
if(command==='تصنيفات'||command==='genres'){if(!args[0])return showGenresList(conn,m,usedPrefix);global.animeSessions[m.sender]=global.animeSessions[m.sender]||{};global.animeSessions[m.sender].genrePage=1;const waitMsg=await conn.sendMessage(m.chat,{text:`⏳ جاري الجلب...`},{quoted:m});return performGenreSearch(conn,m,usedPrefix,args.join(' '),waitMsg);}
if(command==='تصنيف'||command==='genre'){global.animeSessions[m.sender]=global.animeSessions[m.sender]||{};global.animeSessions[m.sender].genrePage=1;const waitMsg=await conn.sendMessage(m.chat,{text:`⏳ جاري الجلب...`},{quoted:m});return performGenreSearch(conn,m,usedPrefix,args[0],waitMsg);}
if(command==='انمي'||command==='anime'){if(!args[0])return conn.sendMessage(m.chat,{text:`✍️ اكتب اسم الأنمي\nمثال: ${usedPrefix}انمي ناروتو`},{quoted:m});global.animeSessions[m.sender]={searchQuery:args.join(' '),searchYear:null,searchStatus:null,searchPage:1};const waitMsg=await conn.sendMessage(m.chat,{text:`⏳ جاري البحث...`},{quoted:m});return performSearch(conn,m,usedPrefix,waitMsg);}
if(command==='انمي-إغلاق'||command==='anime-close'){delete global.animeSessions[m.sender];return conn.sendMessage(m.chat,{text:`✅ تم الإغلاق.`},{quoted:m});}
};
handler.help=['انمي <اسم>','انميات','تصنيفات','انمي-عرض-كامل'];
handler.tags=['search'];
handler.command=[
'انميات','animes','انمي-عرض-كامل','anime-fullview',
'انمي','anime','انمي-اختيار','anime-choice',
'انمي-سنة','anime-year','انمي-حالة','anime-status','انمي-تالي','anime-next','انمي-سابق','anime-prev',
'انمي-مواسم','anime-seasons','انمي-موسم','anime-season','انمي-موسم-تالي','انمي-موسم-سابق',
'تصنيفات','genres','تصنيف','genre','انمي-إغلاق','anime-close'
];
export default handler;