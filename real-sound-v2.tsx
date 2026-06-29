import { useState, useEffect } from "react";

const T = {
  void:"#0D0B0F", deep:"#1C1720", plum:"#2E2438",
  gold:"#D4A843", rose:"#C4727A", teal:"#4A9B8E",
  mist:"#E8E2F0", chalk:"#F9F7FC", soft:"#7A6E8A", border:"#3A2E4A44",
};

const SEED = [
  { id:"p1", name:"Luna Serrano", location:"Providence, RI", email:"luna@example.com", password:"luna123",
    instruments:["Crystal Bowls","Gong","Chimes"], venueTypes:["Yoga Studios","Corporate","Retreats"],
    modalities:["Sound Bath","Reiki"], rate:250, rating:4.9, reviews:38, available:true,
    bio:"Level 2 Reiki practitioner & certified sound healer with 6 years bringing deep healing to groups of all kinds.", avatar:"🌙" },
  { id:"p2", name:"Marcus Bloom", location:"Boston, MA", email:"marcus@example.com", password:"marcus123",
    instruments:["Tibetan Bowls","Gong","Tuning Forks"], venueTypes:["Fight Studios","Corporate","Yoga Studios"],
    modalities:["Sound Bath","Breathwork"], rate:300, rating:4.8, reviews:52, available:true,
    bio:"Former athlete turned sound healer. Specializes in high-performance stress release — perfect for MMA gyms and corporate burnout.", avatar:"🔮" },
  { id:"p3", name:"Celeste Mora", location:"Newport, RI", email:"celeste@example.com", password:"celeste123",
    instruments:["Crystal Bowls","Voice","Rain Drum"], venueTypes:["Yoga Studios","Retreats","Private Events"],
    modalities:["Sound Bath","Reiki","Meditation"], rate:200, rating:5.0, reviews:21, available:false,
    bio:"Trained in sacred sound ceremony traditions. Creates immersive, deeply spiritual experiences for intimate groups.", avatar:"✨" },
  { id:"p4", name:"Jordan Wells", location:"Worcester, MA", email:"jordan@example.com", password:"jordan123",
    instruments:["Gong","Steel Tongue Drum","Chimes"], venueTypes:["Fight Studios","Corporate","Yoga Studios"],
    modalities:["Sound Bath","Breathwork"], rate:275, rating:4.7, reviews:44, available:true,
    bio:"Power-meets-peace. Jordan's gong work is especially impactful in masculine-energy spaces like boxing and BJJ gyms.", avatar:"⚡" },
];

const VENUE_TYPES = ["All","Yoga Studios","Fight Studios","Corporate","Retreats","Private Events"];
const MODALITIES  = ["Sound Bath","Reiki","Breathwork","Meditation","Gong Bath","Crystal Healing"];
const INSTRUMENTS = ["Crystal Bowls","Gong","Tibetan Bowls","Tuning Forks","Chimes","Voice","Steel Tongue Drum","Rain Drum","Drums"];

function Stars({ n }) {
  return <span style={{color:T.gold,fontSize:12}}>{"★".repeat(Math.floor(n))}{"☆".repeat(5-Math.floor(n))}</span>;
}

function Pill({ children, on, color, onClick }) {
  const c = color||T.gold;
  return <button onClick={onClick} style={{padding:"6px 12px",borderRadius:8,fontFamily:"Georgia,serif",fontSize:12,cursor:"pointer",border:`1.5px solid ${on?c:T.border}`,background:on?c+"22":"transparent",color:on?c:T.soft}}>{children}</button>;
}

function Btn({ children, onClick, variant="primary", disabled, full, style={} }) {
  const B = {primary:{background:T.gold,color:T.void,border:"none"},secondary:{background:"transparent",color:T.gold,border:`1.5px solid ${T.gold}`},ghost:{background:T.plum,color:T.mist,border:"none"},danger:{background:T.rose,color:"#fff",border:"none"},teal:{background:T.teal,color:"#fff",border:"none"}};
  return <button onClick={onClick} disabled={disabled} style={{...B[variant],padding:"10px 20px",borderRadius:10,fontSize:13,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.5:1,fontFamily:"Georgia,serif",letterSpacing:"0.05em",fontWeight:"bold",width:full?"100%":"auto",...style}}>{children}</button>;
}

