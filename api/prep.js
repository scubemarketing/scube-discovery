// api/prep.js — Vercel Serverless Function
// All API keys stay server-side. Never exposed to the browser.
// Flow: receive form → 3 SearchAPI calls in parallel → Claude interprets → return brief

const SEARCHAPI_BASE = "https://www.searchapi.io/api/v1/search";

function extractDomain(website) {
  return website
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase()
    .trim();
}

function safeSlice(arr, n) {
  return Array.isArray(arr) ? arr.slice(0, n) : [];
}

// ─── SearchAPI calls ───────────────────────────────────────────────────────────

async function fetchShopping(query, apiKey) {
  const params = new URLSearchParams({
    engine: "google_shopping",
    q: query,
    gl: "us",
    hl: "en",
    num: "10",
    api_key: apiKey,
  });
  try {
    const res = await fetch(`${SEARCHAPI_BASE}?${params}`);
    if (!res.ok) return { results: [], error: `HTTP ${res.status}` };
    const data = await res.json();
    return {
      results: safeSlice(data.shopping_results, 10).map((r, i) => ({
        position:  i + 1,
        title:     r.title || "",
        price:     r.price || "",
        price_raw: r.extracted_price || null,
        seller:    r.seller || r.source || "",
        rating:    r.rating || null,
        reviews:   r.reviews || null,
        delivery:  r.delivery || "",
      })),
    };
  } catch (e) {
    return { results: [], error: e.message };
  }
}

async function fetchAdsTransparency(domain, apiKey) {
  const params = new URLSearchParams({
    engine: "google_ads_transparency_center",
    domain: domain,
    region: "US",
    time_period: "last_30_days",
    api_key: apiKey,
  });
  try {
    const res = await fetch(`${SEARCHAPI_BASE}?${params}`);
    if (!res.ok) return { ads: [], count: 0, error: `HTTP ${res.status}` };
    const data = await res.json();
    const creatives = safeSlice(data.ad_creatives || [], 8);
    const firstAd   = creatives[0] || {};
    const advertiser = firstAd.advertiser || {};
    return {
      advertiser_name: advertiser.name || domain,
      verified:        advertiser.is_verified || false,
      count:           data.search_information?.total_results || creatives.length,
      regions:         [],
      ads: creatives.map(a => ({
        format:      a.format || "unknown",
        headline:    a.headline || a.title || "",
        description: a.description || "",
        first_shown: a.first_shown || "",
        last_shown:  a.last_shown  || "",
      })),
    };
  } catch (e) {
    return { ads: [], count: 0, error: e.message };
  }
}

async function fetchSERP(domain, apiKey) {
  const params = new URLSearchParams({
    engine: "google",
    q: domain,
    gl: "us",
    hl: "en",
    api_key: apiKey,
  });
  try {
    const res = await fetch(`${SEARCHAPI_BASE}?${params}`);
    if (!res.ok) return { shopping_ads: [], organic: [], ads: [] };
    const data = await res.json();
    return {
      shopping_ads: safeSlice(data.shopping_ads || [], 6).map(a => ({
        title: a.title, seller: a.seller, price: a.price, position: a.position,
      })),
      organic: safeSlice(data.organic_results || [], 4).map(r => ({
        title: r.title, link: r.link, snippet: r.snippet,
      })),
      ads: safeSlice(data.ads || [], 4).map(a => ({
        title: a.title, description: a.description, link: a.displayed_link,
      })),
      knowledge_graph: data.knowledge_graph ? {
        title:       data.knowledge_graph.title,
        type:        data.knowledge_graph.type,
        description: data.knowledge_graph.description,
        rating:      data.knowledge_graph.rating,
        reviews:     data.knowledge_graph.reviews,
      } : null,
    };
  } catch (e) {
    return { shopping_ads: [], organic: [], ads: [], error: e.message };
  }
}

// ─── Format data for Claude ────────────────────────────────────────────────────

