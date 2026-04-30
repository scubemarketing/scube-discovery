// api/prep.js - Vercel Serverless Function
// Two-pass approach:
// Pass 1 - Claude generates 3 targeted Shopping queries from intake form
// Pass 2 - All searches run in parallel using those queries

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

// --- Pass 1: Generate search queries -----------------------------------------
// Claude visits the website first, then generates 3 specific Shopping queries.
// Web search is enabled so Claude can read actual product names and categories
// before deciding what to search — prevents generic queries like "automotive parts"
// when the prospect actually sells "BMW M3 dry carbon fiber mirror caps".

async function generateQueries(name, domain, goal, details, productQuery, anthropicKey) {
  const prompt = `You are preparing Google Shopping search queries to research a prospect company.

STEP 1: Search the web for "${domain}" and visit their website. Read their product catalog,
category names, and specific product titles. You need to understand exactly what they sell
at the product level before generating any queries.

STEP 2: Generate exactly 3 Google Shopping search queries based on what you actually found:

Q1 - Brand name: The exact brand name as a customer would type it to find their products.
     Extract the real brand name from the website, not the domain string.
     Example: "Stradawerks" not "stradawerks.com"

Q2 - Specific category + fitment: The most specific product category they sell,
     including any fitment, material, or application detail that makes it narrow.
     WRONG: "automotive performance parts" (too broad - 500 brands would appear)
     WRONG: "carbon fiber parts" (too broad)
     RIGHT: "BMW M3 carbon fiber mirror caps" (specific enough that direct competitors appear)
     RIGHT: "dry carbon fiber front lip G8X" (specific to their actual products)
     The query must be specific enough that this brand OR a direct competitor would
     plausibly appear in the top 10 Google Shopping results.

Q3 - Specific product: A single product type from their catalog that a buyer searches
     when ready to purchase. Include brand, material, vehicle fitment, or model number
     if applicable. This should be even more specific than Q2.
     WRONG: "coilover suspension kit" (too generic)
     RIGHT: "Lamborghini Huracan carbon fiber hood" (if they sell that)
     RIGHT: "G8X BMW M4 dry carbon trunk spoiler" (specific product)

Additional context from intake form:
- Company domain: ${domain}
- Contact name: ${name}
- Goal: ${goal}
- Additional details: ${details || "none"}
${productQuery ? `- Salesperson product hint: ${productQuery}` : ""}

CRITICAL RULES:
- You MUST search the website before generating queries. Do not guess from the domain name.
- Q2 and Q3 must be specific enough that generic mass-market retailers (Amazon, AutoZone,
  Walmart) would NOT dominate the results. Niche competitors should appear.
- If the company sells multiple product lines, pick the one most prominent on their site.
- brand_name should be the actual brand name as it appears on the website.

Return JSON only, no explanation, no markdown:
{"q1": "...", "q2": "...", "q3": "...", "brand_name": "...", "product_summary": "one sentence describing what they actually sell based on the website"}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    // Extract text blocks only (ignore tool_use and tool_result blocks)
    const text = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("");
    const clean = text.replace(/```json|```/g, "").trim();
    // Find the JSON object in case there is any surrounding text
    const jsonStart = clean.indexOf("{");
    const jsonEnd   = clean.lastIndexOf("}");
    if (jsonStart === -1) throw new Error("No JSON in response");
    return JSON.parse(clean.slice(jsonStart, jsonEnd + 1));
  } catch (e) {
    // Fallback: use domain-derived values
    const brand = domain.split(".")[0];
    return {
      q1: brand,
      q2: productQuery || brand,
      q3: productQuery || brand,
      brand_name: brand,
      product_summary: "Could not fetch website - using domain name as fallback",
    };
  }
}

// --- Pass 2: SearchAPI calls --------------------------------------------------

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
    if (!res.ok) return { query, results: [], error: `HTTP ${res.status}` };
    const data = await res.json();
    return {
      query,
      results: safeSlice(data.shopping_results, 10).map((r, i) => ({
        position:  i + 1,
        title:     r.title || "",
        price:     r.price || "",
        price_raw: r.extracted_price || null,
        seller:    r.seller || r.source || "",
        rating:    r.rating || null,
        reviews:   r.reviews || null,
        delivery:  r.delivery || "",
        link:      r.link || "",
      })),
    };
  } catch (e) {
    return { query, results: [], error: e.message };
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
    const firstAd = creatives[0] || {};
    const advertiser = firstAd.advertiser || {};
    return {
      advertiser_name: advertiser.name || domain,
      verified:        advertiser.is_verified || false,
      count:           data.search_information?.total_results || creatives.length,
      ads: creatives.map(a => ({
        format:      a.format || "unknown",
        headline:    a.headline || a.title || "",
        description: a.description || "",
        first_shown: a.first_shown || "",
        last_shown:  a.last_shown || "",
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

// --- Build data block for Claude ---------------------------------------------
// Passes all three Shopping searches separately so Claude can distinguish
// brand presence from category presence from specific product pricing.

// Classify a single Shopping result into one of three buckets:
//   A = prospect's own direct listing (seller/link matches their domain)
//   B = retailer carrying the prospect's brand (title has brand, seller is different)
//   C = competitor (neither)
function classifyResult(r, domain, brandName) {
  const domainRoot = domain.replace(/\.(com|net|co|io|org|us).*$/, "");
  const sellerL = (r.seller || "").toLowerCase();
  const titleL  = (r.title  || "").toLowerCase();
  const linkL   = (r.link   || "").toLowerCase();
  const brandL  = brandName.toLowerCase();
  const domainL = domainRoot.toLowerCase();

  const isOwn =
    sellerL.includes(domainL) ||
    linkL.includes(domain.toLowerCase());

  if (isOwn) return "A";

  const carriesBrand =
    titleL.includes(brandL) ||
    sellerL.includes(brandL);

  if (carriesBrand) return "B";

  return "C";
}

function formatShoppingSearch(label, data, domain, brandName) {
  const lines = [];
  lines.push(`[${label}] query: "${data.query}"`);

  if (!data.results || data.results.length === 0) {
    lines.push(`  No results returned.${data.error ? " Error: " + data.error : ""}`);
    return lines;
  }

  const bucketA = data.results.filter(r => classifyResult(r, domain, brandName) === "A");
  const bucketB = data.results.filter(r => classifyResult(r, domain, brandName) === "B");
  const bucketC = data.results.filter(r => classifyResult(r, domain, brandName) === "C");

  if (bucketA.length > 0) {
    lines.push(`  [BUCKET A - PROSPECT DIRECT LISTINGS - seller/link = ${domain}]`);
    bucketA.forEach(r => lines.push(
      `    #${r.position} | ${r.title} | ${r.price} | Seller: ${r.seller}` +
      (r.rating ? ` | ${r.rating} stars (${r.reviews || 0} reviews)` : "")
    ));
  } else {
    lines.push(`  [BUCKET A - PROSPECT DIRECT LISTINGS]: NONE - prospect's own domain not found as seller`);
  }

  if (bucketB.length > 0) {
    lines.push(`  [BUCKET B - RETAILERS CARRYING ${brandName.toUpperCase()} PRODUCTS]`);
    bucketB.forEach(r => lines.push(
      `    #${r.position} | ${r.title} | ${r.price} | Seller: ${r.seller}` +
      (r.rating ? ` | ${r.rating} stars (${r.reviews || 0} reviews)` : "")
    ));
  } else {
    lines.push(`  [BUCKET B - RETAILERS CARRYING ${brandName.toUpperCase()} PRODUCTS]: NONE`);
  }

  if (bucketC.length > 0) {
    lines.push(`  [BUCKET C - COMPETITORS]`);
    bucketC.slice(0, 5).forEach(r => lines.push(
      `    #${r.position} | ${r.title} | ${r.price} | Seller: ${r.seller}` +
      (r.rating ? ` | ${r.rating} stars (${r.reviews || 0} reviews)` : "")
    ));
  }

  return lines;
}

