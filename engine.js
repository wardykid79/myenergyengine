/* ============================================================
   MY ENERGY ENGINE — transparent home-energy decision engine
   Deterministic model: heat demand + system efficiency + 2026
   grants/prices. No black box. Edit the DATA block to update.
   ============================================================ */
"use strict";
const OIL_KWH_PER_L = 10.35;

const REGIONS = {
  ROI:{name:"the Republic of Ireland",cur:"€",elec:0.35,gas:0.105,oilL:1.30,lpg:0.13,pellet:0.075,solid:0.10,
    exportRate:0.20,gridCO2:0.28,solarYield:850,
    grants:{hpSystem:6500,hpCentral:2000,hpBonus:4000,hpOffGas:0,solar:1800,attic:2000,cavity:1800,biomass:0}},
  GB:{name:"England & Wales",cur:"£",elec:0.26,gas:0.065,oilL:0.70,lpg:0.09,pellet:0.07,solid:0.09,
    exportRate:0.15,gridCO2:0.21,solarYield:900,
    grants:{hpSystem:7500,hpCentral:0,hpBonus:0,hpOffGas:9000,solar:0,attic:0,cavity:0,biomass:5000}},
  NI:{name:"Northern Ireland",cur:"£",elec:0.27,gas:0.075,oilL:0.72,lpg:0.09,pellet:0.07,solid:0.09,
    exportRate:0.08,gridCO2:0.23,solarYield:800,
    grants:{hpSystem:0,hpCentral:0,hpBonus:0,hpOffGas:0,solar:0,attic:0,cavity:0,biomass:0}},
  SCOT:{name:"Scotland",cur:"£",elec:0.26,gas:0.065,oilL:0.72,lpg:0.09,pellet:0.07,solid:0.09,
    exportRate:0.15,gridCO2:0.21,solarYield:820,
    grants:{hpSystem:7500,hpCentral:0,hpBonus:0,hpOffGas:0,solar:0,attic:1200,cavity:1300,biomass:7500}}
};

const BAND_INTENSITY={A:30,B:65,C:110,D:160,E:210,F:260,G:320};
const BAND_ORDER=["A","B","C","D","E","F","G"];
const HP_SCOP={A:3.7,B:3.5,C:3.1,D:2.6,E:2.2,F:1.9,G:1.8};
const HP_DHW_SCOP=2.6;
const BOILER_EFF={oil:0.86,gas:0.90,lpg:0.90,pellet:0.85,solid:0.70,electric:1.0};
const FUEL_CO2={elec:null,gas:0.183,oil:0.267,lpg:0.214,pellet:0.039,solid:0.34,electric:null};

function bandFromInputs(era,insul){
  const eraBase={newbuild:0,post2011:1,"2006-2010":2,"1991-2005":3,"1980-1990":4,pre1980:5}[era]??3;
  const insulAdj={excellent:-1,good:0,some:1,poor:2}[insul]??1;
  return BAND_ORDER[Math.max(0,Math.min(6,eraBase+insulAdj))];
}
function fuelPriceKWh(R,fuel){
  if(fuel==="elec"||fuel==="electric")return R.elec;
  if(fuel==="gas")return R.gas; if(fuel==="oil")return R.oilL/OIL_KWH_PER_L;
  if(fuel==="lpg")return R.lpg; if(fuel==="pellet")return R.pellet; if(fuel==="solid")return R.solid;
  return R.elec;}
const heatDemand=(b,a)=>BAND_INTENSITY[b]*a;
const dhwDemand=o=>o*700;
const baseOtherElec=o=>1800+o*450;
function boilerCost(R,fuel,sp,dhw){const eff=BOILER_EFF[fuel]??0.88;return ((sp+dhw)/eff)*fuelPriceKWh(R,fuel);}
function boilerCO2(fuel,sp,dhw){const eff=BOILER_EFF[fuel]??0.88;return ((sp+dhw)/eff)*(FUEL_CO2[fuel]??0.25);}
const hpElec=(b,sp,dhw)=>sp/HP_SCOP[b]+dhw/HP_DHW_SCOP;
function improveBand(b,s){return BAND_ORDER[Math.max(0,BAND_ORDER.indexOf(b)-s)];}
function solarBenefit(R,kWp,boost,totalElec){const gen=kWp*R.solarYield;
  const selfFrac=boost?0.55:0.38;const selfUse=Math.min(gen*selfFrac,totalElec);const exp=gen-selfUse;
  return selfUse*R.elec+exp*R.exportRate;}

