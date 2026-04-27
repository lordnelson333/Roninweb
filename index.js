// PolyScout Sports Bot — TEST MODE (channel ID)

import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import fetch from "node-fetch";

const TOKEN      = process.env.DISCORD_TOKEN;
const GAMMA      = "https://gamma-api.polymarket.com";
const SITE       = "https://theronin.xyz/signals";
const CHANNEL_ID = "1498195141997891615";
const SCAN_EVERY = 30 * 1000; // 30 seconds for testing

function getYesNo(m) {
  const t = m.tokens||[];
  const yes = t.find(x=>x.outcome?.toLowerCase()==="yes");
  const no  = t.find(x=>x.outcome?.toLowerCase()==="no");
  return { yp: yes?.price??null, np: no?.price??null };
}

function daysLeft(d) {
  if(!d) return null;
  return Math.max(0, Math.ceil((new Date(d)-Date.now())/86400000));
}

function title(m) { return (m.question||m.title||"Unknown").slice(0,55); }

async function getSports() {
  const res = await fetch(
    `${GAMMA}/markets?active=true&closed=false&tag=sports&limit=100&order=volume24hr&ascending=false`,
    { headers: { "User-Agent": "PolyScout/1.0" } }
  );
  if(!res.ok) throw new Error(`API ${res.status}`);
  const d = await res.json();
  return Array.isArray(d)?d:d.markets||[];
}

function findArb(markets) {
  let best=null, bp=-99;
  for(const m of markets) {
    const {yp,np}=getYesNo(m); if(!yp||!np) continue;
    const p=parseFloat(((1-yp-np)*100).toFixed(2));
    if(p>bp){bp=p;best={m,profit:p,yp,np};}
  }
  return best;
}

function findTail(markets) {
  let best=null, by=0;
  for(const m of markets) {
    const {yp}=getYesNo(m); const d=daysLeft(m.endDate);
    if(yp&&yp>=0.70&&d!==null&&d<=30&&yp>by){by=yp;best={m,yp,d};}
  }
  return best;
}

function findWin(markets) {
  let best=null, bs=0;
  for(const m of markets) {
    const {yp}=getYesNo(m); const liq=parseFloat(m.liquidityNum||0); const vol=parseFloat(m.volume24hr||0);
    if(yp&&yp>0.05&&yp<0.70&&liq>500){const s=liq*vol;if(s>bs){bs=s;best={m,yp,liq,vol};}}
  }
  return best;
}

function findNo(markets) {
  let best=null, bv=0;
  for(const m of markets) {
    const {yp,np}=getYesNo(m); const vol=parseFloat(m.volume24hr||0);
    if(yp&&yp>0.50&&vol>1000&&vol>bv){bv=vol;best={m,yp,np,vol};}
  }
  return best;
}

const msg = {
  arb:  m => `⚡ **ARB** — ${title(m)}\n→ ${SITE}`,
  tail: m => `🎯 **TAIL** — ${title(m)}\n→ ${SITE}`,
  win:  m => `🏆 **VALUE** — ${title(m)}\n→ ${SITE}`,
  no:   m => `📉 **NO EDGE** — ${title(m)}\n→ ${SITE}`,
};

const commands = [
  new SlashCommandBuilder().setName("best").setDescription("Top picks right now"),
  new SlashCommandBuilder().setName("arb").setDescription("Best arbitrage in sports"),
  new SlashCommandBuilder().setName("tail").setDescription("Best tail-end play"),
  new SlashCommandBuilder().setName("win").setDescription("Best value odds"),
  new SlashCommandBuilder().setName("no").setDescription("Most overpriced YES"),
].map(c=>c.toJSON());

const client = new Client({ intents:[GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once("ready", async () => {
  console.log(`✅ PolyScout online as ${client.user.tag}`);
  const rest = new REST({version:"10"}).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), {body:commands});
  console.log("✅ Commands registered");
  startLoop();
});

const alerted = new Set();

async function runScan() {
  try {
    const markets = await getSports();
    const ch = await client.channels.fetch(CHANNEL_ID);
    if(!ch){ console.log("❌ Channel not found"); return; }

    const a=findArb(markets), t=findTail(markets), w=findWin(markets), n=findNo(markets);

    if(a&&!alerted.has(`arb-${a.m.id}`)){ await ch.send(msg.arb(a.m)); alerted.add(`arb-${a.m.id}`); console.log("✅ Posted ARB"); }
    if(t&&!alerted.has(`tail-${t.m.id}`)){ await ch.send(msg.tail(t.m)); alerted.add(`tail-${t.m.id}`); console.log("✅ Posted TAIL"); }
    if(w&&!alerted.has(`win-${w.m.id}`)){ await ch.send(msg.win(w.m)); alerted.add(`win-${w.m.id}`); console.log("✅ Posted WIN"); }
    if(n&&!alerted.has(`no-${n.m.id}`)){ await ch.send(msg.no(n.m)); alerted.add(`no-${n.m.id}`); console.log("✅ Posted NO EDGE"); }

    if(alerted.size>300) alerted.clear();
    console.log(`🔍 Scanned ${markets.length} markets`);
  } catch(e){ console.error("Scan error:", e.message); }
}

function startLoop() {
  runScan(); // post immediately
  setInterval(runScan, SCAN_EVERY);
}

client.on("interactionCreate", async interaction => {
  if(!interaction.isChatInputCommand()) return;
  await interaction.deferReply();
  try {
    const markets = await getSports();
    const cmd = interaction.commandName;
    if(cmd==="best") {
      const a=findArb(markets), t=findTail(markets), w=findWin(markets), n=findNo(markets);
      const lines = [a?msg.arb(a.m):null, t?msg.tail(t.m):null, w?msg.win(w.m):null, n?msg.no(n.m):null].filter(Boolean);
      await interaction.editReply(lines.length ? lines.join("\n\n") : `No signals right now.\n→ ${SITE}`);
    }
    else if(cmd==="arb"){  const a=findArb(markets);  await interaction.editReply(a?msg.arb(a.m) :`No arb → ${SITE}`); }
    else if(cmd==="tail"){ const t=findTail(markets); await interaction.editReply(t?msg.tail(t.m):`No tail → ${SITE}`); }
    else if(cmd==="win"){  const w=findWin(markets);  await interaction.editReply(w?msg.win(w.m) :`No value → ${SITE}`); }
    else if(cmd==="no"){   const n=findNo(markets);   await interaction.editReply(n?msg.no(n.m)  :`No NO edge → ${SITE}`); }
  } catch(e){ await interaction.editReply("❌ Error. Try again."); }
});

client.login(TOKEN);
