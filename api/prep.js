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
// Ask Claude to produce 3 targeted Shopping queries from the intake form.
// Q1 = brand/company name (finds their own listings)
// Q2 = primary product category (finds category competitors)
// Q3 = specific product brand or model they likely carry (pricing comparison)

async function generateQueries(name, domain, goal, details, productQuery, anthropicKey) {
  // If the user provided a product query, use it for Q2 and derive Q1/Q3
  // around it. If not, let Claude figure out all three.
  const prompt = `A prospect has submitted an intake form to a paid media agency.
Company domain: ${domain}
Contact name: ${name}
Goal: ${goal}
Additional details: ${details || "none"}
${productQuery ? `Salesperson's product query hint: ${productQuery}` : ""}

Generate exactly 3 Google Shopping search queries to research this prospect:
Q1: The company name or brand name as a buyer would search it (to find their own listings)
Q2: Their primary product category (broad term, to find category competitors)
Q3: A specific product brand, model, or SKU they likely carry (for pricing comparison)

Rules:
- Q1 must be the company/brand name, not the domain. Extract it from the domain or details.
- Q2 should be 2-4 words, high search volume, not brand-specific.
- Q3 should be a specific product term that a customer would search when ready to buy.
- If the salesperson provided a product query hint, use it to inform Q2 or Q3.
- Never use the domain name as a query. Use the brand name instead.

Return JSON only, no explanation:
{"q1": "...", "q2": "...", "q3": "...", "brand_name": "..."}`;

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
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    // Fallback: use domain-derived values
    const brand = domain.split(".")[0];
    return {
      q1: brand,
      q2: productQuery || brand + " products",
      q3: productQuery || brand,
      brand_name: brand,
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

function buildDataBlock(domain, brandName, shoppingBrand, shoppingCategory, shoppingProduct, ads, serp) {
  const lines = ["=== REAL DATA COLLECTED ===\n"];

  // Shopping search 1: Brand name (did their own listings appear?)
  lines.push(`[1a] GOOGLE SHOPPING - Brand search: "${shoppingBrand.query}"`);
  lines.push(`     PURPOSE: Find prospect's own listings and confirm Shopping presence`);
  if (shoppingBrand.results.length > 0) {
    const prospectListings = shoppingBrand.results.filter(r =>
      r.seller.toLowerCase().includes(brandName.toLowerCase()) ||
      r.title.toLowerCase().includes(brandName.toLowerCase())
    );
    if (prospectListings.length > 0) {
      lines.push(`     PROSPECT FOUND in brand search (${prospectListings.length} listings):`);
      prospectListings.forEach(r => {
        lines.push(`       #${r.position} | ${r.title} | ${r.price} | Seller: ${r.seller}`);
      });
      const others = shoppingBrand.results.filter(r => !prospectListings.includes(r));
      if (others.length > 0) {
        lines.push(`     Other sellers appearing for brand search:`);
        others.slice(0, 3).forEach(r => {
          lines.push(`       #${r.position} | ${r.title} | ${r.price} | Seller: ${r.seller}`);
        });
      }
    } else {
      lines.push(`     PROSPECT NOT FOUND in brand search results. Top results:`);
      shoppingBrand.results.slice(0, 5).forEach(r => {
        lines.push(`       #${r.position} | ${r.title} | ${r.price} | Seller: ${r.seller}`);
      });
    }
  } else {
    lines.push(`     No results returned for brand search.`);
    if (shoppingBrand.error) lines.push(`     Error: ${shoppingBrand.error}`);
  }

  // Shopping search 2: Category (who wins the category?)
  lines.push(`\n[1b] GOOGLE SHOPPING - Category search: "${shoppingCategory.query}"`);
  lines.push(`     PURPOSE: Who wins category auctions and at what prices`);
  if (shoppingCategory.results.length > 0) {
    const prospectInCategory = shoppingCategory.results.filter(r =>
      r.seller.toLowerCase().includes(brandName.toLowerCase()) ||
      r.title.toLowerCase().includes(brandName.toLowerCase())
    );
    if (prospectInCategory.length > 0) {
      lines.push(`     PROSPECT APPEARS in category results:`);
      prospectInCategory.forEach(r => {
        lines.push(`       #${r.position} | ${r.title} | ${r.price} | Seller: ${r.seller}` +
          (r.rating ? ` | ${r.rating} stars (${r.reviews || 0} reviews)` : ""));
      });
    } else {
      lines.push(`     PROSPECT ABSENT from category results. Dominant competitors:`);
    }
    shoppingCategory.results
      .filter(r => !prospectInCategory.includes(r))
      .slice(0, 6)
      .forEach(r => {
        lines.push(`       #${r.position} | ${r.title} | ${r.price} | Seller: ${r.seller}` +
          (r.rating ? ` | ${r.rating} stars (${r.reviews || 0} reviews)` : ""));
      });
  } else {
    lines.push(`     No results returned.`);
    if (shoppingCategory.error) lines.push(`     Error: ${shoppingCategory.error}`);
  }

  // Shopping search 3: Specific product (pricing comparison)
  lines.push(`\n[1c] GOOGLE SHOPPING - Product search: "${shoppingProduct.query}"`);
  lines.push(`     PURPOSE: Specific product pricing and competitor landscape`);
  if (shoppingProduct.results.length > 0) {
    const prospectInProduct = shoppingProduct.results.filter(r =>
      r.seller.toLowerCase().includes(brandName.toLowerCase()) ||
      r.title.toLowerCase().includes(brandName.toLowerCase())
    );
    if (prospectInProduct.length > 0) {
      lines.push(`     PROSPECT APPEARS in product results:`);
      prospectInProduct.forEach(r => {
        lines.push(`       #${r.position} | ${r.title} | ${r.price} | Seller: ${r.seller}`);
      });
    } else {
      lines.push(`     PROSPECT ABSENT from product results.`);
    }
    shoppingProduct.results
      .filter(r => !prospectInProduct.includes(r))
      .slice(0, 5)
      .forEach(r => {
        lines.push(`       #${r.position} | ${r.title} | ${r.price} | Seller: ${r.seller}` +
          (r.rating ? ` | ${r.rating} stars (${r.reviews || 0} reviews)` : ""));
      });
  } else {
    lines.push(`     No results returned.`);
    if (shoppingProduct.error) lines.push(`     Error: ${shoppingProduct.error}`);
  }

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

UNDERSTANDING THE THREE SHOPPING SEARCHES:
- Search 1a (Brand search): Did the prospect's own listings appear? If yes, they have Shopping presence. If no, either they are not in Shopping or their titles do not match their brand name.
- Search 1b (Category search): Who wins the generic category terms? Prospect absent here is normal for niche brands - it means they win on specifics but not on broad terms.
- Search 1c (Product search): Pricing comparison on specific products. Who is cheaper, who has more reviews, who has better delivery.

CRITICAL RULE ON SHOPPING PRESENCE:
- If the prospect appeared in ANY of the three Shopping searches, their presence is NOT absent. Use "weak", "moderate", or "strong" based on position and volume.
- Only mark "absent" if the prospect did not appear in ANY of the three searches.
- Ads Transparency showing active Shopping ads confirms they are running Shopping ads even if they do not appear in our three specific searches.

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
  "shopping_presence": "strong / moderate / weak / absent",
  "shopping_position": "Specific finding citing which searches they appeared in, positions, and prices vs competitors",
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
      brand_name: brandName,
      queries: { q1, q2, q3 },
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