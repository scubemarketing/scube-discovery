import { useState, useRef } from "react";

const C = {
  navy:"#2E4FC0",  navyL:"#EEF1FB",
  pink:"#FF3C66",  pinkL:"#FFF0F3",
  teal:"#00A3A2",  tealL:"#E6F6F6",
  orange:"#F27643",orangeL:"#FEF3ED",
  dark:"#1A1A1A",  gray:"#333333",
  mid:"#666666",   light:"#F5F5F5",
  border:"#DDDDDD",white:"#FFFFFF",
};

// ─── Tiny UI components ────────────────────────────────────────────────────────

function Badge({ label, col, bg }) {
  return (
    <span style={{
      display:"inline-block", padding:"2px 9px", borderRadius:3,
      fontSize:11, fontWeight:700, letterSpacing:"0.4px",
      color:col, background:bg, marginRight:4, marginBottom:4,
    }}>{label}</span>
  );
}

function SHead({ title, col }) {
  return (
    <div style={{
      fontSize:11, fontWeight:700, letterSpacing:"1px",
      color:col||C.navy, textTransform:"uppercase",
      borderBottom:`2px solid ${col||C.navy}`,
      paddingBottom:4, marginBottom:12,
    }}>{title}</div>
  );
}

function InfoRow({ label, value, accent }) {
  return (
    <div style={{ display:"flex", gap:10, padding:"5px 0", borderBottom:`1px solid ${C.border}` }}>
      <div style={{ width:148, flexShrink:0, fontSize:12, color:C.mid, fontWeight:600 }}>{label}</div>
      <div style={{ fontSize:13, color:accent||C.gray, flex:1 }}>{value||"—"}</div>
    </div>
  );
}

function Field({ name, label, placeholder, form, update, multi, span2 }) {
  const s = {
    width:"100%", padding:"8px 11px",
    border:`1px solid ${C.border}`, borderRadius:4,
    fontSize:13, color:C.dark, outline:"none",
    boxSizing:"border-box", fontFamily:"inherit",
    background: form[name] ? C.white : C.light,
    transition:"background 0.15s",
  };
  return (
    <div style={span2 ? { gridColumn:"1 / -1" } : {}}>
      <label style={{ display:"block", fontSize:12, fontWeight:600, color:C.gray, marginBottom:4 }}>{label}</label>
      {multi
        ? <textarea name={name} value={form[name]} onChange={update} placeholder={placeholder} rows={3} style={{ ...s, resize:"vertical" }} />
        : <input    name={name} value={form[name]} onChange={update} placeholder={placeholder} style={s} />
      }
    </div>
  );
}

// ─── Presence / confidence / goal colours ────────────────────────────────────

const presCol = {
  strong:   { col:C.teal,   bg:C.tealL   },
  moderate: { col:C.orange, bg:C.orangeL },
  weak:     { col:C.pink,   bg:C.pinkL   },
  absent:   { col:C.pink,   bg:C.pinkL   },
};
const confCol = {
  high:   { col:C.teal,   bg:C.tealL   },
  medium: { col:C.orange, bg:C.orangeL },
  low:    { col:C.mid,    bg:C.light   },
};
const goalMeta = {
  realistic:             { col:C.teal,   bg:C.tealL,   lbl:"Realistic"              },
  aggressive:            { col:C.orange, bg:C.orangeL, lbl:"Aggressive but possible" },
  requires_conversation: { col:C.pink,   bg:C.pinkL,   lbl:"Requires conversation"  },
};

// ─── Raw data panel ────────────────────────────────────────────

// Classify a result into one of three buckets:
//   A = prospect's own direct listing (seller/link matches their domain)
//   B = retailer carrying the prospect's brand (brand in title, different seller)
//   C = competitor
function classifyResult(r, domain, brandName) {
  const domainRoot = (domain || "").replace(/\.(com|net|co|io|org|us).*$/, "");
  const sellerL = (r.seller || "").toLowerCase();
  const titleL  = (r.title  || "").toLowerCase();
  const linkL   = (r.link   || "").toLowerCase();
  const brandL  = (brandName || "").toLowerCase();
  const domainL = domainRoot.toLowerCase();
  const isOwn   = sellerL.includes(domainL) || linkL.includes((domain || "").toLowerCase());
  if (isOwn) return "A";
  if (titleL.includes(brandL) || sellerL.includes(brandL)) return "B";
  return "C";
}