/* build an effective region: 2026 defaults, with the user's edited assumptions layered on top */
function effRegion(input,overrides){
  const base=REGIONS[input.region];
  const R={...base, grants:{...base.grants}};
  if(overrides){
    if(overrides.elec>0) R.elec=overrides.elec;
    if(overrides.fuelPrice>0){const f=input.heating;
      if(f==="oil")R.oilL=overrides.fuelPrice; else if(f==="gas")R.gas=overrides.fuelPrice;
      else if(f==="lpg")R.lpg=overrides.fuelPrice; else if(f==="pellet")R.pellet=overrides.fuelPrice;
      else if(f==="solid")R.solid=overrides.fuelPrice;}
    if(overrides.grants){for(const k in overrides.grants){const v=overrides.grants[k];if(v!=null&&v!==""&&!isNaN(v))R.grants[k]=+v;}}
  }
  return R;
}

function assess(input,overrides){
  const r=effRegion(input,overrides);
  const band=(input.ber&&BAND_INTENSITY[input.ber])?input.ber:bandFromInputs(input.era,input.insulation);
  const area=input.area, occ=input.occupants, cur=input.heating;
  let space=heatDemand(band,area); const dhw=dhwDemand(occ); const otherElec=baseOtherElec(occ);
  const otherCost=otherElec*r.elec, otherCO2=otherElec*r.gridCO2;

  // Anchor to the user's real heating bill if provided (boiler fuels)
  if(input.spend>0 && cur!=="hp"){
    const eff=BOILER_EFF[cur]??0.88, price=fuelPriceKWh(r,cur);
    const impliedSpace=(input.spend/price)*eff - dhw;
    if(impliedSpace>500){ space=impliedSpace; }
  }

  let curHeat,curCO2;
  if(cur==="hp"){curHeat=hpElec(band,space,dhw)*r.elec;curCO2=hpElec(band,space,dhw)*r.gridCO2;}
  else{curHeat=boilerCost(r,cur,space,dhw);curCO2=boilerCO2(cur,space,dhw);}
  const baseRun=curHeat+otherCost, baseCO2=curCO2+otherCO2;
  const offGas=(cur==="oil"||cur==="lpg");
  const fossil=(cur==="oil"||cur==="gas"||cur==="lpg"||cur==="solid");
  const out=[];
  const mk=o=>{const net=Math.max(0,o.capital-o.grant);const save=baseRun-o.running;
    const payback=save>50?net/save:null;return {...o,net,save,payback,co2Save:baseCO2-o.co2};};

  // keep
  out.push(mk({key:"keep",label:"Keep what you have",measures:["No change — your current system"],
    capital:0,grant:0,running:baseRun,co2:baseCO2,hassle:1,futureRisk:fossil?4:2,
    work:["Nothing spent, nothing changes.","Worth comparing against — sometimes waiting a year is right.",fossil?"Note: fossil-fuel running costs face rising carbon tax to 2030.":"Your current setup is already low-carbon."]}));

  // insulate only
  if(band!=="A"&&band!=="B"){
    const nb=improveBand(band,1),sp2=heatDemand(nb,area);
    let cap=0,grant=0;
    if(input.era!=="newbuild"&&input.era!=="post2011"){cap+=input.region==="ROI"?2200:1600;grant+=r.grants.attic;}
    if(input.construction==="cavity"){cap+=input.region==="ROI"?2200:1700;grant+=r.grants.cavity;}
    if(cap===0){cap=input.region==="ROI"?2200:1600;grant+=r.grants.attic;}
    let run,co2;
    if(cur==="hp"){run=hpElec(nb,sp2,dhw)*r.elec+otherCost;co2=hpElec(nb,sp2,dhw)*r.gridCO2+otherCO2;}
    else{run=boilerCost(r,cur,sp2,dhw)+otherCost;co2=boilerCO2(cur,sp2,dhw)+otherCO2;}
    out.push(mk({key:"insul",label:"Insulate first",measures:["Attic + wall insulation"],
      capital:cap,grant,running:run,co2,hassle:2,futureRisk:fossil?4:2,
      work:["Cuts heat demand by improving your effective rating from band "+band+" to ~"+nb+".","Lowest-risk money you can spend, and it makes any future heat pump work properly.","Capital ~"+r.cur+Math.round(cap)+", grant ~"+r.cur+Math.round(grant)+"."]}));
  }

  // heat pump now (only if not already hp)
  if(cur!=="hp"){
    const k=hpElec(band,space,dhw);const run=k*r.elec+otherCost;const co2=k*r.gridCO2+otherCO2;
    let grant=0;
    if(input.region==="ROI")grant=r.grants.hpSystem+r.grants.hpCentral+(fossil||cur==="electric"?r.grants.hpBonus:0);
    else if(input.region==="GB")grant=offGas?r.grants.hpOffGas:r.grants.hpSystem;
    else if(input.region==="SCOT")grant=r.grants.hpSystem;
    const risky=["E","F","G"].includes(band);
    out.push(mk({key:"hp",label:"Heat pump now",measures:["Air-to-water heat pump"+(risky?" — before insulating":"")],
      capital:input.region==="ROI"?14500:13500,grant,running:run,co2,hassle:3,futureRisk:1,
      warn:risky?"Fitting a heat pump into a band-"+band+" home runs it inefficiently. A heat pump is only as good as the building around it — insulate first or the savings won't show up.":null,
      work:["Heat pump efficiency (SCOP) at band "+band+" is ~"+HP_SCOP[band]+".",risky?"⚠ At this efficiency the running cost can match or beat your current bill — exactly the trap to avoid.":"Decent efficiency for a heat pump at this rating.","Grant ~"+r.cur+Math.round(grant)+(input.region==="NI"?" (none — NI has no scheme for most owners).":"")]}));
  }

  // insulate + heat pump
  if(cur!=="hp"){
    const nb=improveBand(band,["E","F","G"].includes(band)?2:1),sp2=heatDemand(nb,area);
    const k=hpElec(nb,sp2,dhw);const run=k*r.elec+otherCost;const co2=k*r.gridCO2+otherCO2;
    let insCap=input.region==="ROI"?2200:1600,insGrant=r.grants.attic;
    if(input.construction==="cavity"){insCap+=input.region==="ROI"?2200:1700;insGrant+=r.grants.cavity;}
    let hpGrant=0;
    if(input.region==="ROI")hpGrant=r.grants.hpSystem+r.grants.hpCentral+(fossil?r.grants.hpBonus:0);
    else if(input.region==="GB")hpGrant=offGas?r.grants.hpOffGas:r.grants.hpSystem;
    else if(input.region==="SCOT")hpGrant=r.grants.hpSystem;
    out.push(mk({key:"insul_hp",label:"Insulate, then heat pump",measures:["Insulation upgrade","Air-to-water heat pump"],
      capital:(input.region==="ROI"?14500:13500)+insCap,grant:hpGrant+insGrant,running:run,co2,hassle:3,futureRisk:1,
      work:["Right sequence: insulate to ~band "+nb+", then size a heat pump for the lower demand.","Heat pump then runs at SCOP ~"+HP_SCOP[nb]+" instead of "+HP_SCOP[band]+" — that's the difference between disappointment and real savings.","Total grant ~"+r.cur+Math.round(hpGrant+insGrant)+(input.region==="NI"?" (NI: minimal — only 0% VAT).":"")]}));
  }

  // new like-for-like boiler (fossil)
  if(["oil","gas","lpg"].includes(cur)){
    const run=boilerCost(r,cur,space,dhw)*0.94+otherCost;
    const co2=boilerCO2(cur,space,dhw)*0.94+otherCO2;
    out.push(mk({key:"boiler",label:"New "+({oil:"oil",gas:"gas",lpg:"LPG"}[cur])+" boiler",measures:["Like-for-like efficient boiler"],
      capital:input.region==="ROI"?4000:3200,grant:0,running:run,co2,hassle:2,futureRisk:4,
      work:["Cheapest way to restore reliable heat, ~6% more efficient than an old unit.","But it locks you into fossil fuel and rising carbon costs for 15+ years.","No grant available for like-for-like fossil replacement."]}));
  }

  // solar only
  if(!input.solarAlready){
    const totalE=otherElec+(cur==="hp"?hpElec(band,space,dhw):0);
    const sb=solarBenefit(r,4.5,cur==="hp"||input.ev,totalE);
    const run=baseRun-sb;const co2=Math.max(0,baseCO2-4.5*r.solarYield*0.4*r.gridCO2);
    out.push(mk({key:"solar",label:"Solar PV",measures:["~4.5 kWp solar array"],
      capital:input.region==="ROI"?8500:7000,grant:r.grants.solar,running:run,co2,hassle:2,futureRisk:1,
      work:["~4.5 kWp generates roughly "+Math.round(4.5*r.solarYield)+" kWh/yr here.","Saves ~"+r.cur+Math.round(sb)+"/yr through self-use plus export."+(cur==="hp"||input.ev?" Your heat pump/EV soaks up more of it, improving the maths.":""),"Works best paired with a heat pump or EV; modest on its own with fossil heating."]}));
  }

  // the long game
  {
    let nb=band,sp2=space,k;
    if(cur!=="hp"){nb=improveBand(band,["E","F","G"].includes(band)?2:1);sp2=heatDemand(nb,area);k=hpElec(nb,sp2,dhw);}
    else{k=hpElec(band,space,dhw);}
    const totalE=otherElec+k;
    const sb=solarBenefit(r,5,true,totalE)*1.12;
    const run=k*r.elec+otherCost-sb;
    const co2=Math.max(0,(k+otherElec)*r.gridCO2-5*r.solarYield*0.55*r.gridCO2);
    let insCap=0,insGrant=0,hpGrant=0,hpCap=0;
    if(cur!=="hp"){
      insCap=input.region==="ROI"?2200:1600;insGrant=r.grants.attic;
      if(input.construction==="cavity"){insCap+=input.region==="ROI"?2200:1700;insGrant+=r.grants.cavity;}
      hpCap=input.region==="ROI"?14500:13500;
      hpGrant=input.region==="ROI"?r.grants.hpSystem+r.grants.hpCentral+(fossil?r.grants.hpBonus:0):(input.region==="GB"?(offGas?r.grants.hpOffGas:r.grants.hpSystem):(input.region==="SCOT"?r.grants.hpSystem:0));
    }
    const solarCap=input.solarAlready?0:(input.region==="ROI"?9500:8000);
    const cap=hpCap+insCap+solarCap+5000;
    const grant=hpGrant+insGrant+(input.solarAlready?0:r.grants.solar);
    out.push(mk({key:"full",label:"The long game",measures:[cur!=="hp"?"Insulation":"Top-up insulation",cur!=="hp"?"Heat pump":"Keep heat pump","Solar + battery"],
      capital:cap,grant,running:run,co2,hassle:4,futureRisk:1,
      work:["The full low-carbon setup: efficient fabric, heat pump, and solar+battery to self-power it.","Lowest running cost and lowest carbon of any option — but the biggest upfront outlay.","Best if you're staying put long-term and want to be largely off the grid's price swings."]}));
  }

  // confidence
  let c=1; if(input.ber)c++; if(input.spend>0)c++; if(input.construction!=="unknown")c++;
  const conf=c>=4?{label:"High confidence",band:0.07}:c>=2?{label:"Good confidence",band:0.11}:{label:"Indicative",band:0.16};
  conf.have=["House type & size","Current heating","Insulation level"];
  conf.missing=[];
  (input.ber?conf.have:conf.missing).push("Energy rating (BER/EPC)");
  (input.spend>0?conf.have:conf.missing).push("Your real heating bill");
  ((input.construction&&input.construction!=="unknown")?conf.have:conf.missing).push("Wall construction");
  conf.missing.push("Window glazing","Roof orientation");

  // scoring
  const pool=out;
  const vals=k=>pool.map(s=>s[k]);
  const norm=(v,k)=>{const a=vals(k);const mn=Math.min(...a),mx=Math.max(...a);return mx===mn?0.5:(v-mn)/(mx-mn);};
  const W={cost:{run:.34,net:.18,pay:.18,co2:.05,hassle:.10,risk:.15},
           green:{run:.18,net:.08,pay:.05,co2:.42,hassle:.10,risk:.17},
           simple:{run:.20,net:.13,pay:.10,co2:.05,hassle:.32,risk:.20}}[input.priority]||{run:.34,net:.18,pay:.18,co2:.05,hassle:.10,risk:.15};
  pool.forEach(s=>{
    const payN=s.payback==null?1:norm(Math.min(s.payback,30),"payback");
    let sc=W.run*(1-norm(s.running,"running"))+W.net*(1-norm(s.net,"net"))+W.pay*(1-payN)
          +W.co2*(1-norm(s.co2,"co2"))+W.hassle*(1-norm(s.hassle,"hassle"))+W.risk*(1-norm(s.futureRisk,"futureRisk"));
    if(s.net>input.budget && s.key!=="keep") sc*=0.45; // respect budget
    if(s.save<0 && s.key!=="keep") sc*=0.5;            // penalise options that raise bills
    s.score=sc;
  });

  // category winners
  const improving=pool.filter(s=>s.save>0);
  const byScore=[...pool].sort((a,b)=>b.score-a.score);
  const best=byScore[0];
  const cheapestRun=[...pool].sort((a,b)=>a.running-b.running)[0];
  const lowUpfront=(improving.length?[...improving]:pool).sort((a,b)=>a.net-b.net)[0];
  const greenest=[...pool].sort((a,b)=>a.co2-b.co2)[0];
  const bestPay=improving.filter(s=>s.payback!=null).sort((a,b)=>a.payback-b.payback)[0];
  pool.forEach(s=>{s.badges=[];
    if(s===cheapestRun)s.badges.push(["run","Cheapest to run"]);
    if(s===lowUpfront)s.badges.push(["up","Lowest upfront"]);
    if(s===greenest)s.badges.push(["green","Greenest"]);
    if(bestPay&&s===bestPay)s.badges.push(["pay","Fastest payback"]);
  });

  const fuelMeta=({oil:["Oil price","/L",r.oilL],gas:["Mains gas","/kWh",r.gas],lpg:["LPG","/kWh",r.lpg],pellet:["Wood pellet","/kWh",r.pellet],solid:["Solid fuel","/kWh",r.solid],electric:["Electricity","/kWh",r.elec],hp:["Electricity","/kWh",r.elec]})[cur]||["Fuel","/kWh",r.elec];
  const assumptions={
    region:input.region, cur:r.cur,
    elec:r.elec, fuelLabel:fuelMeta[0], fuelUnit:fuelMeta[1], fuelPrice:fuelMeta[2], fuelKey:cur,
    scop:HP_SCOP[band], band, solarYield:r.solarYield, exportRate:r.exportRate,
    installHP:input.region==="ROI"?14500:13500, installSolar:input.region==="ROI"?9500:8000,
    grants:{...r.grants}
  };
  return {band,baseRun,baseCO2,cur:r.cur,regionName:r.name,conf,best,
    list:byScore,mistake:pool.find(s=>s.warn),R:r,assumptions};
}

