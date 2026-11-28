const SUPABASE_URL="https://pbffjuqifadnqdddeqwc.supabase.co",SUPABASE_KEY="sb_publishable_64rcnA_hORGgec-u-JEKHQ_3kDlGiTV",sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY),MAX_WORDS=10000;
const GOOGLE_CLIENT_ID="383565719071-otmjg01viggma9e4496r66tmj5u1g7cq.apps.googleusercontent.com";
const EDGE_TTS_URL="/api/tts";
let voices=[],telegramUrl="",announcementText="",aiServerUrl="",colabNotebookUrl="",botLogoUrl="",currentMember=null,isRecoveryFlow=false,authSessionHandled=false,generatedMp3Url=null,generatedFileName="voice_studio.mp3",lastGeneratedKey="",aiAbort=null,aiCancelled=false,isGenerating=false,activeSecret="",voiceMode="clone";
let sampleAudio=null,sampleUrlNow="",generatedAudio=null,signupPhotoBlob=null,pendingPollTimer=null,tickTimer=null,unTimers={},unFailCount={signup:0,settings:0};
const $=id=>document.getElementById(id);

if("serviceWorker"in navigator){navigator.serviceWorker.register("/sw.js").catch(()=>{});}

function showPage(p){
 ["noLoginColabPage","homePage","contactPage","memberLogin","pendingApprovalPage","memberPage"].forEach(id=>$(id).classList.add("hidden"));
 $(p).classList.remove("hidden");
 const showMemberHeader=(p==="memberPage"||p==="pendingApprovalPage")&&!!currentMember;
 $("memberHeaderControls").classList.toggle("hidden",!showMemberHeader);
 $("guestHeaderControls").classList.toggle("hidden",showMemberHeader);
 if(showMemberHeader)refreshMemberUI();
}
function goHome(){stopAllPlayers();updateHomeSessionBar();showPage("homePage")}
function updateHomeSessionBar(){
 const ok=currentMember&&currentMember.profile_completed&&currentMember.approved;
 $("homeSessionBar").classList.toggle("hidden",!ok);
 if(ok)$("homeLoggedInNote").textContent="✅ लॉगिन: "+currentMember.name+" (@"+currentMember.username+")";
}
async function resumeSession(){
 if(!currentMember)return;
 if(!currentMember.profile_completed)return openGoogleCompletionBox(currentMember);
 if(!currentMember.approved)return openPendingApprovalPage(currentMember);
 await openMemberDashboard();
}
function stopPendingPoll(){if(pendingPollTimer){clearInterval(pendingPollTimer);pendingPollTimer=null}}
async function logout(){
 stopAllPlayers();cancelAiGeneration();stopPendingPoll();
 if(generatedMp3Url){URL.revokeObjectURL(generatedMp3Url);generatedMp3Url=null;lastGeneratedKey=""}
 $("bgVoiceBanner").classList.add("hidden");
 await sb.auth.signOut();currentMember=null;authSessionHandled=false;signupPhotoBlob=null;
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
 const{data}=await sb.from("site_settings").select("key,value").in("key",["telegram_url","announcement_text","ai_server_url","colab_notebook_url","bot_logo_url"]);
 const m=Object.fromEntries((data||[]).map(r=>[r.key,r.value||""]));
 telegramUrl=m.telegram_url||"";announcementText=m.announcement_text||"";aiServerUrl=(m.ai_server_url||"").replace(/\/+$/,"");colabNotebookUrl=(m.colab_notebook_url||"").trim();botLogoUrl=(m.bot_logo_url||"").trim();
 if(botLogoUrl){
  const bl=$("siteBotLogo"),fv=$("siteFavicon");
  if(bl){bl.src=botLogoUrl;bl.classList.remove("hidden")}
  if(fv)fv.href=botLogoUrl;
 }
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

async function sendChromeNotification(title,body){
 try{
  if(!("Notification"in window)||Notification.permission!=="granted")return false;
  if("serviceWorker"in navigator){
   const reg=await navigator.serviceWorker.ready;
   await reg.showNotification(title,{body,icon:botLogoUrl||undefined,badge:botLogoUrl||undefined});
   return true;
  }
  new Notification(title,{body,icon:botLogoUrl||undefined});
  return true;
 }catch(_){return false}
}
async function requestNotifPermission(){
 const st=$("pendingStatusMsg"),btn=$("enableNotifBtn");
 if(!("Notification"in window)){if(st){st.textContent="ℹ️ इस ब्राउज़र में Notification सपोर्ट नहीं है — Approve होते ही पेज खुद खुल जाएगा।";st.className="status"}return}
 const res=await Notification.requestPermission();
 if(res==="granted"){if(btn)btn.classList.add("hidden");if(st){st.textContent="✅ Chrome Notification चालू हो गया!";st.className="status good"}}
 else{if(st){st.textContent="ℹ️ Notification बंद है — Approve होते ही यह पेज अपने आप Studio पर चला जाएगा।";st.className="status"}}
}
function speakVoiceReady(){
 try{
  const AC=window.AudioContext||window.webkitAudioContext;
  if(AC){
   const ctx=new AC(),now=ctx.currentTime;
   [660,880].forEach((freq,idx)=>{
    const osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.type="sine";osc.frequency.value=freq;
    gain.gain.setValueAtTime(0.14,now+idx*0.14);
    gain.gain.exponentialRampToValueAtTime(0.001,now+idx*0.14+0.25);
    osc.connect(gain);gain.connect(ctx.destination);
    osc.start(now+idx*0.14);osc.stop(now+idx*0.14+0.26);
   });
  }
 }catch(_){}
 try{
  if("speechSynthesis"in window){
   window.speechSynthesis.cancel();
   const u=new SpeechSynthesisUtterance("Voice ready");
   u.lang="en-US";u.rate=1;u.pitch=1;
   window.speechSynthesis.speak(u);
  }
 }catch(_){}
}

async function sha256Hex(str){
 const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(str));
 return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function loginWithGoogle(){
 if(location.protocol==="file:"||location.origin==="null")return alert("Google Login सिर्फ Live https:// वेबसाइट पर चलता है।");
 $("googleSignUpNote").textContent="";
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
function previewSignupPhoto(e){
 const f=e.target.files[0];signupPhotoBlob=null;
 const pv=$("signupPhotoPreview");pv.classList.add("hidden");
 if(!f)return;
 if(!f.type.startsWith("image/")){e.target.value="";return alert("सिर्फ फोटो (Image) चुनें।")}
 if(f.size>6*1024*1024){e.target.value="";return alert("6 MB से छोटी फोटो चुनें।")}
 const rd=new FileReader();
 rd.onload=ev=>{
  const img=new Image();
  img.onload=()=>{
   const c=document.createElement("canvas");c.width=c.height=240;const s=Math.min(img.width,img.height);
   c.getContext("2d").drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,0,0,240,240);
   c.toBlob(b=>{
    signupPhotoBlob=b;
    pv.src=URL.createObjectURL(b);
    pv.classList.remove("hidden");
   },"image/jpeg",0.88);
  };
  img.src=ev.target.result;
 };
 rd.readAsDataURL(f);
}
async function openGoogleCompletionBox(p){
 showPage("memberLogin");$("googleDetailsBox").classList.remove("hidden");
 const{data:{user}}=await sb.auth.getUser(),meta=user?.user_metadata||{},fn=meta.full_name||meta.name||p.name||"",em=user?.email||p.email||"";
 const ni=$("googleName");ni.value=fn;fn?ni.setAttribute("readonly","readonly"):ni.removeAttribute("readonly");
 $("selectedGoogleGmailInput").value=em;$("googleUsername").value=p.username||"";$("googlePass").value="";$("googleFinishStatus").textContent="";
 $("signupUsernameMsg").textContent="";$("signupUsernameSuggest").classList.add("hidden");
 signupPhotoBlob=null;$("googlePhotoInput").value="";$("signupPhotoPreview").classList.add("hidden");
}
async function checkUnique(name,username,exId){
 const{data,error}=await sb.rpc("check_name_username_available",{p_name:name||"",p_username:username||"",p_exclude_id:exId||null});
 if(!error&&data)return data;
 let ue=false;
 if(username){const{data:em}=await sb.rpc("get_email_by_username",{p_username:username});if(em&&(!currentMember||em.toLowerCase()!==currentMember.email.toLowerCase()))ue=true}
 return{name_exists:false,username_exists:ue};
}
function pickSuggestedUsername(mode,val){
 const inp=$(mode==="signup"?"googleUsername":"editUsernameInput"),msg=$(mode==="signup"?"signupUsernameMsg":"editUsernameMsg"),box=$(mode==="signup"?"signupUsernameSuggest":"editUsernameSuggest");
 inp.value=val;msg.textContent="✅ @"+val+" Available!";msg.className="good";box.classList.add("hidden");
}
function onLiveUsernameInput(mode){
 const inp=$(mode==="signup"?"googleUsername":"editUsernameInput"),msg=$(mode==="signup"?"signupUsernameMsg":"editUsernameMsg"),box=$(mode==="signup"?"signupUsernameSuggest":"editUsernameSuggest");
 if(unTimers[mode])clearTimeout(unTimers[mode]);
 const raw=inp.value.trim(),un=raw.toLowerCase().replace(/[^a-z0-9_]/g,"");
 box.classList.add("hidden");
 if(!raw){msg.textContent="";return}
 if(un!==raw.toLowerCase()){msg.textContent="❌ सिर्फ a-z, 0-9 और _ लिखें";msg.className="bad";return}
 if(un.length<3){msg.textContent="ℹ️ कम से कम 3 अक्षर लिखें";msg.className="note";return}
 if(mode==="settings"&&currentMember&&un===(currentMember.username||"").toLowerCase()){msg.textContent="ℹ️ यही आपका मौजूदा Username है";msg.className="note";return}
 msg.textContent="⏳ जाँच हो रही है...";msg.className="note";
 unTimers[mode]=setTimeout(async()=>{
  const chk=await checkUnique("",un,currentMember?.id);
  if(inp.value.trim().toLowerCase()!==un)return;
  if(chk.username_exists){
   unFailCount[mode]=(unFailCount[mode]||0)+1;
   msg.textContent="❌ Already Exists!";msg.className="bad";
   if(unFailCount[mode]>=2){
    const baseName=((mode==="signup"?$("googleName").value:currentMember?.name)||un).toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,10)||"user";
    const cands=[baseName+"_01",baseName+"_vs",baseName+Math.floor(10+Math.random()*89),baseName+"_kr",baseName+"_99",baseName+"_ai"].filter((v,i,a)=>v.length>=3&&v!==un&&a.indexOf(v)===i);
    const checks=await Promise.all(cands.map(async c=>({c,res:await checkUnique("",c,currentMember?.id)})));
    const free=checks.filter(x=>!x.res.username_exists).slice(0,3);
    if(free.length){
     box.replaceChildren(...free.map(x=>{
      const b=document.createElement("button");b.type="button";b.className="suggest-chip";b.textContent="✨ @"+x.c;
      b.onclick=()=>pickSuggestedUsername(mode,x.c);return b;
     }));
     box.classList.remove("hidden");
    }
   }
  }else{
   msg.textContent="✅ Available!";msg.className="good";box.classList.add("hidden");
  }
 },350);
}
async function saveBrowserCred(username,password,name){
 try{
  if(window.PasswordCredential&&navigator.credentials?.store){
   await navigator.credentials.store(new PasswordCredential({id:username,password,name:name||username}));
  }
 }catch(_){}
}
function waitForPasswordSave(statusId,sec=10){
 return new Promise(resolve=>{
  const el=$(statusId);
  let left=sec,done=false,iv=null;
  const finish=()=>{if(done)return;done=true;if(iv)clearInterval(iv);resolve()};
  const render=()=>{
   if(!el)return;
   el.className="status good";
   el.replaceChildren();
   const sp=document.createElement("span");
   sp.textContent="🔑 ऊपर Chrome में 'Save Password' दबाने के लिए "+left+"s... ";
   const bt=document.createElement("button");
   bt.type="button";bt.className="green";
   bt.style.cssText="padding:6px 10px;font-size:12px;margin:6px 0 0 4px";
   bt.textContent="Aage Badhein ➔";
   bt.onclick=finish;
   el.append(sp,bt);
  };
  render();
  iv=setInterval(()=>{left--;if(left<=0)finish();else render()},1000);
 });
}
async function completeGoogleSignUp(){
 if(!currentMember)return;
 const ni=$("googleName"),ui=$("googleUsername"),name=ni.value.trim(),ru=ui.value.trim(),un=ru.toLowerCase().replace(/[^a-z0-9_]/g,""),pass=$("googlePass").value,st=$("googleFinishStatus"),btn=$("googleFinishBtn");
 if(!name){ni.removeAttribute("readonly");ni.focus();return alert("नाम लिखें।")}
 if(!un||un.length<3||un!==ru.toLowerCase()){ui.focus();return alert("कम से कम 3 अक्षर का Username लिखें (a-z, 0-9, _)।")}
 if(!pass||pass.length<6)return alert("कम से कम 6 अक्षर का Password लिखें।");
 if(!signupPhotoBlob)return alert("🖼️ प्रोफाइल फोटो चुनना ज़रूरी है!");
 btn.disabled=true;st.textContent="जाँच हो रही है...";st.className="status";
 const chk=await checkUnique(name,un,currentMember.id);
 if(chk.name_exists){btn.disabled=false;ni.removeAttribute("readonly");ni.focus();st.textContent="❌ यह Name ("+name+") पहले से मौजूद है (Already Exists)!";st.className="status bad";return}
 if(chk.username_exists){btn.disabled=false;ui.focus();$("signupUsernameMsg").textContent="❌ Already Exists!";$("signupUsernameMsg").className="bad";st.textContent="❌ यह Username (@"+un+") पहले से मौजूद है!";st.className="status bad";return}
 st.textContent="फोटो अपलोड हो रही है...";
 const avPath=currentMember.id+"/av_"+Date.now()+".jpg",{error:ue}=await sb.storage.from("avatars").upload(avPath,signupPhotoBlob,{contentType:"image/jpeg"});
 if(ue){btn.disabled=false;st.textContent="❌ Photo Error: "+ue.message;st.className="status bad";return}
 const{data:pub}=sb.storage.from("avatars").getPublicUrl(avPath);
 const{error:pe}=await sb.auth.updateUser({password:pass});
 if(pe){btn.disabled=false;st.textContent="❌ "+pe.message;st.className="status bad";return}
 const pl={name,username:un,photo_url:pub.publicUrl,profile_completed:true,last_login:new Date().toISOString()};
 const{error:fe}=await sb.from("profiles").update(pl).eq("id",currentMember.id);
 if(fe){btn.disabled=false;if(fe.code==="23505"){ni.removeAttribute("readonly");st.textContent="❌ Name या Username पहले से मौजूद है!"}else st.textContent="❌ "+fe.message;st.className="status bad";return}
 Object.assign(currentMember,{name,username:un,photo_url:pub.publicUrl,profile_completed:true});
 fetch(SUPABASE_URL+"/functions/v1/telegram-bot",{method:"POST",headers:{"Content-Type":"application/json","apikey":SUPABASE_KEY},body:JSON.stringify({action:"member_request_notify",user_id:currentMember.id,name,username:un,email:currentMember.email,photo_url:pub.publicUrl})}).catch(()=>{});
 await saveBrowserCred(un,pass,name);
 await waitForPasswordSave("googleFinishStatus",10);
 btn.disabled=false;$("googleDetailsBox").classList.add("hidden");$("googlePass").value="";st.textContent="";
 const{data:fresh}=await sb.from("profiles").select("*").eq("id",currentMember.id).maybeSingle();
 if(fresh)currentMember=fresh;
 if(currentMember.approved){await openMemberDashboard();return}
 openPendingApprovalPage(currentMember);
}