const bucketStyle = {
  A: { bg:C.tealL,        badge:"DIRECT",     badgeCol:C.teal, priceCol:C.teal   },
  B: { bg:C.navyL,        badge:"RETAILER",   badgeCol:C.navy, priceCol:C.navy   },
  C: { bg:"transparent",  badge:"COMPETITOR", badgeCol:C.mid,  priceCol:C.gray   },
};

function ShoppingTable({ data, label, purpose, domain, brandName }) {
  if (!data) return null;
  const results = data.results || [];
  const counts = { A:0, B:0, C:0 };
  results.forEach(r => { const b = classifyResult(r, domain, brandName); counts[b]++; });

  return (
    <div style={{ marginBottom:20 }}>
      <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:6, flexWrap:"wrap" }}>
        <div style={{ fontSize:12, fontWeight:700, color:C.navy }}>{label}</div>
        <div style={{ fontSize:11, color:C.mid, fontStyle:"italic" }}>{purpose}</div>
        <div style={{ fontSize:11, color:C.mid, marginLeft:"auto" }}>query: "{data.query}"</div>
      </div>
      {results.length > 0 ? (
        <>
          <div style={{ display:"flex", gap:8, marginBottom:8, flexWrap:"wrap" }}>
            <span style={{ fontSize:11, fontWeight:700, color:C.teal, background:C.tealL, padding:"2px 8px", borderRadius:3 }}>
              {counts.A} Direct (own domain)
            </span>
            <span style={{ fontSize:11, fontWeight:700, color:C.navy, background:C.navyL, padding:"2px 8px", borderRadius:3 }}>
              {counts.B} Retailer (carrying brand)
            </span>
            <span style={{ fontSize:11, fontWeight:700, color:C.mid, background:C.light, padding:"2px 8px", borderRadius:3 }}>
              {counts.C} Competitor
            </span>
          </div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:C.light }}>
                  {["#","Type","Product","Price","Seller","Rating"].map(h => (
                    <th key={h} style={{ padding:"5px 8px", textAlign:"left", color:C.mid, fontWeight:600, borderBottom:`1px solid ${C.border}`, whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const bucket = classifyResult(r, domain, brandName);
                  const st = bucketStyle[bucket];
                  return (
                    <tr key={i} style={{ borderBottom:`1px solid ${C.border}`, background:st.bg }}>
                      <td style={{ padding:"5px 8px", color:C.mid, fontWeight:700 }}>{r.position}</td>
                      <td style={{ padding:"5px 8px", whiteSpace:"nowrap" }}>
                        <span style={{ fontSize:10, fontWeight:700, color:st.badgeCol, background:st.bg, padding:"1px 6px", borderRadius:2, border:`1px solid ${st.badgeCol}40` }}>
                          {st.badge}
                        </span>
                      </td>
                      <td style={{ padding:"5px 8px", color:C.dark, maxWidth:220, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={r.title}>{r.title}</td>
                      <td style={{ padding:"5px 8px", color:st.priceCol, fontWeight: bucket === "A" ? 700 : 400 }}>{r.price || "—"}</td>
                      <td style={{ padding:"5px 8px", color:C.gray }}>{r.seller || "—"}</td>
                      <td style={{ padding:"5px 8px", color:C.gray, whiteSpace:"nowrap" }}>{r.rating ? `${r.rating}★ (${r.reviews||0})` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div style={{ fontSize:12, color:C.mid, fontStyle:"italic", padding:"6px 0" }}>
          No results.{data.error && ` Error: ${data.error}`}
        </div>
      )}
    </div>
  );
}

function RawDataPanel({ raw }) {
  const [open, setOpen] = useState(false);
  if (!raw) return null;
  const brandName = raw.brand_name || "";
  const queries   = raw.queries   || {};

  return (
    <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:6, marginBottom:16 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width:"100%", background:"none", border:"none", padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer" }}
      >
        <span style={{ fontSize:11, fontWeight:700, color:C.mid, letterSpacing:"1px", textTransform:"uppercase" }}>
          Raw Search Data — {brandName} — 3 Shopping searches + Ads Transparency + SERP
        </span>
        <span style={{ fontSize:13, color:C.mid }}>{open ? "▲ hide" : "▼ show"}</span>
      </button>

      {open && (
        <div style={{ padding:"0 16px 20px", borderTop:`1px solid ${C.border}` }}>

          {/* Queries used */}
          <div style={{ marginTop:14, background:C.navyL, borderRadius:4, padding:"10px 14px", fontSize:12 }}>
            <div style={{ fontWeight:700, color:C.navy, marginBottom:6 }}>Queries generated by Claude</div>
            <div style={{ color:C.gray }}>Q1 Brand: <strong>"{queries.q1}"</strong> — finds prospect's own listings</div>
            <div style={{ color:C.gray }}>Q2 Category: <strong>"{queries.q2}"</strong> — finds category competitors</div>
            <div style={{ color:C.gray }}>Q3 Product: <strong>"{queries.q3}"</strong> — specific product pricing</div>
            <div style={{ marginTop:6, display:"flex", gap:8, flexWrap:"wrap" }}>
              <span style={{ fontSize:11, fontWeight:700, color:C.teal, background:C.tealL, padding:"2px 8px", borderRadius:3 }}>DIRECT = prospect's own domain as seller</span>
              <span style={{ fontSize:11, fontWeight:700, color:C.navy, background:C.navyL, padding:"2px 8px", borderRadius:3 }}>RETAILER = third party carrying their brand</span>
              <span style={{ fontSize:11, fontWeight:700, color:C.mid, background:C.light, padding:"2px 8px", borderRadius:3 }}>COMPETITOR = neither</span>
            </div>
          </div>

          {/* Three Shopping searches */}
          <div style={{ marginTop:16 }}>
            <SHead title="Google Shopping — 3 Searches" col={C.navy} />
            <ShoppingTable data={raw.shopping && raw.shopping.brand}    label="Search 1: Brand"    purpose="Did prospect's own listings appear?" domain={raw.domain} brandName={brandName} />
            <ShoppingTable data={raw.shopping && raw.shopping.category} label="Search 2: Category" purpose="Who wins the category?" domain={raw.domain} brandName={brandName} />
            <ShoppingTable data={raw.shopping && raw.shopping.product}  label="Search 3: Product"  purpose="Specific product pricing" domain={raw.domain} brandName={brandName} />
          </div>

          {/* Ads Transparency */}
          <div style={{ marginTop:16 }}>
            <SHead title={`Google Ads Transparency — ${raw.domain}`} col={C.pink} />
            <div style={{ fontSize:13, color:C.gray, marginBottom:8 }}>
              Active ads: <strong>{(raw.ads && raw.ads.count) || 0}</strong>
              {raw.ads && raw.ads.verified && <span style={{ marginLeft:10, color:C.teal, fontWeight:600 }}>✓ Verified advertiser</span>}
              {raw.ads && raw.ads.advertiser_name && <span style={{ marginLeft:10, color:C.mid }}>Name on file: {raw.ads.advertiser_name}</span>}
            </div>
            {raw.ads && raw.ads.ads && raw.ads.ads.length > 0 ? (
              raw.ads.ads.map((a, i) => (
                <div key={i} style={{ background:C.pinkL, borderRadius:3, padding:"8px 12px", marginBottom:6, fontSize:12 }}>
                  <span style={{ fontWeight:700, color:C.pink, marginRight:8 }}>{a.format}</span>
                  {a.headline && <span style={{ color:C.dark }}>&quot;{a.headline}&quot;</span>}
                  {(a.first_shown || a.last_shown) && (
                    <span style={{ color:C.mid, marginLeft:8 }}>
                      {a.first_shown && `First: ${a.first_shown}`}
                      {a.last_shown  && ` · Last: ${a.last_shown}`}
                    </span>
                  )}
                </div>
              ))
            ) : (
              <div style={{ fontSize:13, color:C.mid, fontStyle:"italic" }}>
                No ad creatives found.{raw.ads && raw.ads.error && ` (${raw.ads.error})`}
              </div>
            )}
          </div>

          {/* SERP */}
          <div style={{ marginTop:16 }}>
            <SHead title={`Google SERP — "${raw.domain}"`} col={C.orange} />
            {raw.serp && raw.serp.shopping_ads && raw.serp.shopping_ads.length > 0 && (
              <div style={{ marginBottom:8 }}>
                <div style={{ fontSize:12, color:C.mid, marginBottom:4 }}>Shopping ads at top of SERP:</div>
                {raw.serp.shopping_ads.map((a, i) => (
                  <div key={i} style={{ fontSize:12, color:C.gray, marginBottom:2 }}>
                    <span style={{ color:C.teal, fontWeight:700, marginRight:6 }}>#{a.position}</span>
                    {a.title} {a.price && <span style={{ color:C.orange }}>— {a.price}</span>}
                    {a.seller && <span style={{ color:C.mid }}> ({a.seller})</span>}
                  </div>
                ))}
              </div>
            )}
            {raw.serp && raw.serp.knowledge_graph && (
              <div style={{ background:C.orangeL, borderRadius:3, padding:"8px 12px", fontSize:12, color:C.gray }}>
                <strong>Knowledge Graph:</strong> {raw.serp.knowledge_graph.title} — {raw.serp.knowledge_graph.type}
                {raw.serp.knowledge_graph.rating && ` — ${raw.serp.knowledge_graph.rating}★ (${raw.serp.knowledge_graph.reviews} reviews)`}
              </div>
            )}
            {raw.serp && raw.serp.ads && raw.serp.ads.length > 0 && (
              <div style={{ marginTop:8, fontSize:12, color:C.mid }}>
                Text ads ({raw.serp.ads.length}): {raw.serp.ads.map(a => a.title).join(", ")}
              </div>
            )}
            {(!raw.serp || (!raw.serp.shopping_ads?.length && !raw.serp.knowledge_graph)) && (
              <div style={{ fontSize:13, color:C.mid, fontStyle:"italic" }}>No notable SERP signals found.</div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

// ─── Copy text builder ────────────────────────────────────────────────────────

function buildCopyText(r, form) {
  return [
    "SCUBE DISCOVERY PREP BRIEF",
    `Prospect: ${form.name} | ${form.website}`,
    `Date: ${new Date().toLocaleDateString()}`,
    "",
    "COMPANY",
    r.company_summary,
    "",
    "ACCOUNT SIGNALS (real data)",
    `Platform: ${r.platform}`,
    `Catalog estimate: ${r.catalog_estimate}`,
    `AOV estimate: ${r.aov_estimate}`,
    `Spend estimate: ${r.spend_estimate}`,
    `Shopping presence: ${r.shopping_presence}`,
    `Shopping position: ${r.shopping_position}`,
    `Ads activity: ${r.ads_activity}`,
    `Ads finding: ${r.ads_finding}`,
    `Competitors: ${(r.competitor_names||[]).join(", ")||"none identified"}`,
    `Competitor advantage: ${r.competitor_advantage}`,
    `Previous agency: ${r.previous_agency_signals}`,
    "",
    "SCENARIO",
    `Primary: #${r.scenario_primary?.number} ${r.scenario_primary?.name} (${r.scenario_primary?.confidence})`,
    r.scenario_primary?.reasoning,
    r.scenario_secondary ? `Also possible: #${r.scenario_secondary?.number} ${r.scenario_secondary?.name} — ${r.scenario_secondary?.reasoning}` : "",
    "",
    "WORKING HYPOTHESIS",
    r.working_hypothesis,
    "",
    `GOAL ASSESSMENT: ${goalMeta[r.goal_assessment]?.lbl || r.goal_assessment}`,
    r.goal_reasoning,
    "",
    `AUDIENCE TYPE: ${r.audience_type?.replace(/_/g," ")}`,
    r.audience_reasoning,
    "",
    ...(r.red_flags?.filter(Boolean).length ? ["RED FLAGS", ...r.red_flags.filter(Boolean).map(f=>`- ${f}`), ""] : []),
    "DISCOVERY QUESTIONS",
    ...(r.discovery_questions||[]).map(q=>`${q.priority}. ${q.question}\n   Why: ${q.why}`),
    "",
    "PERSONAL COST ANGLE",
    r.personal_cost_angle,
    "",
    "WHY SCUBE HOOK",
    r.why_scube_hook,
  ].filter(l => l !== undefined).join("\n");
}

// ─── Main app ─────────────────────────────────────────────────────────────────

export default function App() {
  const [form, setForm] = useState({
    name:"", email:"", phone:"", website:"", goal:"", productQuery:"", details:"",
  });
  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState("");
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState(null);
  const [copied,  setCopied]  = useState(false);
  const ref = useRef(null);

  const update = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  const canRun = form.website.trim() && form.name.trim() && form.goal.trim() && !loading;

  const LOAD_MSGS = [
    "Identifying brand name and search queries...",
    "Searching Google Shopping for brand listings...",
    "Searching Google Shopping for category competitors...",
    "Checking Google Ads Transparency Center...",
    "Running SERP analysis...",
    "Interpreting all data and building brief...",
  ];

  async function run() {
    setLoading(true); setResult(null); setError(null);
    let idx = 0;
    setLoadMsg(LOAD_MSGS[0]);
    const ticker = setInterval(() => {
      idx = (idx + 1) % LOAD_MSGS.length;
      setLoadMsg(LOAD_MSGS[idx]);
    }, 2400);

    try {
      const res  = await fetch("/api/prep", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data);
      setTimeout(() => ref.current?.scrollIntoView({ behavior:"smooth" }), 100);
    } catch (e) {
      setError(e.message || "Something went wrong.");
    } finally {
      clearInterval(ticker);
      setLoading(false);
    }
  }

  function copy() {
    if (!result) return;
    navigator.clipboard.writeText(buildCopyText(result, form))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); });
  }

  return (
    <div style={{ minHeight:"100vh", background:"#F8F8F9", fontFamily:"'DM Sans','Helvetica Neue',Helvetica,sans-serif" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ background:C.dark, padding:"14px 28px", display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontWeight:800, fontSize:18, color:C.pink }}>SCUBE</span>
        <span style={{ fontWeight:300, fontSize:18, color:C.white }}>Discovery Prep</span>
        <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
          {["Google Shopping","Ads Transparency","Claude"].map(s => (
            <span key={s} style={{ fontSize:11, color:"#888", background:"#2A2A2A", padding:"3px 9px", borderRadius:4 }}>{s}</span>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:920, margin:"0 auto", padding:"28px 20px" }}>

        {/* ── Intro ──────────────────────────────────────────────────────────── */}
        <div style={{ background:C.navyL, borderLeft:`4px solid ${C.navy}`, borderRadius:4, padding:"12px 16px", marginBottom:22, fontSize:13, color:C.navy }}>
          <strong>How this works:</strong> Paste the prospect's intake form. The tool fires three live API calls in parallel — Google Shopping for competitive pricing, Google Ads Transparency for their active ad creatives, and SERP for branded presence — then sends all the real data to Claude to produce a data-backed pre-call brief. Output maps to Document 2 of the Sales System.
        </div>

        {/* ── Form ───────────────────────────────────────────────────────────── */}
        <div style={{ background:C.white, borderRadius:6, border:`1px solid ${C.border}`, padding:24, marginBottom:22 }}>
          <SHead title="Prospect Intake Form" col={C.navy} />
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <Field name="name"         label="Contact Name *"    placeholder="Brad Smith"            form={form} update={update} />
            <Field name="email"        label="Email"             placeholder="brad@company.com"      form={form} update={update} />
            <Field name="phone"        label="Phone"             placeholder="+1 (312) 555-0100"     form={form} update={update} />
            <Field name="website"      label="Website *"         placeholder="https://company.com"   form={form} update={update} />
            <Field name="goal"         label="Goal *"            placeholder="e.g. Grow Google Ads revenue from $80K to $200K/month while maintaining efficiency" form={form} update={update} span2 />
            <Field name="productQuery" label="Product Search Query — optional, improves Shopping data" placeholder="e.g. alternator, HVAC parts, car floor mats — what to search in Google Shopping" form={form} update={update} span2 />
            <Field name="details"      label="Additional Details" placeholder="Previous agency, catalog size, current challenges, anything else from the intake form..." form={form} update={update} multi span2 />
          </div>
          <div style={{ marginTop:18, display:"flex", alignItems:"center", gap:14 }}>
            <button
              onClick={run} disabled={!canRun}
              style={{
                background: canRun ? C.navy : "#BBBBBB",
                color:C.white, border:"none",
                padding:"11px 30px", borderRadius:4,
                fontSize:14, fontWeight:700,
                cursor: canRun ? "pointer" : "default",
                transition:"background 0.2s",
              }}
            >
              {loading ? "Running…" : "Run Discovery Prep"}
            </button>
            {!canRun && !loading && (
              <span style={{ fontSize:12, color:C.mid }}>Name, website, and goal are required</span>
            )}
          </div>
        </div>

        {/* ── Loading ────────────────────────────────────────────────────────── */}
        {loading && (
          <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:6, padding:36, textAlign:"center" }}>
            <div style={{ fontSize:14, color:C.navy, fontWeight:600, marginBottom:6 }}>{loadMsg}</div>
            <div style={{ fontSize:12, color:C.mid }}>Collecting real data for {form.website}</div>
            <div style={{ marginTop:16, height:3, background:C.light, borderRadius:2, overflow:"hidden" }}>
              <div style={{ height:"100%", width:"28%", background:C.navy, borderRadius:2, animation:"slide 1.6s ease-in-out infinite" }} />
            </div>
            <style>{`@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(440%)}}`}</style>
          </div>
        )}

        {/* ── Error ──────────────────────────────────────────────────────────── */}
        {error && (
          <div style={{ background:C.pinkL, borderLeft:`4px solid ${C.pink}`, borderRadius:4, padding:"12px 16px", fontSize:13, color:C.pink }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* ── Result ─────────────────────────────────────────────────────────── */}
        {result && (
          <div ref={ref}>

            {/* Result header */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
              <div>
                <div style={{ fontSize:18, fontWeight:700, color:C.dark }}>{form.name}</div>
                <div style={{ fontSize:13, color:C.navy }}>{form.website}</div>
              </div>
              <button
                onClick={copy}
                style={{ background:C.teal, color:C.white, border:"none", padding:"8px 18px", borderRadius:4, fontSize:13, fontWeight:600, cursor:"pointer" }}
              >
                {copied ? "Copied!" : "Copy Brief"}
              </button>
            </div>

            {/* Collapsible raw data */}
            <RawDataPanel raw={result._raw} />

            {/* Company summary */}
            <div style={{ background:C.dark, borderRadius:6, padding:20, marginBottom:16 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"#888", letterSpacing:"1px", marginBottom:8 }}>COMPANY OVERVIEW</div>
              <div style={{ fontSize:14, color:C.white, lineHeight:1.65 }}>{result.company_summary}</div>
            </div>

            {/* Signals + Scenario side by side */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>

              <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:6, padding:20 }}>
                <SHead title="Account Signals — Real Data" col={C.navy} />
                <InfoRow label="Platform"         value={result.platform} />
                <InfoRow label="Catalog estimate" value={result.catalog_estimate} />
                <InfoRow label="AOV estimate"     value={result.aov_estimate} />
                <InfoRow label="Spend estimate"   value={result.spend_estimate} />
                <InfoRow label="Shopping"
                  value={result.shopping_presence}
                  accent={presCol[result.shopping_presence?.toLowerCase()]?.col || C.gray} />
                <InfoRow label="Ads activity"     value={result.ads_activity} />
                <InfoRow label="Previous agency"  value={result.previous_agency_signals} />
              </div>

              <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:6, padding:20 }}>
                <SHead title="Scenario Identification" col={C.pink} />

                {/* Primary */}
                <div style={{ background:C.pinkL, border:`1px solid ${C.pink}22`, borderRadius:4, padding:14, marginBottom:10 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                    <div style={{
                      width:26, height:26, borderRadius:"50%",
                      background:C.pink, color:C.white,
                      fontSize:12, fontWeight:800,
                      display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
                    }}>{result.scenario_primary?.number}</div>
                    <div style={{ fontWeight:700, fontSize:13, color:C.dark, flex:1 }}>
                      {result.scenario_primary?.name}
                    </div>
                    <Badge
                      label={(result.scenario_primary?.confidence||"").toUpperCase()}
                      col={confCol[result.scenario_primary?.confidence]?.col||C.mid}
                      bg={confCol[result.scenario_primary?.confidence]?.bg||C.light}
                    />
                  </div>
                  <div style={{ fontSize:13, color:C.gray, lineHeight:1.5 }}>
                    {result.scenario_primary?.reasoning}
                  </div>
                </div>

                {/* Secondary */}
                {result.scenario_secondary && (
                  <div style={{ background:C.light, borderRadius:4, padding:"9px 12px", marginBottom:12 }}>
                    <div style={{ fontSize:11, color:C.mid, marginBottom:3 }}>Also possible</div>
                    <div style={{ fontSize:13, color:C.gray }}>
                      <strong>#{result.scenario_secondary.number} {result.scenario_secondary.name}</strong>
                      {" — "}{result.scenario_secondary.reasoning}
                    </div>
                  </div>
                )}

                {/* Tags */}
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
                  {result.goal_assessment && (
                    <Badge
                      label={"Goal: " + (goalMeta[result.goal_assessment]?.lbl || result.goal_assessment)}
                      col={goalMeta[result.goal_assessment]?.col || C.mid}
                      bg={goalMeta[result.goal_assessment]?.bg  || C.light}
                    />
                  )}
                  {result.audience_type && (
                    <Badge label={"Audience: " + result.audience_type.replace(/_/g," ")} col={C.navy} bg={C.navyL} />
                  )}
                </div>
                <div style={{ fontSize:12, color:C.mid, lineHeight:1.5 }}>{result.goal_reasoning}</div>
              </div>
            </div>

            {/* Competitive intelligence */}
            <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:6, padding:20, marginBottom:16 }}>
              <SHead title="Competitive Intelligence — From Google Shopping + Ads Transparency" col={C.teal} />
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
                <div>
                  <div style={{ fontSize:12, fontWeight:600, color:C.mid, marginBottom:6 }}>SHOPPING POSITION</div>
                  <div style={{ fontSize:13, color:C.dark, lineHeight:1.6 }}>
                    {result.shopping_position || "Not found in Shopping results for this query."}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:12, fontWeight:600, color:C.mid, marginBottom:6 }}>COMPETITOR ADVANTAGE</div>
                  <div style={{ fontSize:13, color:C.dark, lineHeight:1.6, marginBottom:8 }}>
                    {result.competitor_advantage || "No clear competitive advantage identified in data."}
                  </div>
                  {result.competitor_names?.filter(Boolean).map((n, i) => (
                    <Badge key={i} label={n} col={C.orange} bg={C.orangeL} />
                  ))}
                </div>
              </div>
              <div style={{ marginTop:14 }}>
                <div style={{ fontSize:12, fontWeight:600, color:C.mid, marginBottom:4 }}>ADS FINDING</div>
                <div style={{ fontSize:13, color:C.dark, lineHeight:1.5 }}>
                  {result.ads_finding}
                </div>
              </div>
            </div>

            {/* Working hypothesis */}
            <div style={{ background:C.white, borderLeft:`5px solid ${C.teal}`, border:`1px solid ${C.border}`, borderRadius:6, padding:20, marginBottom:16 }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.teal, letterSpacing:"1px", marginBottom:8 }}>WORKING HYPOTHESIS</div>
              <div style={{ fontSize:15, color:C.dark, lineHeight:1.65, fontWeight:500 }}>
                {result.working_hypothesis}
              </div>
            </div>

            {/* Red flags */}
            {result.red_flags?.filter(Boolean).length > 0 && (
              <div style={{ background:C.pinkL, borderLeft:`5px solid ${C.pink}`, border:`1px solid ${C.pink}30`, borderRadius:6, padding:16, marginBottom:16 }}>
                <div style={{ fontSize:11, fontWeight:700, color:C.pink, letterSpacing:"1px", marginBottom:8 }}>RED FLAGS</div>
                {result.red_flags.filter(Boolean).map((f, i) => (
                  <div key={i} style={{ fontSize:13, color:C.gray, marginBottom:4 }}>⚠ {f}</div>
                ))}
              </div>
            )}

            {/* Discovery questions */}
            <div style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:6, padding:20, marginBottom:16 }}>
              <SHead title="Prioritised Discovery Questions" col={C.navy} />
              {(result.discovery_questions || []).map((q, i) => (
                <div key={i} style={{
                  display:"flex", gap:14, padding:"14px 0",
                  borderBottom: i < 2 ? `1px solid ${C.border}` : "none",
                }}>
                  <div style={{
                    width:26, height:26, borderRadius:"50%",
                    background:C.navy, color:C.white,
                    fontSize:12, fontWeight:800, flexShrink:0,
                    display:"flex", alignItems:"center", justifyContent:"center",
                  }}>{q.priority}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:14, fontWeight:700, color:C.dark, marginBottom:5, lineHeight:1.4, fontStyle:"italic" }}>
                      &ldquo;{q.question}&rdquo;
                    </div>
                    <div style={{ fontSize:12, color:C.mid, lineHeight:1.5 }}>{q.why}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Personal cost + Why SCUBE */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
              <div style={{ background:C.white, borderLeft:`5px solid ${C.orange}`, border:`1px solid ${C.border}`, borderRadius:6, padding:18 }}>
                <div style={{ fontSize:11, fontWeight:700, color:C.orange, letterSpacing:"1px", marginBottom:8 }}>PERSONAL COST ANGLE</div>
                <div style={{ fontSize:13, color:C.gray, lineHeight:1.6 }}>{result.personal_cost_angle}</div>
              </div>
              <div style={{ background:C.white, borderLeft:`5px solid ${C.pink}`, border:`1px solid ${C.border}`, borderRadius:6, padding:18 }}>
                <div style={{ fontSize:11, fontWeight:700, color:C.pink, letterSpacing:"1px", marginBottom:8 }}>WHY SCUBE HOOK</div>
                <div style={{ fontSize:13, color:C.gray, lineHeight:1.6 }}>{result.why_scube_hook}</div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ background:C.light, border:`1px solid ${C.border}`, borderRadius:4, padding:"10px 14px", fontSize:12, color:C.mid }}>
              <strong style={{ color:C.gray }}>Data sources:</strong> Google Shopping (real-time pricing + competitors), Google Ads Transparency Center (active creatives), Google SERP (paid + organic presence), Claude (interpretation + brief).{" "}
              Complete the Discovery-to-Analyst Brief (Document 2 of the Sales System) after the call and hand off to the analyst.
            </div>

          </div>
        )}
      </div>
    </div>
  );
}