function buildDataBlock(domain, brandName, shoppingBrand, shoppingCategory, shoppingProduct, ads, serp) {
  const lines = ["=== REAL DATA COLLECTED ===\n"];
  lines.push("SHOPPING DATA KEY:");
  lines.push("  Bucket A = prospect selling direct (their own domain as seller) - measures direct channel effectiveness");
  lines.push("  Bucket B = retailers carrying their products (brand in title, different seller) - measures market presence/distribution");
  lines.push("  Bucket C = competitors (neither) - measures competitive landscape");
  lines.push("  NOTE: Only Bucket A listings represent the prospect's own direct channel performance.\n");

  lines.push(...formatShoppingSearch("1a BRAND SEARCH", shoppingBrand, domain, brandName));
  lines.push("");
  lines.push(...formatShoppingSearch("1b CATEGORY SEARCH", shoppingCategory, domain, brandName));
  lines.push("");
  lines.push(...formatShoppingSearch("1c PRODUCT SEARCH", shoppingProduct, domain, brandName));

  // Ads Transparency
  lines.push(`\n[2] GOOGLE ADS TRANSPARENCY - domain: ${domain}`);
  lines.push(`  Active ads in last 30 days: ${ads.count}`);
  lines.push(`  Verified advertiser: ${ads.verified ? "yes" : "no"}`);
  if (ads.advertiser_name) lines.push(`  Advertiser name on file: ${ads.advertiser_name}`);
  if (ads.ads && ads.ads.length > 0) {
    ads.ads.forEach((a, i) => {
      lines.push(
        `  Ad ${i + 1}: format=${a.format} | "${a.headline}"` +
        (a.first_shown ? ` | first shown: ${a.first_shown}` : "") +
        (a.last_shown  ? ` | last shown: ${a.last_shown}` : "")
      );
    });
  } else {
    lines.push("  No ad creatives found.");
    if (ads.error) lines.push(`  Error: ${ads.error}`);
  }

  // SERP
  lines.push(`\n[3] GOOGLE SERP - query: "${domain}"`);
  if (serp.shopping_ads && serp.shopping_ads.length > 0) {
    lines.push(`  Shopping ads at top of SERP: ${serp.shopping_ads.map(a => `${a.title} (${a.price})`).join(" | ")}`);
  } else {
    lines.push("  No shopping ads at top of SERP for branded query.");
  }
  if (serp.ads && serp.ads.length > 0) {
    lines.push(`  Text ads (${serp.ads.length}): ${serp.ads.map(a => a.title).join(" | ")}`);
  } else {
    lines.push("  No text ads found on SERP.");
  }
  if (serp.organic && serp.organic.length > 0) {
    lines.push(`  Top organic: ${serp.organic.slice(0, 3).map(r => `${r.title} (${r.link})`).join(" | ")}`);
  }
  if (serp.knowledge_graph) {
    const kg = serp.knowledge_graph;
    lines.push(
      `  Knowledge graph: ${kg.title} - ${kg.type}` +
      (kg.rating ? ` - ${kg.rating} stars (${kg.reviews} reviews)` : "")
    );
    if (kg.description) lines.push(`  Description: ${kg.description}`);
  } else {
    lines.push("  No knowledge graph found.");
  }

  return lines.join("\n");
}

