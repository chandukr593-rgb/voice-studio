const SUPABASE_URL="https://pbffjuqifadnqdddeqwc.supabase.co",SUPABASE_KEY="sb_publishable_64rcnA_hORGgec-u-JEKHQ_3kDlGiTV",sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY),MAX_WORDS=3500;
const GOOGLE_CLIENT_ID="383565719071-otmjg01viggma9e4496r66tmj5u1g7cq.apps.googleusercontent.com";
const EDGE_TTS_URL="/api/tts";
let voices=[],telegramUrl="",announcementText="",aiServerUrl="",colabNotebookUrl="",currentMember=null,isRecoveryFlow=false,authSessionHandled=false,generatedMp3Url=null,lastGeneratedKey="",aiAbort=null,aiCancelled=false,activeSecret="",voiceMode="clone";
let sampleAudio=null,sampleUrlNow="",generatedAudio=null;
const $=id=>document.getElementById(id);

function showPage(p){
 ["noLoginColabPage","homePage","contactPage","memberLogin","memberPage"].forEach(id=>$(id).classList.add("hidden"));
 $(p).classList.remove("hidden");
 $("memberHeaderControls").classList.toggle("hidden",!(p==="memberPage"&&currentMember));
}
function goHome(){stopAllPlayers();updateHomeSessionBar();showPage("homePage")}
function updateHomeSessionBar(){
 const ok=currentMember&&currentMember.profile_completed;
 $("homeSessionBar").classList.toggle("hidden",!ok);
 if(ok)$("homeLoggedInNote").textContent="✅ लॉगिन: "+currentMember.name+" (@"+currentMember.username+")";
}
async function resumeSession(){if(!currentMember)return;if(!currentMember.profile_completed)return openGoogleCompletionBox(currentMember);await openMemberDashboard()}
async function logout(){
 stopAllPlayers();cancelAiGeneration();
 if(generatedMp3Url){URL.revokeObjectURL(generatedMp3Url);generatedMp3Url=null;lastGeneratedKey=""}
 await sb.auth.signOut();currentMember=null;authSessionHandled=false;
 $("memberSettingsCard").classList.add("hidden");$("googleDetailsBox").classList.add("hidden");$("generatedAudioBox").classList.add("hidden");
 updateHomeSessionBar();showPage("homePage");
}

function refreshHelperPageUI(){
 $("helperCurrentServerUrl").value=aiServerUrl||"";
 $("helperNotebookUrl").value=colabNotebookUrl||"https://colab.research.google.com/";
 $("helperOpenColabBtn").href=colabNotebookUrl||"https://colab.research.google.com/";
}
async function copyTextValue(id,label){
 const v=($(id).value||"").trim(),st=$("helperStatus");
 if(!v)return alert(label+" खाली है।");
 try{await navigator.clipboard.writeText(v)}catch(_){$(id).select();document.execCommand("copy")}
 st.textContent="✅ "+label+" कॉपी हो गया! Telegram में Paste करें।";st.className="status good";
}
async function testHelperServer(){
 const st=$("helperStatus");
 if(!aiServerUrl){st.textContent="❌ कोई URL नहीं है।";st.className="status bad";return}
 st.textContent="⏳ जाँच हो रही है...";st.className="status";
 try{const r=await fetch(aiServerUrl+"/health"),j=await r.json();st.textContent=r.ok&&j.status==="ok"?"✅ Server LIVE है!":"❌ Server जवाब नहीं दे रहा।";st.className="status "+(r.ok&&j.status==="ok"?"good":"bad")}
 catch(_){st.textContent="❌ Server Offline है — Colab में ▶ Run दबाएं।";st.className="status bad"}
}
async function saveHelperServerUrl(){
 const u=$("helperNewServerUrl").value.trim().replace(/\/+$/,""),st=$("helperStatus"),btn=$("helperSaveBtn");
 if(!/^https?:\/\/.+/i.test(u))return alert("सही URL लिखें।");
 btn.disabled=true;st.textContent="सेव हो रहा है...";st.className="status";
 const{error}=await sb.rpc("auto_register_ai_server",{p_secret:activeSecret,p_url:u});btn.disabled=false;
 if(error){st.textContent="❌ "+error.message;st.className="status bad";return}
 aiServerUrl=u;$("helperNewServerUrl").value="";refreshHelperPageUI();
 st.textContent="✅ नया URL सेव हो गया और Telegram पर अलर्ट भेज दिया गया!";st.className="status good";
 fetch(SUPABASE_URL+"/functions/v1/telegram-bot",{method:"POST",headers:{"Content-Type":"application/json","apikey":SUPABASE_KEY},body:JSON.stringify({action:"colab_notify",secret:activeSecret,url:u})}).catch(()=>{});
}

