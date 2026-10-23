/* Tostones Multi: la misma idea de Tostitos, pero con varias fábricas en una base de datos PostgreSQL (Supabase). */
"use strict";

/* ---------- utilidades ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const r2 = n => Math.round(num(n) * 100) / 100;
let MON = "$";
const money = n => (num(n) < 0 ? "-" : "") + MON + Math.abs(num(n)).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = n => num(n).toLocaleString("es-DO", { maximumFractionDigits: 2 });
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fdate = f => { if (!f) return ""; const [y, m, d] = f.split("-").map(Number); return `${d} ${MESES[m - 1].slice(0, 3)} ${y}`; };
const fmes = m => { const [y, mm] = m.split("-").map(Number); return `${MESES[mm - 1]} ${y}`; };
const sortF = a => [...a].sort((x, y) => (y.fecha || "").localeCompare(x.fecha || "") || (y.creado || "").localeCompare(x.creado || ""));
const sortN = a => [...a].sort((x, y) => (x.nombre || "").localeCompare(y.nombre || "", "es"));
const limpiaCod = c => String(c || "").trim().toUpperCase();
const opts = (list, sel, ph) => (ph != null ? `<option value="">${esc(ph)}</option>` : "") + list.map(x => `<option value="${esc(x.id)}"${x.id === sel ? " selected" : ""}>${esc(x.nombre)}</option>`).join("");
let toastT;
function toast(t) { const e = $("toast"); e.textContent = t; e.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => e.hidden = true, 3200); }
function errMsg(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (e && e.code === "42501") return "No tienes permiso para hacer esto en esta fábrica.";
  if (e && e.code === "23503") return "No se puede: este dato está siendo usado en otro registro.";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "No hay conexión con la base de datos. Revisa tu internet.";
  return m;
}
const fail = e => { console.error(e); toast(errMsg(e)); };
const chk = ({ data, error }) => { if (error) throw error; return data; };

/* ---------- conexión ---------- */
if (!window.supabase || !window.SUPABASE_URL || /TU-PROYECTO/.test(window.SUPABASE_URL)) {
  $("login").hidden = false; $("fLogin").hidden = true; $("lgModo").hidden = $("lgOlvide").hidden = true;
  $("loginSub").textContent = "Falta configurar Supabase en config.js (mira el README).";
  throw new Error("Supabase sin configurar");
}
const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

/* ---------- estado ---------- */
let USER = null, E = null;          // usuario y empresa (fábrica) actual
let EMPRESAS = [];                  // [{id,nombre,moneda,dias_aviso,rol}]
const S = { tipos: [], clientes: [], gastos: [], producciones: [], ventas: [], pagos: [], miembros: [], invitaciones: [], inventario: [] };
const emp = () => EMPRESAS.find(x => x.id === E) || {};
const esAdmin = () => ["dueno", "admin"].includes(emp().rol);
const byId = (col, id) => S[col].find(x => x.id === id);

/* Trae todas las filas de una tabla de esta fábrica (de 1000 en 1000) */
async function todo(tabla, select = "*", orden = "creado") {
  const out = [];
  for (let i = 0; ; i += 1000) {
    const q = sb.from(tabla).select(select).eq("empresa_id", E);
    const rows = chk(await (orden ? q.order(orden) : q).range(i, i + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
const LOAD = {
  tipos: () => todo("tipos_toston"),
  clientes: () => todo("clientes"),
  gastos: () => todo("gastos"),
  producciones: () => todo("producciones", "*, items:produccion_items(*)"),
  ventas: () => todo("ventas", "*, items:venta_items(*)"),
  pagos: () => todo("pagos"),
  miembros: () => todo("miembros"),
  invitaciones: async () => esAdmin() ? todo("invitaciones") : [],
  inventario: () => todo("v_inventario", "*", null),
};
async function recargar(...cols) {
  if (!cols.length) cols = Object.keys(LOAD);
  const res = await Promise.all(cols.map(c => LOAD[c]()));
  cols.forEach((c, i) => S[c] = res[i]);
  renderAll();
}

/* ---------- entrar / salir ---------- */
let modo = "entrar";
function pintaLogin() {
  const reg = modo === "crear", olv = modo === "olvide";
  $("lgBtn").textContent = reg ? "Crear cuenta" : olv ? "Enviarme el enlace" : "Entrar";
  $("lgPassBox").hidden = olv; $("lgPass").required = !olv;
  $("lgPass").autocomplete = reg ? "new-password" : "current-password";
  if (reg) $("lgPass").minLength = 6; else $("lgPass").removeAttribute("minlength");
  $("lgModo").textContent = reg || olv ? "Ya tengo cuenta: entrar" : "¿No tienes cuenta? Crear una";
  $("lgOlvide").hidden = olv;
  $("loginSub").textContent = reg ? "Crea tu cuenta con tu correo." : olv ? "Te enviamos un enlace para cambiar la contraseña." : "Entra con tu correo y contraseña.";
  $("lgMsg").textContent = ""; $("lgMsg").className = "msg";
}
$("lgModo").onclick = () => { modo = modo === "entrar" ? "crear" : "entrar"; pintaLogin(); };
$("lgOlvide").onclick = () => { modo = "olvide"; pintaLogin(); };
$("fLogin").addEventListener("submit", async ev => {
  ev.preventDefault();
  const email = $("lgEmail").value.trim().toLowerCase(), password = $("lgPass").value, msg = $("lgMsg");
  msg.className = "msg"; msg.textContent = "Un momento…";
  try {
    if (modo === "olvide") {
      chk(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] }));
      msg.className = "msg ok"; msg.textContent = "Listo. Revisa tu correo y abre el enlace.";
    } else if (modo === "crear") {
      const d = chk(await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split("#")[0] } }));
      if (!d.session) { msg.className = "msg ok"; msg.textContent = "Te enviamos un correo para confirmar tu cuenta. Ábrelo y luego entra aquí."; }
    } else {
      chk(await sb.auth.signInWithPassword({ email, password }));
      msg.textContent = "";
    }
  } catch (e) {
    const m = errMsg(e);
    msg.textContent = /Invalid login/i.test(m) ? "Correo o contraseña incorrectos."
      : /not confirmed/i.test(m) ? "Todavía no confirmas tu correo. Revisa tu bandeja de entrada."
      : /already registered/i.test(m) ? "Ese correo ya tiene cuenta. Entra con tu contraseña."
      : m;
  }
});
$("fRecuperar").addEventListener("submit", async ev => {
  ev.preventDefault();
  try { chk(await sb.auth.updateUser({ password: $("rcPass").value })); $("recuperar").hidden = true; toast("Contraseña cambiada"); iniciar(); }
  catch (e) { $("rcMsg").textContent = errMsg(e); }
});
const salir = async () => { await sb.auth.signOut(); location.reload(); };
$("logoutBtn").onclick = $("logoutBtn2").onclick = salir; $("nvSalir").onclick = salir;

let ultimoUser;  // undefined hasta el primer aviso de sesión
sb.auth.onAuthStateChange((ev, session) => {
  // No se llama a Supabase dentro de este aviso: se hace justo después
  if (ev === "PASSWORD_RECOVERY") { setTimeout(() => { ["login", "nueva", "app"].forEach(i => $(i).hidden = true); $("recuperar").hidden = false; }); return; }
  const u = session?.user || null;
  const uid = u ? u.id : null;
  if (uid === ultimoUser) return;
  ultimoUser = uid; USER = u;
  setTimeout(iniciar);
});

async function iniciar() {
  if (!$("recuperar").hidden) return;
  if (!USER) { $("app").hidden = $("nueva").hidden = true; $("login").hidden = false; pintaLogin(); return; }
  $("login").hidden = true;
  $("who").textContent = $("who2").textContent = USER.email || "";
  try {
    await sb.rpc("aceptar_invitaciones");
    await cargarEmpresas();
  } catch (e) { $("login").hidden = false; $("lgMsg").textContent = errMsg(e); return; }
  if (!EMPRESAS.length) { $("app").hidden = true; $("nueva").hidden = false; $("nvEmail").textContent = USER.email; return; }
  let guardada = null; try { guardada = localStorage.getItem("tm.empresa"); } catch (_) {}
  await abrirEmpresa(EMPRESAS.some(x => x.id === guardada) ? guardada : EMPRESAS[0].id);
}
async function cargarEmpresas() {
  const rows = chk(await sb.from("miembros").select("rol, empresa:empresas(id,nombre,moneda,dias_aviso)").eq("user_id", USER.id));
  EMPRESAS = rows.filter(r => r.empresa).map(r => ({ ...r.empresa, rol: r.rol })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}
async function abrirEmpresa(id) {
  E = id; try { localStorage.setItem("tm.empresa", id); } catch (_) {}
  const e = emp(); MON = e.moneda || "$";
  $("empSel").innerHTML = EMPRESAS.map(x => `<option value="${esc(x.id)}"${x.id === id ? " selected" : ""}>${esc(x.nombre)}</option>`).join("");
  $("brandName").textContent = e.nombre;
  document.title = e.nombre + " · Tostones";
  Object.keys(S).forEach(k => S[k] = []);  // no mostrar datos de la fábrica anterior mientras carga
  SEL.clear(); resetGasto(); resetVenta(); resetProd(); resetTipo(); resetCliente();
  try { await recargar(); } catch (err) { fail(err); }
  $("nueva").hidden = true; $("app").hidden = false;
}
$("empSel").addEventListener("change", e => abrirEmpresa(e.target.value));
async function nuevaEmpresa(nombre, moneda) {
  const id = chk(await sb.rpc("crear_empresa", { p_nombre: nombre, p_moneda: moneda }));
  await cargarEmpresas(); await abrirEmpresa(id);
}
$("fNueva").addEventListener("submit", async ev => {
  ev.preventDefault();
  try { await nuevaEmpresa($("nvNombre").value.trim(), $("nvMoneda").value.trim()); }
  catch (e) { $("nvMsg").textContent = errMsg(e); }
});
// Al volver a la pestaña, trae lo que otros hayan anotado
document.addEventListener("visibilitychange", () => { if (!document.hidden && E && !$("app").hidden) recargar().catch(() => {}); });

/* ---------- pestañas ---------- */
function irA(t) {
  document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.t === t));
  document.querySelectorAll("section.tab").forEach(s => s.hidden = s.id !== "t-" + t);
  $("fabVenta").hidden = t === "ventas";  // en Ventas el formulario ya está ahí
  try { localStorage.setItem("tm.tab", t); } catch (_) {}
  scrollTo(0, 0);
}
$("tabs").addEventListener("click", e => { const b = e.target.closest("button[data-t]"); if (b) irA(b.dataset.t); });
document.addEventListener("click", e => { const g = e.target.closest("[data-go]"); if (g) irA(g.dataset.go); });
try { const t = localStorage.getItem("tm.tab"); if (t && $("t-" + t)) irA(t); } catch (_) {}

