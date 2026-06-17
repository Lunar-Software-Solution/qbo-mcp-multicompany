// Self-contained admin dashboard served at GET /admin. Embedded as a string so
// it ships in dist/ without extra build steps. The browser JS uses string
// concatenation (no template literals) to avoid clashing with this TS literal.
export const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>QuickBooks Connections</title>
<style>
  :root { --bg:#0f172a; --card:#1e293b; --line:#334155; --muted:#94a3b8; --fg:#e2e8f0;
          --accent:#2E8B57; --accent2:#2563eb; --danger:#dc2626; --warn:#d97706; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif;
         background:var(--bg); color:var(--fg); }
  header { display:flex; align-items:center; justify-content:space-between;
           padding:18px 24px; border-bottom:1px solid var(--line); }
  header h1 { font-size:18px; margin:0; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 24px; }
  .pill { font-size:12px; padding:3px 10px; border-radius:999px; border:1px solid var(--line); color:var(--muted); }
  .pill.ok { color:#86efac; border-color:#14532d; background:#052e16; }
  .pill.bad { color:#fca5a5; border-color:#7f1d1d; background:#450a0a; }
  .pill.warn { color:#fcd34d; border-color:#78350f; background:#451a03; }
  .bar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:20px; }
  input[type=password], input[type=text] { background:#0b1220; border:1px solid var(--line);
    color:var(--fg); padding:9px 11px; border-radius:8px; min-width:280px; font-size:13px; }
  button { cursor:pointer; border:none; border-radius:8px; padding:9px 14px; font-size:13px; font-weight:600; color:#fff; }
  button.primary { background:var(--accent2); }
  button.green { background:var(--accent); }
  button.ghost { background:transparent; border:1px solid var(--line); color:var(--fg); }
  button.danger { background:transparent; border:1px solid #7f1d1d; color:#fca5a5; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin-bottom:14px; }
  .card h3 { margin:0 0 4px; font-size:15px; }
  .meta { color:var(--muted); font-size:12px; margin-bottom:12px; }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .url { font-family: ui-monospace, Menlo, Consolas, monospace; font-size:12px; background:#0b1220;
         border:1px solid var(--line); padding:7px 9px; border-radius:8px; flex:1; overflow:auto; white-space:nowrap; }
  .empty { color:var(--muted); text-align:center; padding:40px; border:1px dashed var(--line); border-radius:12px; }
  .toast { position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#111827;
           border:1px solid var(--line); padding:10px 16px; border-radius:8px; font-size:13px; opacity:0; transition:opacity .2s; }
  .toast.show { opacity:1; }
  a { color:#93c5fd; }
</style>
</head>
<body>
<header>
  <h1>QuickBooks Connections</h1>
  <span id="serverStatus" class="pill">checking…</span>
</header>
<div class="wrap">
  <div class="bar">
    <input id="token" type="password" placeholder="Admin bearer token" autocomplete="off" />
    <button class="ghost" id="saveToken">Save token</button>
    <button class="green" id="connectBtn">+ Connect a company</button>
    <button class="ghost" id="refreshBtn">Refresh</button>
  </div>
  <div id="companies"></div>
</div>
<div id="toast" class="toast"></div>
<script>
(function(){
  var TKEY = "qbo_admin_token";
  var tokenInput = document.getElementById("token");
  tokenInput.value = sessionStorage.getItem(TKEY) || "";

  function token(){ return sessionStorage.getItem(TKEY) || ""; }
  function toast(msg){ var t=document.getElementById("toast"); t.textContent=msg; t.classList.add("show");
    setTimeout(function(){ t.classList.remove("show"); }, 2200); }

  function api(path, opts){
    opts = opts || {};
    opts.headers = Object.assign({ "Authorization": "Bearer " + token() }, opts.headers || {});
    return fetch(path, opts);
  }

  function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]; }); }

  function loadHealth(){
    fetch("/health").then(function(r){ return r.json(); }).then(function(d){
      var el=document.getElementById("serverStatus");
      el.textContent = "server ok · " + d.companies + " companies";
      el.className = "pill ok";
    }).catch(function(){
      var el=document.getElementById("serverStatus"); el.textContent="server unreachable"; el.className="pill bad";
    });
  }

  function loadCompanies(){
    var box = document.getElementById("companies");
    if(!token()){ box.innerHTML = '<div class="empty">Enter your admin bearer token above to begin.</div>'; return; }
    box.innerHTML = '<div class="empty">Loading…</div>';
    api("/companies").then(function(r){
      if(r.status===401){ box.innerHTML='<div class="empty">Unauthorized — check your token.</div>'; return null; }
      return r.json();
    }).then(function(d){
      if(!d) return;
      var list = d.companies || [];
      if(!list.length){ box.innerHTML='<div class="empty">No companies connected yet. Click “Connect a company”.</div>'; return; }
      box.innerHTML = "";
      list.forEach(function(c){ box.appendChild(card(c)); });
    }).catch(function(){ box.innerHTML='<div class="empty">Failed to load companies.</div>'; });
  }

  function card(c){
    var div = document.createElement("div");
    div.className = "card";
    var name = c.displayName || "(name unknown — run a health check)";
    div.innerHTML =
      '<div class="row" style="justify-content:space-between;">' +
        '<h3>' + esc(name) + '</h3>' +
        '<span class="pill" data-status>' + esc(c.environment||"") + '</span>' +
      '</div>' +
      '<div class="meta">Realm ID: ' + esc(c.realmId) + (c.connectedAt? ' · connected ' + esc(c.connectedAt.slice(0,10)) : '') + '</div>' +
      '<div class="row" style="margin-bottom:10px;">' +
        '<span class="url">' + esc(c.mcpUrl) + '</span>' +
        '<button class="ghost" data-copy>Copy URL</button>' +
      '</div>' +
      '<div class="row">' +
        '<button class="green" data-health>Test &amp; refresh</button>' +
        '<button class="danger" data-disc>Disconnect</button>' +
      '</div>';

    div.querySelector("[data-copy]").onclick = function(){
      var text = c.mcpUrl + "  (header: Authorization: Bearer <token>)";
      navigator.clipboard.writeText(text).then(function(){ toast("MCP URL copied"); });
    };
    div.querySelector("[data-health]").onclick = function(ev){
      var btn=ev.target; btn.disabled=true; btn.textContent="Checking…";
      var badge=div.querySelector("[data-status]");
      api("/companies/" + encodeURIComponent(c.realmId) + "/health").then(function(r){ return r.json(); }).then(function(h){
        if(h.ok){ badge.className="pill ok"; badge.textContent="connected · " + esc(h.environment||"");
          if(h.companyName){ div.querySelector("h3").textContent = h.companyName; } toast("Token refreshed · connection OK"); }
        else { badge.className="pill bad"; badge.textContent="error"; toast("Health check failed: " + (h.error||"")); }
      }).catch(function(){ badge.className="pill bad"; badge.textContent="error"; toast("Health check failed"); })
        .finally(function(){ btn.disabled=false; btn.textContent="Test & refresh"; });
    };
    div.querySelector("[data-disc]").onclick = function(){
      if(!confirm("Disconnect " + name + " (" + c.realmId + ")? The server will lose access to this company.")) return;
      api("/companies/" + encodeURIComponent(c.realmId), { method:"DELETE" }).then(function(r){ return r.json(); }).then(function(){
        toast("Disconnected"); loadCompanies(); loadHealth();
      }).catch(function(){ toast("Disconnect failed"); });
    };
    return div;
  }

  document.getElementById("saveToken").onclick = function(){
    sessionStorage.setItem(TKEY, tokenInput.value.trim()); toast("Token saved"); loadCompanies(); loadHealth();
  };
  document.getElementById("refreshBtn").onclick = function(){ loadCompanies(); loadHealth(); };
  document.getElementById("connectBtn").onclick = function(){
    if(!token()){ toast("Save your admin token first"); return; }
    window.open("/connect?token=" + encodeURIComponent(token()), "_blank");
    toast("Finish authorizing in the new tab, then click Refresh");
  };

  loadHealth();
  loadCompanies();
})();
</script>
</body>
</html>`;