async function loadSiteSettings(){
 const{data}=await sb.from("site_settings").select("key,value").in("key",["telegram_url","announcement_text","ai_server_url","colab_notebook_url"]);
 const m=Object.fromEntries((data||[]).map(r=>[r.key,r.value||""]));
 telegramUrl=m.telegram_url||"";announcementText=m.announcement_text||"";aiServerUrl=(m.ai_server_url||"").replace(/\/+$/,"");colabNotebookUrl=(m.colab_notebook_url||"").trim();
 $("telegramContactSection").classList.toggle("hidden",!telegramUrl);if(telegramUrl)$("publicTelegramLink").href=telegramUrl;
 const cl=announcementText.trim();$("memberNoticeBanner").classList.toggle("hidden",!cl);$("memberNoticeText").textContent=cl;
}
async function openContactPage(){stopAllPlayers();await loadSiteSettings();showPage("contactPage")}
async function sendContact(){
 const name=$("contactName").value.trim(),email=$("contactEmail").value.trim(),msg=$("contactMessage").value.trim(),st=$("contactStatus"),btn=$("sendContactBtn");
 if(!name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return alert("सही नाम और Gmail लिखें।");
 if(!msg)return alert("संदेश लिखें।");
 btn.disabled=true;const{error}=await sb.from("contact_messages").insert({name,email,message:msg});btn.disabled=false;
 if(error){st.textContent="Error: "+error.message;st.className="status bad";return}
 fetch(SUPABASE_URL+"/functions/v1/telegram-bot",{method:"POST",headers:{"Content-Type":"application/json","apikey":SUPABASE_KEY},body:JSON.stringify({action:"contact_notify",name,email,message:msg})}).catch(()=>{});
 $("contactName").value="";$("contactEmail").value="";$("contactMessage").value="";
 st.textContent="✅ संदेश भेज दिया गया है!";st.className="status good";
}

async function sha256Hex(str){
 const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(str));
 return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function loginWithGoogle(){
 if(location.protocol==="file:"||location.origin==="null")return alert("Google Login सिर्फ Live https:// वेबसाइट पर चलता है।");
 const r=location.origin+location.pathname.replace(/index\.html$/,"");
 if(!GOOGLE_CLIENT_ID||GOOGLE_CLIENT_ID.includes("YAHAN_APNA")){
  if(self!==top){const{data,error}=await sb.auth.signInWithOAuth({provider:"google",options:{redirectTo:r,skipBrowserRedirect:true}});if(error)return alert(error.message);if(data?.url)open(data.url,"_blank");return}
  const{error}=await sb.auth.signInWithOAuth({provider:"google",options:{redirectTo:r}});if(error)alert(error.message);
  return;
 }
 const rawNonce=crypto.randomUUID?crypto.randomUUID():(Date.now()+"_"+Math.random().toString(36).slice(2));
 localStorage.setItem("vs_g_nonce",rawNonce);
 const hashedNonce=await sha256Hex(rawNonce);
 const p=new URLSearchParams({client_id:GOOGLE_CLIENT_ID,redirect_uri:r,response_type:"id_token",scope:"openid email profile",nonce:hashedNonce,prompt:"select_account"});
 const authUrl="https://accounts.google.com/o/oauth2/v2/auth?"+p.toString();
 if(self!==top){open(authUrl,"_blank");return}
 location.href=authUrl;
}
async function openGoogleCompletionBox(p){
 showPage("memberLogin");$("googleDetailsBox").classList.remove("hidden");
 const{data:{user}}=await sb.auth.getUser(),meta=user?.user_metadata||{},fn=meta.full_name||meta.name||p.name||"",em=user?.email||p.email||"",ph=meta.avatar_url||meta.picture||p.photo_url||"";
 if(ph&&!currentMember.photo_url)currentMember.photo_url=ph;
 const ni=$("googleName");ni.value=fn;fn?ni.setAttribute("readonly","readonly"):ni.removeAttribute("readonly");
 $("selectedGoogleGmailInput").value=em;$("googleUsername").value=p.username||"";$("googlePass").value="";$("googleFinishStatus").textContent="";
}
async function checkUnique(name,username,exId){
 const{data,error}=await sb.rpc("check_name_username_available",{p_name:name||"",p_username:username||"",p_exclude_id:exId||null});
 if(!error&&data)return data;
 let ue=false;
 if(username){const{data:em}=await sb.rpc("get_email_by_username",{p_username:username});if(em&&(!currentMember||em.toLowerCase()!==currentMember.email.toLowerCase()))ue=true}
 return{name_exists:false,username_exists:ue};
}
async function completeGoogleSignUp(){
 if(!currentMember)return;
 const ni=$("googleName"),ui=$("googleUsername"),name=ni.value.trim(),ru=ui.value.trim(),un=ru.toLowerCase().replace(/[^a-z0-9_]/g,""),pass=$("googlePass").value,st=$("googleFinishStatus"),btn=$("googleFinishBtn");
 if(!name){ni.removeAttribute("readonly");ni.focus();return alert("नाम लिखें।")}
 if(!un||un.length<3||un!==ru.toLowerCase()){ui.focus();return alert("कम से कम 3 अक्षर का Username लिखें (a-z, 0-9, _)।")}
 if(!pass||pass.length<6)return alert("कम से कम 6 अक्षर का Password लिखें।");
 btn.disabled=true;st.textContent="जाँच हो रही है...";st.className="status";
 const chk=await checkUnique(name,un,currentMember.id);
 if(chk.name_exists){btn.disabled=false;ni.removeAttribute("readonly");ni.focus();st.textContent="❌ यह Name ("+name+") पहले से मौजूद है (Already Exists)!";st.className="status bad";return}
 if(chk.username_exists){btn.disabled=false;ui.focus();st.textContent="❌ यह Username (@"+un+") पहले से मौजूद है (Already Exists)!";st.className="status bad";return}
 const{error:pe}=await sb.auth.updateUser({password:pass});
 if(pe){btn.disabled=false;st.textContent="❌ "+pe.message;st.className="status bad";return}
 const pl={name,username:un,profile_completed:true,last_login:new Date().toISOString()};if(currentMember.photo_url)pl.photo_url=currentMember.photo_url;
 const{error:fe}=await sb.from("profiles").update(pl).eq("id",currentMember.id);btn.disabled=false;
 if(fe){if(fe.code==="23505"){ni.removeAttribute("readonly");st.textContent="❌ Name या Username पहले से मौजूद है!"}else st.textContent="❌ "+fe.message;st.className="status bad";return}
 Object.assign(currentMember,{name,username:un,profile_completed:true});$("googleDetailsBox").classList.add("hidden");$("googlePass").value="";await openMemberDashboard();
}
async function resolveEmail(id){const c=id.trim().toLowerCase().replace(/^@/,"");if(c.includes("@"))return c;const{data}=await sb.rpc("get_email_by_username",{p_username:c});return data||null}
async function memberLogin(){
 const inp=$("memberEmail").value.trim(),pw=$("memberPassword").value,st=$("memberLoginStatus"),btn=$("memberLoginBtn");
 if(!inp||!pw)return alert("Username/Email और Password भरें।");
 btn.disabled=true;st.textContent="लॉगिन हो रहा है...";st.className="status";
 const em=await resolveEmail(inp);
 if(!em){btn.disabled=false;st.textContent="❌ अकाउंट नहीं मिला।";st.className="status bad";return}
 const{data,error}=await sb.auth.signInWithPassword({email:em,password:pw});btn.disabled=false;
 if(error){st.textContent="❌ Password गलत है।";st.className="status bad";return}
 $("memberPassword").value="";st.textContent="";await handleLoggedInUser(data.user.id);
}
function openForgotPassword(){$("forgotPasswordBox").classList.remove("hidden");$("forgotStatus").textContent="";const p=$("memberEmail").value.trim();if(p.includes("@"))$("forgotEmailInput").value=p}
function closeForgotPassword(){$("forgotPasswordBox").classList.add("hidden")}
async function sendForgotResetEmail(){
 const em=$("forgotEmailInput").value.trim().toLowerCase(),st=$("forgotStatus");
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em))return alert("सही Email लिखें।");
 const{error}=await sb.auth.resetPasswordForEmail(em,location.protocol==="file:"?{}:{redirectTo:location.origin+location.pathname});
 st.textContent=error?"❌ "+error.message:"📩 Reset Link भेज दिया गया!";st.className="status "+(error?"bad":"good");
}
async function completePasswordReset(){
 const p1=$("resetNewPassInput").value,p2=$("resetConfirmPassInput").value,st=$("resetPassStatus");
 if(!p1||p1.length<6)return st.textContent="कम से कम 6 अक्षर लिखें।";if(p1!==p2)return st.textContent="Password मेल नहीं खाते।";
 const{error}=await sb.auth.updateUser({password:p1});if(error)return st.textContent="❌ "+error.message;
 isRecoveryFlow=false;$("resetNewPassInput").value="";$("resetConfirmPassInput").value="";$("resetPasswordBox").classList.add("hidden");history.replaceState(null,"",location.pathname);
 alert("Password बदल गया!");const{data}=await sb.auth.getUser();if(data?.user)await handleLoggedInUser(data.user.id);
}