/* ---------- cálculos ---------- */
const totalItems = it => (it || []).reduce((a, x) => a + num(x.cantidad) * num(x.precio), 0);
const totalVenta = v => totalItems(v.items);
const nomTipo = id => byId("tipos", id)?.nombre || "(tipo borrado)";
const nomCli = id => byId("clientes", id)?.nombre || "Cliente general";
function deuda(c) {
  const v = S.ventas.filter(x => x.cliente_id === c.id).reduce((a, x) => a + totalVenta(x) - num(x.pagado), 0);
  return v - S.pagos.filter(x => x.cliente_id === c.id).reduce((a, x) => a + num(x.monto), 0);
}
/* Desde cuándo debe: los pagos cubren primero las ventas más viejas */
function debeDesde(c) {
  const V = S.ventas.filter(v => v.cliente_id === c.id).map(v => ({ f: v.fecha, r: totalVenta(v) - num(v.pagado) })).filter(x => x.r > 0.004).sort((a, b) => a.f.localeCompare(b.f));
  let p = S.pagos.filter(x => x.cliente_id === c.id).reduce((a, x) => a + num(x.monto), 0);
  p += S.ventas.filter(v => v.cliente_id === c.id).reduce((a, v) => a + Math.max(num(v.pagado) - totalVenta(v), 0), 0);
  for (const x of V) { if (p >= x.r - 0.004) { p -= x.r; continue; } return x.f; }
  return "";
}
const diasDesde = f => { if (!f) return 0; const [y, m, d] = f.split("-").map(Number), t = today().split("-").map(Number); return Math.round((Date.UTC(t[0], t[1] - 1, t[2]) - Date.UTC(y, m - 1, d)) / 864e5); };
const diasAviso = () => num(emp().dias_aviso ?? 7);
function atrasados() {
  return S.clientes.map(c => { const d = deuda(c), f = d > 0.004 ? debeDesde(c) : ""; return { c, d, f, dias: diasDesde(f) }; })
    .filter(x => x.d > 0.004 && x.c.recordar !== false && x.dias > diasAviso()).sort((a, b) => b.dias - a.dias);
}
function waLink(c, d, f) {
  let tel = String(c.telefono || "").replace(/\D/g, ""); if (tel.length === 10 && /^(809|829|849)/.test(tel)) tel = "1" + tel;
  const msg = `Hola ${c.nombre}, le saludamos de ${emp().nombre}. Le recordamos que tiene un saldo pendiente de ${money(d)}${f ? " desde el " + fdate(f) : ""}. ¡Muchas gracias!`;
  return "https://wa.me/" + tel + "?text=" + encodeURIComponent(msg);
}
const waBtn = (c, d, f) => `<a class="btn sm wa" href="${esc(waLink(c, d, f))}" target="_blank" rel="noopener">Recordar por WhatsApp</a>`;
const margenPill = p => `<span class="pill ${p >= 30 ? "ok" : p >= 10 ? "low" : "neg"}">${qty(p)}%</span>`;

/* Grupos de gastos */
const gastosDe = c => S.gastos.filter(g => limpiaCod(g.grupo) === c);
const totalGrupo = c => gastosDe(c).reduce((a, g) => a + num(g.monto), 0);
function grupos() {
  const m = {};
  S.gastos.forEach(g => { const c = limpiaCod(g.grupo); if (!c) return; (m[c] = m[c] || { cod: c, n: 0, total: 0, fecha: "" }); m[c].n++; m[c].total += num(g.monto); if (g.fecha > m[c].fecha) m[c].fecha = g.fecha; });
  return Object.values(m).sort((a, b) => b.fecha.localeCompare(a.fecha) || a.cod.localeCompare(b.cod));
}
const prodDeGrupo = c => S.producciones.filter(p => limpiaCod(p.grupo) === c);
const prodCosto = p => { const c = limpiaCod(p.grupo); return c && gastosDe(c).length ? totalGrupo(c) : num(p.costo); };
/* El gasto de una producción se reparte entre sus tipos según las unidades */
function prodItems(p) {
  const it = p.items || [], u = it.reduce((a, x) => a + num(x.cantidad), 0), k = prodCosto(p);
  return it.map(x => ({ tipo_id: x.tipo_id, cantidad: num(x.cantidad), precio: num(x.precio) || num(byId("tipos", x.tipo_id)?.precio), costo: u > 0 ? k * num(x.cantidad) / u : 0 }));
}
function resumenProd(it, k) {
  const u = it.reduce((a, x) => a + x.cantidad, 0), cu = u > 0 ? k / u : 0, venta = it.reduce((a, x) => a + x.cantidad * x.precio, 0);
  return { u, cu, venta, gan: venta - k, pct: venta > 0 ? (venta - k) / venta * 100 : 0, todosConPrecio: it.length && it.every(x => x.precio > 0) };
}

/* ---------- pintar todo ---------- */
function renderAll() {
  if (!E) return;
  LOTES = null;
  MON = emp().moneda || "$";
  document.querySelectorAll(".diasAviso").forEach(e => e.textContent = diasAviso());
  renderResumen(); renderGastos(); renderProd(); renderTipos(); renderVentas(); renderClientes(); renderEmpresa();
  fillTipoSelects(); fillClientes(); fillGrupos(); calcProd(); calcVenta();
}
const tabla = (head, rows, vacio) => rows.length ? `<table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>` : `<div class="empty">${vacio}</div>`;
const MAXF = 300;
const corta = (arr, n = MAXF) => arr.length > n ? arr.slice(0, n) : arr;
const masFilas = (arr, n = MAXF) => arr.length > n ? `<div class="muted" style="padding:10px">Se muestran los ${n} más recientes de ${arr.length}. Descarga el Excel para verlos todos.</div>` : "";

