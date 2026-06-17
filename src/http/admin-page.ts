// Self-contained admin dashboard served at GET /admin. Embedded as a string so
// it ships in dist/ without extra build steps. Browser JS uses string
// concatenation (no template literals) to avoid clashing with this TS literal.
export const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>QuickBooks Connections</title>
<style>
  :root {
    --bg:#f4f6f9; --card:#ffffff; --line:#e4e7ec; --line2:#eef1f4;
    --fg:#1f2933; --muted:#667085; --label:#8a93a2;
    --accent:#2563eb; --green:#15803d; --green-bg:#dcfce7; --green-bd:#a7f3c4;
    --red:#b42318; --red-bg:#fee4e2; --amber:#b54708; --amber-bg:#fef0c7;
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font-family:-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size:14px; }
  header { display:flex; align-items:center; justify-content:space-between;
           padding:16px 24px; background:var(--card); border-bottom:1px solid var(--line); }
  header h1 { font-size:17px; margin:0; font-weight:650; }
  .wrap { max-width: 960px; margin:0 auto; padding:24px; }
  .pill { font-size:12px; font-weight:600; padding:3px 10px; border-radius:999px; border:1px solid var(--line); color:var(--muted); white-space:nowrap; }
  .pill.ok { color:var(--green); background:var(--green-bg); border-color:var(--green-bd); }
  .pill.bad { color:var(--red); background:var(--red-bg); border-color:#fda29b; }
  .pill.muted { color:var(--muted); background:#f2f4f7; border-color:var(--line); }
  .bar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:20px; }
  input[type=password], input[type=text] { background:#fff; border:1px solid var(--line); color:var(--fg);
    padding:9px 11px; border-radius:8px; min-width:300px; font-size:13px; }
  button { cursor:pointer; border:none; border-radius:8px; padding:9px 14px; font-size:13px; font-weight:600; }
  button.primary { background:var(--accent); color:#fff; }
  button.green { background:var(--green); color:#fff; }
  button.ghost { background:#fff; border:1px solid var(--line); color:var(--fg); }
  button.link { background:none; border:none; color:var(--accent); padding:4px 6px; font-weight:600; }
  button.danger { background:#fff; border:1px solid #fda29b; color:var(--red); }
  button:disabled { opacity:.55; cursor:not-allowed; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px 20px; margin-bottom:16px;
          box-shadow:0 1px 2px rgba(16,24,40,.04); }
  .card-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
  .card-title { display:flex; align-items:center; gap:9px; }
  .card-title h3 { margin:0; font-size:16px; font-weight:650; }
  .glyph { width:26px; height:26px; border-radius:7px; background:#eef2ff; color:var(--accent);
           display:flex; align-items:center; justify-content:center; font-size:15px; }
  .badges { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .meta { color:var(--muted); font-size:12.5px; margin:4px 0 14px 35px; }
  .actions { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:6px; }
  .sections { border-top:1px solid var(--line2); margin-top:14px; padding-top:6px; }
  .section { padding:12px 0; border-bottom:1px solid var(--line2); }
  .section:last-child { border-bottom:none; }
  .section-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
  .section-head h4 { margin:0; font-size:13px; font-weight:650; display:flex; align-items:center; gap:7px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 28px; }
  .kv { font-size:13px; }
  .kv .k { color:var(--label); font-size:11.5px; text-transform:uppercase; letter-spacing:.03em; }
  .kv .v { color:var(--fg); }
  .empty { color:var(--muted); text-align:center; padding:42px; background:var(--card); border:1px dashed var(--line); border-radius:14px; }
  .loading { color:var(--muted); font-size:13px; padding:8px 0; }
  .toast { position:fixed; bottom:22px; left:50%; transform:translateX(-50%); background:#1f2933; color:#fff;
           padding:10px 16px; border-radius:8px; font-size:13px; opacity:0; transition:opacity .2s; pointer-events:none; }
  .toast.show { opacity:1; }
  code { font-family:ui-monospace, Menlo, Consolas, monospace; font-size:12px; }
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
  // localStorage (persists across reloads/tabs); migrate any old sessionStorage value.
  var saved = localStorage.getItem(TKEY) || sessionStorage.getItem(TKEY) || "";
  if (saved) localStorage.setItem(TKEY, saved);
  tokenInput.value = saved;

  function token(){ return localStorage.getItem(TKEY) || ""; }
  function toast(m){ var t=document.getElementById("toast"); t.textContent=m; t.classList.add("show"); setTimeout(function(){ t.classList.remove("show"); }, 2200); }
  function api(path, opts){ opts=opts||{}; opts.headers=Object.assign({ "Authorization":"Bearer "+token() }, opts.headers||{}); return fetch(path, opts); }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]; }); }
  function kv(k, v){ return '<div class="kv"><div class="k">'+esc(k)+'</div><div class="v">'+(v?esc(v):"\\u2014")+'</div></div>'; }

  function loadHealth(){
    fetch("/health").then(function(r){ return r.json(); }).then(function(d){
      var el=document.getElementById("serverStatus"); el.textContent="server ok · "+d.companies+" companies"; el.className="pill ok";
    }).catch(function(){ var el=document.getElementById("serverStatus"); el.textContent="server unreachable"; el.className="pill bad"; });
  }

  function loadCompanies(){
    var box=document.getElementById("companies");
    if(!token()){ box.innerHTML='<div class="empty">Enter your admin bearer token above to begin.</div>'; return; }
    box.innerHTML='<div class="empty">Loading…</div>';
    api("/companies").then(function(r){
      if(r.status===401){ box.innerHTML='<div class="empty">Unauthorized — check your token.</div>'; return null; }
      return r.json();
    }).then(function(d){
      if(!d) return;
      var list=d.companies||[];
      if(!list.length){ box.innerHTML='<div class="empty">No companies connected yet. Click “Connect a company”.</div>'; return; }
      box.innerHTML="";
      list.forEach(function(c){ box.appendChild(card(c)); });
    }).catch(function(){ box.innerHTML='<div class="empty">Failed to load companies.</div>'; });
  }

  function card(c){
    var div=document.createElement("div"); div.className="card";
    div.innerHTML=
      '<div class="card-head">' +
        '<div class="card-title"><span class="glyph">\\u{1F3E2}</span><div>' +
          '<h3 data-name>' + esc(c.displayName || "Company") + '</h3>' +
        '</div></div>' +
        '<div class="badges">' +
          '<span class="pill muted">' + esc(c.environment||"") + '</span>' +
          '<span class="pill muted" data-cur>—</span>' +
          '<span class="pill muted" data-health>checking…</span>' +
        '</div>' +
      '</div>' +
      '<div class="meta">QuickBooks Online · Connected — Realm ID: ' + esc(c.realmId) + '</div>' +
      '<div class="actions">' +
        '<button class="ghost" data-test>↻ Test Connection</button>' +
        '<button class="ghost" data-copy>Copy MCP URL</button>' +
        '<button class="danger" data-disc>Disconnect</button>' +
      '</div>' +
      '<div class="sections"><div class="loading" data-body>Loading details…</div></div>';

    div.querySelector("[data-copy]").onclick=function(){
      navigator.clipboard.writeText(c.mcpUrl + "  (headers: CF-Access-Client-Id/Secret + Authorization: Bearer <token>)").then(function(){ toast("MCP URL copied"); });
    };
    div.querySelector("[data-disc]").onclick=function(){
      if(!confirm("Disconnect "+(c.displayName||c.realmId)+"? The server will lose access to this company.")) return;
      api("/companies/"+encodeURIComponent(c.realmId), {method:"DELETE"}).then(function(){ toast("Disconnected"); loadCompanies(); loadHealth(); });
    };
    div.querySelector("[data-test]").onclick=function(ev){
      var b=ev.target; b.disabled=true; b.textContent="Checking…";
      api("/companies/"+encodeURIComponent(c.realmId)+"/health").then(function(r){return r.json();}).then(function(h){
        setHealth(div, h.ok); toast(h.ok?"Token refreshed · connection OK":"Health check failed");
      }).catch(function(){ setHealth(div,false); }).finally(function(){ b.disabled=false; b.textContent="↻ Test Connection"; });
    };

    loadInfo(c, div);
    return div;
  }

  function setHealth(div, ok){
    var p=div.querySelector("[data-health]");
    p.className="pill "+(ok?"ok":"bad"); p.textContent=ok?"QBO · Healthy":"QBO · Error";
  }

  function loadInfo(c, div){
    api("/companies/"+encodeURIComponent(c.realmId)+"/info").then(function(r){return r.json();}).then(function(i){
      if(!i || i.health!=="ok"){ setHealth(div,false); div.querySelector("[data-body]").innerHTML='<div class="loading">Could not load details'+(i&&i.error?': '+esc(i.error):'')+'</div>'; return; }
      setHealth(div, true);
      if(i.companyName) div.querySelector("[data-name]").textContent=i.companyName;
      if(i.currency){ var cu=div.querySelector("[data-cur]"); cu.textContent=i.currency; }
      var a=i.address||{};
      var addrLine=[a.line1, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(", ");
      var sections=
        section("Legal details", '\\u{2696}', [ ["Legal name", i.legalName], ["Country", i.country], ["Industry", i.industry] ]) +
        section("Address", '\\u{1F4CD}', [ ["Address", addrLine] ]) +
        section("Contact", '\\u{2709}', [ ["Email", i.email], ["Phone", i.phone], ["Website", i.webAddr] ]) +
        section("Fiscal & plan", '\\u{1F4C5}', [ ["Fiscal year start", i.fiscalYearStartMonth], ["Subscription", i.subscriptionStatus], ["Plan", i.offeringSku], ["Multi-currency", i.multiCurrency===undefined?"":(i.multiCurrency?"Enabled":"Off")] ]) ;
      div.querySelector("[data-body]").outerHTML='<div data-body>'+sections+'</div>';
    }).catch(function(){ setHealth(div,false); div.querySelector("[data-body]").innerHTML='<div class="loading">Failed to load details.</div>'; });
  }

  function section(title, glyph, rows){
    var refresh = title==="Legal details" ? '<button class="link" data-refresh>↻ Refresh from QuickBooks</button>' : '';
    var cells = rows.map(function(r){ return kv(r[0], r[1]); }).join("");
    return '<div class="section"><div class="section-head"><h4>'+glyph+' '+esc(title)+'</h4>'+refresh+'</div><div class="grid">'+cells+'</div></div>';
  }

  // Delegated handler for per-card "Refresh from QuickBooks"
  document.getElementById("companies").addEventListener("click", function(ev){
    var btn = ev.target.closest ? ev.target.closest("[data-refresh]") : null;
    if(!btn) return;
    var cardEl = btn.closest(".card"); if(!cardEl) return;
    var realm = (cardEl.querySelector(".meta").textContent.match(/Realm ID: (\\S+)/)||[])[1];
    if(!realm) return;
    cardEl.querySelector("[data-body]").innerHTML='<div class="loading">Refreshing…</div>';
    loadInfo({ realmId: realm }, cardEl); toast("Refreshing from QuickBooks…");
  });

  document.getElementById("saveToken").onclick=function(){ localStorage.setItem(TKEY, tokenInput.value.trim()); toast("Token saved"); loadCompanies(); loadHealth(); };
  document.getElementById("refreshBtn").onclick=function(){ loadCompanies(); loadHealth(); };
  document.getElementById("connectBtn").onclick=function(){
    if(!token()){ toast("Save your admin token first"); return; }
    window.open("/connect?token="+encodeURIComponent(token()), "_blank");
    toast("Finish authorizing in the new tab, then click Refresh");
  };

  loadHealth();
  loadCompanies();
})();
</script>
</body>
</html>`;