async function handleLoggedInUser(uid){
 authSessionHandled=true;const{data:p,error}=await sb.from("profiles").select("*").eq("id",uid).single();
 if(error||!p){authSessionHandled=false;return alert("Profile लोड नहीं हुई।")}
 if(p.banned){await sb.auth.signOut();currentMember=null;authSessionHandled=false;alert("यह अकाउंट Banned है।");return showPage("homePage")}
 currentMember=p;if(!p.profile_completed)return openGoogleCompletionBox(p);
 await sb.from("profiles").update({last_login:new Date().toISOString()}).eq("id",uid);await openMemberDashboard();
}
async function openMemberDashboard(){
 if(!currentMember)return;
 const{data:fp}=await sb.from("profiles").select("*").eq("id",currentMember.id).maybeSingle();
 if(fp){if(fp.banned){alert("आपका अकाउंट Ban हो गया है।");return logout()}currentMember=fp}
 $("memberSettingsCard").classList.add("hidden");refreshMemberUI();showPage("memberPage");
 await Promise.all([loadVoices(),loadSiteSettings()]);renderMemberVoices();updateUploadPerm();updateScriptWordCount();checkGpuServerStatus();
}
function refreshMemberUI(){
 if(!currentMember)return;
 $("headerFullName").textContent=currentMember.name;$("settingsDisplayName").textContent=currentMember.name+" (@"+(currentMember.username||"user")+")";
 $("settingsDisplayEmail").textContent=currentMember.email;$("editUsernameInput").value=currentMember.username||"";
 [["headerAvatarImg","headerAvatarText"],["settingsAvatarImg","settingsAvatarText"]].forEach(([i,t])=>{
  const has=!!currentMember.photo_url;$(i).classList.toggle("hidden",!has);$(t).classList.toggle("hidden",has);
  if(has)$(i).src=currentMember.photo_url;else $(t).textContent=(currentMember.name||"U")[0].toUpperCase();
 });
}
function toggleSettings(){$("memberSettingsCard").classList.toggle("hidden");$("memberSettingsStatus").textContent=""}
function uploadProfilePhoto(e){
 const f=e.target.files[0];if(!f||!currentMember)return;if(!f.type.startsWith("image/"))return alert("सिर्फ फोटो चुनें।");if(f.size>5*1024*1024)return alert("5 MB से कम चुनें।");
 const st=$("memberSettingsStatus");st.textContent="अपलोड हो रहा है...";st.className="status";
 const rd=new FileReader();rd.onload=ev=>{const img=new Image();img.onload=()=>{
  const c=document.createElement("canvas");c.width=c.height=160;const s=Math.min(img.width,img.height);
  c.getContext("2d").drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,0,0,160,160);
  c.toBlob(async b=>{
   const path=currentMember.id+"/av_"+Date.now()+".jpg",{error:ue}=await sb.storage.from("avatars").upload(path,b,{contentType:"image/jpeg"});
   if(ue){st.textContent="❌ "+ue.message;st.className="status bad";return}
   const{data:pub}=sb.storage.from("avatars").getPublicUrl(path),{error:de}=await sb.from("profiles").update({photo_url:pub.publicUrl}).eq("id",currentMember.id);
   if(de){st.textContent="❌ "+de.message;st.className="status bad";return}
   currentMember.photo_url=pub.publicUrl;refreshMemberUI();st.textContent="✅ फोटो बदल गई!";st.className="status good";
  },"image/jpeg",0.85);
 };img.src=ev.target.result};rd.readAsDataURL(f);e.target.value="";
}
async function updateMemberUsername(){
 if(!currentMember)return;const ru=$("editUsernameInput").value.trim(),nu=ru.toLowerCase().replace(/[^a-z0-9_]/g,""),st=$("memberSettingsStatus");
 if(!nu||nu.length<3||nu!==ru.toLowerCase()){st.textContent="3+ अक्षर (a-z,0-9,_) लिखें।";st.className="status bad";return}
 if(nu===(currentMember.username||"").toLowerCase())return;
 const chk=await checkUnique("",nu,currentMember.id);
 if(chk.username_exists){st.textContent="❌ Username पहले से मौजूद है!";st.className="status bad";return}
 const{error}=await sb.from("profiles").update({username:nu}).eq("id",currentMember.id);
 if(error){st.textContent="❌ Username पहले से मौजूद है।";st.className="status bad";return}
 currentMember.username=nu;refreshMemberUI();st.textContent="✅ Username बदल गया!";st.className="status good";
}
async function updateMemberPassword(){
 const p1=$("editMemberNewPass").value,p2=$("editMemberConfirmPass").value,st=$("memberSettingsStatus");
 if(!p1||p1.length<6||p1!==p2){st.textContent="6+ अक्षर का एक जैसा Password भरें।";st.className="status bad";return}
 const{error}=await sb.auth.updateUser({password:p1});
 if(error){st.textContent="❌ "+error.message;st.className="status bad";return}
 $("editMemberNewPass").value="";$("editMemberConfirmPass").value="";st.textContent="✅ Password बदल गया!";st.className="status good";
}