/* ---------- route map: turn the winning option into an ordered plan ---------- */
function routeFor(res,input){
  const r=res.R||REGIONS[input.region], b=res.best, band=res.band;
  const m=n=>res.cur+Math.round(n).toLocaleString();
  const leaky=["E","F","G"].includes(band);
  const cavity=input.construction==="cavity";
  const fossil=["oil","gas","lpg","solid"].includes(input.heating);
  const offGas=["oil","lpg"].includes(input.heating);
  // indicative nets, using the same constants the engine uses
  const insCap=(input.region==="ROI"?2200:1600)+(cavity?(input.region==="ROI"?2200:1700):0);
  const insGrant=r.grants.attic+(cavity?r.grants.cavity:0);
  const insNet=Math.max(0,insCap-insGrant);
  const hpCap=input.region==="ROI"?14500:13500;
  let hpGrant=0;
  if(input.region==="ROI")hpGrant=r.grants.hpSystem+r.grants.hpCentral+(fossil?r.grants.hpBonus:0);
  else if(input.region==="GB")hpGrant=offGas?r.grants.hpOffGas:r.grants.hpSystem;
  else if(input.region==="SCOT")hpGrant=r.grants.hpSystem;
  const hpNet=Math.max(0,hpCap-hpGrant);
  const solarNet=Math.max(0,(input.region==="ROI"?9500:8000)-r.grants.solar);
  const berCost=input.region==="ROI"?150:120;
  const steps=[];
  const S=(title,detail,cost,tag)=>steps.push({title,detail,cost:cost||null,tag});
  const insCostTxt=insNet>0?"~"+m(insNet)+" after grant":"grant-covered";
  switch(b.key){
    case "keep":
      S("Hold — and re-run when something changes","Your current setup is the smart call this year. Come back when fuel prices jump, the boiler nears end of life, or a grant changes.",null,"No spend now");
      break;
    case "insul":
      S("Insulate the easy wins","Attic top-up"+(cavity?" and cavity fill":"")+" — the biggest comfort gain for the least money.",insCostTxt,"Start here");
      S("Reassess in a year","With a warmer house, re-check whether a heat pump now stacks up — you'll be in a far stronger position.",null,"Then");
      break;
    case "solar":
      if(leaky) S("Tighten the house first","Cheap insulation saves more per euro than panels. Do the attic before you spend on solar.","~"+m(insNet)+" after grant","First");
      S("Confirm your roof","Check orientation (south, or east-west) and shading — a satellite map tells you most of it.",null,leaky?"Then":"Start here");
      S("Install ~4.5 kWp solar","Sized to your daytime use. Add a heat pump or EV later and it pays back faster.","~"+m(solarNet),"Then");
      break;
    case "boiler":
      S("Replace like-for-like","The cheapest way to restore reliable heat — but it locks in fossil fuel and rising carbon costs for 15+ years.","~"+m(input.region==="ROI"?4000:3200),"Note the trade-off");
      S("Insulate alongside it","Attic + cavity pays back fastest and keeps a future heat pump on the table.",insCostTxt,"Don't skip");
      break;
    case "hp":
      S("Confirm it'll run well","A BER assessment and a quick radiator check confirm the heat pump suits your home.","~"+m(berCost),"Start here");
      S("Install the heat pump","Your fabric is already good enough to run one efficiently — this is where the savings land.","~"+m(hpNet)+" after grant","Then");
      break;
    case "insul_hp":
    case "full":
      S("Insulate first","Attic top-up"+(cavity?" + cavity fill":"")+". The step everyone skips — and exactly why heat pumps disappoint. Lower the demand before you size the system.",insCostTxt,"Start here");
      S("Get a BER / EPC assessment","Unlocks the right grants and confirms the system will perform. Cheap, and often grant-aided.","~"+m(berCost),"Then");
      S("Upgrade a few radiators","Heat pumps run cooler water, so a handful of radiators may need upsizing for the same warmth.","~"+m(input.region==="ROI"?1200:1000),"Then");
      S("Install the heat pump","Now sized for your reduced demand — running far more efficiently than it would in the leaky house.","~"+m(hpNet)+" after grant","Then");
      if(b.key==="full") S("Add solar + battery","With demand low and the heat pump in, solar self-powers it and shields you from price swings.","~"+m(solarNet+5000),"Finally");
      break;
    default:
      S("Start with the cheap wins","Insulation and a BER assessment before any big kit.",null,"Start here");
  }
  return {steps,totalNet:b.net,totalSave:b.save,key:b.key};
}

