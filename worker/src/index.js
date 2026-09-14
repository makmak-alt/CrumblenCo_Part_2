/* Crumble & Co MVI — Cloudflare Worker API (crumble-api)
 * Routes:
 *   POST   /orders                 create order (customer checkout)
 *   GET    /orders/{num}?email=…   customer order tracking (email must match)
 *   GET    /orders                 owner: list all orders        (Bearer OWNER_TOKEN)
 *   PATCH  /orders/{num}           owner: update status/payment  (Bearer OWNER_TOKEN)
 *   POST   /chat                   AI chat via Workers AI (Llama 3.1 8B, free tier)
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_KEY, OWNER_TOKEN
 * Vars:    SHEET_URL (Apps Script webhook), ALLOWED_ORIGIN
 */

const ORDER_FIELDS = "order_num,name,email,phone,items,delivery,address,total,status,created_at,updated_at";

const MENU_KNOWLEDGE = `
You are the Crumble & Co assistant — a warm, helpful chatbot for a small home bakery in Diep River, Cape Town, run by Basrah.
MENU (single cookies): Classic Choc Chip R25 (bestseller), Salted Caramel Crunch R28, Red Velvet Dream R30,
Lemon Zest Burst R26, Double Dark Choc R30, Peanut Butter Bliss R27.
BOX DEALS: 6-pack R150, 12-pack R280, 24-pack R520 (gift packaging, custom messages possible).
DELIVERY: anywhere in Cape Town, R35 flat, FREE for orders over R300. PICKUP: free, from Diep River.
Orders are baked fresh 24–48 hours after payment. Payment via SnapScan (scan QR) or EFT (Absa).
Large/event orders need 3 days notice.
RULES: Answer only questions about Crumble & Co, cookies, orders, prices, delivery, payment.
Keep answers short (2–4 sentences), friendly, use plain text (no markdown). Never invent products, prices or policies.
If you don't know something or the question is about an existing order's status, say the customer can use the
"Track my order" tab or WhatsApp the owner. If asked something unrelated to the bakery, politely decline.
`.trim();

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "https://makmak-alt.github.io",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

function json(data, status, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

async function supabase(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status}: ${body}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function isOwner(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return auth === `Bearer ${env.OWNER_TOKEN}`;
}

async function notifyAppsScript(env, payload) {
  // Fire-and-forget: Sheet + Gmail are nice-to-have; never fail the API call over them.
  try {
    await fetch(env.SHEET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "follow",
    });
  } catch (e) {
    console.error("Apps Script notify failed:", e);
  }
}

function newOrderNum() {
  return "CC-" + Math.floor(10000 + Math.random() * 90000);
}

async function handleCreateOrder(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, env);
  }
  const required = ["name", "email", "items", "delivery", "total"];
  for (const f of required) {
    if (!data[f] || typeof data[f] !== "string") {
      return json({ error: `Missing or invalid field: ${f}` }, 400, env);
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return json({ error: "Invalid email address" }, 400, env);
  }

  // Retry with a fresh order number on the (rare) PK collision
  for (let attempt = 0; attempt < 3; attempt++) {
    const orderNum = newOrderNum();
    const row = {
      order_num: orderNum,
      name: data.name.slice(0, 120),
      email: data.email.slice(0, 200),
      phone: (data.phone || "").slice(0, 40),
      items: data.items.slice(0, 1000),
      delivery: data.delivery === "Delivery" ? "Delivery" : "Pickup",
      address: (data.address || "").slice(0, 300),
      total: data.total.slice(0, 20),
      status: "New",
    };
    try {
      await supabase(env, "orders", { method: "POST", body: JSON.stringify(row) });
      await notifyAppsScript(env, { type: "order", ...row });
      return json({ ok: true, orderNum }, 201, env);
    } catch (e) {
      if (attempt === 2) {
        console.error(e);
        return json({ error: "Could not save order. Please try again." }, 502, env);
      }
    }
  }
}

async function handleTrackOrder(orderNum, url, env) {
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  if (!email) return json({ error: "email query parameter is required" }, 400, env);
  const rows = await supabase(
    env,
    `orders?order_num=eq.${encodeURIComponent(orderNum)}&select=${ORDER_FIELDS}`
  );
  const order = rows && rows[0];
  if (!order || order.email.toLowerCase() !== email) {
    // Same message whether the order doesn't exist or the email is wrong (no enumeration)
    return json({ error: "No order found for that order number and email." }, 404, env);
  }
  return json({ ok: true, order }, 200, env);
}

async function handleListOrders(env) {
  const rows = await supabase(
    env,
    `orders?select=${ORDER_FIELDS}&order=created_at.desc&limit=200`
  );
  return json({ ok: true, orders: rows || [] }, 200, env);
}

async function handleUpdateOrder(request, orderNum, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, env);
  }
  const allowed = ["New", "Paid", "Baking", "Packing", "Ready", "Delivered", "Cancelled"];
  if (!data.status || !allowed.includes(data.status)) {
    return json({ error: `status must be one of: ${allowed.join(", ")}` }, 400, env);
  }
  const rows = await supabase(
    env,
    `orders?order_num=eq.${encodeURIComponent(orderNum)}`,
    { method: "PATCH", body: JSON.stringify({ status: data.status }) }
  );
  const order = rows && rows[0];
  if (!order) return json({ error: "Order not found" }, 404, env);

  await notifyAppsScript(env, {
    type: "status",
    order_num: order.order_num,
    name: order.name,
    email: order.email,
    items: order.items,
    total: order.total,
    delivery: order.delivery,
    status: order.status,
  });
  return json({ ok: true, order }, 200, env);
}

async function handleChat(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, env);
  }
  const message = (data.message || "").toString().slice(0, 500).trim();
  if (!message) return json({ error: "message is required" }, 400, env);

  const history = Array.isArray(data.history) ? data.history.slice(-6) : [];
  const messages = [
    { role: "system", content: MENU_KNOWLEDGE },
    ...history
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({ role: m.role, content: m.content.slice(0, 500) })),
    { role: "user", content: message },
  ];

  const aiRes = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    messages,
    max_tokens: 220,
  });
  const reply = (aiRes && aiRes.response ? aiRes.response : "").trim();
  if (!reply) throw new Error("Empty AI response");
  return json({ ok: true, reply }, 200, env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    try {
      if (request.method === "POST" && url.pathname === "/orders") {
        return await handleCreateOrder(request, env);
      }
      if (request.method === "POST" && url.pathname === "/chat") {
        return await handleChat(request, env);
      }
      const orderMatch = url.pathname.match(/^\/orders\/([A-Za-z0-9-]+)$/);
      if (orderMatch) {
        const orderNum = orderMatch[1].toUpperCase();
        if (request.method === "GET") return await handleTrackOrder(orderNum, url, env);
        if (request.method === "PATCH") {
          if (!isOwner(request, env)) return json({ error: "Unauthorized" }, 401, env);
          return await handleUpdateOrder(request, orderNum, env);
        }
      }
      if (request.method === "GET" && url.pathname === "/orders") {
        if (!isOwner(request, env)) return json({ error: "Unauthorized" }, 401, env);
        return await handleListOrders(env);
      }
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "crumble-api" }, 200, env);
      }
      return json({ error: "Not found" }, 404, env);
    } catch (e) {
      console.error(e);
      return json({ error: "Internal error" }, 500, env);
    }
  },
};