function fmtSec(sec){const s=Math.max(0,Math.floor(sec||0));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")}
function stopSampleAudio(){
 if(sampleAudio){sampleAudio.pause();sampleAudio.currentTime=0}
 const b=$("samplePlayBtn");if(b){b.textContent="▶";b.classList.remove("playing")}
}
function stopGeneratedAudio(){
 if(generatedAudio){generatedAudio.pause();generatedAudio.currentTime=0}
 const b=$("generatedPlayBtn");if(b){b.textContent="▶";b.classList.remove("playing")}
}
function stopAllPlayers(){stopSampleAudio();stopGeneratedAudio()}

async function loadVoices(){const{data}=await sb.from("voices").select("*").order("created_at",{ascending:false});voices=data||[]}
function renderMemberVoices(){
 const sel=$("voiceSelect"),prev=sel.value;sel.replaceChildren(new Option("Select Voice Character",""));
 voices.forEach(v=>sel.add(new Option(v.name,String(v.id))));
 sel.value=voices.some(v=>String(v.id)===prev)?prev:voices[0]?String(voices[0].id):"";selectVoice();
}
function selectVoice(){
 stopSampleAudio();
 const v=voices.find(x=>String(x.id)===$("voiceSelect").value),row=$("sampleVoiceRow");
 if(!v){row.classList.add("hidden");sampleUrlNow="";return}
 row.classList.remove("hidden");$("memberVoiceInfo").textContent=v.name;sampleUrlNow=v.audio_url||"";
 $("samplePlayBtn").classList.toggle("hidden",!sampleUrlNow);
}
function toggleSamplePlay(){
 if(!sampleUrlNow)return alert("इस Voice में Sample Audio नहीं है।");
 const b=$("samplePlayBtn");
 if(sampleAudio&&!sampleAudio.paused){stopSampleAudio();return}
 stopAllPlayers();
 if(!sampleAudio||sampleAudio.src!==sampleUrlNow){
  sampleAudio=new Audio(sampleUrlNow);
  sampleAudio.onended=()=>stopSampleAudio();
  sampleAudio.onerror=()=>{stopSampleAudio();alert("Sample Audio प्ले नहीं हो पाया।")};
 }
 sampleAudio.play().then(()=>{b.textContent="⏹";b.classList.add("playing")}).catch(()=>stopSampleAudio());
}

function updateUploadPerm(){
 const ok=!!(currentMember&&(currentMember.upload_permission||currentMember.is_admin||currentMember.is_owner));
 $("memberUploadForm").classList.toggle("hidden",!ok);
 $("uploadPermissionMessage").textContent=ok?"✅ आपको Audio Upload Permission मिली है।":"Admin से Permission मिलने के बाद खुलेगा।";
 $("uploadPermissionMessage").className=ok?"status good":"note";
}
async function addMemberVoice(){
 const name=$("memberCharacterName").value.trim(),fi=$("memberVoiceFile"),f=fi.files[0],st=$("memberUploadStatus"),btn=$("memberUploadBtn");
 if(!name||!f||!f.type.startsWith("audio/")||f.size>15*1024*1024)return alert("सही Character Name और 15 MB से छोटी Audio File चुनें।");
 btn.disabled=true;st.textContent="अपलोड हो रहा है...";st.className="status";
 const path=currentMember.id+"/"+Date.now()+"_"+f.name.replace(/[^a-zA-Z0-9._-]/g,"_"),{error:ue}=await sb.storage.from("voice-samples").upload(path,f,{contentType:f.type});
 if(ue){btn.disabled=false;st.textContent="❌ "+ue.message;st.className="status bad";return}
 const{data:pub}=sb.storage.from("voice-samples").getPublicUrl(path),{error:de}=await sb.from("voices").insert({name,file_name:f.name,audio_url:pub.publicUrl,uploaded_by:currentMember.name,user_id:currentMember.id});
 btn.disabled=false;if(de){st.textContent="❌ "+de.message;st.className="status bad";return}
 $("memberCharacterName").value="";fi.value="";st.textContent="✅ Uploaded!";st.className="status good";await loadVoices();renderMemberVoices();
}

const getWords=t=>t.trim()?t.trim().split(/\s+/).filter(Boolean).length:0;
const detectLang=s=>((s||"").match(/[\u0900-\u097F]/g)||[]).length>=2?"hi":"en";
function updateScriptWordCount(){const t=$("scriptText").value||"",w=getWords(t),el=$("scriptWordCount");el.textContent="Words: "+w+" / "+MAX_WORDS+" • Characters: "+t.length+" • Auto: "+(detectLang(t)==="hi"?"Hindi":"English");el.className=w>MAX_WORDS?"bad":""}
function splitChunks(text,max=140){
 const sents=text.replace(/\r\n/g,"\n").trim().split(/(?<=[।.!?\n])\s+/),out=[];let cur="";
 for(const s of sents){
  const c=s.trim();if(!c)continue;
  if(c.length>max){if(cur){out.push(cur);cur=""}let b="";for(const w of c.split(/\s+/)){if((b+" "+w).trim().length>max){if(b)out.push(b);b=w}else b=b?b+" "+w:w}if(b)out.push(b)}
  else if((cur+" "+c).trim().length>max){if(cur)out.push(cur);cur=c}else cur=cur?cur+" "+c:c;
 }
 if(cur)out.push(cur);return out;
}
function cancelAiGeneration(){aiCancelled=true;if(aiAbort){aiAbort.abort();aiAbort=null}}

function setVoiceMode(mode){
 voiceMode=mode==="edge"?"edge":"clone";
 $("cloneVoiceCard").classList.toggle("hidden",voiceMode!=="clone");
 $("edgeVoiceCard").classList.toggle("hidden",voiceMode!=="edge");
 $("modeCloneBtn").className=voiceMode==="clone"?"green":"gray";
 $("modeEdgeBtn").className=voiceMode==="edge"?"green":"gray";
 stopAllPlayers();
}
async function checkGpuServerStatus(){
 const b=$("gpuServerBadge");if(!b)return;
 if(!aiServerUrl){b.innerHTML="🔴 Voice Cloning Server अभी बंद है — आप <b>⚡ 24×7 Fast Voices</b> इस्तेमाल कर सकते हैं!";b.className="status bad";return}
 try{
  const ctrl=new AbortController();setTimeout(()=>ctrl.abort(),4000);
  const r=await fetch(aiServerUrl+"/health",{signal:ctrl.signal}),j=await r.json();
  if(r.ok&&j.status==="ok"){b.innerHTML="🟢 Voice Cloning Server <b>LIVE</b> है!";b.className="status good";return}
 }catch(_){}
 b.innerHTML="🔴 Voice Cloning Server अभी Offline है — <b>⚡ 24×7 Fast Voices</b> हमेशा चालू है!";b.className="status bad";
}

function setupGeneratedPlayer(blob,vid){
 stopGeneratedAudio();
 if(generatedMp3Url)URL.revokeObjectURL(generatedMp3Url);
 generatedMp3Url=URL.createObjectURL(blob);
 generatedAudio=new Audio(generatedMp3Url);
 generatedAudio.playbackRate=1;
 generatedAudio.onloadedmetadata=()=>{$("generatedTimeLabel").textContent="0:00 / "+fmtSec(generatedAudio.duration)};
 generatedAudio.ontimeupdate=()=>{$("generatedTimeLabel").textContent=fmtSec(generatedAudio.currentTime)+" / "+fmtSec(generatedAudio.duration)};
 generatedAudio.onended=()=>stopGeneratedAudio();
 const isEdge=String(vid).startsWith("edge:");
 const v=isEdge?null:voices.find(x=>String(x.id)===String(vid));
 const raw=(v?v.name:"voice_studio").replace(/[^a-zA-Z0-9_-]/g,"").replace(/^_+|_+$/g,"")||"voice_studio";
 $("generatedVoiceTitle").textContent=(isEdge?"⚡ Edge TTS":"🎙️ "+(v?v.name:"Generated Voice"))+" ("+Math.max(1,Math.round(blob.size/1024))+" KB)";
 $("generatedTimeLabel").textContent="0:00 / 0:00";
 $("generatedAudioBox").classList.remove("hidden");
 return{url:generatedMp3Url,vid,fname:isEdge?"voice_studio_edge.mp3":raw+"_cloned.mp3"};
}

function toggleGeneratedPlay(){
 if(!generatedAudio||!generatedMp3Url)return alert("पहले Generate Voice दबाएं।");
 const b=$("generatedPlayBtn");
 if(!generatedAudio.paused){stopGeneratedAudio();return}
 stopSampleAudio();
 generatedAudio.playbackRate=1;
 generatedAudio.play().then(()=>{b.textContent="⏹";b.classList.add("playing")}).catch(()=>stopGeneratedAudio());
}

async function generateAiVoiceBlob(){
 const text=$("scriptText").value.trim(),st=$("memberStatus");
 if(!text)return alert("कृपया अपनी Script लिखें।");
 const wc=getWords(text);if(wc>MAX_WORDS)return alert("अधिकतम "+MAX_WORDS+" शब्द ही लिखें (अभी: "+wc+")।");

 if(voiceMode==="edge"){
  const ev=$("edgeVoiceSelect").value,er=$("edgeRateSelect").value,key="edge::"+ev+"::"+er+"::"+text;
  if(generatedMp3Url&&lastGeneratedKey===key)return{url:generatedMp3Url,vid:"edge:"+ev,fname:"voice_studio_edge.mp3"};
  const chunks=splitChunks(text,350),blobs=[],gb=$("generateAiBtn"),db=$("downloadMp3Btn");
  aiCancelled=false;aiAbort=new AbortController();gb.disabled=db.disabled=true;$("aiProgressBox").classList.remove("hidden");$("aiProgressBar").style.width="0%";
  st.textContent="⚡ 24×7 Fast Voice बन रही है (हिस्से: "+chunks.length+")...";st.className="status";
  try{
   for(let i=0;i<chunks.length;i++){
    if(aiCancelled)break;const pct=Math.round((i/chunks.length)*100);$("aiProgressBar").style.width=pct+"%";$("aiProgressText").textContent="⏳ हिस्सा "+(i+1)+" / "+chunks.length+" ("+pct+"%)";
    const r=await fetch(EDGE_TTS_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:chunks[i],voice:ev,rate:er,pitch:"+0Hz"}),signal:aiAbort.signal});
    if(!r.ok)throw new Error("TTS Error "+r.status);blobs.push(await r.blob());
   }
   if(!blobs.length){st.textContent="⚠️ रद्द किया गया।";st.className="status bad";return null}
   $("aiProgressBar").style.width="100%";$("aiProgressText").textContent="✅ "+blobs.length+" / "+chunks.length+" हिस्से तैयार!";
   lastGeneratedKey=aiCancelled?"":key;
   const info=setupGeneratedPlayer(new Blob(blobs,{type:"audio/mpeg"}),"edge:"+ev);
   st.textContent="✅ आवाज़ तैयार है (Play हो रही है)!";st.className="status good";return info;
  }catch(e){
   if(e.name==="AbortError"&&blobs.length){
    lastGeneratedKey="";const info=setupGeneratedPlayer(new Blob(blobs,{type:"audio/mpeg"}),"edge:"+ev);
    st.textContent="⏹ रोका गया ("+blobs.length+" हिस्से तैयार)।";return info;
   }
   st.textContent="❌ "+(e.message||"Edge TTS Error");st.className="status bad";return null;
  }finally{gb.disabled=db.disabled=false;aiAbort=null}
 }

 await loadSiteSettings();checkGpuServerStatus();
 const vid=$("voiceSelect").value;
 if(!vid)return alert("पहले Voice Character चुनें।");
 const v=voices.find(x=>String(x.id)===vid);if(!v?.audio_url)return alert("इस Character में Audio Sample नहीं है।");
 if(!aiServerUrl){
  st.textContent="❌ AI Cloning Server अभी बंद है — ⚡ 24×7 Fast Voices चुनें।";st.className="status bad";
  if(confirm("❌ AI Cloning Server अभी बंद है!\n\nक्या आप अभी ⚡ 24×7 Fast Voices इस्तेमाल करना चाहते हैं?"))setVoiceMode("edge");
  return null;
 }
 const key=vid+"::auto::"+text;
 if(generatedMp3Url&&lastGeneratedKey===key){
  const raw=(v.name||"voice_studio").replace(/[^a-zA-Z0-9_-]/g,"").replace(/^_+|_+$/g,"")||"voice_studio";
  return{url:generatedMp3Url,vid,fname:raw+"_cloned.mp3"};
 }
 const chunks=splitChunks(text,140),blobs=[],gb=$("generateAiBtn"),db=$("downloadMp3Btn");
 aiCancelled=false;aiAbort=new AbortController();gb.disabled=db.disabled=true;$("aiProgressBox").classList.remove("hidden");$("aiProgressBar").style.width="0%";
 st.textContent="🎙️ Voice बन रही है (हिस्से: "+chunks.length+")...";st.className="status";
 try{
  for(let i=0;i<chunks.length;i++){
   if(aiCancelled)break;const pct=Math.round((i/chunks.length)*100);$("aiProgressBar").style.width=pct+"%";$("aiProgressText").textContent="⏳ हिस्सा "+(i+1)+" / "+chunks.length+" ("+pct+"%)";
   const r=await fetch(aiServerUrl+"/clone",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:chunks[i],language:detectLang(chunks[i]),speaker_url:v.audio_url}),signal:aiAbort.signal});
   if(!r.ok)throw new Error("Server Error "+r.status);blobs.push(await r.blob());
  }
  if(!blobs.length){st.textContent="⚠️ रद्द किया गया।";st.className="status bad";return null}
  $("aiProgressBar").style.width="100%";$("aiProgressText").textContent="✅ "+blobs.length+" / "+chunks.length+" हिस्से तैयार!";
  lastGeneratedKey=aiCancelled?"":key;
  const info=setupGeneratedPlayer(new Blob(blobs,{type:"audio/mpeg"}),vid);
  st.textContent="✅ आवाज़ तैयार है (Play हो रही है)!";st.className="status good";return info;
 }catch(e){
  if(e.name==="AbortError"&&blobs.length){
   lastGeneratedKey="";const info=setupGeneratedPlayer(new Blob(blobs,{type:"audio/mpeg"}),vid);
   st.textContent="⏹ रोका गया ("+blobs.length+" हिस्से तैयार)।";return info;
  }
  const msg=e.message||"Colab Server Offline है।";
  st.textContent="❌ "+msg;st.className="status bad";
  if(confirm("❌ "+msg+"\n\nक्या आप अभी ⚡ 24×7 Fast Voices इस्तेमाल करना चाहते हैं?"))setVoiceMode("edge");
  return null;
 }finally{gb.disabled=db.disabled=false;aiAbort=null}
}