function buildDataBlock(domain, query, shopping, ads, serp) {
  const lines = ["=== REAL DATA COLLECTED ===\n"];

  lines.push(`[1] GOOGLE SHOPPING  query: "${query}"`);
  if (shopping.results && shopping.results.length > 0) {
    shopping.results.forEach(r => {
      lines.push(
        `  #${r.position} | ${r.title} | ${r.price} | Seller: ${r.seller}` +
        (r.rating  ? ` | ${r.rating}★ (${r.reviews || 0} reviews)` : "") +
        (r.delivery ? ` | ${r.delivery}` : "")
      );
    });
  } else {
    lines.push("  No shopping results returned for this query.");
    if (shopping.error) lines.push(`  Error: ${shopping.error}`);
  }

  lines.push(`\n[2] GOOGLE ADS TRANSPARENCY  domain: ${domain}`);
  lines.push(`  Active ads: ${ads.count}`);
  lines.push(`  Verified advertiser: ${ads.verified ? "yes" : "no"}`);
  if (ads.regions && ads.regions.length > 0) {
    lines.push(`  Regions: ${ads.regions.join(", ")}`);
  }
  if (ads.ads && ads.ads.length > 0) {
    ads.ads.forEach((a, i) => {
      lines.push(
        `  Ad ${i + 1}: format=${a.format} | "${a.headline}"` +
        (a.first_shown ? ` | first shown: ${a.first_shown}` : "") +
        (a.last_shown  ? ` | last shown: ${a.last_shown}`  : "")
      );
    });
  } else {
    lines.push("  No ad creatives found in Transparency Center.");
    if (ads.error) lines.push(`  Error: ${ads.error}`);
  }

  lines.push(`\n[3] GOOGLE SERP  query: "${domain}"`);
  if (serp.shopping_ads && serp.shopping_ads.length > 0) {
    lines.push(`  Shopping ads at top: ${serp.shopping_ads.map(a => `${a.title} (${a.price})`).join(" | ")}`);
  } else {
    lines.push("  No shopping ads at top of SERP for branded query.");
  }
  if (serp.ads && serp.ads.length > 0) {
    lines.push(`  Text ads (${serp.ads.length}): ${serp.ads.map(a => a.title).join(" | ")}`);
  } else {
    lines.push("  No text ads found.");
  }
  if (serp.organic && serp.organic.length > 0) {
    lines.push(`  Top organic: ${serp.organic.slice(0, 3).map(r => `${r.title} (${r.link})`).join(" | ")}`);
  }
  if (serp.knowledge_graph) {
    const kg = serp.knowledge_graph;
    lines.push(
      `  Knowledge graph: ${kg.title} — ${kg.type}` +
      (kg.rating ? ` — ${kg.rating}★ (${kg.reviews} reviews)` : "")
    );
    if (kg.description) lines.push(`  Description: ${kg.description}`);
  } else {
    lines.push("  No knowledge graph found.");
  }

  return lines.join("\n");
}

// ─── Claude system prompt ──────────────────────────────────────────────────────

const CLAUDE_SYSTEM = `You are a senior paid media strategist at SCUBE Marketing — a Chicago agency specialising in Google Ads, product feeds, and analytics for catalog-heavy ecommerce (automotive, HVAC, industrial, cycling, marine, tools, and similar spec-driven verticals).

You have a prospect intake form and REAL DATA from three live API calls: Google Shopping results, Google Ads Transparency Center, and Google SERP. Use this real data as your primary evidence. Do not guess what you can read. Do not estimate what you can calculate from the data.

THE 10 SCENARIO TYPES:
1. ROAS-constrained — High ROAS target suppressing bids, pricing them out of auctions. Revenue declining while ROAS looks fine.
2. Burned by previous agency — CVR or revenue dropped under prior management. Skeptical. Wants evidence not promises.
3. Aggressive revenue goal — Target requires KPI improvement the data does not support. Board or investor-set number.
4. Large catalog, no prioritisation — No custom label structure. Google treating all SKUs equally. Budget flows to zero-converters.
5. B2B making DTC transition — Decades of wholesale, new Shopify store, zero consumer acquisition experience.
6. Formal RFP / multi-vendor eval — Structured selection process. Competing on criteria, not relationship.
7. Small account / AOV constraint — Unit economics may not support the fee and the stated goal simultaneously.
8. Multi-brand acquisition — Multiple brands, one decision-maker, inconsistent histories.
9. Broken measurement — Platform data diverges from actual revenue. GA4 incomplete. Phone revenue invisible.
10. Neglect pattern — Account on autopilot. Fewer than 10 changes per month. Google deciding without human oversight.

SCUBE SCOPE: Ads + Feed + Analytics — all three. The campaign is the output of the feed and the analytics. Most agencies only manage campaigns.

INTERPRETING SEARCH DATA:
Shopping: if the prospect is absent from results for their category, that is a critical finding. If they appear but at higher prices than competitors, calculate the specific price delta. If competitors have far more reviews, flag it with numbers.
Ads Transparency: 0 ads = neglect or new account. 1-5 = minimal activity. 10+ = active management. Note formats — Shopping-only vs Search+Shopping vs Video indicates scope of current program.
SERP: competitors appearing in Shopping ads for the prospect's branded query means auction invasion. Organic position reveals brand health.
Knowledge graph: absence for an established business may indicate weak branded search or limited digital presence.

RULES:
- Every key finding must cite something from the actual data — a position, a price, a seller name, an ad count.
- The working_hypothesis must be specific enough to be embarrassing if wrong — it names the actual constraint with evidence.
- Discovery questions must each cite a specific data point. Generic questions are not acceptable.
- Never fabricate competitor names, prices, or metrics not present in the data.

Return valid JSON only — no markdown fences, no preamble, no trailing text after the closing brace:
{
  "company_summary": "2-3 sentences describing the business. Reference at least one specific data point.",
  "platform": "Shopify / BigCommerce / WooCommerce / Magento / Custom / Unknown",
  "catalog_estimate": "SKU range estimate from visible signals",
  "aov_estimate": "AOV range derived from actual prices in Shopping data",
  "spend_estimate": "estimated monthly ad spend range",
  "shopping_presence": "strong / moderate / weak / absent",
  "shopping_position": "Specific finding from Shopping data citing actual positions and prices",
  "ads_activity": "active (N ads) / inactive / unknown",
  "ads_finding": "Specific finding from Transparency data citing format, count, and dates",
  "competitor_names": ["name1", "name2"],
  "competitor_advantage": "Specific competitive gap visible in the data with numbers",
  "previous_agency_signals": "Signals from data or intake form, or none detected",
  "scenario_primary": {
    "number": 4,
    "name": "scenario name",
    "confidence": "high / medium / low",
    "reasoning": "1-2 sentences citing specific data points"
  },
  "scenario_secondary": {
    "number": 10,
    "name": "scenario name",
    "confidence": "medium / low",
    "reasoning": "1 sentence"
  },
  "working_hypothesis": "One specific falsifiable sentence naming the central constraint with evidence from the data.",
  "goal_assessment": "realistic / aggressive / requires_conversation",
  "goal_reasoning": "1-2 sentences connecting the stated goal to what the data currently shows.",
  "audience_type": "direct_owner / internal_champion / procurement / unknown",
  "audience_reasoning": "1 sentence",
  "red_flags": ["specific flag with data reference if applicable"],
  "discovery_questions": [
    { "priority": 1, "question": "Exact question to ask", "why": "Cite specific data finding" },
    { "priority": 2, "question": "Exact question to ask", "why": "Cite specific data finding" },
    { "priority": 3, "question": "Exact question to ask", "why": "Cite specific data finding" }
  ],
  "personal_cost_angle": "The personal cost framing most likely to land with this specific person",
  "why_scube_hook": "The single most compelling data-backed argument for SCUBE's three-layer scope"
}`;