function Inp({ label, ...p }) {
  return <div style={{display:"flex",flexDirection:"column",gap:5}}>{label&&<label style={{fontSize:11,letterSpacing:"0.12em",color:T.gold}}>{label}</label>}<input {...p} style={{background:T.plum,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 12px",color:T.mist,fontSize:14,fontFamily:"Georgia,serif",outline:"none",...p.style}}/></div>;
}

function TA({ label, ...p }) {
  return <div style={{display:"flex",flexDirection:"column",gap:5}}>{label&&<label style={{fontSize:11,letterSpacing:"0.12em",color:T.gold}}>{label}</label>}<textarea {...p} style={{background:T.plum,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 12px",color:T.mist,fontSize:14,fontFamily:"Georgia,serif",outline:"none",resize:"vertical",...p.style}}/></div>;
}

function Sel({ label, children, ...p }) {
  return <div style={{display:"flex",flexDirection:"column",gap:5}}>{label&&<label style={{fontSize:11,letterSpacing:"0.12em",color:T.gold}}>{label}</label>}<select {...p} style={{background:T.plum,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 12px",color:T.mist,fontSize:14,fontFamily:"Georgia,serif",outline:"none"}}>{children}</select></div>;
}

function Card({ children, gold, onClick, style={} }) {
  return <div onClick={onClick} style={{background:T.deep,borderRadius:16,padding:20,border:`1px solid ${gold?T.gold+"66":T.border}`,...style}}>{children}</div>;
}

function Stat({ label, value, sub, color }) {
  return <Card style={{textAlign:"center",padding:"18px 12px"}}><div style={{fontSize:28,fontWeight:"bold",color:color||T.gold}}>{value}</div>{sub&&<div style={{fontSize:11,color:T.teal,marginTop:2}}>{sub}</div>}<div style={{fontSize:11,color:T.soft,letterSpacing:"0.08em",marginTop:4}}>{label}</div></Card>;
}

function ModTag({ m }) {
  return <span style={{fontSize:10,padding:"2px 7px",borderRadius:6,background:T.teal+"22",color:T.teal}}>{m}</span>;
}

function InstTag({ i }) {
  return <span style={{fontSize:11,padding:"3px 8px",borderRadius:6,background:T.plum,color:T.soft}}>{i}</span>;
}

export default function RealSound() {
  const [tab,setTab]           = useState("home");
  const [P,setP]               = useState([]);
  const [B,setB]               = useState([]);
  const [filter,setFilter]     = useState("All");
  const [mFilter,setMFilter]   = useState("All");
  const [sel,setSel]           = useState(null);
  const [bStep,setBStep]       = useState(0);
  const [bForm,setBForm]       = useState({venueName:"",date:"",time:"",venueType:"",groupSize:"",notes:"",email:""});
  const [jForm,setJForm]       = useState({name:"",location:"",email:"",password:"",rate:"",instruments:[],venueTypes:[],modalities:[],bio:"",instagram:""});
  const [jStep,setJStep]       = useState(0);
  const [toast,setToast]       = useState(null);
  const [adminView,setAV]      = useState(false);
  const [adminIn,setAI]        = useState("");
  const [pLogin,setPLogin]     = useState({email:"",password:""});
  const [me,setMe]             = useState(null);
  const [pTab,setPTab]         = useState("dashboard");
  const [editing,setEditing]   = useState(false);
  const [eForm,setEForm]       = useState(null);
  const [loginErr,setLE]       = useState("");
  const ADMIN="REALSOUND";

  useEffect(()=>{
    (async()=>{
      try {
        const ps=await window.storage.get("rs3:p");
        const bs=await window.storage.get("rs3:b");
        setP(ps?JSON.parse(ps.value):SEED);
        setB(bs?JSON.parse(bs.value):[]);
      } catch { setP(SEED); setB([]); }
    })();
  },[]);

  const sP=async(next)=>{try{await window.storage.set("rs3:p",JSON.stringify(next));}catch{}};
  const sB=async(next)=>{try{await window.storage.set("rs3:b",JSON.stringify(next));}catch{}};
  const toast2=(msg,color=T.gold)=>{setToast({msg,color});setTimeout(()=>setToast(null),3000);};
  const goTab=(t)=>{setTab(t);setSel(null);setBStep(0);setJStep(0);setAV(false);if(t!=="practitioner")setMe(null);};

  const filtered=P.filter(p=>(filter==="All"||p.venueTypes?.includes(filter))&&(mFilter==="All"||p.modalities?.includes(mFilter)));

  const submitBook=async()=>{
    const bk={id:"b"+Date.now(),practitionerId:sel.id,practitionerName:sel.name,...bForm,fee:sel.rate,platformFee:Math.round(sel.rate*0.15),total:Math.round(sel.rate*1.15),status:"pending",createdAt:new Date().toISOString()};
    const next=[...B,bk]; setB(next); await sB(next); setBStep(3); toast2("Booking request sent! 🎵");
  };

  const submitJoin=async()=>{
    if(P.find(x=>x.email===jForm.email)){toast2("Email already registered",T.rose);return;}
    const p={id:"p"+Date.now(),...jForm,rating:5.0,reviews:0,available:true,avatar:["🌿","🎵","🌸","💫","🔔","🌀","🪬"][Math.floor(Math.random()*7)]};
    const next=[...P,p]; setP(next); await sP(next); setJStep(2); toast2("Welcome to REAL Sound! ✨");
  };

  const doLogin=()=>{
    const p=P.find(x=>x.email===pLogin.email&&x.password===pLogin.password);
    if(p){setMe(p);setPTab("dashboard");setLE("");}else setLE("Email or password not recognised.");
  };

  const respond=async(id,status)=>{
    const next=B.map(b=>b.id===id?{...b,status}:b); setB(next); await sB(next);
    toast2(status==="confirmed"?"Booking confirmed ✓":"Booking declined",status==="confirmed"?T.teal:T.rose);
  };

  const saveEdit=async()=>{
    const next=P.map(p=>p.id===me.id?{...p,...eForm}:p);
    setP(next); await sP(next); setMe({...me,...eForm}); setEditing(false); toast2("Profile updated ✓");
  };

  const adminRespond=async(id,s)=>{const next=B.map(b=>b.id===id?{...b,status:s}:b);setB(next);await sB(next);};
  const removeP=async(id)=>{const next=P.filter(p=>p.id!==id);setP(next);await sP(next);};

  const myB  = me?B.filter(b=>b.practitionerId===me.id):[];
  const myEarned = myB.filter(b=>b.status==="confirmed").reduce((s,b)=>s+b.fee,0);
  const myFees   = myB.filter(b=>b.status==="confirmed").reduce((s,b)=>s+b.platformFee,0);
  const myPend   = myB.filter(b=>b.status==="pending").length;
  const myConf   = myB.filter(b=>b.status==="confirmed").length;

  const NAV=[{key:"home",label:"Home"},{key:"find",label:"Find a Healer"},{key:"join",label:"Join as Healer"},{key:"practitioner",label:"Healer Login"},{key:"admin",label:"⚙"}];
  const statusStyle=(s)=>({padding:"4px 10px",borderRadius:8,fontSize:11,background:s==="confirmed"?"#1a3a1a":s==="declined"?"#3a1a1a":T.plum,color:s==="confirmed"?"#6fcf6f":s==="declined"?"#cf6f6f":T.gold});

  return (
    <div style={{minHeight:"100vh",background:T.void,color:T.mist,fontFamily:"Georgia,serif"}}>

      {toast&&<div style={{position:"fixed",top:20,left:"50%",transform:"translateX(-50%)",background:toast.color,color:T.void,padding:"10px 24px",borderRadius:24,fontSize:14,fontWeight:"bold",zIndex:9999,boxShadow:"0 4px 20px rgba(0,0,0,0.4)",whiteSpace:"nowrap"}}>{toast.msg}</div>}

      {/* Nav */}
      <div style={{background:T.deep,borderBottom:`1px solid ${T.gold}33`,padding:"0 20px",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:980,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:60}}>
          <div onClick={()=>goTab("home")} style={{cursor:"pointer"}}>
            <div style={{fontSize:18,fontWeight:"bold",color:T.gold,letterSpacing:"0.12em"}}>◉ REAL SOUND</div>
            <div style={{fontSize:9,color:T.soft,letterSpacing:"0.2em"}}>FIND · BOOK · HEAL</div>
          </div>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {NAV.map(n=>(
              <button key={n.key} onClick={()=>goTab(n.key)} style={{padding:"6px 13px",borderRadius:20,border:"none",cursor:"pointer",fontSize:11,fontFamily:"Georgia,serif",background:tab===n.key?T.gold:"transparent",color:tab===n.key?T.void:T.soft,fontWeight:tab===n.key?"bold":"normal"}}>
                {n.key==="practitioner"&&me?`👤 ${me.name.split(" ")[0]}`:n.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{maxWidth:980,margin:"0 auto",padding:"28px 20px"}}>

        {/* HOME */}
        {tab==="home"&&(
          <div>
            <div style={{textAlign:"center",padding:"40px 0 44px"}}>
              <div style={{fontSize:11,letterSpacing:"0.3em",color:T.rose,marginBottom:14}}>THE SOUND HEALING MARKETPLACE</div>
              <h1 style={{fontSize:"clamp(28px,5vw,48px)",fontWeight:"normal",lineHeight:1.2,margin:"0 0 16px",color:T.chalk}}>Real healers.<br/><span style={{color:T.gold}}>Real bookings.</span><br/>Real peace.</h1>
              <p style={{color:T.soft,fontSize:15,maxWidth:420,margin:"0 auto 28px",lineHeight:1.7}}>Connect your yoga studio, gym, or team with certified Sound Bath and Reiki practitioners. No middleman. No guesswork.</p>
              <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}>
                <Btn onClick={()=>goTab("find")} style={{padding:"13px 28px",fontSize:15}}>Find a Healer →</Btn>
                <Btn onClick={()=>goTab("join")} variant="secondary" style={{padding:"13px 28px",fontSize:15}}>I'm a Practitioner</Btn>
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:44}}>
              {[[P.length,"Verified healers"],[B.length,"Sessions booked"],["15%","Platform fee only"]].map(([v,l])=><Stat key={l} value={v} label={l}/>)}
            </div>

            <div style={{marginBottom:36}}>
              <div style={{fontSize:11,letterSpacing:"0.2em",color:T.gold,textAlign:"center",marginBottom:14}}>WHAT WE OFFER</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10}}>
                {[["🎵","Sound Bath"],["🙌","Reiki"],["🌬️","Breathwork"],["🧘","Meditation"],["🔔","Gong Bath"],["💎","Crystal Healing"]].map(([icon,label])=>(
                  <div key={label} onClick={()=>{goTab("find");setMFilter(label);}} style={{background:T.deep,borderRadius:12,padding:"16px 10px",textAlign:"center",border:`1px solid ${T.border}`,cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.borderColor=T.teal} onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
                    <div style={{fontSize:26}}>{icon}</div><div style={{fontSize:12,color:T.mist,marginTop:8}}>{label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{marginBottom:36}}>
              <div style={{fontSize:11,letterSpacing:"0.2em",color:T.gold,textAlign:"center",marginBottom:14}}>WHO IT'S FOR</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10}}>
                {[["🧘","Yoga Studios"],["🥊","Fight Studios"],["🏢","Corporate"],["🌿","Retreats"],["🎉","Private Events"],["🏨","Hotels & Spas"]].map(([icon,label])=>(
                  <div key={label} onClick={()=>{goTab("find");setFilter(VENUE_TYPES.find(v=>label.includes(v.split(" ")[0]))||"All");}} style={{background:T.deep,borderRadius:12,padding:"16px 10px",textAlign:"center",border:`1px solid ${T.border}`,cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.borderColor=T.gold} onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
                    <div style={{fontSize:26}}>{icon}</div><div style={{fontSize:12,color:T.mist,marginTop:8}}>{label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{fontSize:11,letterSpacing:"0.2em",color:T.gold}}>FEATURED HEALERS</div>
                <span onClick={()=>goTab("find")} style={{fontSize:13,color:T.rose,cursor:"pointer"}}>See all →</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}}>
                {P.filter(p=>p.available).slice(0,3).map(p=>(
                  <Card key={p.id} onClick={()=>{goTab("find");setSel(p);setBStep(1);}} style={{cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.borderColor=T.gold} onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
                    <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:10}}>
                      <div style={{fontSize:28,background:T.plum,borderRadius:"50%",width:46,height:46,display:"flex",alignItems:"center",justifyContent:"center"}}>{p.avatar}</div>
                      <div><div style={{fontWeight:"bold",color:T.chalk}}>{p.name}</div><div style={{fontSize:12,color:T.soft}}>{p.location}</div></div>
                      <div style={{marginLeft:"auto",color:T.gold,fontWeight:"bold"}}>${p.rate}</div>
                    </div>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>{p.modalities?.map(m=><ModTag key={m} m={m}/>)}</div>
                    <div style={{fontSize:13,color:T.soft,lineHeight:1.5}}>{p.bio?.slice(0,80)}…</div>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* FIND */}
        {tab==="find"&&!sel&&(
          <div>
            <h2 style={{margin:"0 0 6px",fontWeight:"normal",fontSize:24}}>Find a Healer</h2>
            <p style={{color:T.soft,margin:"0 0 16px",fontSize:14}}>Browse verified practitioners and send a booking request.</p>
            <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:8}}>{VENUE_TYPES.map(v=><Pill key={v} on={filter===v} onClick={()=>setFilter(v)}>{v}</Pill>)}</div>
            <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:22}}>{["All",...MODALITIES].map(m=><Pill key={m} on={mFilter===m} color={T.teal} onClick={()=>setMFilter(m)}>{m}</Pill>)}</div>
            {filtered.length===0&&<div style={{textAlign:"center",padding:"60px 0",color:T.soft}}><div style={{fontSize:40,marginBottom:12}}>🔍</div>No practitioners found for this filter.</div>}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
              {filtered.map(p=>(
                <Card key={p.id} style={{transition:"border-color 0.2s"}} onMouseEnter={e=>e.currentTarget.style.borderColor=T.gold} onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
                  <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:12,paddingBottom:12,borderBottom:`1px solid ${T.border}`}}>
                    <div style={{fontSize:28,background:T.plum,borderRadius:"50%",width:46,height:46,display:"flex",alignItems:"center",justifyContent:"center"}}>{p.avatar}</div>
                    <div style={{flex:1}}><div style={{fontWeight:"bold",color:T.chalk}}>{p.name}</div><div style={{fontSize:12,color:T.soft}}>📍 {p.location}</div></div>
                    <span style={{fontSize:10,padding:"3px 8px",borderRadius:8,background:p.available?"#1a3a1a":"#3a1a1a",color:p.available?"#6fcf6f":"#cf6f6f"}}>{p.available?"● Open":"○ Busy"}</span>
                  </div>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>{p.modalities?.map(m=><ModTag key={m} m={m}/>)}</div>
                  <p style={{fontSize:13,color:T.soft,margin:"0 0 10px",lineHeight:1.5}}>{p.bio}</p>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>{p.instruments?.map(i=><InstTag key={i} i={i}/>)}</div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div><span style={{fontSize:20,fontWeight:"bold",color:T.chalk}}>${p.rate}</span><span style={{fontSize:12,color:T.soft}}>/session</span><div style={{marginTop:2}}><Stars n={p.rating}/> <span style={{fontSize:11,color:T.soft}}>({p.reviews})</span></div></div>
                    <Btn onClick={()=>{setSel(p);setBStep(1);}} disabled={!p.available}>{p.available?"Book →":"Unavailable"}</Btn>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* BOOKING */}
        {tab==="find"&&sel&&(
          <div style={{maxWidth:520,margin:"0 auto"}}>
            <button onClick={()=>{setSel(null);setBStep(0);setBForm({venueName:"",date:"",time:"",venueType:"",groupSize:"",notes:"",email:""});}} style={{background:"none",border:"none",color:T.rose,cursor:"pointer",fontSize:13,marginBottom:20,fontFamily:"Georgia,serif"}}>← Back</button>
            <Card gold style={{display:"flex",gap:14,alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:30}}>{sel.avatar}</div>
              <div style={{flex:1}}><div style={{fontWeight:"bold",color:T.chalk}}>{sel.name}</div><div style={{fontSize:12,color:T.soft}}>{sel.location}</div><div style={{display:"flex",gap:4,marginTop:4}}>{sel.modalities?.map(m=><ModTag key={m} m={m}/>)}</div></div>
              <div style={{textAlign:"right"}}><div style={{fontSize:20,color:T.gold,fontWeight:"bold"}}>${sel.rate}</div><div style={{fontSize:11,color:T.soft}}>per session</div></div>
            </Card>

            {bStep===1&&(
              <Card>
                <h3 style={{margin:"0 0 20px",color:T.chalk,fontWeight:"normal",fontSize:18}}>Tell us about your event</h3>
                <div style={{display:"flex",flexDirection:"column",gap:14}}>
                  <Inp label="VENUE / COMPANY NAME" placeholder="e.g. Lotus Yoga Studio" value={bForm.venueName} onChange={e=>setBForm({...bForm,venueName:e.target.value})}/>
                  <Inp label="YOUR EMAIL" type="email" placeholder="you@example.com" value={bForm.email} onChange={e=>setBForm({...bForm,email:e.target.value})}/>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                    <Inp label="DATE" type="date" value={bForm.date} onChange={e=>setBForm({...bForm,date:e.target.value})}/>
                    <Inp label="TIME" type="time" value={bForm.time} onChange={e=>setBForm({...bForm,time:e.target.value})}/>
                  </div>
                  <Sel label="VENUE TYPE" value={bForm.venueType} onChange={e=>setBForm({...bForm,venueType:e.target.value})}>
                    <option value="">Select...</option>{VENUE_TYPES.filter(v=>v!=="All").map(v=><option key={v}>{v}</option>)}
                  </Sel>
                  <Inp label="GROUP SIZE" type="number" placeholder="e.g. 20" value={bForm.groupSize} onChange={e=>setBForm({...bForm,groupSize:e.target.value})}/>
                  <TA label="NOTES FOR THE HEALER" rows={3} placeholder="Themes, intentions, special requests…" value={bForm.notes} onChange={e=>setBForm({...bForm,notes:e.target.value})}/>
                  <Btn onClick={()=>setBStep(2)} disabled={!bForm.venueName||!bForm.date||!bForm.email} full style={{padding:14,fontSize:15}}>Review Booking →</Btn>
                </div>
              </Card>
            )}

            {bStep===2&&(
              <Card>
                <h3 style={{margin:"0 0 20px",color:T.chalk,fontWeight:"normal"}}>Review your booking</h3>
                {[["Venue",bForm.venueName],["Date",bForm.date],["Time",bForm.time],["Type",bForm.venueType],["Group",bForm.groupSize?`${bForm.groupSize} people`:"—"],["Session fee",`$${sel.rate}`],["Platform fee (15%)",`$${Math.round(sel.rate*0.15)}`]].map(([k,v])=>(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:`1px solid ${T.border}`,fontSize:14}}>
                    <span style={{color:T.soft,fontSize:11,letterSpacing:"0.08em",alignSelf:"center"}}>{k.toUpperCase()}</span>
                    <span style={{color:T.mist}}>{v}</span>
                  </div>
                ))}
                <div style={{display:"flex",justifyContent:"space-between",padding:"12px 0",fontSize:17,fontWeight:"bold"}}>
                  <span style={{color:T.gold}}>TOTAL</span><span style={{color:T.gold}}>${Math.round(sel.rate*1.15)}</span>
                </div>
                <div style={{background:T.plum,borderRadius:8,padding:"12px 14px",margin:"12px 0"}}>
                  <label style={{display:"flex",gap:10,alignItems:"flex-start",cursor:"pointer"}}>
                    <input type="checkbox" style={{marginTop:3,accentColor:T.gold}} onChange={e=>setBForm({...bForm,agreed:e.target.checked})}/>
                    <span style={{fontSize:11,color:T.soft,lineHeight:1.6}}>I understand that REAL Sound is a marketplace platform connecting independent practitioners with venues. REAL Sound is not responsible for the conduct, qualifications, or services of any practitioner. By confirming this booking I agree that REAL Sound bears no liability for any injury, loss, or damage arising from this session.</span>
                  </label>
                </div>
                <div style={{display:"flex",gap:10,marginTop:8}}>
                  <Btn onClick={()=>setBStep(1)} variant="ghost" style={{flex:1}}>Edit</Btn>
                  <Btn onClick={submitBook} disabled={!bForm.agreed} style={{flex:2,padding:14,fontSize:15}}>Confirm & Request →</Btn>
                </div>
              </Card>
            )}

            {bStep===3&&(
              <Card gold style={{textAlign:"center",padding:36}}>
                <div style={{fontSize:52,marginBottom:16}}>🔔</div>
                <h2 style={{color:T.gold,margin:"0 0 10px",fontWeight:"normal"}}>Request Sent!</h2>
                <p style={{color:T.soft,fontSize:14,margin:"0 0 24px",lineHeight:1.7}}>{sel.name} will confirm within 24 hours.<br/>Check <strong style={{color:T.mist}}>{bForm.email}</strong> for updates.</p>
                <div style={{background:T.plum,borderRadius:10,padding:"14px 18px",textAlign:"left",marginBottom:22}}>
                  {["Healer reviews and confirms your request","You'll receive a session prep guide","Payment releases only after the session","Leave a review to help the community"].map((s,i)=>(
                    <div key={i} style={{display:"flex",gap:10,fontSize:13,color:T.soft,marginBottom:7}}><span style={{color:T.gold}}>✓</span>{s}</div>
                  ))}
                </div>
                <Btn onClick={()=>{setSel(null);setBStep(0);setBForm({venueName:"",date:"",time:"",venueType:"",groupSize:"",notes:"",email:""});}} variant="secondary">Back to healers</Btn>
              </Card>
            )}
          </div>
        )}

        {/* JOIN */}
        {tab==="join"&&(
          <div style={{maxWidth:520,margin:"0 auto"}}>
            {jStep===0&&(
              <div style={{textAlign:"center",paddingTop:20}}>
                <div style={{fontSize:52,marginBottom:16}}>🎵</div>
                <h2 style={{fontWeight:"normal",fontSize:26,margin:"0 0 10px"}}>Share your gift. <span style={{color:T.gold}}>Get booked.</span></h2>
                <p style={{color:T.soft,fontSize:14,maxWidth:400,margin:"0 auto 28px",lineHeight:1.7}}>REAL Sound connects you with yoga studios, gyms, and companies. Keep 85% of every booking. Log back in anytime to manage requests and track earnings.</p>
                <div style={{display:"grid",gap:12,marginBottom:28,textAlign:"left"}}>
                  {[["🎯","Get found by venues","Studios and companies discover you — no cold outreach needed."],["💰","Keep 85% of every booking","We take 15% to run the platform. That's it."],["📊","Your own dashboard","Log in to accept bookings, track earnings, and update your profile."]].map(([icon,title,desc])=>(
                    <Card key={title} style={{display:"flex",gap:14,alignItems:"flex-start"}}><div style={{fontSize:24}}>{icon}</div><div><div style={{fontWeight:"bold",color:T.chalk,marginBottom:3}}>{title}</div><div style={{fontSize:13,color:T.soft}}>{desc}</div></div></Card>
                  ))}
                </div>
                <Btn onClick={()=>setJStep(1)} style={{padding:"13px 32px",fontSize:15}}>Create My Profile →</Btn>
                <div style={{marginTop:14}}><span style={{color:T.soft,fontSize:13}}>Already listed? </span><span onClick={()=>goTab("practitioner")} style={{color:T.gold,fontSize:13,cursor:"pointer"}}>Log in →</span></div>
              </div>
            )}

            {jStep===1&&(
              <Card>
                <h3 style={{margin:"0 0 4px",color:T.chalk,fontWeight:"normal",fontSize:20}}>Create your healer profile</h3>
                <p style={{color:T.soft,fontSize:13,margin:"0 0 20px"}}>Venues will see this. You'll use your email & password to log back in.</p>
                <div style={{display:"flex",flexDirection:"column",gap:14}}>
                  <Inp label="YOUR NAME" placeholder="e.g. Luna Serrano" value={jForm.name} onChange={e=>setJForm({...jForm,name:e.target.value})}/>
                  <Inp label="EMAIL" type="email" placeholder="you@example.com" value={jForm.email} onChange={e=>setJForm({...jForm,email:e.target.value})}/>
                  <Inp label="PASSWORD" type="password" placeholder="Create a password" value={jForm.password} onChange={e=>setJForm({...jForm,password:e.target.value})}/>
                  <Inp label="LOCATION" placeholder="City, State" value={jForm.location} onChange={e=>setJForm({...jForm,location:e.target.value})}/>
                  <Inp label="SESSION RATE ($)" type="number" placeholder="e.g. 250" value={jForm.rate} onChange={e=>setJForm({...jForm,rate:e.target.value})}/>
                  <Inp label="INSTAGRAM (optional)" placeholder="@yourhandle" value={jForm.instagram} onChange={e=>setJForm({...jForm,instagram:e.target.value})}/>
                  <div>
                    <label style={{fontSize:11,letterSpacing:"0.12em",color:T.gold,display:"block",marginBottom:8}}>MODALITIES (what you offer)</label>
                    <div style={{display:"flex",flexWrap:"wrap",gap:7}}>{MODALITIES.map(m=>{const on=jForm.modalities.includes(m);return<Pill key={m} on={on} color={T.teal} onClick={()=>setJForm({...jForm,modalities:on?jForm.modalities.filter(x=>x!==m):[...jForm.modalities,m]})}>{m}</Pill>;})}</div>
                  </div>
                  <div>
                    <label style={{fontSize:11,letterSpacing:"0.12em",color:T.gold,display:"block",marginBottom:8}}>INSTRUMENTS</label>
                    <div style={{display:"flex",flexWrap:"wrap",gap:7}}>{INSTRUMENTS.map(i=>{const on=jForm.instruments.includes(i);return<Pill key={i} on={on} onClick={()=>setJForm({...jForm,instruments:on?jForm.instruments.filter(x=>x!==i):[...jForm.instruments,i]})}>{i}</Pill>;})}</div>
                  </div>
                  <div>
                    <label style={{fontSize:11,letterSpacing:"0.12em",color:T.gold,display:"block",marginBottom:8}}>VENUE TYPES YOU SERVE</label>
                    <div style={{display:"flex",flexWrap:"wrap",gap:7}}>{VENUE_TYPES.filter(v=>v!=="All").map(vt=>{const on=jForm.venueTypes.includes(vt);return<Pill key={vt} on={on} color={T.rose} onClick={()=>setJForm({...jForm,venueTypes:on?jForm.venueTypes.filter(x=>x!==vt):[...jForm.venueTypes,vt]})}>{vt}</Pill>;})}</div>
                  </div>
                  <TA label="YOUR BIO" rows={4} placeholder="Tell venues about your practice, training, and the experience you create…" value={jForm.bio} onChange={e=>setJForm({...jForm,bio:e.target.value})}/>
                  <Btn onClick={submitJoin} disabled={!jForm.name||!jForm.email||!jForm.password||!jForm.location||!jForm.rate} full style={{padding:14,fontSize:15}}>Create Profile →</Btn>
                </div>
              </Card>
            )}

            {jStep===2&&(
              <Card gold style={{textAlign:"center",padding:36}}>
                <div style={{fontSize:52,marginBottom:16}}>🌟</div>
                <h2 style={{color:T.gold,margin:"0 0 10px",fontWeight:"normal"}}>You're live!</h2>
                <p style={{color:T.soft,fontSize:14,margin:"0 0 24px",lineHeight:1.7}}>Your profile is now visible to venues on REAL Sound.<br/>Log in anytime to manage bookings and track earnings.</p>
                <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
                  <Btn onClick={()=>{goTab("practitioner");setJStep(0);}} variant="teal">Go to My Dashboard →</Btn>
                  <Btn onClick={()=>{setJStep(0);setJForm({name:"",location:"",email:"",password:"",rate:"",instruments:[],venueTypes:[],modalities:[],bio:"",instagram:""}); }} variant="secondary">Add another</Btn>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* PRACTITIONER LOGIN */}
        {tab==="practitioner"&&!me&&(
          <div style={{maxWidth:380,margin:"60px auto"}}>
            <div style={{textAlign:"center",marginBottom:24}}>
              <div style={{fontSize:40,marginBottom:12}}>👤</div>
              <h2 style={{fontWeight:"normal",margin:"0 0 6px"}}>Healer Login</h2>
              <p style={{color:T.soft,fontSize:13}}>Access your dashboard, bookings & earnings.</p>
            </div>
            <Card>
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                <Inp label="EMAIL" type="email" placeholder="your@email.com" value={pLogin.email} onChange={e=>{setPLogin({...pLogin,email:e.target.value});setLE("");}}/>
                <Inp label="PASSWORD" type="password" placeholder="Your password" value={pLogin.password} onChange={e=>{setPLogin({...pLogin,password:e.target.value});setLE("");}}/>
                {loginErr&&<div style={{color:T.rose,fontSize:13}}>{loginErr}</div>}
                <Btn onClick={doLogin} full style={{padding:13,fontSize:15}}>Log In →</Btn>
                <div style={{textAlign:"center",paddingTop:4}}><span style={{color:T.soft,fontSize:12}}>Not listed yet? </span><span onClick={()=>goTab("join")} style={{color:T.gold,fontSize:12,cursor:"pointer"}}>Create a profile →</span></div>
                <div style={{borderTop:`1px solid ${T.border}`,paddingTop:12,fontSize:11,color:T.soft,textAlign:"center",lineHeight:1.6}}>
                  Demo logins:<br/>luna@example.com / luna123<br/>marcus@example.com / marcus123
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* PRACTITIONER DASHBOARD */}
        {tab==="practitioner"&&me&&!editing&&(
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:10}}>
              <div><h2 style={{margin:0,fontWeight:"normal",color:T.chalk}}>{me.avatar} {me.name}</h2><div style={{fontSize:13,color:T.soft}}>Healer Dashboard</div></div>
              <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                {[["dashboard","📊 Overview"],["bookings","📅 Bookings"],["earnings","💰 Earnings"],["profile","👤 Profile"]].map(([k,l])=>(
                  <button key={k} onClick={()=>setPTab(k)} style={{padding:"7px 13px",borderRadius:20,border:"none",cursor:"pointer",fontSize:11,fontFamily:"Georgia,serif",background:pTab===k?T.gold:T.plum,color:pTab===k?T.void:T.soft,fontWeight:pTab===k?"bold":"normal"}}>{l}</button>
                ))}
                <Btn onClick={()=>{setMe(null);setPLogin({email:"",password:""});}} variant="ghost" style={{fontSize:11,padding:"7px 13px"}}>Log out</Btn>
              </div>
            </div>

            {pTab==="dashboard"&&(
              <div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:12,marginBottom:24}}>
                  <Stat value={myPend} label="PENDING" color={T.gold}/>
                  <Stat value={myConf} label="CONFIRMED" color={T.teal}/>
                  <Stat value={`$${myEarned}`} label="EARNED" color={T.teal} sub={`Platform: $${myFees}`}/>
                  <Stat value={myB.length} label="TOTAL BOOKINGS"/>
                </div>
                <div style={{fontSize:11,letterSpacing:"0.15em",color:T.gold,marginBottom:12}}>PENDING REQUESTS ({myPend})</div>
                {myPend===0&&<Card style={{textAlign:"center",color:T.soft,padding:28,marginBottom:20}}>No pending requests. Share your profile to get bookings!</Card>}
                {myB.filter(b=>b.status==="pending").map(b=>(
                  <Card key={b.id} style={{marginBottom:12}}>
                    <div style={{display:"flex",gap:14,alignItems:"flex-start",flexWrap:"wrap"}}>
                      <div style={{flex:1,minWidth:180}}>
                        <div style={{fontWeight:"bold",color:T.chalk,marginBottom:3}}>{b.venueName}</div>
                        <div style={{fontSize:12,color:T.soft}}>{b.date} at {b.time} · {b.venueType} · {b.groupSize} people</div>
                        {b.notes&&<div style={{fontSize:12,color:T.soft,marginTop:3,fontStyle:"italic"}}>"{b.notes}"</div>}
                        <div style={{fontSize:13,color:T.teal,marginTop:4,fontWeight:"bold"}}>You earn: ${b.fee}</div>
                      </div>
                      <div style={{display:"flex",gap:8}}>
                        <Btn onClick={()=>respond(b.id,"confirmed")} variant="teal" style={{padding:"8px 14px",fontSize:12}}>✓ Accept</Btn>
                        <Btn onClick={()=>respond(b.id,"declined")} variant="danger" style={{padding:"8px 14px",fontSize:12}}>✗ Decline</Btn>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {pTab==="bookings"&&(
              <div>
                <div style={{fontSize:11,letterSpacing:"0.15em",color:T.gold,marginBottom:12}}>ALL BOOKINGS ({myB.length})</div>
                {myB.length===0&&<Card style={{textAlign:"center",color:T.soft,padding:28}}>No bookings yet.</Card>}
                {myB.map(b=>(
                  <Card key={b.id} style={{marginBottom:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
                      <div>
                        <div style={{fontWeight:"bold",color:T.chalk,marginBottom:3}}>{b.venueName}</div>
                        <div style={{fontSize:12,color:T.soft}}>{b.date} at {b.time} · {b.venueType}</div>
                        <div style={{fontSize:12,color:T.soft}}>Group: {b.groupSize} · Contact: {b.email}</div>
                        {b.notes&&<div style={{fontSize:12,color:T.soft,marginTop:3,fontStyle:"italic"}}>"{b.notes}"</div>}
                      </div>
                      <div style={{textAlign:"right"}}>
                        <span style={statusStyle(b.status)}>{b.status}</span>
                        <div style={{fontSize:13,color:T.teal,marginTop:6}}>${b.fee} your cut</div>
                      </div>
                    </div>
                    {b.status==="pending"&&(
                      <div style={{display:"flex",gap:8,marginTop:12,paddingTop:12,borderTop:`1px solid ${T.border}`}}>
                        <Btn onClick={()=>respond(b.id,"confirmed")} variant="teal" style={{padding:"8px 14px",fontSize:12}}>✓ Accept</Btn>
                        <Btn onClick={()=>respond(b.id,"declined")} variant="danger" style={{padding:"8px 14px",fontSize:12}}>✗ Decline</Btn>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}

            {pTab==="earnings"&&(
              <div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12,marginBottom:24}}>
                  <Stat value={`$${myEarned}`} label="TOTAL EARNED" color={T.teal}/>
                  <Stat value={`$${myFees}`} label="PLATFORM FEES" color={T.soft}/>
                  <Stat value={myConf} label="SESSIONS DONE" color={T.gold}/>
                  <Stat value={myConf>0?`$${Math.round(myEarned/myConf)}`:"—"} label="AVG PER SESSION" color={T.gold}/>
                </div>
                <div style={{fontSize:11,letterSpacing:"0.15em",color:T.gold,marginBottom:12}}>CONFIRMED SESSIONS</div>
                {myB.filter(b=>b.status==="confirmed").length===0&&<Card style={{textAlign:"center",color:T.soft,padding:28}}>No confirmed sessions yet.</Card>}
                {myB.filter(b=>b.status==="confirmed").map(b=>(
                  <Card key={b.id} style={{marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
                    <div><div style={{fontWeight:"bold",color:T.chalk}}>{b.venueName}</div><div style={{fontSize:12,color:T.soft}}>{b.date} · {b.venueType} · {b.groupSize} people</div></div>
                    <div style={{textAlign:"right"}}><div style={{fontSize:18,color:T.teal,fontWeight:"bold"}}>${b.fee}</div><div style={{fontSize:11,color:T.soft}}>your earnings</div></div>
                  </Card>
                ))}
              </div>
            )}

            {pTab==="profile"&&(
              <div style={{maxWidth:520}}>
                <Card gold style={{marginBottom:16}}>
                  <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:14}}>
                    <div style={{fontSize:38,background:T.plum,borderRadius:"50%",width:58,height:58,display:"flex",alignItems:"center",justifyContent:"center"}}>{me.avatar}</div>
                    <div><div style={{fontWeight:"bold",fontSize:20,color:T.chalk}}>{me.name}</div><div style={{color:T.soft,fontSize:13}}>📍 {me.location}</div><div style={{color:T.gold,fontWeight:"bold",marginTop:2}}>${me.rate}/session</div></div>
                  </div>
                  <p style={{color:T.soft,fontSize:14,lineHeight:1.6,margin:"0 0 12px"}}>{me.bio}</p>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>{me.modalities?.map(m=><ModTag key={m} m={m}/>)}</div>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{me.instruments?.map(i=><InstTag key={i} i={i}/>)}</div>
                </Card>
                <Btn onClick={()=>{setEForm({...me});setEditing(true);}} full style={{padding:13,fontSize:15}}>✏️ Edit My Profile</Btn>
              </div>
            )}
          </div>
        )}

        {/* EDIT PROFILE */}
        {tab==="practitioner"&&me&&editing&&(
          <div style={{maxWidth:520,margin:"0 auto"}}>
            <button onClick={()=>setEditing(false)} style={{background:"none",border:"none",color:T.rose,cursor:"pointer",fontSize:13,marginBottom:20,fontFamily:"Georgia,serif"}}>← Cancel</button>
            <Card>
              <h3 style={{margin:"0 0 20px",color:T.chalk,fontWeight:"normal"}}>Edit Your Profile</h3>
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                <Inp label="NAME" value={eForm.name} onChange={e=>setEForm({...eForm,name:e.target.value})}/>
                <Inp label="LOCATION" value={eForm.location} onChange={e=>setEForm({...eForm,location:e.target.value})}/>
                <Inp label="SESSION RATE ($)" type="number" value={eForm.rate} onChange={e=>setEForm({...eForm,rate:e.target.value})}/>
                <Inp label="INSTAGRAM" value={eForm.instagram||""} onChange={e=>setEForm({...eForm,instagram:e.target.value})}/>
                <div>
                  <label style={{fontSize:11,letterSpacing:"0.12em",color:T.gold,display:"block",marginBottom:8}}>MODALITIES</label>
                  <div style={{display:"flex",flexWrap:"wrap",gap:7}}>{MODALITIES.map(m=>{const on=eForm.modalities?.includes(m);return<Pill key={m} on={on} color={T.teal} onClick={()=>setEForm({...eForm,modalities:on?eForm.modalities.filter(x=>x!==m):[...(eForm.modalities||[]),m]})}>{m}</Pill>;})}</div>
                </div>
                <div>
                  <label style={{fontSize:11,letterSpacing:"0.12em",color:T.gold,display:"block",marginBottom:8}}>INSTRUMENTS</label>
                  <div style={{display:"flex",flexWrap:"wrap",gap:7}}>{INSTRUMENTS.map(i=>{const on=eForm.instruments?.includes(i);return<Pill key={i} on={on} onClick={()=>setEForm({...eForm,instruments:on?eForm.instruments.filter(x=>x!==i):[...(eForm.instruments||[]),i]})}>{i}</Pill>;})}</div>
                </div>
                <div>
                  <label style={{fontSize:11,letterSpacing:"0.12em",color:T.gold,display:"block",marginBottom:8}}>AVAILABILITY</label>
                  <div style={{display:"flex",gap:10}}>
                    <Pill on={eForm.available===true} color={T.teal} onClick={()=>setEForm({...eForm,available:true})}>● Available</Pill>
                    <Pill on={eForm.available===false} color={T.rose} onClick={()=>setEForm({...eForm,available:false})}>○ Paused</Pill>
                  </div>
                </div>
                <TA label="BIO" rows={4} value={eForm.bio} onChange={e=>setEForm({...eForm,bio:e.target.value})}/>
                <Btn onClick={saveEdit} full style={{padding:13,fontSize:15}}>Save Changes ✓</Btn>
              </div>
            </Card>
          </div>
        )}

        {/* ADMIN */}
        {tab==="admin"&&!adminView&&(
          <div style={{maxWidth:360,margin:"60px auto",textAlign:"center"}}>
            <div style={{fontSize:36,marginBottom:16}}>🔐</div>
            <h3 style={{color:T.chalk,fontWeight:"normal",marginBottom:20}}>Admin Access</h3>
            <Inp placeholder="Enter admin code" value={adminIn} onChange={e=>setAI(e.target.value)} style={{marginBottom:12,textAlign:"center"}}/>
            <Btn onClick={()=>{if(adminIn===ADMIN)setAV(true);else toast2("Incorrect code",T.rose);}} full>Enter</Btn>
            <p style={{color:T.soft,fontSize:12,marginTop:14}}>Code: REALSOUND</p>
          </div>
        )}

        {tab==="admin"&&adminView&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
              <h2 style={{margin:0,color:T.gold,fontWeight:"normal"}}>⚙ Admin Dashboard</h2>
              <Btn onClick={()=>setAV(false)} variant="ghost" style={{fontSize:12,padding:"6px 14px"}}>Lock</Btn>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:12,marginBottom:28}}>
              <Stat value={B.length} label="TOTAL BOOKINGS"/>
              <Stat value={B.filter(b=>b.status==="pending").length} label="PENDING" color={T.gold}/>
              <Stat value={B.filter(b=>b.status==="confirmed").length} label="CONFIRMED" color={T.teal}/>
              <Stat value={`$${B.filter(b=>b.status==="confirmed").reduce((s,b)=>s+b.platformFee,0)}`} label="YOUR REVENUE" color={T.teal}/>
            </div>
            <div style={{fontSize:11,letterSpacing:"0.15em",color:T.gold,marginBottom:12}}>ALL BOOKINGS</div>
            {B.length===0&&<div style={{color:T.soft,fontSize:14,marginBottom:24}}>No bookings yet.</div>}
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:32}}>
              {B.map(b=>(
                <Card key={b.id} style={{display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
                  <div style={{flex:1,minWidth:180}}>
                    <div style={{fontWeight:"bold",color:T.chalk,marginBottom:2}}>{b.venueName}</div>
                    <div style={{fontSize:12,color:T.soft}}>{b.practitionerName} · {b.date} {b.time} · {b.venueType}</div>
                    <div style={{fontSize:12,color:T.soft}}>Group: {b.groupSize} · Your cut: <span style={{color:T.teal}}>${b.platformFee}</span> · Total: ${b.total}</div>
                  </div>
                  <span style={statusStyle(b.status)}>{b.status}</span>
                  {b.status==="pending"&&<div style={{display:"flex",gap:6}}><Btn onClick={()=>adminRespond(b.id,"confirmed")} style={{padding:"6px 12px",fontSize:12}}>✓</Btn><Btn onClick={()=>adminRespond(b.id,"declined")} variant="danger" style={{padding:"6px 12px",fontSize:12}}>✗</Btn></div>}
                </Card>
              ))}
            </div>
            <div style={{fontSize:11,letterSpacing:"0.15em",color:T.gold,marginBottom:12}}>PRACTITIONERS ({P.length})</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {P.map(p=>(
                <Card key={p.id} style={{display:"flex",alignItems:"center",gap:14}}>
                  <div style={{fontSize:22}}>{p.avatar}</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:"bold",color:T.chalk}}>{p.name}</div>
                    <div style={{fontSize:12,color:T.soft}}>{p.location} · ${p.rate}/session · {p.email}</div>
                    <div style={{display:"flex",gap:5,marginTop:4,flexWrap:"wrap"}}>{p.modalities?.map(m=><ModTag key={m} m={m}/>)}</div>
                  </div>
                  <span style={{fontSize:11,padding:"3px 8px",borderRadius:8,background:p.available?"#1a3a1a":"#3a1a1a",color:p.available?"#6fcf6f":"#cf6f6f"}}>{p.available?"Active":"Paused"}</span>
                  <Btn onClick={()=>removeP(p.id)} variant="danger" style={{padding:"6px 12px",fontSize:12}}>Remove</Btn>
                </Card>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Disclaimer */}
      <div style={{background:T.deep,borderTop:`1px solid ${T.border}`,padding:"20px 24px",marginTop:40}}>
        <div style={{maxWidth:900,margin:"0 auto"}}>
          <div style={{fontSize:10,letterSpacing:"0.15em",color:T.gold,marginBottom:8}}>LEGAL DISCLAIMER</div>
          <p style={{fontSize:11,color:T.soft,lineHeight:1.7,margin:"0 0 12px"}}>
            REAL Sound is an independent marketplace platform that connects independent sound healing and wellness practitioners with venues and organizations seeking their services. REAL Sound does not employ, supervise, or control any practitioner listed on this platform. All practitioners are independent contractors solely responsible for the services they provide.
          </p>
          <p style={{fontSize:11,color:T.soft,lineHeight:1.7,margin:"0 0 12px"}}>
            REAL Sound makes no representations or warranties regarding the qualifications, certifications, conduct, or quality of any practitioner. By using this platform to book or list services, all parties agree that REAL Sound, its founder, and its affiliates bear no liability for any injury, loss, damage, or dispute arising from or related to any session, interaction, or transaction facilitated through this platform.
          </p>
          <p style={{fontSize:11,color:T.soft,lineHeight:1.7,margin:0}}>
            All bookings are made at the sole discretion and risk of the parties involved. Users are encouraged to verify practitioner credentials independently. By using REAL Sound you acknowledge and agree to these terms.
          </p>
        </div>
      </div>

      <div style={{borderTop:`1px solid ${T.gold}22`,padding:"20px",textAlign:"center"}}>
        <div style={{color:T.gold,fontSize:13,letterSpacing:"0.12em"}}>◉ REAL SOUND</div>
        <div style={{color:T.soft,fontSize:11,marginTop:4}}>A REAL Golden Peace venture by Suzzanna</div>
        <div style={{color:T.soft,fontSize:10,marginTop:4}}>© {new Date().getFullYear()} REAL Sound · All Rights Reserved</div>
      </div>
    </div>
  );
}