async function generateVoiceOnly(){
 try{
  stopAllPlayers();
  const r=await generateAiVoiceBlob();
  if(r?.url&&generatedAudio){
   generatedAudio.playbackRate=1;generatedAudio.currentTime=0;
   generatedAudio.play().then(()=>{const b=$("generatedPlayBtn");if(b){b.textContent="⏹";b.classList.add("playing")}}).catch(()=>{});
  }
 }catch(e){alert("Error: "+(e?.message||e))}
}
function generateAndPlayAI(){return generateVoiceOnly()}

async function downloadAudio(){
 try{
  const r=await generateAiVoiceBlob();if(!r?.url)return;
  const a=document.createElement("a");a.href=r.url;a.download=r.fname||"voice_studio_cloned.mp3";a.style.display="none";
  document.body.appendChild(a);a.click();setTimeout(()=>a.remove(),2500);
  $("memberStatus").textContent="⬇️ MP3 डाउनलोड शुरू हो गई है!";$("memberStatus").className="status good";
 }catch(e){alert("Download Error: "+(e?.message||e))}
}

async function handleOAuthOrInitialSession(s,isOAuth){
 if(!s?.user||isRecoveryFlow||authSessionHandled)return;authSessionHandled=true;
 let{data:p,error}=await sb.from("profiles").select("*").eq("id",s.user.id).maybeSingle();
 if(!p&&!error){
  const m=s.user.user_metadata||{},{data:c,error:ie}=await sb.from("profiles").insert({id:s.user.id,email:s.user.email,name:m.full_name||m.name||"",photo_url:m.avatar_url||m.picture||"",profile_completed:false}).select("*").single();
  if(ie){authSessionHandled=false;return alert(ie.message)}p=c;
 }
 if(!p){authSessionHandled=false;return error&&alert(error.message)}
 if(p.banned){await sb.auth.signOut();currentMember=null;authSessionHandled=false;alert("Banned!");return showPage("homePage")}
 currentMember=p;
 if(isOAuth){history.replaceState(null,"",location.pathname);return p.profile_completed?resumeSession():openGoogleCompletionBox(p)}
 if(!p.profile_completed)return openGoogleCompletionBox(p);updateHomeSessionBar();
}