function openPendingApprovalPage(p){
 currentMember=p;showPage("pendingApprovalPage");
 $("pendingUserInfo").textContent=p.name+" (@"+(p.username||"user")+")\n"+p.email;
 const has=!!p.photo_url;$("pendingAvatarImg").classList.toggle("hidden",!has);$("pendingAvatarText").classList.toggle("hidden",has);
 if(has)$("pendingAvatarImg").src=p.photo_url;else $("pendingAvatarText").textContent=(p.name||"U")[0].toUpperCase();
 if("Notification"in window&&Notification.permission==="granted")$("enableNotifBtn").classList.add("hidden");
 else $("enableNotifBtn").classList.remove("hidden");
 $("pendingStatusMsg").textContent="⏳ Approval की प्रतीक्षा हो रही है...";$("pendingStatusMsg").className="status";
 stopPendingPoll();
 pendingPollTimer=setInterval(()=>checkApprovalStatusNow(true),4500);
}
async function checkApprovalStatusNow(silent=false){
 if(!currentMember)return;
 const{data:fp}=await sb.from("profiles").select("*").eq("id",currentMember.id).maybeSingle();
 if(!fp)return;
 if(fp.banned){
  stopPendingPoll();await sb.auth.signOut();currentMember=null;authSessionHandled=false;
  alert("❌ आपका Request Reject / Ban कर दिया गया है।");showPage("homePage");return;
 }
 if(fp.approved){
  stopPendingPoll();currentMember=fp;
  const st=$("pendingStatusMsg");if(st){st.textContent="🎉 आपका अकाउंट Approve हो गया है! Studio खुल रहा है...";st.className="status good"}
  await sendChromeNotification("🎉 Voice Studio Approved!","आपका अकाउंट Approve हो गया है — अब आप Voice Studio इस्तेमाल कर सकते हैं!");
  await openMemberDashboard();return;
 }
 if(!silent){const st=$("pendingStatusMsg");if(st){st.textContent="⏳ अभी Pending है — Admin के Approve करते ही अपने आप खुल जाएगा।";st.className="status"}}
}

