"use strict";
/*
 * Orders — Customer & Owner Apps (connected, server-backed)
 * Plain Node.js, no external dependencies. Run: npm start
 * Customer app:  /        (anyone can upload an order and chat)
 * Owner app:     /owner   (owner passcode required for status / price finds / delete)
 * Data:          data/orders.json + data/uploads/  (persists across restarts)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const OWNER_CODE = process.env.OWNER_CODE || "owner123"; // CHANGE THIS when deploying (see README)
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "orders.json");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]", "utf8");

function loadOrders() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch (e) { return []; }
}
function saveOrders(orders) {
  fs.writeFileSync(DB_FILE, JSON.stringify(orders, null, 2), "utf8");
}
function newId() { return Date.now().toString(36) + crypto.randomBytes(4).toString("hex"); }

const STATUSES = ["Looking for it", "Found - can buy", "Negotiating", "Not available", "Cancelled"];

function withComputed(order) {
  const finds = order.finds || [];
  let lowest = null, nearest = null;
  for (const f of finds) {
    if (typeof f.price === "number" && (!lowest || f.price < lowest.price)) lowest = f;
    if (typeof f.distanceKm === "number" && (!nearest || f.distanceKm < nearest.distanceKm)) nearest = f;
  }
  return Object.assign({}, order, { lowestFind: lowest, nearestFind: nearest });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > 12 * 1024 * 1024) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error("invalid json")); }
    });
    req.on("error", reject);
  });
}
function isOwner(req) {
  return (req.headers["x-owner-code"] || "") === OWNER_CODE;
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api","orders",...]

  if (req.method === "GET" && url.pathname === "/api/orders") {
    return sendJson(res, 200, { orders: loadOrders().map(withComputed) });
  }

  if (req.method === "POST" && url.pathname === "/api/orders") {
    const b = await readBody(req);
    const itemName = String(b.itemName || "").trim();
    if (!itemName) return sendJson(res, 400, { error: "itemName is required" });
    const order = {
      id: newId(),
      customerName: String(b.customerName || "").trim(),
      itemName,
      description: String(b.description || "").trim(),
      quantity: Math.max(1, parseInt(b.quantity, 10) || 1),
      priceSeen: (b.priceSeen === "" || b.priceSeen == null) ? null : Number(b.priceSeen),
      photoUrl: null,
      status: "New",
      finds: [],
      messages: [],
      createdAt: new Date().toISOString()
    };
    if (b.photoDataUrl && typeof b.photoDataUrl === "string") {
      const m = b.photoDataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
      if (m) {
        const ext = m[1] === "jpeg" ? "jpg" : m[1];
        const file = order.id + "." + ext;
        fs.writeFileSync(path.join(UPLOAD_DIR, file), Buffer.from(m[2], "base64"));
        order.photoUrl = "/uploads/" + file;
      }
    }
    const orders = loadOrders();
    orders.unshift(order);
    saveOrders(orders);
    return sendJson(res, 201, { order: withComputed(order) });
  }

  // /api/orders/:id/...
  if (parts.length >= 3 && parts[0] === "api" && parts[1] === "orders") {
    const id = parts[2];
    const orders = loadOrders();
    const order = orders.find(o => o.id === id);
    if (!order) return sendJson(res, 404, { error: "order not found" });

    if (req.method === "DELETE" && parts.length === 3) {
      if (!isOwner(req)) return sendJson(res, 403, { error: "owner passcode required" });
      saveOrders(orders.filter(o => o.id !== id));
      if (order.photoUrl) {
        const f = path.join(UPLOAD_DIR, path.basename(order.photoUrl));
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && parts[3] === "status") {
      if (!isOwner(req)) return sendJson(res, 403, { error: "owner passcode required" });
      const b = await readBody(req);
      if (!STATUSES.includes(b.status)) return sendJson(res, 400, { error: "invalid status" });
      order.status = b.status;
      saveOrders(orders);
      return sendJson(res, 200, { order: withComputed(order) });
    }

    if (req.method === "POST" && parts[3] === "finds") {
      if (!isOwner(req)) return sendJson(res, 403, { error: "owner passcode required" });
      const b = await readBody(req);
      const store = String(b.store || "").trim();
      if (!store) return sendJson(res, 400, { error: "store is required" });
      const find = {
        id: newId(),
        store,
        location: String(b.location || "").trim(),
        price: (b.price === "" || b.price == null) ? null : Number(b.price),
        distanceKm: (b.distanceKm === "" || b.distanceKm == null) ? null : Number(b.distanceKm),
        addedAt: new Date().toISOString()
      };
      order.finds = order.finds || [];
      order.finds.push(find);
      saveOrders(orders);
      return sendJson(res, 201, { order: withComputed(order), find });
    }

    if (req.method === "POST" && parts[3] === "messages") {
      const b = await readBody(req);
      const text = String(b.text || "").trim();
      if (!text) return sendJson(res, 400, { error: "text is required" });
      const msg = {
        id: newId(),
        sender: b.sender === "owner" ? "owner" : "customer",
        author: String(b.author || "").trim(),
        text,
        at: new Date().toISOString()
      };
      order.messages = order.messages || [];
      order.messages.push(msg);
      saveOrders(orders);
      return sendJson(res, 201, { order: withComputed(order), message: msg });
    }
  }

  return sendJson(res, 404, { error: "not found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);

    if (url.pathname.startsWith("/uploads/")) {
      const file = path.join(UPLOAD_DIR, path.basename(url.pathname));
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end("not found"); }
      const ext = path.extname(file).toLowerCase();
      const type = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=86400" });
      return fs.createReadStream(file).pipe(res);
    }

    if (url.pathname === "/" || url.pathname === "/owner") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page(url.pathname === "/owner" ? "owner" : "customer"));
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  } catch (e) {
    sendJson(res, 500, { error: String(e && e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log("Orders app running on port " + PORT);
  console.log("Customer app: http://localhost:" + PORT + "/");
  console.log("Owner app:    http://localhost:" + PORT + "/owner");
});

/* ============================ Pages ============================ */
function page(mode) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${mode === "owner" ? "Owner — Orders" : "Upload your order"}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:#f6f4ef;color:#1e2a26}
  header{background:#17604a;color:#fff;padding:16px 20px}
  header h1{margin:0;font-size:22px}
  header p{margin:4px 0 0;font-size:13px;opacity:.85}
  header a{color:#ffd97a}
  .wrap{max-width:1000px;margin:0 auto;padding:16px}
  .panel{background:#fff;border:1px solid #ddd8cc;border-radius:12px;padding:16px;margin-bottom:16px}
  .panel h2{margin:0 0 12px;font-size:17px}
  label{display:block;font-size:13px;font-weight:600;margin:10px 0 4px}
  input[type=text],input[type=number],input[type=password],textarea{width:100%;padding:9px 10px;border:1px solid #ddd8cc;border-radius:8px;font-size:15px}
  textarea{min-height:56px;resize:vertical}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  @media(max-width:640px){.row{grid-template-columns:1fr}}
  button{cursor:pointer;border:none;border-radius:8px;padding:9px 14px;font-size:14px;font-weight:600;background:#17604a;color:#fff}
  button.ghost{background:#fff;border:1px solid #ddd8cc;color:#1e2a26}
  button.danger{background:#fff;border:1px solid #b23a2e;color:#b23a2e}
  button.small{padding:5px 9px;font-size:12px}
  button.on{background:#c9a24b;color:#fff;border-color:#c9a24b}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
  .card{background:#fff;border:1px solid #ddd8cc;border-radius:12px;overflow:hidden}
  .card img{width:100%;height:180px;object-fit:cover;display:block;background:#eee}
  .noimg{height:120px;display:flex;align-items:center;justify-content:center;color:#6b7a74;background:#faf8f3;font-size:13px}
  .cb{padding:12px 14px}
  .cb h3{margin:0 0 4px;font-size:17px}
  .meta{font-size:13px;color:#6b7a74}
  .desc{font-size:14px;white-space:pre-wrap;margin:6px 0}
  .chip{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700;background:#eef3f0;color:#17604a;border:1px solid #cfe0d8}
  .find{background:#f3efe4;border-radius:8px;padding:7px 10px;font-size:13px;margin-top:6px}
  .badge{display:inline-block;font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px;background:#c9a24b;color:#fff;margin-left:6px}
  .badge.near{background:#17604a}
  .chat{border-top:1px solid #eee;margin-top:10px;padding-top:8px}
  .msg{font-size:13px;margin:5px 0;padding:6px 9px;border-radius:8px;background:#f4f6f5}
  .msg.owner{background:#fdf6e0}
  .msg b{font-size:12px}
  .flex{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px}
  .flex input{flex:1}
  .totals{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}
  .tot{flex:1 1 140px;background:#fff;border:1px solid #ddd8cc;border-radius:12px;padding:10px 14px}
  .tot .l{font-size:11px;color:#6b7a74;text-transform:uppercase;letter-spacing:.05em}
  .tot .v{font-size:22px;font-weight:700}
  .preview{width:110px;height:110px;object-fit:cover;border-radius:10px;border:1px dashed #ddd8cc;display:none}
  .note{font-size:12px;color:#6b7a74}
</style>
</head>
<body>
<header>
  <h1>${mode === "owner" ? "Owner — All orders" : "Upload your order"}</h1>
  <p>${mode === "owner"
    ? 'Every order customers uploaded, in one place. <a href="/">Open the customer app</a>'
    : 'Send a photo and a description of what you want. The owner will look for the nearest, lowest price. <a href="/owner">Owner app</a>'}</p>
</header>
<div class="wrap" id="app"></div>
<script>
var MODE = "${mode}";
var STATUSES = ["Looking for it","Found - can buy","Negotiating","Not available","Cancelled"];
var orders = [];
var pendingPhoto = null;

function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function ownerCode(){ return sessionStorage.getItem("ownerCode") || ""; }
function api(path, opts){
  opts = opts || {};
  opts.headers = Object.assign({"Content-Type":"application/json"}, opts.headers || {});
  if (MODE === "owner") opts.headers["x-owner-code"] = ownerCode();
  return fetch(path, opts).then(function(r){
    return r.json().then(function(j){ if(!r.ok) throw new Error(j.error || ("HTTP "+r.status)); return j; });
  });
}
function load(){
  return api("/api/orders").then(function(j){ orders = j.orders; render(); })
    .catch(function(e){ document.getElementById("list").innerHTML = "<p>Could not load orders: "+esc(e.message)+"</p>"; });
}

function headerHtml(){
  var h = "";
  if (MODE === "customer") {
    h += '<section class="panel"><h2>New order</h2>'
      + '<label>Photo of the item</label><input type="file" id="fPhoto" accept="image/*">'
      + '<img id="fPreview" class="preview" alt="">'
      + '<div class="row"><div><label>Item name *</label><input type="text" id="fItem" placeholder="e.g. DualSense controller, white"></div>'
      + '<div><label>Your name</label><input type="text" id="fName" placeholder="e.g. Alex"></div></div>'
      + '<label>Description</label><textarea id="fDesc" placeholder="Size, colour, model, any details..."></textarea>'
      + '<div class="row"><div><label>Quantity</label><input type="number" id="fQty" value="1" min="1"></div>'
      + '<div><label>Price you saw (optional)</label><input type="number" id="fPrice" min="0" step="any" placeholder="e.g. 8980"></div></div>'
      + '<div class="flex"><button id="sendBtn">Send order</button><span class="note" id="sendNote"></span></div></section>';
  } else {
    var totalLowest = 0, hasLowest = false, newCount = 0;
    orders.forEach(function(o){
      if (o.status === "New") newCount++;
      if (o.lowestFind && typeof o.lowestFind.price === "number") { totalLowest += o.lowestFind.price * (o.quantity||1); hasLowest = true; }
    });
    h += '<div class="totals"><div class="tot"><div class="l">Orders</div><div class="v">'+orders.length+'</div></div>'
      + '<div class="tot"><div class="l">New</div><div class="v">'+newCount+'</div></div>'
      + '<div class="tot"><div class="l">Lowest-price total</div><div class="v">'+(hasLowest ? "¥"+totalLowest.toLocaleString() : "—")+'</div></div></div>'
      + '<section class="panel"><h2>Owner passcode</h2>'
      + '<div class="flex"><input type="password" id="oc" placeholder="Owner passcode" value="'+esc(ownerCode())+'" style="flex:1">'
      + '<button class="ghost" id="ocSave">Save</button></div>'
      + '<p class="note">Needed to change a status, add a price find, or delete an order. It is kept only in this browser tab.</p></section>';
  }
  return h;
}

function findHtml(o, f){
  var badges = "";
  if (o.lowestFind && o.lowestFind.id === f.id) badges += '<span class="badge">LOWEST PRICE</span>';
  if (o.nearestFind && o.nearestFind.id === f.id) badges += '<span class="badge near">NEAREST</span>';
  return '<div class="find"><b>'+esc(f.store)+'</b>'+badges+'<br>'
    + esc(f.location || "")
    + (typeof f.price === "number" ? " — ¥"+Number(f.price).toLocaleString() : "")
    + (typeof f.distanceKm === "number" ? " — "+f.distanceKm+" km away" : "")
    + '</div>';
}

function cardHtml(o){
  var h = '<article class="card">'
    + (o.photoUrl ? '<img src="'+esc(o.photoUrl)+'" alt="">' : '<div class="noimg">No photo</div>')
    + '<div class="cb"><h3>'+esc(o.itemName)+'</h3>'
    + '<div><span class="chip">'+esc(o.status)+'</span></div>'
    + (o.description ? '<div class="desc">'+esc(o.description)+'</div>' : '')
    + '<div class="meta">From: '+esc(o.customerName || "—")+' · Qty: '+(o.quantity||1)
    + (typeof o.priceSeen === "number" ? ' · Price they saw: ¥'+Number(o.priceSeen).toLocaleString() : '')
    + '</div>';
  (o.finds || []).forEach(function(f){ h += findHtml(o, f); });
  h += '<div class="flex">'
    + '<a target="_blank" rel="noopener" href="https://www.google.com/search?q='+encodeURIComponent(o.itemName)+'"><button type="button" class="ghost small">Search the web</button></a>'
    + '<a target="_blank" rel="noopener" href="https://www.google.com/maps/search/'+encodeURIComponent(o.itemName)+'"><button type="button" class="ghost small">Search on a map</button></a>'
    + '</div>';
  if (MODE === "owner") {
    h += '<div class="flex">';
    STATUSES.forEach(function(s){
      h += '<button type="button" class="ghost small'+(o.status===s?" on":"")+'" onclick="setStatus(\\''+o.id+'\\',\\''+s+'\\')">'+s+'</button>';
    });
    h += '<button type="button" class="danger small" onclick="delOrder(\\''+o.id+'\\')">Delete</button></div>'
      + '<div style="margin-top:10px"><b style="font-size:13px">Add a price find</b>'
      + '<input type="text" id="fs-'+o.id+'" placeholder="Store name">'
      + '<input type="text" id="fl-'+o.id+'" placeholder="Location">'
      + '<div class="row"><input type="number" id="fp-'+o.id+'" placeholder="Price (¥)" min="0" step="any">'
      + '<input type="number" id="fd-'+o.id+'" placeholder="Distance (km)" min="0" step="any"></div>'
      + '<div class="flex"><button type="button" class="small" onclick="addFind(\\''+o.id+'\\')">Add find</button></div></div>';
  }
  h += '<div class="chat"><b style="font-size:13px">Chat about this item</b>'
    + (o.messages || []).map(function(m){
        return '<div class="msg '+(m.sender==="owner"?"owner":"")+'"><b>'+(m.sender==="owner"?"Owner":"Customer")+(m.author?" · "+esc(m.author):"")+'</b><br>'+esc(m.text)+'</div>';
      }).join("")
    + '<div class="flex"><input type="text" id="cm-'+o.id+'" placeholder="Write a message...">'
    + '<button type="button" class="small" onclick="sendMsg(\\''+o.id+'\\')">Send</button></div></div>';
  h += '</div></article>';
  return h;
}

function render(){
  var app = document.getElementById("app");
  app.innerHTML = headerHtml()
    + '<div class="flex" style="margin-bottom:12px"><button class="ghost small" onclick="load()">Refresh</button>'
    + '<span class="note">Orders update automatically every few seconds.</span></div>'
    + '<div class="cards" id="list">'
    + (orders.length ? orders.map(cardHtml).join("") : '<p>No orders yet.</p>')
    + '</div>';
  if (MODE === "customer") bindForm();
  if (MODE === "owner") {
    document.getElementById("ocSave").addEventListener("click", function(){
      sessionStorage.setItem("ownerCode", document.getElementById("oc").value.trim());
      alert("Passcode saved for this tab.");
    });
  }
}

function bindForm(){
  var file = document.getElementById("fPhoto");
  file.addEventListener("change", function(){
    var f = file.files[0]; if (!f) return;
    var img = new Image();
    img.onload = function(){
      var max = 1200, w = img.width, h = img.height;
      if (Math.max(w,h) > max) { var s = max/Math.max(w,h); w = Math.round(w*s); h = Math.round(h*s); }
      var c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      pendingPhoto = c.toDataURL("image/jpeg", 0.82);
      var p = document.getElementById("fPreview"); p.src = pendingPhoto; p.style.display = "block";
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  });
  document.getElementById("sendBtn").addEventListener("click", function(){
    var item = document.getElementById("fItem").value.trim();
    if (!item) { alert("Please write the item name."); return; }
    var body = {
      itemName: item,
      customerName: document.getElementById("fName").value.trim(),
      description: document.getElementById("fDesc").value.trim(),
      quantity: parseInt(document.getElementById("fQty").value, 10) || 1,
      priceSeen: document.getElementById("fPrice").value === "" ? null : Number(document.getElementById("fPrice").value),
      photoDataUrl: pendingPhoto
    };
    api("/api/orders", { method: "POST", body: JSON.stringify(body) })
      .then(function(){ pendingPhoto = null; document.getElementById("sendNote").textContent = "Sent!"; return load(); })
      .catch(function(e){ alert("Could not send: " + e.message); });
  });
}

function setStatus(id, status){
  api("/api/orders/"+id+"/status", { method: "POST", body: JSON.stringify({ status: status }) })
    .then(load).catch(function(e){ alert(e.message + " (check the owner passcode)"); });
}
function addFind(id){
  var body = {
    store: document.getElementById("fs-"+id).value.trim(),
    location: document.getElementById("fl-"+id).value.trim(),
    price: document.getElementById("fp-"+id).value === "" ? null : Number(document.getElementById("fp-"+id).value),
    distanceKm: document.getElementById("fd-"+id).value === "" ? null : Number(document.getElementById("fd-"+id).value)
  };
  if (!body.store) { alert("Please write the store name."); return; }
  api("/api/orders/"+id+"/finds", { method: "POST", body: JSON.stringify(body) })
    .then(load).catch(function(e){ alert(e.message + " (check the owner passcode)"); });
}
function delOrder(id){
  if (!confirm("Delete this order?")) return;
  api("/api/orders/"+id, { method: "DELETE" }).then(load).catch(function(e){ alert(e.message + " (check the owner passcode)"); });
}
function sendMsg(id){
  var input = document.getElementById("cm-"+id);
  var text = input.value.trim(); if (!text) return;
  var author = "";
  if (MODE === "customer") { var n = document.getElementById("fName"); author = n ? n.value.trim() : ""; }
  api("/api/orders/"+id+"/messages", { method: "POST", body: JSON.stringify({ sender: MODE, author: author, text: text }) })
    .then(load).catch(function(e){ alert(e.message); });
}

load();
setInterval(function(){
  var typing = document.activeElement && (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA");
  if (!typing) load();
}, 6000);
</script>
</body>
</html>`;
}