/* ---------- RESUMEN ---------- */
$("mesSel").value = today().slice(0, 7); $("mesSel").addEventListener("change", renderResumen);
function renderResumen() {
  const mes = $("mesSel").value || today().slice(0, 7), enMes = x => (x.fecha || "").startsWith(mes);
  const G = S.gastos.filter(enMes), V = S.ventas.filter(enMes);
  const gt = G.reduce((a, g) => a + num(g.monto), 0), vt = V.reduce((a, v) => a + totalVenta(v), 0);
  const cobrado = V.reduce((a, v) => a + num(v.pagado), 0) + S.pagos.filter(enMes).reduce((a, p) => a + num(p.monto), 0);
  const L = lotes(), cv = L.costoVendido[mes] || 0, merma = L.mermaMes[mes] || 0;
  // Gastos sin grupo (gasolina, sueldos, etc.) no son de una producción: se restan en el mes en que se gastan
  const otros = G.filter(g => !limpiaCod(g.grupo)).reduce((a, g) => a + num(g.monto), 0);
  const porCobrar = S.clientes.reduce((a, c) => a + Math.max(deuda(c), 0), 0), nDeben = S.clientes.filter(c => deuda(c) > 0.004).length, AT = atrasados(), gan = vt - cv - merma - otros;
  $("kpis").innerHTML = `
   <button type="button" class="kpi" data-go="ventas"><span class="l">Ventas de ${fmes(mes)}</span><span class="v">${money(vt)}</span><span class="h">${V.length} ventas · cobrado ${money(cobrado)} · <u>ver</u> →</span></button>
   <button type="button" class="kpi" data-go="gastos"><span class="l">Gastos de ${fmes(mes)}</span><span class="v">${money(gt)}</span><span class="h">${G.length} gastos · <u>ver</u> →</span></button>
   <div class="kpi hi"><div class="l">Ganancia de ${fmes(mes)}</div><div class="v${gan < 0 ? " neg" : ""}">${money(gan)}</div><div class="h">ventas menos lo que costaron los tostones vendidos (${money(cv)})${merma > 0.004 ? `, merma ${money(merma)}` : ""}${otros > 0.004 ? ` y otros gastos ${money(otros)}` : ""}</div></div>
   <button type="button" class="kpi" data-go="clientes"><span class="l">Te deben</span><span class="v" style="color:${porCobrar > 0 ? "var(--warn)" : "inherit"}">${money(porCobrar)}</span><span class="h">${nDeben ? nDeben + " cliente" + (nDeben > 1 ? "s" : "") : "nadie te debe"}${AT.length ? ` · <b style="color:var(--bad)">${AT.length} atrasado${AT.length > 1 ? "s" : ""}</b>` : ""} · <u>ver quién</u> →</span></button>`;
  $("avisos").innerHTML = AT.length ? `<div class="card aviso"><h3>${AT.length === 1 ? "1 cliente te debe" : AT.length + " clientes te deben"} desde hace más de ${diasAviso()} días</h3>${AT.map(({ c, d, f, dias }) => `<div class="avrow"><span><b>${esc(c.nombre)}</b><span class="s">${money(d)} · hace ${dias} días</span></span>${waBtn(c, d, f)}</div>`).join("")}</div>` : "";
  renderProdPanel();
  const D = S.clientes.map(c => ({ c, d: deuda(c) })).filter(x => x.d > 0.004).sort((a, b) => b.d - a.d);
  $("resDeben").innerHTML = D.length ? `<table><tbody>${D.map(({ c, d }) => `<tr><td>${esc(c.nombre)}</td><td class="n"><b style="color:var(--warn)">${money(d)}</b></td></tr>`).join("")}</tbody></table>` : `<div class="muted">Nadie te debe ahora mismo.</div>`;
  const porTipo = {}, porDesc = {};
  G.forEach(g => { porTipo[g.tipo] = (porTipo[g.tipo] || 0) + num(g.monto); porDesc[g.descripcion] = (porDesc[g.descripcion] || 0) + num(g.monto); });
  const top = Object.entries(porDesc).sort((a, b) => b[1] - a[1]).slice(0, 8);
  $("resGastos").innerHTML = G.length ? `<table><thead><tr><th>Gasto</th><th class="n">Total</th></tr></thead><tbody>${Object.entries(porTipo).map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td class="n"><b>${money(v)}</b></td></tr>`).join("") + top.map(([k, v]) => `<tr><td class="muted">${esc(k)}</td><td class="n muted">${money(v)}</td></tr>`).join("")}</tbody></table>` : `<div class="muted">No hay gastos en ${fmes(mes)}.</div>`;
}

/* ---------- producciones abiertas y cerradas ----------
   Cada venta se descuenta de la producción abierta más vieja que todavía tenga ese tostón
   (lo primero que entra es lo primero que sale). Una producción cerrada solo cuenta las
   ventas registradas antes de cerrarla; lo que le sobró se toma como merma. */
const ts = x => Date.parse(x || "") || 0;
const abierta = p => !p.cerrada_en;
const nomProd = p => (p.grupo ? p.grupo + " · " : "Producción del ") + fdate(p.fecha);
const mesLocal = t => { const d = new Date(t); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
function lotesProd(sinVenta) {
  const L = [...S.producciones].sort((a, b) => (a.fecha || "").localeCompare(b.fecha || "") || (a.creado || "").localeCompare(b.creado || ""))
    .map(p => ({ p, k: prodCosto(p), items: prodItems(p).map(i => ({ ...i, vend: 0, monto: 0 })) }));
  const COGS = {}, suma = (m, k) => COGS[m] = (COGS[m] || 0) + k;
  const V = [...S.ventas].filter(v => v.id !== sinVenta).sort((a, b) => (a.fecha || "").localeCompare(b.fecha || "") || (a.creado || "").localeCompare(b.creado || ""));
  V.forEach(v => (v.items || []).forEach(it => {
    let q = num(it.cantidad); const pr = num(it.precio);
    const C = L.filter(l => abierta(l.p) || ts(v.creado) < ts(l.p.cerrada_en)).flatMap(l => l.items.filter(x => x.tipo_id === it.tipo_id));
    const mes = (v.fecha || "").slice(0, 7), cuX = x => x.cantidad > 0 ? x.costo / x.cantidad : 0;
    for (const x of C) { if (q <= 0) break; const t = Math.min(q, x.cantidad - x.vend); if (t > 0) { x.vend += t; x.monto += t * pr; q -= t; suma(mes, t * cuX(x)); } }
    if (q > 0 && C.length) { const x = C[C.length - 1]; x.vend += q; x.monto += q * pr; suma(mes, q * cuX(x)); } // vendiste más de lo producido
  }));
  L.forEach(l => {
    l.u = l.items.reduce((a, x) => a + x.cantidad, 0); l.vend = l.items.reduce((a, x) => a + Math.min(x.vend, x.cantidad), 0);
    l.quedan = l.items.reduce((a, x) => a + Math.max(x.cantidad - x.vend, 0), 0); l.monto = l.items.reduce((a, x) => a + x.monto, 0);
    l.cu = l.u > 0 ? l.k / l.u : 0; l.gan = l.monto - l.k;
    l.merma = abierta(l.p) ? 0 : l.items.reduce((a, x) => a + Math.max(x.cantidad - x.vend, 0) * (x.cantidad > 0 ? x.costo / x.cantidad : 0), 0);
  });
  L.costoVendido = COGS; L.mermaMes = {};
  L.forEach(l => { if (l.merma > 0) { const m = mesLocal(l.p.cerrada_en); L.mermaMes[m] = (L.mermaMes[m] || 0) + l.merma; } });
  return L;
}
let PSEL = "", LOTES = null;
const lotes = () => LOTES || (LOTES = lotesProd());
function renderProdPanel() {
  const L = lotes(), A = L.filter(l => abierta(l.p)).reverse(), C = L.filter(l => !abierta(l.p)).sort((a, b) => ts(b.p.cerrada_en) - ts(a.p.cerrada_en));
  const sel = $("prodSel");
  if (!L.length) {
    sel.hidden = true; $("prodInfo").innerHTML = ""; $("prodBtns").innerHTML = "";
    $("resTipos").innerHTML = `<div class="muted">Registra tu primera producción en la pestaña Producción.</div>`;
  } else {
    if (!L.some(l => l.p.id === PSEL)) PSEL = (A[0] || C[0]).p.id;
    const op = l => `<option value="${l.p.id}"${l.p.id === PSEL ? " selected" : ""}>${esc(nomProd(l.p))}${abierta(l.p) ? " · quedan " + qty(l.quedan) : ""}</option>`;
    sel.hidden = false;
    sel.innerHTML = (A.length ? `<optgroup label="Abiertas">${A.map(op).join("")}</optgroup>` : "") + (C.length ? `<optgroup label="Cerradas">${C.map(op).join("")}</optgroup>` : "");
    const l = L.find(x => x.p.id === PSEL), ab = abierta(l.p);
    const estado = !ab ? `<span class="pill">Cerrada el ${fdate(l.p.cerrada_en.slice(0, 10))}</span>` : l.quedan <= 0 ? `<span class="pill ok">Se vendió todo</span>` : `<span class="pill lote">Abierta</span>`;
    $("prodInfo").innerHTML = (A.length > 1 && ab ? `<p class="nota">Tienes ${A.length} producciones abiertas. Las ventas se descuentan primero de la más vieja.</p>` : "") +
      `<div class="calc"><div><span class="muted">Estado</span>${estado}</div>
       <div><span class="muted">Gasto de la producción</span><b>${l.k > 0 ? money(l.k) : "—"}</b></div>
       <div><span class="muted">Vendido hasta ahora</span><b>${money(l.monto)}</b></div>
       <div><span class="muted">${ab ? "Quedan" : "Sobraron (merma)"}</span><b>${qty(l.quedan)} de ${qty(l.u)}</b></div>
       ${l.k > 0 ? `<div class="t"><span>${ab ? "Ganancia hasta ahora" : "Ganancia final"}</span><span style="color:${l.gan < 0 ? "var(--bad)" : "var(--good)"}">${money(l.gan)}</span></div>` : ""}</div>`;
    const T = {}; l.items.forEach(x => { const t = T[x.tipo_id] = T[x.tipo_id] || { id: x.tipo_id, prod: 0, vend: 0, quedan: 0, monto: 0, costo: 0, precio: x.precio }; t.prod += x.cantidad; t.vend += x.vend; t.quedan += Math.max(x.cantidad - x.vend, 0); t.monto += x.monto; t.costo += x.costo; });
    $("resTipos").innerHTML = tabla(`<th>Tipo</th><th class="n">Producidas</th><th class="n">Vendidas</th><th class="n">Quedan</th><th class="n">Costo c/u</th><th class="n">Margen</th>`,
      Object.values(T).map(r => {
        const cu = r.prod > 0 ? r.costo / r.prod : 0, pv = r.vend > 0 ? r.monto / r.vend : r.precio, pct = cu > 0 && pv > 0 ? (pv - cu) / pv * 100 : null;
        return `<tr><td>${esc(nomTipo(r.id))}</td><td class="n">${qty(r.prod)}</td><td class="n">${qty(r.vend)}</td><td class="n"><b>${qty(r.quedan)}</b></td><td class="n">${cu > 0 ? money(cu) : "—"}</td><td class="n">${pct == null ? "—" : margenPill(pct) + `<span class="s">a ${money(pv)} c/u</span>`}</td></tr>`;
      }), "");
    $("prodBtns").innerHTML = ab ? `<button type="button" class="btn${l.quedan <= 0 ? "" : " ghost"}" data-cerrar="${l.p.id}">Cerrar esta producción</button>`
      : `<button type="button" class="btn ghost" data-abrir="${l.p.id}">Volver a abrir</button>`;
  }
  // Existencias: lo que queda en las producciones abiertas
  const inv = {}; L.filter(l => abierta(l.p)).forEach(l => l.items.forEach(x => { const r = inv[x.tipo_id] = inv[x.tipo_id] || { id: x.tipo_id, prod: 0, vend: 0, quedan: 0 }; r.prod += x.cantidad; r.vend += x.vend; r.quedan += x.cantidad - x.vend; }));
  const R = Object.values(inv).sort((a, b) => nomTipo(a.id).localeCompare(nomTipo(b.id), "es"));
  $("lInv").innerHTML = tabla(`<th>Tipo</th><th class="n">Producidas</th><th class="n">Vendidas</th><th class="n">Quedan</th>`,
    R.map(r => `<tr><td>${esc(nomTipo(r.id))}</td><td class="n">${qty(r.prod)}</td><td class="n">${qty(r.vend)}</td><td class="n"><b${r.quedan < 0 ? ' style="color:var(--bad)"' : ""}>${qty(r.quedan)}</b></td></tr>`), "No hay producciones abiertas.");
}
$("prodSel").addEventListener("change", () => { PSEL = $("prodSel").value; renderProdPanel(); });
async function cerrarProd(id, cerrar) {
  const l = lotesProd().find(x => x.p.id === id); if (!l) return;
  const aviso = !cerrar ? `¿Volver a abrir “${nomProd(l.p)}”? Se le vuelven a descontar ventas.`
    : l.quedan > 0 ? `Todavía quedan ${qty(l.quedan)} tostones de “${nomProd(l.p)}”.\n\nSi la cierras, esos tostones se cuentan como merma (pérdida) y las próximas ventas se descuentan de la siguiente producción.\n\n¿Cerrarla?`
    : `¿Cerrar “${nomProd(l.p)}”? Ya se vendió todo.`;
  if (!confirm(aviso)) return;
  try {
    chk(await sb.rpc("cerrar_produccion", { p_id: id, cerrar }));
    toast(cerrar ? "Producción cerrada" : "Producción abierta otra vez");
    if (cerrar) PSEL = "";
    await recargar("producciones");
  } catch (e) { fail(/cerrar_produccion|cerrada_en/.test(errMsg(e)) ? new Error("Falta actualizar la base: corre de nuevo schema.sql en Supabase (SQL Editor).") : e); }
}
document.addEventListener("click", e => {
  const c = e.target.closest("[data-cerrar],[data-abrir]"); if (!c) return;
  cerrarProd(c.dataset.cerrar || c.dataset.abrir, !!c.dataset.cerrar);
});

/* ---------- GASTOS ---------- */
function calcGasto() {
  const c = num($("gaCant").value), m = num($("gaMonto").value), u = $("gaUnidad").value;
  $("gaCalc").hidden = !(c > 0 && m > 0);
  if (c > 0 && m > 0) $("gaCalc").innerHTML = `<div><span>Precio por ${esc(u || "unidad")}</span><b>${money(m / c)}</b></div>`;
}
["gaCant", "gaMonto", "gaUnidad"].forEach(i => $(i).addEventListener("input", calcGasto));
$("gaDesc").addEventListener("change", () => {
  // Repite unidad, tipo y proveedor de la última vez que compraste lo mismo
  const d = $("gaDesc").value.trim().toLowerCase(), last = sortF(S.gastos).find(g => g.descripcion.toLowerCase() === d);
  if (last && !$("gaId").value) { if (last.unidad) $("gaUnidad").value = last.unidad; $("gaTipo").value = last.tipo; if (last.proveedor && !$("gaProv").value) $("gaProv").value = last.proveedor; }
});
function resetGasto() { $("fGasto").reset(); $("gaId").value = ""; $("gaFecha").value = today(); $("gaCancel").hidden = true; $("gaTitulo").textContent = "Nuevo gasto"; calcGasto(); }
$("gaCancel").onclick = resetGasto;
function editGasto(id) {
  const g = byId("gastos", id); if (!g) return;
  $("gaId").value = g.id; $("gaFecha").value = g.fecha; $("gaTipo").value = g.tipo; $("gaDesc").value = g.descripcion;
  $("gaCant").value = g.cantidad ?? ""; $("gaUnidad").value = g.unidad || ""; $("gaMonto").value = g.monto; $("gaProv").value = g.proveedor || ""; $("gaGrupo").value = g.grupo || "";
  $("gaCancel").hidden = false; $("gaTitulo").textContent = "Editar gasto"; calcGasto(); $("fGasto").scrollIntoView({ behavior: "smooth" });
}
$("fGasto").addEventListener("submit", async ev => {
  ev.preventDefault();
  const d = {
    empresa_id: E, fecha: $("gaFecha").value || today(), tipo: $("gaTipo").value, descripcion: $("gaDesc").value.trim(),
    cantidad: $("gaCant").value === "" ? null : num($("gaCant").value), unidad: $("gaUnidad").value || null,
    monto: r2($("gaMonto").value), proveedor: $("gaProv").value.trim() || null, grupo: limpiaCod($("gaGrupo").value) || null,
  };
  const id = $("gaId").value;
  try {
    chk(await (id ? sb.from("gastos").update(d).eq("id", id) : sb.from("gastos").insert(d)));
    toast(id ? "Gasto actualizado" : "Gasto guardado"); resetGasto(); await recargar("gastos");
  } catch (e) { fail(e); }
});
const SEL = new Set();
function selBar() { $("gaSelBar").hidden = !SEL.size; $("gaSelN").textContent = SEL.size + (SEL.size === 1 ? " gasto marcado" : " gastos marcados"); }
async function asignarGrupo(cod) {
  try { chk(await sb.from("gastos").update({ grupo: cod || null }).in("id", [...SEL])); toast(cod ? "Agrupados en " + cod : "Grupo quitado"); SEL.clear(); $("gaSelCod").value = ""; await recargar("gastos"); }
  catch (e) { fail(e); }
}
$("gaSelAsig").onclick = () => { const c = limpiaCod($("gaSelCod").value); if (!c) { toast("Escribe un código para el grupo"); return; } asignarGrupo(c); };
$("gaSelQuitar").onclick = () => asignarGrupo(null);
function renderGastos() {
  const G = sortF(S.gastos);
  [...SEL].forEach(id => { if (!byId("gastos", id)) SEL.delete(id); });
  $("lGastos").innerHTML = tabla(`<th class="ck"></th><th>Fecha</th><th>Qué</th><th class="n">Cantidad</th><th class="n">Total</th><th></th>`,
    corta(G).map(g => `<tr><td class="ck"><input type="checkbox" data-sel="${g.id}" aria-label="Marcar"${SEL.has(g.id) ? " checked" : ""}></td><td>${fdate(g.fecha)}</td>
      <td><b>${esc(g.descripcion)}</b><span class="s">${esc(g.tipo)}${g.proveedor ? " · " + esc(g.proveedor) : ""}</span>${g.grupo ? `<span class="pill lote">${esc(g.grupo)}</span>` : ""}</td>
      <td class="n">${g.cantidad != null ? qty(g.cantidad) + " " + esc(g.unidad || "") : "—"}${num(g.cantidad) > 0 ? `<span class="s">${money(num(g.monto) / num(g.cantidad))} c/u</span>` : ""}</td>
      <td class="n"><b>${money(g.monto)}</b></td>
      <td class="n"><div class="btns" style="justify-content:flex-end"><button class="btn sm ghost" data-ed="gasto" data-id="${g.id}">Editar</button><button class="btn sm danger" data-del="gastos" data-id="${g.id}">Borrar</button></div></td></tr>`),
    "Todavía no hay gastos.") + masFilas(G);
  const L = grupos();
  $("lLotes").innerHTML = tabla(`<th>Grupo</th><th class="n">Gastos</th><th class="n">Total</th><th>Producción</th>`,
    L.map(l => { const p = prodDeGrupo(l.cod); return `<tr><td><span class="pill lote">${esc(l.cod)}</span></td><td class="n">${l.n}</td><td class="n"><b>${money(l.total)}</b></td><td>${p.length ? p.map(x => fdate(x.fecha)).join(", ") : '<span class="muted">sin usar</span>'}</td></tr>`; }),
    "Aún no hay grupos. Marca gastos en la lista y ponles un código.");
  selBar();
  const descs = [...new Set(S.gastos.map(g => g.descripcion))].sort(), provs = [...new Set(S.gastos.map(g => g.proveedor).filter(Boolean))].sort();
  $("gaDescs").innerHTML = descs.map(d => `<option value="${esc(d)}">`).join("");
  $("gaProvs").innerHTML = provs.map(d => `<option value="${esc(d)}">`).join("");
  $("gaGrupos").innerHTML = L.map(l => `<option value="${esc(l.cod)}">`).join("");
}
$("lGastos").addEventListener("change", e => { const c = e.target.closest("[data-sel]"); if (!c) return; c.checked ? SEL.add(c.dataset.sel) : SEL.delete(c.dataset.sel); selBar(); });

/* ---------- borrar y editar (todas las listas) ---------- */
const AVISO_BORRAR = {
  gastos: "¿Borrar este gasto?", producciones: "¿Borrar esta producción?", ventas: "¿Borrar esta venta? Si quedó debiendo, esa deuda también se borra.",
  pagos: "¿Borrar este pago? La deuda del cliente vuelve a subir.", clientes: "¿Borrar este cliente? Sus pagos se borran y sus ventas quedan como cliente general.",
};
const RECARGA = { gastos: ["gastos"], producciones: ["producciones", "inventario"], ventas: ["ventas", "inventario"], pagos: ["pagos"], clientes: ["clientes", "ventas", "pagos"] };
const EDIT = { gasto: editGasto, prod: id => editProd(id), venta: id => editVenta(id), cliente: id => editCliente(id), tipo: id => editTipo(id) };
document.addEventListener("click", async e => {
  const ed = e.target.closest("[data-ed]"); if (ed) { EDIT[ed.dataset.ed](ed.dataset.id); return; }
  const del = e.target.closest("[data-del]"); if (!del) return;
  const t = del.dataset.del, id = del.dataset.id;
  if (t === "tipos_toston") return borrarTipo(id);
  if (!confirm(AVISO_BORRAR[t])) return;
  try { chk(await sb.from(t).delete().eq("id", id)); toast("Borrado"); await recargar(...RECARGA[t]); } catch (err) { fail(err); }
});

/* ---------- PRODUCCIÓN ---------- */
function fillTipoSelects() {
  document.querySelectorAll("#pdLines select, #veLines select").forEach(s => {
    const v = s.value; s.innerHTML = opts(sortN(S.tipos.filter(t => t.activo || t.id === v)), v, "Tipo…");
    if (v && !byId("tipos", v)) s.insertAdjacentHTML("beforeend", `<option value="${esc(v)}" selected>(tipo borrado)</option>`);
  });
}
function linea(cont, it, onCalc) {
  const d = document.createElement("div"); d.className = "line v";
  d.innerHTML = `<select aria-label="Tipo de tostón"></select><input type="number" step="any" min="0" aria-label="Unidades" placeholder="Unid."><input type="number" step="any" min="0" aria-label="Precio" placeholder="Precio"><button type="button" class="x" aria-label="Quitar">×</button>`;
  const [sl, c, pr] = d.querySelectorAll("select,input");
  sl.innerHTML = opts(sortN(S.tipos.filter(t => t.activo)), "", "Tipo…");
  sl.addEventListener("change", () => { const t = byId("tipos", sl.value); if (t && t.precio) pr.value = t.precio; onCalc(); });
  d.addEventListener("input", onCalc);
  d.querySelector(".x").onclick = () => { d.remove(); if (!cont.children.length) linea(cont, null, onCalc); onCalc(); };
  if (cont.id === "veLines") {
    d.insertAdjacentHTML("beforeend", `<div class="quick"><span class="stk"></span>${[5, 10, 25, 50].map(n => `<button type="button" data-mas="${n}">+${n}</button>`).join("")}<button type="button" data-mas="0" aria-label="Borrar cantidad">0</button></div>`);
    d.querySelector(".quick").addEventListener("click", e => { const b = e.target.closest("[data-mas]"); if (!b) return; const n = +b.dataset.mas; c.value = n ? qty2(num(c.value) + n) : ""; onCalc(); });
  }
  if (it) {
    if (!S.tipos.some(t => t.activo && t.id === it.tipo_id)) sl.insertAdjacentHTML("beforeend", `<option value="${esc(it.tipo_id)}">${esc(nomTipo(it.tipo_id))}</option>`);
    sl.value = it.tipo_id; c.value = it.cantidad ?? ""; pr.value = it.precio ?? "";
  }
  cont.appendChild(d);
}
const qty2 = n => String(Math.round(n * 1000) / 1000);
const leerLineas = cont => [...cont.children].map(d => { const [s, c, p] = d.querySelectorAll("select,input"); return { tipo_id: s.value, cantidad: num(c.value), precio: num(p.value) }; }).filter(x => x.tipo_id && x.cantidad > 0);
$("pdAdd").onclick = () => linea($("pdLines"), null, calcProd);
function fillGrupos() {
  const s = $("pdGrupo"), v = s.value;
  s.innerHTML = `<option value="">Sin grupo (escribo el gasto abajo)</option>` + grupos().map(l => `<option value="${esc(l.cod)}">${esc(l.cod)} · ${money(l.total)} (${l.n} gasto${l.n > 1 ? "s" : ""})</option>`).join("");
  if (v && !grupos().some(l => l.cod === v)) s.insertAdjacentHTML("beforeend", `<option value="${esc(v)}">${esc(v)} (sin gastos)</option>`);
  s.value = v; aplicaGrupo();
}
function aplicaGrupo() {
  const c = $("pdGrupo").value, k = $("pdCosto");
  if (c && gastosDe(c).length) { k.value = r2(totalGrupo(c)); k.readOnly = true; } else k.readOnly = false;
  calcProd();
}
$("pdGrupo").addEventListener("change", () => {
  const c = $("pdGrupo").value;
  if (c && prodDeGrupo(c).some(p => p.id !== $("pdId").value)) toast("Ojo: el grupo " + c + " ya está en otra producción");
  if (!c) $("pdCosto").value = "";
  aplicaGrupo();
});
$("pdCosto").addEventListener("input", calcProd);
function calcProd() {
  const it = leerLineas($("pdLines")), k = num($("pdCosto").value), r = resumenProd(it, k), box = $("pdCalc");
  box.hidden = !it.length;
  if (!it.length) return;
  box.innerHTML = `<div><span class="muted">Unidades</span><b>${qty(r.u)}</b></div>` +
    (k > 0 ? `<div><span class="muted">Costo por unidad</span><b>${money(r.cu)}</b></div>` : "") +
    (r.venta > 0 ? `<div><span class="muted">Si vendes todo</span><b>${money(r.venta)}</b></div>` : "") +
    (k > 0 && r.venta > 0 ? `<div class="t"><span>Ganancia esperada</span><span>${money(r.gan)} · ${qty(r.pct)}%</span></div>` : "");
}
function resetProd() {
  $("fProd").reset(); $("pdId").value = ""; $("pdFecha").value = today(); $("pdLines").innerHTML = ""; linea($("pdLines"), null, calcProd);
  $("pdCosto").readOnly = false; $("pdCancel").hidden = true; $("pdTitulo").textContent = "Registrar producción"; calcProd();
}
$("pdCancel").onclick = resetProd;
function editProd(id) {
  const p = byId("producciones", id); if (!p) return;
  resetProd(); $("pdId").value = p.id; $("pdFecha").value = p.fecha; $("pdNota").value = p.nota || ""; $("pdCosto").value = num(p.costo) || "";
  $("pdLines").innerHTML = ""; (p.items.length ? p.items : [null]).forEach(it => linea($("pdLines"), it, calcProd));
  fillGrupos(); $("pdGrupo").value = p.grupo || ""; if (p.grupo && $("pdGrupo").value !== p.grupo) { $("pdGrupo").insertAdjacentHTML("beforeend", `<option value="${esc(p.grupo)}">${esc(p.grupo)}</option>`); $("pdGrupo").value = p.grupo; }
  aplicaGrupo(); $("pdCancel").hidden = false; $("pdTitulo").textContent = "Editar producción"; $("fProd").scrollIntoView({ behavior: "smooth" });
}
$("fProd").addEventListener("submit", async ev => {
  ev.preventDefault();
  const items = leerLineas($("pdLines"));
  if (!items.length) { toast("Elige el tipo de tostón y cuántas unidades"); return; }
  const grupo = $("pdGrupo").value, id = $("pdId").value;
  const p = { id: id || null, empresa_id: E, fecha: $("pdFecha").value || today(), grupo: grupo || null, costo: grupo && gastosDe(grupo).length ? 0 : r2($("pdCosto").value), nota: $("pdNota").value.trim(), items };
  try { chk(await sb.rpc("guardar_produccion", { p })); toast(id ? "Producción actualizada" : "Producción guardada"); resetProd(); await recargar("producciones", "inventario"); }
  catch (e) { fail(e); }
});
function renderProd() {
  const P = sortF(S.producciones), LM = Object.fromEntries(lotes().map(l => [l.p.id, l]));
  $("lProd").innerHTML = tabla(`<th>Fecha</th><th>Tostones</th><th class="n">Gasto</th><th class="n">Costo c/u</th><th class="n">Margen</th><th></th>`,
    corta(P).map(p => {
      const it = prodItems(p), k = prodCosto(p), r = resumenProd(it, k);
      return `<tr><td>${fdate(p.fecha)}</td><td>${it.map(x => `<b>${qty(x.cantidad)}</b> ${esc(nomTipo(x.tipo_id))}`).join("<br>")}${p.grupo ? `<span class="pill lote">${esc(p.grupo)}</span> ` : ""}${abierta(p) ? `<span class="pill ok">Abierta · quedan ${qty(LM[p.id]?.quedan)}</span>` : `<span class="pill">Cerrada</span>`}${p.nota ? `<span class="s">${esc(p.nota)}</span>` : ""}</td>
      <td class="n">${k > 0 ? money(k) : "—"}</td><td class="n">${k > 0 && r.u > 0 ? money(r.cu) : "—"}</td><td class="n">${k > 0 && r.todosConPrecio ? margenPill(r.pct) : "—"}</td>
      <td class="n"><div class="btns" style="justify-content:flex-end"><button class="btn sm ghost" data-ed="prod" data-id="${p.id}">Editar</button>${abierta(p) ? `<button class="btn sm ghost" data-cerrar="${p.id}">Cerrar</button>` : `<button class="btn sm ghost" data-abrir="${p.id}">Abrir</button>`}<button class="btn sm danger" data-del="producciones" data-id="${p.id}">Borrar</button></div></td></tr>`;
    }), "Todavía no hay producción registrada.") + masFilas(P);
}

/* Tipos de tostón */
function resetTipo() { $("fTipo").reset(); $("tiId").value = ""; $("tiCancel").hidden = true; }
$("tiCancel").onclick = resetTipo;
function editTipo(id) { const t = byId("tipos", id); if (!t) return; $("tiId").value = t.id; $("tiNombre").value = t.nombre; $("tiPrecio").value = t.precio || ""; $("tiCancel").hidden = false; $("tiNombre").focus(); }
$("fTipo").addEventListener("submit", async ev => {
  ev.preventDefault();
  const id = $("tiId").value, d = { empresa_id: E, nombre: $("tiNombre").value.trim(), precio: r2($("tiPrecio").value), activo: true };
  try {
    chk(await (id ? sb.from("tipos_toston").update(d).eq("id", id) : sb.from("tipos_toston").insert(d)));
    toast("Tipo guardado"); resetTipo(); await recargar("tipos", "inventario");
  } catch (e) { fail(e.code === "23505" ? { message: "Ya existe un tipo con ese nombre." } : e); }
});
async function borrarTipo(id) {
  const t = byId("tipos", id); if (!t || !confirm(`¿Borrar el tipo “${t.nombre}”?`)) return;
  try {
    const { error } = await sb.from("tipos_toston").delete().eq("id", id);
    if (error && error.code === "23503") { chk(await sb.from("tipos_toston").update({ activo: false }).eq("id", id)); toast("Ya tiene producción o ventas: se ocultó, pero su historial se queda"); }
    else if (error) throw error; else toast("Tipo borrado");
    await recargar("tipos", "inventario");
  } catch (e) { fail(e); }
}
function renderTipos() {
  const T = sortN(S.tipos.filter(t => t.activo));
  $("lTipos").innerHTML = T.length ? `<table><tbody>${T.map(t => `<tr><td><b>${esc(t.nombre)}</b></td><td class="n price">${t.precio > 0 ? money(t.precio) : "—"}</td><td class="n"><div class="btns" style="justify-content:flex-end"><button class="btn sm ghost" data-ed="tipo" data-id="${t.id}">Editar</button><button class="btn sm danger" data-del="tipos_toston" data-id="${t.id}">Borrar</button></div></td></tr>`).join("")}</tbody></table>` : `<div class="empty">Agrega tu primer tipo de tostón (ej. Verde, Maduro, Con ajo).</div>`;
}

/* ---------- VENTAS ---------- */
function fillClientes() {
  const s = $("veCliente"), v = s.value;
  s.innerHTML = `<option value="">Cliente general (de contado)</option>` + opts(sortN(S.clientes), v);
  s.value = byId("clientes", v) ? v : "";
}
$("veAdd").onclick = () => linea($("veLines"), null, calcVenta);
$("vePago").addEventListener("change", () => { $("vePagadoBox").hidden = $("vePago").value !== "parte"; calcVenta(); });
$("vePagado").addEventListener("input", calcVenta);
$("veCliente").addEventListener("change", () => {
  // Venta rápida: si todavía no escribiste cantidades, pone los tostones y precios de su última compra
  const cid = $("veCliente").value, last = cid && sortF(S.ventas).find(v => v.cliente_id === cid);
  if (last && !$("veId").value && !leerLineas($("veLines")).length && last.items.length) {
    $("veLines").innerHTML = "";
    last.items.forEach(i => linea($("veLines"), { tipo_id: i.tipo_id, cantidad: "", precio: i.precio }, calcVenta));
    toast("Puse lo que " + nomCli(cid) + " compró la última vez. Solo escribe la cantidad.");
    $("veLines").querySelector("input")?.focus();
  }
  calcVenta();
});
/* Botón flotante: nueva venta desde cualquier pantalla */
$("fabVenta").onclick = () => {
  if ($("veId").value && !confirm("Estás editando una venta. ¿Dejarla y empezar una nueva?")) { irA("ventas"); $("fVenta").scrollIntoView({ behavior: "smooth" }); return; }
  resetVenta(); irA("ventas");
  setTimeout(() => { $("fVenta").scrollIntoView({ behavior: "smooth", block: "start" }); $("veCliente").focus({ preventScroll: true }); }, 50);
};
function pagadoVenta(total) { const m = $("vePago").value; return m === "todo" ? total : m === "credito" ? 0 : num($("vePagado").value); }
/* Cuántos tostones quedan de cada tipo en las producciones abiertas (sin contar la venta que estás editando) */
function stockTipos() {
  const id = $("veId").value, L = id ? lotesProd(id) : lotes(), m = {};
  L.filter(l => abierta(l.p)).forEach(l => l.items.forEach(x => m[x.tipo_id] = (m[x.tipo_id] || 0) + x.cantidad - x.vend));
  return m;
}
function calcVenta() {
  const it = leerLineas($("veLines")), t = totalItems(it), pg = pagadoVenta(t), queda = t - pg, cli = $("veCliente").value;
  const st = stockTipos(), pide = {}, faltan = [];
  it.forEach(x => pide[x.tipo_id] = (pide[x.tipo_id] || 0) + x.cantidad);
  [...$("veLines").children].forEach(d => {
    const tid = d.querySelector("select").value, e = d.querySelector(".stk"); if (!e) return;
    const hay = st[tid] || 0;
    e.textContent = tid ? `Quedan ${qty(hay)}` : ""; e.classList.toggle("bad", !!tid && (pide[tid] || 0) > hay + 0.0005);
  });
  Object.entries(pide).forEach(([tid, q]) => { if (q > (st[tid] || 0) + 0.0005) faltan.push(`${nomTipo(tid)}: vendes ${qty(q)} y solo quedan ${qty(Math.max(st[tid] || 0, 0))}`); });
  $("veCalc").innerHTML = `<div class="t"><span>Total</span><span>${money(t)}</span></div>` +
    (faltan.length ? `<div class="note warn">${faltan.map(esc).join("<br>")}. Revisa si falta registrar una producción.</div>` : "") +
    (queda > 0.004 ? `<div><span>Queda debiendo</span><b style="color:var(--warn)">${money(queda)}</b></div>` : "") +
    (queda > 0.004 && !cli ? `<div class="note warn">Elige el cliente para poder anotar la deuda.</div>` : "");
}
function resetVenta() {
  $("fVenta").reset(); $("veId").value = ""; $("veFecha").value = today(); $("veLines").innerHTML = ""; linea($("veLines"), null, calcVenta);
  $("vePagadoBox").hidden = true; $("veCliBox").hidden = true; $("veCancel").hidden = true; $("veTitulo").textContent = "Nueva venta"; fillClientes(); calcVenta();
}
$("veCancel").onclick = resetVenta;
function editVenta(id) {
  const v = byId("ventas", id); if (!v) return;
  resetVenta(); $("veId").value = v.id; $("veFecha").value = v.fecha; $("veCliente").value = v.cliente_id || "";
  $("veLines").innerHTML = ""; (v.items.length ? v.items : [null]).forEach(it => linea($("veLines"), it, calcVenta));
  const t = totalVenta(v), p = num(v.pagado);
  $("vePago").value = Math.abs(p - t) < 0.005 ? "todo" : p === 0 ? "credito" : "parte"; $("vePagado").value = p; $("vePagadoBox").hidden = $("vePago").value !== "parte";
  $("veCancel").hidden = false; $("veTitulo").textContent = "Editar venta"; calcVenta(); $("fVenta").scrollIntoView({ behavior: "smooth" });
}
$("veCliNuevo").onclick = () => { $("veCliBox").hidden = false; $("veCliNom").focus(); };
$("veCliCancel").onclick = () => { $("veCliBox").hidden = true; $("veCliNom").value = $("veCliTel").value = ""; };
$("veCliGuardar").onclick = async () => {
  const nombre = $("veCliNom").value.trim(); if (!nombre) { toast("Escribe el nombre del cliente"); return; }
  try {
    const c = chk(await sb.from("clientes").insert({ empresa_id: E, nombre, telefono: $("veCliTel").value.trim() || null }).select().single());
    S.clientes.push(c); fillClientes(); $("veCliente").value = c.id; $("veCliCancel").onclick(); renderClientes(); calcVenta(); toast("Cliente guardado");
  } catch (e) { fail(e); }
};
$("fVenta").addEventListener("submit", async ev => {
  ev.preventDefault();
  const items = leerLineas($("veLines")); if (!items.length) { toast("Elige el tipo de tostón y cuántas unidades"); return; }
  const t = totalItems(items), pagado = r2(pagadoVenta(t)), cli = $("veCliente").value, id = $("veId").value;
  if (t - pagado > 0.004 && !cli) { toast("Elige el cliente para poder anotar la deuda"); return; }
  const p = { id: id || null, empresa_id: E, fecha: $("veFecha").value || today(), cliente_id: cli || null, pagado, items };
  try { chk(await sb.rpc("guardar_venta", { p })); toast(id ? "Venta actualizada" : "Venta guardada"); resetVenta(); await recargar("ventas", "inventario"); }
  catch (e) { fail(e); }
});
function renderVentas() {
  const V = sortF(S.ventas);
  $("lVentas").innerHTML = tabla(`<th>Fecha</th><th>Cliente</th><th>Detalle</th><th class="n">Total</th><th></th>`,
    corta(V).map(v => {
      const t = totalVenta(v), q = t - num(v.pagado);
      return `<tr><td>${fdate(v.fecha)}</td><td><b>${esc(nomCli(v.cliente_id))}</b></td>
      <td>${v.items.map(i => `${qty(i.cantidad)} ${esc(nomTipo(i.tipo_id))} <span class="muted">a ${money(i.precio)}</span>`).join("<br>")}</td>
      <td class="n"><b>${money(t)}</b>${q > 0.004 ? `<span class="s"><span class="pill debe">Debe ${money(q)}</span></span>` : `<span class="s"><span class="pill pag">Pagada</span></span>`}</td>
      <td class="n"><div class="btns" style="justify-content:flex-end"><button class="btn sm ghost" data-ed="venta" data-id="${v.id}">Editar</button><button class="btn sm danger" data-del="ventas" data-id="${v.id}">Borrar</button></div></td></tr>`;
    }), "Todavía no hay ventas.") + masFilas(V);
}

/* ---------- CLIENTES ---------- */
function resetCliente() { $("fCliente").reset(); $("clId").value = ""; $("clRec").checked = true; $("clCancel").hidden = true; $("clTitulo").textContent = "Nuevo cliente"; }
$("clCancel").onclick = resetCliente;
function editCliente(id) {
  const c = byId("clientes", id); if (!c) return;
  $("clId").value = c.id; $("clNombre").value = c.nombre; $("clTel").value = c.telefono || ""; $("clNotas").value = c.notas || ""; $("clRec").checked = c.recordar !== false;
  $("clCancel").hidden = false; $("clTitulo").textContent = "Editar cliente"; $("fCliente").scrollIntoView({ behavior: "smooth" });
}
$("fCliente").addEventListener("submit", async ev => {
  ev.preventDefault();
  const id = $("clId").value, d = { empresa_id: E, nombre: $("clNombre").value.trim(), telefono: $("clTel").value.trim() || null, notas: $("clNotas").value.trim() || null, recordar: $("clRec").checked };
  try { chk(await (id ? sb.from("clientes").update(d).eq("id", id) : sb.from("clientes").insert(d))); toast("Cliente guardado"); resetCliente(); await recargar("clientes"); }
  catch (e) { fail(e); }
});
async function registrarPago(cid, inp) {
  const m = r2(inp.value); if (!(m > 0)) { toast("Escribe cuánto te pagaron"); inp.focus(); return; }
  try { chk(await sb.from("pagos").insert({ empresa_id: E, cliente_id: cid, monto: m, fecha: today() })); toast("Pago de " + money(m) + " anotado"); await recargar("pagos"); }
  catch (e) { fail(e); }
}
$("lCli").addEventListener("click", e => { const b = e.target.closest("[data-pagar]"); if (b) registrarPago(b.dataset.pagar, b.parentElement.querySelector("input")); });
$("lCli").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches(".abono input")) { e.preventDefault(); registrarPago(e.target.dataset.cli, e.target); } });
function renderClientes() {
  const C = S.clientes.map(c => ({ c, d: deuda(c) })).sort((a, b) => b.d - a.d || a.c.nombre.localeCompare(b.c.nombre, "es"));
  $("lCli").innerHTML = tabla(`<th>Cliente</th><th class="n">Debe</th><th class="n">Registrar pago</th><th></th>`,
    C.map(({ c, d }) => {
      let debe;
      if (d > 0.004) { const f = debeDesde(c), n = diasDesde(f), late = n > diasAviso(); debe = `<b style="color:var(--warn)">${money(d)}</b><span class="s">${f ? (n <= 0 ? "desde hoy" : "hace " + n + " día" + (n === 1 ? "" : "s")) : ""}${c.recordar === false ? " · sin aviso" : ""}</span>${late && c.recordar !== false ? '<span class="pill neg">Atrasado</span>' : ""}${late ? `<span class="s" style="margin-top:6px">${waBtn(c, d, f)}</span>` : ""}`; }
      else debe = d < -0.004 ? `<span class="s">Saldo a favor ${money(-d)}</span>` : '<span class="pill pag">Al día</span>';
      return `<tr><td><b>${esc(c.nombre)}</b>${c.telefono ? `<span class="s">${esc(c.telefono)}</span>` : ""}${c.notas ? `<span class="s">${esc(c.notas)}</span>` : ""}</td><td class="n">${debe}</td>
      <td class="n"><div class="abono"><input type="number" step="any" min="0" placeholder="Monto" aria-label="Monto del pago de ${esc(c.nombre)}" data-cli="${c.id}"${d > 0.004 ? ` value="${r2(d)}"` : ""}><button class="btn sm" type="button" data-pagar="${c.id}">Anotar pago</button></div></td>
      <td class="n"><div class="btns" style="justify-content:flex-end"><button class="btn sm ghost" data-ed="cliente" data-id="${c.id}">Editar</button><button class="btn sm danger" data-del="clientes" data-id="${c.id}">Borrar</button></div></td></tr>`;
    }), "Todavía no hay clientes.");
  const P = sortF(S.pagos);
  $("lPagos").innerHTML = tabla(`<th>Fecha</th><th>Cliente</th><th class="n">Monto</th><th></th>`,
    corta(P).map(p => `<tr><td>${fdate(p.fecha)}</td><td><b>${esc(nomCli(p.cliente_id))}</b></td><td class="n"><b>${money(p.monto)}</b></td><td class="n"><button class="btn sm danger" data-del="pagos" data-id="${p.id}">Borrar</button></td></tr>`),
    "Todavía no hay pagos.") + masFilas(P);
}

/* ---------- FÁBRICA: datos, equipo e invitaciones ---------- */
const ROL = { dueno: "Dueño", admin: "Administrador", operador: "Operador" };
function renderEmpresa() {
  const e = emp(), adm = esAdmin();
  if (document.activeElement?.closest("#fEmpresa") == null) { $("emNombre").value = e.nombre || ""; $("emMoneda").value = e.moneda || "$"; $("emDias").value = e.dias_aviso ?? 7; }
  ["emNombre", "emMoneda", "emDias"].forEach(i => $(i).disabled = !adm); $("emGuardar").hidden = !adm; $("emSoloAdmin").hidden = adm;
  $("invBox").hidden = !adm;
  const M = [...S.miembros].sort((a, b) => ["dueno", "admin", "operador"].indexOf(a.rol) - ["dueno", "admin", "operador"].indexOf(b.rol) || a.email.localeCompare(b.email));
  $("lEquipo").innerHTML = tabla(`<th>Correo</th><th>Rol</th><th></th>`, M.map(m => {
    const yo = m.user_id === USER.id, puede = adm && m.rol !== "dueno" && !yo;
    const rol = puede ? `<select data-rol="${m.user_id}" aria-label="Rol de ${esc(m.email)}" style="min-height:36px">${["admin", "operador"].map(r => `<option value="${r}"${r === m.rol ? " selected" : ""}>${ROL[r]}</option>`).join("")}</select>` : `<span class="pill${m.rol === "dueno" ? " ok" : ""}">${ROL[m.rol]}</span>`;
    const acc = puede ? `<button class="btn sm danger" data-quitar="${m.user_id}">Quitar</button>` : yo && m.rol !== "dueno" ? `<button class="btn sm danger" data-quitar="${m.user_id}">Salir de esta fábrica</button>` : "";
    return `<tr><td><b>${esc(m.email)}</b>${yo ? '<span class="s">Tú</span>' : ""}</td><td>${rol}</td><td class="n">${acc}</td></tr>`;
  }), "");
  $("lInvit").innerHTML = S.invitaciones.length ? `<table><thead><tr><th>Invitaciones pendientes</th><th>Rol</th><th></th></tr></thead><tbody>${S.invitaciones.map(i => `<tr><td>${esc(i.email)}</td><td>${ROL[i.rol]}</td><td class="n"><button class="btn sm danger" data-desinvitar="${i.id}">Cancelar</button></td></tr>`).join("")}</tbody></table>` : "";
}
$("fEmpresa").addEventListener("submit", async ev => {
  ev.preventDefault();
  const d = { nombre: $("emNombre").value.trim(), moneda: $("emMoneda").value.trim() || "$", dias_aviso: Math.max(0, Math.round(num($("emDias").value))) };
  try { chk(await sb.from("empresas").update(d).eq("id", E)); Object.assign(emp(), d); toast("Datos guardados"); $("emNombre").blur(); await abrirEmpresa(E); }
  catch (e) { fail(e); }
});
$("fOtra").addEventListener("submit", async ev => {
  ev.preventDefault();
  try { await nuevaEmpresa($("otNombre").value.trim(), MON); $("fOtra").reset(); toast("Fábrica creada"); irA("resumen"); } catch (e) { fail(e); }
});
$("fInvitar").addEventListener("submit", async ev => {
  ev.preventDefault();
  const email = $("inEmail").value.trim().toLowerCase();
  if (S.miembros.some(m => m.email === email)) { toast("Esa persona ya está en el equipo"); return; }
  try { chk(await sb.from("invitaciones").upsert({ empresa_id: E, email, rol: $("inRol").value }, { onConflict: "empresa_id,email" })); $("fInvitar").reset(); toast("Invitación guardada. Que entre con " + email); await recargar("invitaciones"); }
  catch (e) { fail(e); }
});
$("t-empresa").addEventListener("change", async e => {
  const s = e.target.closest("[data-rol]"); if (!s) return;
  try { chk(await sb.from("miembros").update({ rol: s.value }).eq("empresa_id", E).eq("user_id", s.dataset.rol)); toast("Rol cambiado"); await recargar("miembros"); } catch (err) { fail(err); }
});
$("t-empresa").addEventListener("click", async e => {
  const q = e.target.closest("[data-quitar]"), d = e.target.closest("[data-desinvitar]");
  try {
    if (q) {
      const yo = q.dataset.quitar === USER.id;
      if (!confirm(yo ? "¿Salir de esta fábrica? Ya no podrás ver sus datos." : "¿Quitar a esta persona del equipo?")) return;
      chk(await sb.from("miembros").delete().eq("empresa_id", E).eq("user_id", q.dataset.quitar));
      if (yo) { await cargarEmpresas(); E = null; return iniciar(); }
      toast("Quitado del equipo"); await recargar("miembros");
    }
    if (d) { chk(await sb.from("invitaciones").delete().eq("id", d.dataset.desinvitar)); toast("Invitación cancelada"); await recargar("invitaciones"); }
  } catch (err) { fail(err); }
});

/* ---------- EXCEL ---------- */
function libro() {
  return {
    "Gastos": sortF(S.gastos).map(g => ({ "Fecha": g.fecha, "Tipo": g.tipo, "Qué": g.descripcion, "Cantidad": g.cantidad ?? "", "Unidad": g.unidad || "", "Total": r2(g.monto), "Proveedor": g.proveedor || "", "Grupo": g.grupo || "" })),
    "Producción": sortF(S.producciones).flatMap(p => prodItems(p).map(i => ({ "Fecha": p.fecha, "Tipo de tostón": nomTipo(i.tipo_id), "Unidades": i.cantidad, "Precio de venta": r2(i.precio), "Costo": r2(i.costo), "Costo c/u": i.cantidad ? r2(i.costo / i.cantidad) : "", "Grupo": p.grupo || "", "Nota": p.nota || "" }))),
    "Ventas": sortF(S.ventas).flatMap(v => v.items.map((i, n) => ({ "Fecha": v.fecha, "Cliente": nomCli(v.cliente_id), "Tipo de tostón": nomTipo(i.tipo_id), "Unidades": num(i.cantidad), "Precio": r2(i.precio), "Importe": r2(num(i.cantidad) * num(i.precio)), "Total venta": n ? "" : r2(totalVenta(v)), "Pagado": n ? "" : r2(v.pagado) }))),
    "Pagos": sortF(S.pagos).map(p => ({ "Fecha": p.fecha, "Cliente": nomCli(p.cliente_id), "Monto": r2(p.monto) })),
    "Clientes": sortN(S.clientes).map(c => ({ "Cliente": c.nombre, "Teléfono": c.telefono || "", "Notas": c.notas || "", "Debe": r2(deuda(c)) })),
    "Producciones": [...lotesProd()].reverse().map(l => ({ "Producción": nomProd(l.p), "Estado": abierta(l.p) ? "Abierta" : "Cerrada", "Cerrada el": l.p.cerrada_en ? l.p.cerrada_en.slice(0, 10) : "", "Unidades": l.u, "Vendidas": l.vend, "Quedan / merma": l.quedan, "Gasto": r2(l.k), "Vendido": r2(l.monto), "Ganancia": r2(l.gan) })),
  };
}
$("xlBtn").onclick = () => {
  if (!window.XLSX) { toast("No se pudo cargar la librería de Excel"); return; }
  const wb = XLSX.utils.book_new();
  Object.entries(libro()).forEach(([n, rows]) => XLSX.utils.book_append_sheet(wb, rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([["Sin datos"]]), n));
  const slug = (emp().nombre || "tostones").normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  XLSX.writeFile(wb, `${slug}-${today()}.xlsx`);
};

/* ---------- traer una copia de seguridad del sistema Tostitos ---------- */
$("impBtn").onclick = () => $("impFile").click();
$("impFile").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  const msg = $("impMsg");
  try {
    const j = JSON.parse(await f.text()), D = j && j.datos;
    if (!D || j.app !== "tostitos") throw new Error("Ese archivo no es una copia de seguridad de Tostitos.");
    const L = k => Array.isArray(D[k]) ? D[k] : [];
    if (!confirm(`Se van a agregar a “${emp().nombre}”: ${L("tipos").length} tipos, ${L("clientes").length} clientes, ${L("gastos").length} gastos, ${L("produccion").length} producciones, ${L("ventas").length} ventas y ${L("pagos").length} pagos. ¿Seguir?`)) return;
    msg.className = "msg ok"; msg.textContent = "Cargando…";
    const uid = () => crypto.randomUUID(), fecha = x => /^\d{4}-\d{2}-\d{2}$/.test(x || "") ? x : today();
    // defaultToNull:false: si una fila no trae un campo, la base usa su valor por defecto (no NULL)
    const ins = async (t, rows) => { for (let i = 0; i < rows.length; i += 500) chk(await sb.from(t).insert(rows.slice(i, i + 500), { defaultToNull: false })); };
    // Tipos: si ya existe uno con el mismo nombre, se usa ese
    const mapT = {}, porNombre = Object.fromEntries(S.tipos.map(t => [t.nombre.toLowerCase(), t.id])), nuevosT = [];
    L("tipos").forEach(t => { const n = String(t.nombre || "Sin nombre").trim(), k = n.toLowerCase(); if (!porNombre[k]) { porNombre[k] = uid(); nuevosT.push({ id: porNombre[k], empresa_id: E, nombre: n, precio: r2(t.precio), activo: true }); } mapT[t.id] = porNombre[k]; });
    const tipoDe = id => { if (!mapT[id]) { mapT[id] = uid(); nuevosT.push({ id: mapT[id], empresa_id: E, nombre: "Tipo viejo " + nuevosT.length, precio: 0, activo: false }); } return mapT[id]; };
    const mapC = {}, nuevosC = L("clientes").map(c => ({ id: (mapC[c.id] = uid()), empresa_id: E, nombre: String(c.nombre || "Sin nombre").trim() || "Sin nombre", telefono: c.telefono || null, notas: c.direccion || null, recordar: c.recordar !== false }));
    const gastos = L("gastos").map(g => ({ empresa_id: E, fecha: fecha(g.fecha), tipo: ["Materia prima", "Producción", "Otro"].includes(g.tipo) ? g.tipo : "Otro", descripcion: String(g.descripcion || "Gasto").trim() || "Gasto", cantidad: num(g.cantidad) || null, unidad: g.unidad || null, monto: Math.max(0, r2(g.monto)), proveedor: g.proveedor || null, grupo: limpiaCod(g.lote) || null }));
    const prods = [], pItems = [];
    L("produccion").forEach(p => {
      const it = (Array.isArray(p.items) ? p.items : [{ tipoId: p.tipoId, cantidad: p.cantidad, precio: p.precio }]).filter(x => x.tipoId && num(x.cantidad) > 0);
      if (!it.length) return; const id = uid();
      prods.push({ id, empresa_id: E, fecha: fecha(p.fecha), grupo: limpiaCod(p.lote) || null, costo: Math.max(0, r2(p.costo)), nota: p.nota || null });
      it.forEach(x => pItems.push({ empresa_id: E, produccion_id: id, tipo_id: tipoDe(x.tipoId), cantidad: num(x.cantidad), precio: Math.max(0, r2(x.precio)) }));
    });
    const ventas = [], vItems = [];
    L("ventas").forEach(v => {
      const it = (v.items || []).filter(x => x.tipoId && num(x.cantidad) > 0); if (!it.length) return; const id = uid();
      ventas.push({ id, empresa_id: E, fecha: fecha(v.fecha), cliente_id: mapC[v.clienteId] || null, pagado: Math.max(0, r2(v.pagado)) });
      it.forEach(x => vItems.push({ empresa_id: E, venta_id: id, tipo_id: tipoDe(x.tipoId), cantidad: num(x.cantidad), precio: Math.max(0, r2(x.precio)) }));
    });
    const pagos = L("pagos").filter(p => mapC[p.clienteId] && num(p.monto) > 0).map(p => ({ empresa_id: E, cliente_id: mapC[p.clienteId], fecha: fecha(p.fecha), monto: r2(p.monto) }));
    await ins("tipos_toston", nuevosT); await ins("clientes", nuevosC); await ins("gastos", gastos);
    await ins("producciones", prods); await ins("produccion_items", pItems);
    await ins("ventas", ventas); await ins("venta_items", vItems); await ins("pagos", pagos);
    if (D.ajustes?.[0]?.moneda && !S.gastos.length && !S.ventas.length) { chk(await sb.from("empresas").update({ moneda: D.ajustes[0].moneda }).eq("id", E)); emp().moneda = D.ajustes[0].moneda; }
    await recargar();
    msg.textContent = `Listo: se cargaron ${gastos.length} gastos, ${prods.length} producciones, ${ventas.length} ventas y ${pagos.length} pagos.`;
  } catch (err) { console.error(err); msg.className = "msg"; msg.textContent = errMsg(err); }
});

resetGasto(); resetProd(); resetVenta();