async function resolveEmail(id){const c=id.trim().toLowerCase().replace(/^@/,"");if(c.includes("@"))return c;const{data}=await sb.rpc("get_email_by_username",{p_username:c});return data||null}
async function memberLogin(){
 const inp=$("memberEmail").value.trim(),pw=$("memberPassword").value,st=$("memberLoginStatus"),btn=$("memberLoginBtn");
 if(!inp||!pw)return alert("Username/Email और Password भरें।");
 btn.disabled=true;st.textContent="लॉगिन हो रहा है...";st.className="status";
 const em=await resolveEmail(inp);
 if(!em){btn.disabled=false;st.textContent="❌ अकाउंट नहीं मिला।";st.className="status bad";return}
 const{data,error}=await sb.auth.signInWithPassword({email:em,password:pw});
 if(error){btn.disabled=false;st.textContent="❌ Password गलत है।";st.className="status bad";return}
 await saveBrowserCred(inp,pw,inp);
 await waitForPasswordSave("memberLoginStatus",10);
 btn.disabled=false;$("memberPassword").value="";st.textContent="";await handleLoggedInUser(data.user.id);
}
function openForgotPassword(){$("forgotPasswordBox").classList.remove("hidden");$("forgotStatus").textContent="";const p=$("memberEmail").value.trim();if(p)$("forgotEmailInput").value=p}
function closeForgotPassword(){$("forgotPasswordBox").classList.add("hidden")}
async function sendForgotResetEmail(){
 const raw=$("forgotEmailInput").value.trim(),st=$("forgotStatus"),btn=$("forgotSendBtn");
 if(!raw)return alert("अपना Username या Gmail लिखें।");
 btn.disabled=true;st.textContent="खोजा जा रहा है...";st.className="status";
 const em=await resolveEmail(raw);
 if(!em||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){btn.disabled=false;st.textContent="❌ यह Username या Email नहीं मिला।";st.className="status bad";return}
 const r=location.origin+location.pathname.replace(/index\.html$/,"");
 const{error}=await sb.auth.resetPasswordForEmail(em,location.protocol==="file:"?{}:{redirectTo:r});
 btn.disabled=false;
 st.textContent=error?"❌ "+error.message:"📩 Reset Link ("+em+") पर भेज दिया गया है! Gmail चेक करें।";st.className="status "+(error?"bad":"good");
}
async function completePasswordReset(){
 const p1=$("resetNewPassInput").value,p2=$("resetConfirmPassInput").value,st=$("resetPassStatus");
 if(!p1||p1.length<6)return st.textContent="कम से कम 6 अक्षर लिखें।";if(p1!==p2)return st.textContent="Password मेल नहीं खाते।";
 const{error}=await sb.auth.updateUser({password:p1});if(error)return st.textContent="❌ "+error.message;
 const{data}=await sb.auth.getUser();
 if(data?.user){
  const{data:fp}=await sb.from("profiles").select("username,name").eq("id",data.user.id).maybeSingle();
  await saveBrowserCred(fp?.username||data.user.email,p1,fp?.name);
  await waitForPasswordSave("resetPassStatus",10);
  isRecoveryFlow=false;$("resetNewPassInput").value="";$("resetConfirmPassInput").value="";$("resetPasswordBox").classList.add("hidden");history.replaceState(null,"",location.pathname);
  await handleLoggedInUser(data.user.id);
 }else{
  isRecoveryFlow=false;$("resetNewPassInput").value="";$("resetConfirmPassInput").value="";$("resetPasswordBox").classList.add("hidden");history.replaceState(null,"",location.pathname);
  alert("✅ Password बदल गया!");
 }
}