/* ---------- red-flag detection: turn the engine on the installers ---------- */
function redFlags(res,input){
  const b=res.best, band=res.band, flags=[];
  const hp=["hp","insul_hp","full"].includes(b.key);
  const leaky=["E","F","G"].includes(band);
  const solar=["solar","full"].includes(b.key);
  flags.push({t:"\u201cGuaranteed savings\u201d",d:"No honest installer can promise an exact saving — your bill depends on your habits, the weather and prices. Treat a guaranteed figure as a sales line, not a fact."});
  if(hp){
    flags.push({t:"No heat-loss calculation",d:"A proper heat-pump quote includes a room-by-room heat-loss survey, not just your floor area. If the system is sized from square metres alone, walk away."});
    flags.push({t:"No radiator sizing check",d:"Heat pumps run cooler water, so some radiators usually need upsizing. A quote that never mentions radiators hasn't done the homework."});
  }
  if(hp && leaky){
    flags.push({t:"Heat pump pushed before insulation",d:"Be very wary of an installer keen to fit a heat pump into a draughty home without insulating first. It's the costliest mistake in this whole area — and it suits them, not you."});
  }
  if(solar){
    flags.push({t:"Solar quote with no roof assessment",d:"A solar quote that doesn't account for your roof's orientation and shading is guessing at your output. Insist on it before you sign."});
  }
  if(b.key==="full" && !input.ev && input.occupants<=2){
    flags.push({t:"Battery added despite low daytime use",d:"If the house is empty most of the day and there's no EV, a home battery's payback can be weak. Ask for the numbers for your usage specifically before adding one."});
  }
  const grantName=input.region==="ROI"?"SEAI":(input.region==="GB"?"Boiler Upgrade Scheme":(input.region==="SCOT"?"Home Energy Scotland":null));
  if(hp && grantName){
    flags.push({t:"Grant treated as guaranteed",d:"Grants aren't confirmed until your application is approved. Be wary of a quote that deducts the "+grantName+" grant as certain before your eligibility is checked."});
  }
  if(hp && input.region==="NI"){
    flags.push({t:"Quote assumes a grant you can't get",d:"Northern Ireland has no heat-pump grant for most owner-occupiers. Be sceptical of any quote that assumes one — confirm exactly what, if anything, you qualify for."});
  }
  return flags;
}