// ─── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const SEARCHAPI_KEY = process.env.SEARCHAPI_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  if (!SEARCHAPI_KEY || !ANTHROPIC_KEY) {
    return res.status(500).json({ error: "Server misconfiguration: API keys not set" });
  }

  const { website, name, email, phone, goal, details, productQuery } = req.body || {};

  if (!website || !goal) {
    return res.status(400).json({ error: "website and goal are required" });
  }

  const domain = extractDomain(website);

  // Build shopping search query — use explicit productQuery if provided,
  // otherwise clean goal text down to product terms.
// Use explicit product query if provided, otherwise use the domain name
  // as the shopping search term — this finds whether they appear in Shopping
  // and who their competitors are. The domain name works better than
  // stripping words from a goal sentence.
  const shoppingQuery = productQuery || domain;
  // Run all three SearchAPI calls in parallel
 // Run two Shopping searches in parallel:
  // 1. Domain name — detects if prospect appears in Shopping and who competes
  // 2. Product query — finds category competitors and pricing context
  const productSearchQuery = productQuery || domain;
  const [shoppingDomain, shoppingProduct, ads, serp] = await Promise.all([
    fetchShopping(domain, SEARCHAPI_KEY),
    productQuery ? fetchShopping(productQuery, SEARCHAPI_KEY) : Promise.resolve({ results: [] }),
    fetchAdsTransparency(domain, SEARCHAPI_KEY),
    fetchSERP(domain, SEARCHAPI_KEY),
  ]);

  // Merge: domain results first (prospect visibility), then product results (competitors)
  const shopping = {
    results: [
      ...shoppingDomain.results,
      ...shoppingProduct.results.filter(r =>
        !shoppingDomain.results.some(d => d.title === r.title)
      ),
    ].slice(0, 10),
  };
  const shoppingQuery = productSearchQuery;

  const dataBlock = buildDataBlock(domain, shoppingQuery, shopping, ads, serp);

  const userMessage = [
    "PROSPECT INTAKE:",
    `Name: ${name}`,
    `Email: ${email || "not provided"}`,
    `Phone: ${phone || "not provided"}`,
    `Website: ${website}`,
    `Goal: ${goal}`,
    `Additional details: ${details || "none"}`,
    "",
    dataBlock,
    "",
    "Produce the Discovery prep brief using the real data above as your primary evidence.",
  ].join("\n");

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
       max_tokens: 4000,
        system: CLAUDE_SYSTEM,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    const anthropicData = await anthropicRes.json();

    if (!anthropicRes.ok) {
      return res.status(anthropicRes.status).json({
        error: anthropicData.error?.message || "Claude API error",
      });
    }

    const text = (anthropicData.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("");

    const brief = JSON.parse(text.replace(/```json|```/g, "").trim());

    // Attach raw data so the frontend can render the source material
    brief._raw = { domain, query: shoppingQuery, shopping, ads, serp };

    return res.status(200).json(brief);

  } catch (e) {
    return res.status(500).json({ error: e.message || "Internal error" });
  }
}