async function handleLoggedInUser(uid){
 authSessionHandled=true;const{data:p,error}=await sb.from("profiles").select("*").eq("id",uid).single();
 if(error||!p){authSessionHandled=false;return alert("Profile लोड नहीं हुई।")}
 if(p.banned){await sb.auth.signOut();currentMember=null;authSessionHandled=false;alert("यह अकाउंट Banned है।");return showPage("homePage")}
 currentMember=p;
 if(!p.profile_completed)return openGoogleCompletionBox(p);
 if(!p.approved)return openPendingApprovalPage(p);
 await sb.from("profiles").update({last_login:new Date().toISOString()}).eq("id",uid);await openMemberDashboard();
}
async function openMemberDashboard(){
 if(!currentMember)return;
 const{data:fp}=await sb.from("profiles").select("*").eq("id",currentMember.id).maybeSingle();
 if(fp){
  if(fp.banned){alert("आपका अकाउंट Ban हो गया है।");return logout()}
  currentMember=fp;
  if(!fp.approved)return openPendingApprovalPage(fp);
 }
 $("memberSettingsCard").classList.add("hidden");refreshMemberUI();showPage("memberPage");
 await Promise.all([loadVoices(),loadSiteSettings()]);renderMemberVoices();updateUploadPerm();updateScriptWordCount();checkGpuServerStatus();
}
function refreshMemberUI(){
 if(!currentMember)return;
 $("settingsDisplayName").textContent=currentMember.name+" (@"+(currentMember.username||"user")+")";
 $("settingsDisplayEmail").textContent=currentMember.email;$("editUsernameInput").value=currentMember.username||"";
 [["headerAvatarImg","headerAvatarText"],["settingsAvatarImg","settingsAvatarText"]].forEach(([i,t])=>{
  const has=!!currentMember.photo_url;$(i).classList.toggle("hidden",!has);$(t).classList.toggle("hidden",has);
  if(has)$(i).src=currentMember.photo_url;else $(t).textContent=(currentMember.name||"U")[0].toUpperCase();
 });
}
function toggleSettings(){
 if(!$("memberPage").classList.contains("hidden")){
  $("memberSettingsCard").classList.toggle("hidden");$("memberSettingsStatus").textContent="";
 }else if(currentMember&&currentMember.approved){
  openMemberDashboard().then(()=>{$("memberSettingsCard").classList.remove("hidden")});
 }
}
function uploadProfilePhoto(e){
 const f=e.target.files[0];if(!f||!currentMember)return;if(!f.type.startsWith("image/"))return alert("सिर्फ फोटो चुनें।");if(f.size>5*1024*1024)return alert("5 MB से कम चुनें।");
 const st=$("memberSettingsStatus");st.textContent="अपलोड हो रहा है...";st.className="status";
 const rd=new FileReader();rd.onload=ev=>{const img=new Image();img.onload=()=>{
  const c=document.createElement("canvas");c.width=c.height=240;const s=Math.min(img.width,img.height);
  c.getContext("2d").drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,0,0,240,240);
  c.toBlob(async b=>{
   const path=currentMember.id+"/av_"+Date.now()+".jpg",{error:ue}=await sb.storage.from("avatars").upload(path,b,{contentType:"image/jpeg"});
   if(ue){st.textContent="❌ "+ue.message;st.className="status bad";return}
   const{data:pub}=sb.storage.from("avatars").getPublicUrl(path),{error:de}=await sb.from("profiles").update({photo_url:pub.publicUrl}).eq("id",currentMember.id);
   if(de){st.textContent="❌ "+de.message;st.className="status bad";return}
   currentMember.photo_url=pub.publicUrl;refreshMemberUI();st.textContent="✅ फोटो बदल गई!";st.className="status good";
  },"image/jpeg",0.88);
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
 currentMember.username=nu;refreshMemberUI();$("editUsernameMsg").textContent="✅ Saved!";$("editUsernameMsg").className="good";st.textContent="✅ Username बदल गया!";st.className="status good";
}
async function updateMemberPassword(){
 const p1=$("editMemberNewPass").value,p2=$("editMemberConfirmPass").value,st=$("memberSettingsStatus");
 if(!p1||p1.length<6||p1!==p2){st.textContent="6+ अक्षर का एक जैसा Password भरें।";st.className="status bad";return}
 const{error}=await sb.auth.updateUser({password:p1});
 if(error){st.textContent="❌ "+error.message;st.className="status bad";return}
 await saveBrowserCred(currentMember.username||currentMember.email,p1,currentMember.name);
 $("editMemberNewPass").value="";$("editMemberConfirmPass").value="";st.textContent="✅ Password बदल गया!";st.className="status good";
}

function fmtSec(sec){const s=Math.max(0,Math.floor(sec||0));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")}
function stopSampleAudio(){
 if(sampleAudio){sampleAudio.pause();sampleAudio.currentTime=0}
 const b=$("samplePlayBtn");if(b){b.textContent="▶";b.classList.remove("playing")}
}
function stopGeneratedAudio(){
 if(generatedAudio){generatedAudio.pause();generatedAudio.currentTime=0}
 const b=$("generatedPlayBtn");if(b){b.textContent=isGenerating?"⏳":"▶";b.classList.remove("playing")}
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
function cancelAiGeneration(){aiCancelled=true;if(tickTimer){clearInterval(tickTimer);tickTimer=null}if(aiAbort){aiAbort.abort();aiAbort=null}}

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

function updateProcessingUI(pct,subText){
 const p=Math.max(0,Math.min(100,Math.round(pct)));
 $("generatedAudioBox").classList.remove("hidden");
 $("aiProgressWrap").classList.remove("hidden");
 $("aiCancelInlineBtn").classList.remove("hidden");
 $("generatedPlayBtn").disabled=true;
 $("generatedPlayBtn").textContent="⏳";
 $("generatedPlayBtn").classList.remove("playing");
 $("generatedVoiceTitle").textContent="⏳ Processing... "+p+"%";
 $("generatedTimeLabel").textContent=subText||"आवाज़ बन रही है...";
 $("aiProgressBar").style.width=p+"%";
 document.title="⏳ "+p+"% — Voice Studio";
 const bg=$("bgVoiceBanner"),bt=$("bgVoiceText"),ba=$("bgVoiceActions");
 bg.classList.remove("hidden");
 bt.textContent="⏳ Voice Processing... "+p+"%";
 const cb=document.createElement("button");cb.className="red";cb.style.cssText="padding:6px 10px;font-size:12px;margin:0";cb.textContent="⏹ Cancel";cb.onclick=cancelAiGeneration;
 ba.replaceChildren(cb);
}

function showBgReadyBanner(){
 const bg=$("bgVoiceBanner"),bt=$("bgVoiceText"),ba=$("bgVoiceActions");
 bg.classList.remove("hidden");
 bt.textContent="🎉 Voice Ready! (100%)";
 const pb=document.createElement("button");pb.className="green";pb.style.cssText="padding:6px 10px;font-size:12px;margin:0";pb.textContent="▶ Play";pb.onclick=toggleGeneratedPlay;
 const db=document.createElement("button");db.className="orange";db.style.cssText="padding:6px 10px;font-size:12px;margin:0";db.textContent="⬇ MP3";db.onclick=()=>{const a=document.createElement("a");a.href=generatedMp3Url;a.download=generatedFileName;document.body.appendChild(a);a.click();setTimeout(()=>a.remove(),1500)};
 const xb=document.createElement("button");xb.className="gray";xb.style.cssText="padding:6px 10px;font-size:12px;margin:0";xb.textContent="✖";xb.onclick=()=>bg.classList.add("hidden");
 ba.replaceChildren(pb,db,xb);
}

async function notifyVoiceFinished(){
 document.title="🔔 Voice Ready! — Voice Studio";
 setTimeout(()=>{if(!isGenerating)document.title="Voice Studio"},6000);
 showBgReadyBanner();
 const sent=await sendChromeNotification("🔔 Voice Ready! (100%)","Voice Studio: आपकी स्क्रिप्ट की आवाज़ तैयार है — Play या Download करें!");
 if(!sent)speakVoiceReady();
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
 generatedFileName=isEdge?"voice_studio_edge.mp3":raw+"_cloned.mp3";
 $("aiCancelInlineBtn").classList.add("hidden");
 $("aiProgressWrap").classList.add("hidden");
 $("generatedPlayBtn").disabled=false;
 $("generatedPlayBtn").textContent="▶";
 $("generatedVoiceTitle").textContent="✅ 100% Ready — "+(isEdge?"⚡ Edge TTS":(v?v.name:"Voice"))+" ("+Math.max(1,Math.round(blob.size/1024))+" KB)";
 $("generatedTimeLabel").textContent="0:00 / 0:00";
 $("generatedAudioBox").classList.remove("hidden");
 return{url:generatedMp3Url,vid,fname:generatedFileName};
}

function toggleGeneratedPlay(){
 if(isGenerating)return alert("⏳ कृपया 100% Processing पूरी होने दें।");
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
  aiCancelled=false;isGenerating=true;aiAbort=new AbortController();gb.disabled=db.disabled=true;
  let fakePct=5;updateProcessingUI(fakePct,"हिस्सा 1 / "+chunks.length);
  if(tickTimer)clearInterval(tickTimer);
  tickTimer=setInterval(()=>{if(fakePct<90&&chunks.length===1){fakePct+=8;updateProcessingUI(fakePct,"हिस्सा 1 / 1")}},350);
  st.textContent="⚡ Voice बन रही है (Back करने पर भी Background में चलती रहेगी)...";st.className="status";
  try{
   for(let i=0;i<chunks.length;i++){
    if(aiCancelled)break;
    const basePct=Math.max(5,Math.round((i/chunks.length)*100));
    updateProcessingUI(basePct,"हिस्सा "+(i+1)+" / "+chunks.length);
    const r=await fetch(EDGE_TTS_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:chunks[i],voice:ev,rate:er,pitch:"+0Hz"}),signal:aiAbort.signal});
    if(!r.ok)throw new Error("TTS Error "+r.status);blobs.push(await r.blob());
   }
   if(tickTimer){clearInterval(tickTimer);tickTimer=null}
   if(!blobs.length){isGenerating=false;$("bgVoiceBanner").classList.add("hidden");$("generatedAudioBox").classList.add("hidden");st.textContent="⚠️ रद्द किया गया।";st.className="status bad";return null}
   lastGeneratedKey=aiCancelled?"":key;
   isGenerating=false;
   const info=setupGeneratedPlayer(new Blob(blobs,{type:"audio/mpeg"}),"edge:"+ev);
   st.textContent="✅ 100% तैयार है — अब ▶ Play दबाकर सुनें!";st.className="status good";
   await notifyVoiceFinished();
   return info;
  }catch(e){
   if(tickTimer){clearInterval(tickTimer);tickTimer=null}
   isGenerating=false;
   if(e.name==="AbortError"&&blobs.length){
    lastGeneratedKey="";const info=setupGeneratedPlayer(new Blob(blobs,{type:"audio/mpeg"}),"edge:"+ev);
    st.textContent="⏹ रोका गया ("+blobs.length+" हिस्से तैयार)।";return info;
   }
   $("bgVoiceBanner").classList.add("hidden");$("generatedAudioBox").classList.add("hidden");document.title="Voice Studio";
   st.textContent="❌ "+(e.message||"Edge TTS Error");st.className="status bad";return null;
  }finally{isGenerating=false;gb.disabled=db.disabled=false;aiAbort=null}
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
 aiCancelled=false;isGenerating=true;aiAbort=new AbortController();gb.disabled=db.disabled=true;
 let fakePct=5;updateProcessingUI(fakePct,"हिस्सा 1 / "+chunks.length);
 if(tickTimer)clearInterval(tickTimer);
 tickTimer=setInterval(()=>{if(fakePct<90&&chunks.length===1){fakePct+=5;updateProcessingUI(fakePct,"हिस्सा 1 / 1")}},700);
 st.textContent="🎙️ Voice बन रही है (Back करने पर भी Background में चलती रहेगी)...";st.className="status";
 try{
  for(let i=0;i<chunks.length;i++){
   if(aiCancelled)break;
   const pct=Math.max(5,Math.round((i/chunks.length)*100));
   updateProcessingUI(pct,"हिस्सा "+(i+1)+" / "+chunks.length);
   const r=await fetch(aiServerUrl+"/clone",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:chunks[i],language:detectLang(chunks[i]),speaker_url:v.audio_url}),signal:aiAbort.signal});
   if(!r.ok)throw new Error("Server Error "+r.status);blobs.push(await r.blob());
  }
  if(tickTimer){clearInterval(tickTimer);tickTimer=null}
  if(!blobs.length){isGenerating=false;$("bgVoiceBanner").classList.add("hidden");$("generatedAudioBox").classList.add("hidden");st.textContent="⚠️ रद्द किया गया।";st.className="status bad";return null}
  lastGeneratedKey=aiCancelled?"":key;
  isGenerating=false;
  const info=setupGeneratedPlayer(new Blob(blobs,{type:"audio/mpeg"}),vid);
  st.textContent="✅ 100% तैयार है — अब ▶ Play दबाकर सुनें!";st.className="status good";
  await notifyVoiceFinished();
  return info;
 }catch(e){
  if(tickTimer){clearInterval(tickTimer);tickTimer=null}
  isGenerating=false;
  if(e.name==="AbortError"&&blobs.length){
   lastGeneratedKey="";const info=setupGeneratedPlayer(new Blob(blobs,{type:"audio/mpeg"}),vid);
   st.textContent="⏹ रोका गया ("+blobs.length+" हिस्से तैयार)।";return info;
  }
  $("bgVoiceBanner").classList.add("hidden");$("generatedAudioBox").classList.add("hidden");document.title="Voice Studio";
  const msg=e.message||"Colab Server Offline है।";
  st.textContent="❌ "+msg;st.className="status bad";
  if(confirm("❌ "+msg+"\n\nक्या आप अभी ⚡ 24×7 Fast Voices इस्तेमाल करना चाहते हैं?"))setVoiceMode("edge");
  return null;
 }finally{isGenerating=false;gb.disabled=db.disabled=false;aiAbort=null}
}