// --- Claude system prompt -----------------------------------------------------

const CLAUDE_SYSTEM = `You are a senior paid media strategist at SCUBE Marketing - a Chicago agency specialising in Google Ads, product feeds, and analytics for catalog-heavy ecommerce (automotive, HVAC, industrial, cycling, marine, tools, and similar spec-driven verticals).

You have a prospect intake form and REAL DATA from five live searches: three Google Shopping searches (brand, category, and product level), Google Ads Transparency Center, and Google SERP. Use this real data as your primary evidence.

UNDERSTANDING THE THREE SHOPPING SEARCHES AND THREE BUCKETS:
Each Shopping search classifies results into three buckets. This distinction is critical:

BUCKET A = Prospect's own direct listings (seller or link matches their domain).
  This measures their DIRECT CHANNEL effectiveness. If Bucket A is empty across all three searches,
  the prospect has no direct Shopping presence regardless of what retailers are doing.

BUCKET B = Retailers carrying the prospect's products (brand name in title, different seller).
  This measures MARKET PRESENCE and distribution reach. Bucket B results confirm the brand has
  demand and retail distribution but tell you nothing about their own channel performance.
  A prospect can have many Bucket B results and zero Bucket A results simultaneously.

BUCKET C = Competitors (neither the brand nor their products).
  This is the competitive landscape they must compete against for direct channel growth.

CRITICAL RULE ON SHOPPING PRESENCE:
- Base shopping_presence ONLY on Bucket A results (their own direct listings).
- Bucket B results (retailer listings) do NOT count as the prospect's Shopping presence.
- If Bucket A is empty in all three searches but Bucket B has results: shopping_presence = "absent"
  but note the distribution finding separately in shopping_position.
- If Ads Transparency shows active Shopping ads but Bucket A is empty, flag this as a critical
  finding: they are paying for Shopping ads but may not be winning impressions for their own domain.
- shopping_presence scale based on Bucket A only:
    strong = Bucket A appears in 2-3 searches, positions 1-5
    moderate = Bucket A appears in 1-2 searches, any position
    weak = Bucket A appears in only brand search or positions 6-10
    absent = Bucket A empty in all three searches

THE 10 SCENARIO TYPES:
1. ROAS-constrained - High ROAS target suppressing bids. Revenue declining while ROAS looks fine.
2. Burned by previous agency - CVR or revenue dropped under prior management. Skeptical.
3. Aggressive revenue goal - Target requires KPI improvement the data does not support.
4. Large catalog, no prioritisation - No custom label structure. Google treating all SKUs equally.
5. B2B making DTC transition - Decades of wholesale, new Shopify store, zero consumer experience.
6. Formal RFP / multi-vendor eval - Structured selection process with fixed criteria.
7. Small account / AOV constraint - Unit economics may not support the fee and the goal.
8. Multi-brand acquisition - Multiple brands, one decision-maker, inconsistent histories.
9. Broken measurement - Platform data diverges from actual revenue. GA4 incomplete.
10. Neglect pattern - Account on autopilot. Fewer than 10 changes per month.

SCUBE SCOPE: Ads + Feed + Analytics - all three layers. Most agencies only manage campaigns.

RULES:
- Every key finding must cite something from the actual data with specific positions, prices, or counts.
- working_hypothesis must be specific and falsifiable - name the actual constraint with evidence.
- Discovery questions must each cite a specific data point from the search results.
- Never fabricate competitor names, prices, or metrics not present in the data.
- shopping_presence: strong (appears in 2-3 searches, top positions) / moderate (appears in 1-2 searches) / weak (appears only in brand search or low positions) / absent (does not appear in any of the three searches AND Ads Transparency shows 0 ads).

Return valid JSON only - no markdown fences, no preamble, no trailing text:
{
  "company_summary": "2-3 sentences. Reference at least one specific data point from the searches.",
  "platform": "Shopify / BigCommerce / WooCommerce / Magento / Custom / Unknown",
  "catalog_estimate": "SKU range from visible signals",
  "aov_estimate": "AOV range from actual prices in Shopping data",
  "spend_estimate": "estimated monthly ad spend range",
  "shopping_presence": "strong / moderate / weak / absent - based on Bucket A (own direct listings) ONLY",
  "shopping_position": "Cite Bucket A count, Bucket B count, and Bucket C competitors. Example: 'Zero direct listings (Bucket A). Brand carried by 3 retailers including Extreme Power House (Bucket B). Category dominated by CompA and CompB at $X-$Y (Bucket C).'",
  "ads_activity": "active (N ads) / inactive / unknown",
  "ads_finding": "Specific finding from Transparency data - formats, count, dates, and what this signals",
  "competitor_names": ["name1", "name2", "name3"],
  "competitor_advantage": "Specific competitive gap with numbers from the data",
  "previous_agency_signals": "Signals detected or none detected",
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
  "working_hypothesis": "One specific falsifiable sentence naming the central constraint with evidence.",
  "goal_assessment": "realistic / aggressive / requires_conversation",
  "goal_reasoning": "1-2 sentences connecting the stated goal to what the data shows.",
  "audience_type": "direct_owner / internal_champion / procurement / unknown",
  "audience_reasoning": "1 sentence",
  "red_flags": ["specific flag with data reference"],
  "discovery_questions": [
    { "priority": 1, "question": "Exact question", "why": "Cite specific data finding" },
    { "priority": 2, "question": "Exact question", "why": "Cite specific data finding" },
    { "priority": 3, "question": "Exact question", "why": "Cite specific data finding" }
  ],
  "personal_cost_angle": "The personal cost framing most likely to land with this person",
  "why_scube_hook": "The most compelling data-backed argument for SCUBE three-layer scope"
}`;

