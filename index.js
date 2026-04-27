// PolyScout Bot — Sports, Politics, Crypto, Economy
// theronin.xyz/signals

import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import fetch from "node-fetch";

const TOKEN      = process.env.DISCORD_TOKEN;
const GAMMA      = "https://gamma-api.polymarket.com";
const SITE       = "https://theronin.xyz/signals";
const CHANNEL_ID = "1498195141997891615";
const SCAN_EVERY = 5 * 60 * 1000; // 5 minutes

const CATEGORIES = [
  { tag: "sports",   emoji: "⚽", label: "SPORTS"   },
  { tag: "politics", emoji: "🗳️", label: "POLITICS" },
  { tag: "crypto",   emoji: "💰", label: "CRYPTO"   },
  { tag: "economy",  emoji: "💼", label: "ECONOMY"  },
];

// ── price reader ──────────────────────────────────────────────
function getPrices(m) {
  try {
    if (m.outcomePrices) {
      const prices = JSON.parse(m.outcomePrices);
      if (prices.length >= 2) {
        const p0 = parseFloat(prices[0]);
        const p1 = parseFloat(prices[1]);
        return { p0, p1, best: Math.max(p0,p1), worst: Math.min(p0,p1) };
      }
    }
    const t = m.tokens||[];
    if (t.length >= 2) {
      const p0 = t[0]?.price ?? 0;
      const p1 = t[1]?.price ?? 0;
      return { p0, p1, best: Math.max(p0,p1), worst: Math.min(p0,p1) };
    }
  } catch(e) {}
  return null;
}

function daysLeft(d) {
  if(!d) return null;
  return Math.max(0, Math.ceil((new Date(d)-Date.now())/86400000));
}

function title(m) { return (m.question||m.title||"Unknown").slice(0,55); }

// ── fetch by category ─────────────────────────────────────────
async function fetchCategory(tag) {
  const res = await fetch(
    `${GAMMA}/markets?active=true&closed=false&tag=${tag}&limit=100&order=volume24hr&ascending=false`,
    { headers: { "User-Agent": "PolyScout/1.0" } }
  );
  if(!res.ok) throw new Error(`API ${res.status}`);
  const d = await res.json();
  return Array.isArray(d)?d:d.markets||[];
}

async function fetchAll() {
  const results = await Promise.all(
    CATEGORIES.map(async c => {
      const markets = await fetchCategory(c.tag);
      return markets.map(m => ({ ...m, _cat: c }));
    })
  );
  return results.flat();
}

// ── strategy finders ──────────────────────────────────────────
function findArb(markets) {
  let best=null, bp=0;
  for(const m of markets) {
    const p=getPrices(m); if(!p) continue;
    const profit=parseFloat(((1-p.p0-p.p1)*100).toFixed(2));
    if(profit>bp){bp=profit;best={m,profit,p0:p.p0,p1:p.p1};}
  }
  return best;
}

function findTail(markets) {
  let best=null, by=0;
  for(const m of markets) {
    const p=getPrices(m); if(!p) continue;
    const d=daysLeft(m.endDate);
    if(p.best>=0.93&&d!==null&&d<=7&&p.best>by){by=p.best;best={m,yp:p.best,d};}
  }
  return best;
}

function findWin(markets) {
  let best=null, bs=0;
  for(const m of markets) {
    const p=getPrices(m); if(!p) continue;
    const liq=parseFloat(m.liquidityNum||0);
    const vol=parseFloat(m.volume24hr||0);
    if(p.worst>0.05&&p.worst<0.45&&liq>5000){
      const s=liq*vol;
      if(s>bs){bs=s;best={m,yp:p.worst};}
    }
  }
  return best;
}

function findNo(markets) {
  let best=null, bv=0;
  for(const m of markets) {
    const p=getPrices(m); if(!p) continue;
    const vol=parseFloat(m.volume24hr||0);
    if(p.best>0.62&&p.best<0.90&&vol>5000&&vol>bv){bv=vol;best={m,yp:p.best,np:p.worst,vol};}
  }
  return best;
}

// ── alert messages with category tag ─────────────────────────
function catTag(m) { return m._cat ? `[${m._cat.label}]` : ""; }

const msg = {
  arb:  m => `⚡ **ARB** ${catTag(m)} — ${title(m)}\n→ ${SITE}`,
  tail: m => `🎯 **TAIL** ${catTag(m)} — ${title(m)}\n→ ${SITE}`,
  win:  m => `🏆 **VALUE** ${catTag(m)} — ${title(m)}\n→ ${SITE}`,
  no:   m => `📉 **NO EDGE** ${catTag(m)} — ${title(m)}\n→ ${SITE}`,
};