sb.auth.onAuthStateChange(async(ev,s)=>{
 if(ev==="PASSWORD_RECOVERY"){isRecoveryFlow=true;showPage("memberLogin");$("resetPasswordBox").classList.remove("hidden")}
 else if(ev==="SIGNED_OUT")authSessionHandled=false;
 else if(ev==="SIGNED_IN"&&s&&!currentMember&&!isRecoveryFlow&&!location.hash.includes("type=recovery")&&(location.hash.includes("access_token")||location.search.includes("code=")))await handleOAuthOrInitialSession(s,true);
});

(async function(){
 const q=new URLSearchParams(location.search),h=new URLSearchParams(location.hash.replace(/^#/,"")),err=q.get("error_description")||h.get("error_description")||q.get("error")||h.get("error");
 if(err){alert("Login Error: "+decodeURIComponent(err.replace(/\+/g," ")));history.replaceState(null,"",location.pathname)}
 await loadSiteSettings();
 const cp=q.get("admin_colab");
 if(cp){const{data:ok}=await sb.rpc("verify_colab_magic_token",{p_secret:cp});if(ok){activeSecret=cp;refreshHelperPageUI();showPage("noLoginColabPage");return}alert("⛔ Invalid Colab Link");history.replaceState(null,"",location.pathname)}
 if(location.hash.includes("type=recovery")||q.get("type")==="recovery"){isRecoveryFlow=true;showPage("memberLogin");$("resetPasswordBox").classList.remove("hidden");return}
 const idToken=h.get("id_token");
 if(idToken){
  const rawNonce=localStorage.getItem("vs_g_nonce")||"";
  localStorage.removeItem("vs_g_nonce");
  history.replaceState(null,"",location.pathname);
  const{data,error}=await sb.auth.signInWithIdToken({provider:"google",token:idToken,nonce:rawNonce||undefined});
  if(error){alert("Google Login Error: "+error.message);return}
  if(data?.session){await handleOAuthOrInitialSession(data.session,true);return}
 }
 const{data:{session}}=await sb.auth.getSession();if(session)await handleOAuthOrInitialSession(session,location.hash.includes("access_token")||location.search.includes("code="));
})();