// --- Handler ------------------------------------------------------------------

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

  // --- Pass 1: Generate targeted search queries ---
  const queries = await generateQueries(name, domain, goal, details, productQuery, ANTHROPIC_KEY);
  const { q1, q2, q3, brand_name } = queries;
  const brandName = brand_name || domain.split(".")[0];

  // --- Pass 2: All searches in parallel ---
  const [shoppingBrand, shoppingCategory, shoppingProduct, ads, serp] = await Promise.all([
    fetchShopping(q1, SEARCHAPI_KEY),
    fetchShopping(q2, SEARCHAPI_KEY),
    fetchShopping(q3, SEARCHAPI_KEY),
    fetchAdsTransparency(domain, SEARCHAPI_KEY),
    fetchSERP(domain, SEARCHAPI_KEY),
  ]);

  const dataBlock = buildDataBlock(
    domain, brandName,
    shoppingBrand, shoppingCategory, shoppingProduct,
    ads, serp
  );

  const userMessage = [
    "PROSPECT INTAKE:",
    `Name: ${name}`,
    `Email: ${email || "not provided"}`,
    `Phone: ${phone || "not provided"}`,
    `Website: ${website}`,
    `Goal: ${goal}`,
    `Additional details: ${details || "none"}`,
    `Brand name identified: ${brandName}`,
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

    const clean = text.replace(/```json|```/g, "").trim();
    const brief = JSON.parse(clean);

    // Attach raw data for the frontend raw data panel
    brief._raw = {
      domain,
      brand_name:      brandName,
      product_summary: queries.product_summary || null,
      queries:         { q1, q2, q3 },
      shopping: {
        brand:    shoppingBrand,
        category: shoppingCategory,
        product:  shoppingProduct,
      },
      ads,
      serp,
    };

    return res.status(200).json(brief);
  } catch (e) {
    return res.status(500).json({ error: e.message || "Internal error" });
  }
}