// ── slash commands ────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder().setName("best").setDescription("Top picks across all categories"),
  new SlashCommandBuilder().setName("arb").setDescription("Best arbitrage right now"),
  new SlashCommandBuilder().setName("tail").setDescription("Best tail-end play"),
  new SlashCommandBuilder().setName("win").setDescription("Best value odds"),
  new SlashCommandBuilder().setName("no").setDescription("Most overpriced favourite"),
  new SlashCommandBuilder().setName("sports").setDescription("Best sports signal"),
  new SlashCommandBuilder().setName("politics").setDescription("Best politics signal"),
  new SlashCommandBuilder().setName("crypto").setDescription("Best crypto signal"),
  new SlashCommandBuilder().setName("economy").setDescription("Best economy signal"),
].map(c=>c.toJSON());

// ── bot ───────────────────────────────────────────────────────
const client = new Client({ intents:[GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once("ready", async () => {
  console.log(`✅ PolyScout online as ${client.user.tag}`);
  const rest = new REST({version:"10"}).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), {body:commands});
  console.log("✅ Commands registered");
  startLoop();
});

// ── auto scan ─────────────────────────────────────────────────
const alerted = new Set();

async function runScan() {
  try {
    const markets = await fetchAll();
    const ch = await client.channels.fetch(CHANNEL_ID);
    if(!ch){ console.log("❌ Channel not found"); return; }

    const a=findArb(markets);
    const t=findTail(markets);
    const n=findNo(markets);

    if(a&&!alerted.has(`arb-${a.m.id}`)){ await ch.send(msg.arb(a.m)); alerted.add(`arb-${a.m.id}`); console.log(`✅ ARB [${a.m._cat?.label}]: ${title(a.m)}`); }
    if(t&&!alerted.has(`tail-${t.m.id}`)){ await ch.send(msg.tail(t.m)); alerted.add(`tail-${t.m.id}`); console.log(`✅ TAIL [${t.m._cat?.label}]: ${title(t.m)}`); }
    if(n&&!alerted.has(`no-${n.m.id}`)){ await ch.send(msg.no(n.m)); alerted.add(`no-${n.m.id}`); console.log(`✅ NO [${n.m._cat?.label}]: ${title(n.m)}`); }

    if(alerted.size>500) alerted.clear();
    console.log(`🔍 Scanned ${markets.length} markets across 4 categories`);
  } catch(e){ console.error("Scan error:", e.message); }
}

function startLoop() {
  runScan();
  setInterval(runScan, SCAN_EVERY);
}

// ── slash command handler ─────────────────────────────────────
client.on("interactionCreate", async interaction => {
  if(!interaction.isChatInputCommand()) return;
  await interaction.deferReply();
  try {
    const cmd = interaction.commandName;

    // category-specific commands
    const catCmd = CATEGORIES.find(c => c.tag === cmd);
    if(catCmd) {
      const markets = (await fetchCategory(catCmd.tag)).map(m=>({...m,_cat:catCmd}));
      const a=findArb(markets), t=findTail(markets), w=findWin(markets), n=findNo(markets);
      const lines = [
        a?msg.arb(a.m):null, t?msg.tail(t.m):null,
        w?msg.win(w.m):null, n?msg.no(n.m):null,
      ].filter(Boolean);
      await interaction.editReply(lines.length?lines.join("\n\n"):`No signals in ${catCmd.label} right now.\n→ ${SITE}`);
      return;
    }

    const markets = await fetchAll();

    if(cmd==="best") {
      const a=findArb(markets), t=findTail(markets), w=findWin(markets), n=findNo(markets);
      const lines = [
        a?msg.arb(a.m):null, t?msg.tail(t.m):null,
        w?msg.win(w.m):null, n?msg.no(n.m):null,
      ].filter(Boolean);
      await interaction.editReply(lines.length?lines.join("\n\n"):`No signals right now.\n→ ${SITE}`);
    }
    else if(cmd==="arb"){  const a=findArb(markets);  await interaction.editReply(a?msg.arb(a.m) :`No arb right now → ${SITE}`); }
    else if(cmd==="tail"){ const t=findTail(markets); await interaction.editReply(t?msg.tail(t.m):`No tail plays → ${SITE}`); }
    else if(cmd==="win"){  const w=findWin(markets);  await interaction.editReply(w?msg.win(w.m) :`No value plays → ${SITE}`); }
    else if(cmd==="no"){   const n=findNo(markets);   await interaction.editReply(n?msg.no(n.m)  :`No NO edge → ${SITE}`); }

  } catch(e){ await interaction.editReply("❌ Error fetching data. Try again."); }
});

client.login(TOKEN);