async function generateVoiceOnly(){
 try{
  stopAllPlayers();
  if("Notification"in window&&Notification.permission==="default"){Notification.requestPermission().catch(()=>{});}
  await generateAiVoiceBlob();
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
  const m=s.user.user_metadata||{},{data:c,error:ie}=await sb.from("profiles").insert({id:s.user.id,email:s.user.email,name:m.full_name||m.name||"",photo_url:"",profile_completed:false,approved:false}).select("*").single();
  if(ie){authSessionHandled=false;return alert(ie.message)}p=c;
 }
 if(!p){authSessionHandled=false;return error&&alert(error.message)}
 if(p.banned){await sb.auth.signOut();currentMember=null;authSessionHandled=false;alert("यह अकाउंट Banned है।");return showPage("homePage")}
 if(isOAuth){
  history.replaceState(null,"",location.pathname);
  if(p.profile_completed){
   if(!p.approved){currentMember=p;return openPendingApprovalPage(p)}
   const unOrEm=p.username||p.email||"";
   await sb.auth.signOut();currentMember=null;authSessionHandled=false;
   showPage("memberLogin");
   $("memberEmail").value=unOrEm;
   $("googleSignUpNote").textContent="ℹ️ आपका अकाउंट (@"+(p.username||"user")+") पहले से बना है! कृपया नीचे Sign In से लॉगिन करें।";
   $("googleSignUpNote").className="status bad";
   return;
  }
  currentMember=p;return openGoogleCompletionBox(p);
 }
 currentMember=p;
 if(!p.profile_completed)return openGoogleCompletionBox(p);
 if(!p.approved)return openPendingApprovalPage(p);
 updateHomeSessionBar();
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