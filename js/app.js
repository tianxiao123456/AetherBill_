const KEY = "aetherbill.v1";

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}

function nowIso() {
  return new Date().toISOString();
}

function emptyState() {
  return { products: [], moves: [], orders: [], ledger: [] };
}

const store = {
  data: emptyState(),

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      this.data = raw ? { ...emptyState(), ...JSON.parse(raw) } : emptyState();
    } catch {
      this.data = emptyState();
    }
    return this.data;
  },

  save() {
    localStorage.setItem(KEY, JSON.stringify(this.data));
  },

  export() {
    return JSON.stringify(this.data, null, 2);
  },

  import(json) {
    this.data = { ...emptyState(), ...JSON.parse(json) };
    this.save();
  },

  addProduct({ sku, name, qty, unit, cost, note }) {
    const product = {
      id: uid(),
      sku: (sku || "").trim(),
      name: name.trim(),
      qty: Number(qty) || 0,
      unit: (unit || "件").trim(),
      cost: Number(cost) || 0,
      note: (note || "").trim(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.data.products.unshift(product);
    if (product.qty) {
      this.data.moves.unshift({
        id: uid(),
        productId: product.id,
        name: product.name,
        sku: product.sku,
        type: "in",
        qty: product.qty,
        before: 0,
        after: product.qty,
        note: "建档入库",
        createdAt: product.createdAt,
      });
    }
    this.save();
    return product;
  },

  updateProduct(id, patch) {
    const p = this.data.products.find((x) => x.id === id);
    if (!p) return;
    Object.assign(p, patch, { updatedAt: nowIso() });
    this.save();
  },

  removeProduct(id) {
    this.data.products = this.data.products.filter((x) => x.id !== id);
    this.save();
  },

  setQty(id, nextQty, note = "快捷改库存") {
    const p = this.data.products.find((x) => x.id === id);
    if (!p) throw new Error("货品不存在");
    const after = Number(nextQty);
    if (!Number.isFinite(after) || after < 0) throw new Error("库存须为不小于 0 的数字");
    const before = p.qty;
    const delta = after - before;
    if (delta === 0) return p;
    p.qty = after;
    p.updatedAt = nowIso();
    this.data.moves.unshift({
      id: uid(),
      productId: p.id,
      name: p.name,
      sku: p.sku,
      type: "adjust",
      qty: delta,
      before,
      after,
      note,
      createdAt: nowIso(),
    });
    this.save();
    return p;
  },

  inbound({ productId, qty, note }) {
    const p = this.data.products.find((x) => x.id === productId);
    if (!p) throw new Error("货品不存在");
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) throw new Error("入库数量须大于 0");
    const before = p.qty;
    p.qty += n;
    p.updatedAt = nowIso();
    this.data.moves.unshift({
      id: uid(),
      productId: p.id,
      name: p.name,
      sku: p.sku,
      type: "in",
      qty: n,
      before,
      after: p.qty,
      note: (note || "").trim(),
      createdAt: nowIso(),
    });
    this.save();
  },

  createOrder({ info, company, tracking, freight, income, note, items }) {
    const lines = items
      .map((it) => {
        const p = this.data.products.find((x) => x.id === it.productId);
        return {
          productId: it.productId,
          name: p ? p.name : it.name,
          sku: p ? p.sku : "",
          qty: Number(it.qty) || 0,
          price: Number(it.price) || 0,
        };
      })
      .filter((it) => it.productId && it.qty > 0);

    if (!lines.length) throw new Error("请添加出库货品");

    for (const line of lines) {
      const p = this.data.products.find((x) => x.id === line.productId);
      if (!p) throw new Error(`货品不存在：${line.name}`);
      if (p.qty < line.qty) throw new Error(`${p.name} 库存不足（现有 ${p.qty}）`);
    }

    const createdAt = nowIso();
    const orderId = uid();
    const goodsTotal = lines.reduce((s, it) => s + it.qty * it.price, 0);
    const freightAmt = Number(freight) || 0;
    const incomeAmt = income === "" || income == null ? goodsTotal : Number(income) || 0;
    const infoText = (info || "").trim();

    for (const line of lines) {
      const p = this.data.products.find((x) => x.id === line.productId);
      const before = p.qty;
      p.qty -= line.qty;
      p.updatedAt = createdAt;
      this.data.moves.unshift({
        id: uid(),
        productId: p.id,
        name: p.name,
        sku: p.sku,
        type: "out",
        qty: -line.qty,
        before,
        after: p.qty,
        orderId,
        note: infoText ? `出单 ${infoText.split(/\s+/)[0]}` : "出单",
        createdAt,
      });
    }

    const order = {
      id: orderId,
      express: {
        info: infoText,
        company: (company || "").trim(),
        tracking: (tracking || "").trim(),
        freight: freightAmt,
      },
      items: lines,
      goodsTotal,
      income: incomeAmt,
      note: (note || "").trim(),
      createdAt,
    };
    this.data.orders.unshift(order);

    if (incomeAmt) {
      this.data.ledger.unshift({
        id: uid(),
        type: "income",
        amount: incomeAmt,
        category: "货款",
        orderId,
        note: infoText.split(/\n/)[0] || "出单收款",
        createdAt,
      });
    }
    if (freightAmt) {
      this.data.ledger.unshift({
        id: uid(),
        type: "expense",
        amount: freightAmt,
        category: "运费",
        orderId,
        note: tracking || company || "快递运费",
        createdAt,
      });
    }

    this.save();
    return order;
  },

  addLedger({ type, amount, category, note }) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) throw new Error("金额须大于 0");
    this.data.ledger.unshift({
      id: uid(),
      type,
      amount: n,
      category: (category || "").trim() || (type === "income" ? "收入" : "支出"),
      note: (note || "").trim(),
      createdAt: nowIso(),
    });
    this.save();
  },

  removeLedger(id) {
    this.data.ledger = this.data.ledger.filter((x) => x.id !== id);
    this.save();
  },

  updateOrderExpress(id, patch) {
    const o = this.data.orders.find((x) => x.id === id);
    if (!o) return;
    o.express = { ...o.express, ...patch };
    this.save();
  },

  totals() {
    const skuCount = this.data.products.length;
    const stock = this.data.products.reduce((s, p) => s + (Number(p.qty) || 0), 0);
    const income = this.data.ledger.filter((x) => x.type === "income").reduce((s, x) => s + x.amount, 0);
    const expense = this.data.ledger.filter((x) => x.type === "expense").reduce((s, x) => s + x.amount, 0);
    return { skuCount, stock, income, expense, balance: income - expense };
  },
};


const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const money = (n) =>
  "¥" + (Number(n) || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function expressInfo(o) {
  if (o.express && o.express.info) return o.express.info;
  return [o.customer, o.phone, o.address].filter(Boolean).join(" ");
}

const fmtTime = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

let view = "stock";
let q = "";

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 1800);
}

function setView(name) {
  view = name;
  $$("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  render();
}

function kpis() {
  const t = store.totals();
  $("#kpi-stock").textContent = t.stock;
  $("#kpi-sku").textContent = t.skuCount;
  $("#kpi-balance").textContent = money(t.balance);
}

function filteredProducts() {
  const s = q.trim().toLowerCase();
  return store.data.products.filter((p) => {
    if (!s) return true;
    return [p.name, p.sku, p.note].join(" ").toLowerCase().includes(s);
  });
}

function renderStock() {
  const rows = filteredProducts();
  if (!rows.length) {
    return `<div class="empty">${store.data.products.length ? "无匹配货品" : "暂无库存，先添加货品"}</div>`;
  }
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>货品</th>
            <th>SKU</th>
            <th class="right">库存</th>
            <th class="right">成本</th>
            <th>更新时间</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (p) => `
            <tr>
              <td data-label="货品">${escapeHtml(p.name)}${p.note ? `<div class="muted">${escapeHtml(p.note)}</div>` : ""}</td>
              <td data-label="SKU" class="muted">${escapeHtml(p.sku || "—")}</td>
              <td data-label="库存">
                <div class="qty-edit">
                  <button data-act="dec" data-id="${p.id}">−</button>
                  <input class="num" data-qty="${p.id}" value="${p.qty}" inputmode="numeric">
                  <button data-act="inc" data-id="${p.id}">+</button>
                </div>
              </td>
              <td data-label="成本" class="num right ${p.qty <= 0 ? "low" : ""}">${money(p.cost)}</td>
              <td data-label="更新" class="muted num">${fmtTime(p.updatedAt)}</td>
              <td class="row-actions">
                <button class="btn ghost" data-act="in" data-id="${p.id}">入库</button>
                <button class="btn ghost" data-act="edit" data-id="${p.id}">改</button>
                <button class="btn ghost" data-act="del" data-id="${p.id}">删</button>
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

function renderFlow() {
  const opts = store.data.products
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}（${p.qty}${p.unit}）</option>`)
    .join("");
  return `
    <form id="order-form" class="panel">
      <div class="form-grid">
        <label class="full"><span class="label">出库明细</span>
          <div class="line-items" id="lines">
            <div class="line">
              <select class="field" name="productId">${opts || `<option value="">暂无货品</option>`}</select>
              <input class="field" name="qty" placeholder="数量" inputmode="numeric" value="1">
              <input class="field" name="price" placeholder="单价" inputmode="decimal">
              <button type="button" class="btn ghost" data-act="rm-line">×</button>
            </div>
          </div>
          <button type="button" class="btn" id="add-line" style="margin-top:8px">加一行</button>
        </label>
        <label class="full"><span class="label">快递信息</span><textarea class="field" name="info" placeholder="客户 / 电话 / 地址"></textarea></label>
        <label><span class="label">快递公司</span><input class="field" name="company" placeholder="如 顺丰 / 中通"></label>
        <label><span class="label">运单号</span><input class="field" name="tracking"></label>
        <label><span class="label">运费</span><input class="field" name="freight" inputmode="decimal" placeholder="0"></label>
        <label><span class="label">实收货款</span><input class="field" name="income" inputmode="decimal" placeholder="默认=数量×单价"></label>
        <label class="full"><span class="label">备注</span><textarea class="field" name="note"></textarea></label>
      </div>
      <div class="summary">
        <span class="muted">确认后扣库存，记录写入下方表格</span>
        <button class="btn primary" type="submit">确认出单</button>
      </div>
    </form>
    <div class="section-head">进出记录</div>
    <div class="panel">${renderMoves()}</div>`;
}

function lineHtml() {
  const opts = store.data.products
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}（${p.qty}${p.unit}）</option>`)
    .join("");
  const wrap = document.createElement("div");
  wrap.className = "line";
  wrap.innerHTML = `
    <select class="field" name="productId">${opts}</select>
    <input class="field" name="qty" placeholder="数量" inputmode="numeric" value="1">
    <input class="field" name="price" placeholder="单价" inputmode="decimal">
    <button type="button" class="btn ghost" data-act="rm-line">×</button>`;
  return wrap;
}

function renderMoves() {
  const s = q.trim().toLowerCase();
  const rows = store.data.moves.filter((m) => {
    if (!s) return true;
    return [m.name, m.sku, m.note, m.type].join(" ").toLowerCase().includes(s);
  });
  if (!rows.length) return `<div class="empty">暂无进出记录</div>`;
  const typeLabel = { in: "入库", out: "出库", adjust: "调整" };
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>类型</th>
            <th>货品</th>
            <th class="right">数量</th>
            <th class="right">结余</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (m) => `
            <tr>
              <td data-label="时间" class="num">${fmtTime(m.createdAt)}</td>
              <td data-label="类型"><span class="tag ${m.type}">${typeLabel[m.type] || m.type}</span></td>
              <td data-label="货品">${escapeHtml(m.name)}${m.sku ? `<div class="muted">${escapeHtml(m.sku)}</div>` : ""}</td>
              <td data-label="数量" class="num right">${m.qty > 0 ? "+" : ""}${m.qty}</td>
              <td data-label="结余" class="num right">${m.after}</td>
              <td data-label="备注" class="muted">${escapeHtml(m.note || "—")}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

function renderExpress() {
  const s = q.trim().toLowerCase();
  const rows = store.data.orders.filter((o) => {
    if (!s) return true;
    return [o.customer, o.phone, o.address, o.express.company, o.express.tracking, o.note]
      .join(" ")
      .toLowerCase()
      .includes(s);
  });
  if (!rows.length) return `<div class="empty">暂无快递信息</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>客户</th>
            <th>快递</th>
            <th>运单号</th>
            <th class="right">运费</th>
            <th>货品</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((o) => {
              const goods = o.items.map((i) => `${i.name}×${i.qty}`).join("、");
              return `
              <tr>
                <td data-label="时间" class="num">${fmtTime(o.createdAt)}</td>
                <td data-label="客户">${escapeHtml(o.customer || "—")}<div class="muted">${escapeHtml(o.phone || o.address || "")}</div></td>
                <td data-label="快递">${escapeHtml(o.express.company || "—")}</td>
                <td data-label="运单号" class="num">${escapeHtml(o.express.tracking || "—")}</td>
                <td data-label="运费" class="num right">${money(o.express.freight)}</td>
                <td data-label="货品">${escapeHtml(goods)}</td>
                <td class="row-actions">
                  <button class="btn ghost" data-act="edit-exp" data-id="${o.id}">改单号</button>
                </td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;
}

function renderLedger() {
  const s = q.trim().toLowerCase();
  const rows = store.data.ledger.filter((x) => {
    if (!s) return true;
    return [x.type, x.category, x.note].join(" ").toLowerCase().includes(s);
  });
  const t = store.totals();
  return `
    <div class="summary panel" style="margin-bottom:12px;border-radius:var(--radius)">
      <span>收入 ${money(t.income)}</span>
      <span>支出 ${money(t.expense)}</span>
      <b>结余 ${money(t.balance)}</b>
    </div>
    ${
      rows.length
        ? `<div class="table-wrap"><table>
        <thead><tr><th>时间</th><th>类型</th><th>类目</th><th class="right">金额</th><th>备注</th><th></th></tr></thead>
        <tbody>
          ${rows
            .map(
              (x) => `
            <tr>
              <td data-label="时间" class="num">${fmtTime(x.createdAt)}</td>
              <td data-label="类型"><span class="tag ${x.type === "income" ? "in" : "out"}">${x.type === "income" ? "收入" : "支出"}</span></td>
              <td data-label="类目">${escapeHtml(x.category)}</td>
              <td data-label="金额" class="num right">${x.type === "income" ? "+" : "−"}${money(x.amount)}</td>
              <td data-label="备注" class="muted">${escapeHtml(x.note || "—")}</td>
              <td class="row-actions"><button class="btn ghost" data-act="del-led" data-id="${x.id}">删</button></td>
            </tr>`
            )
            .join("")}
        </tbody></table></div>`
        : `<div class="empty">暂无账目</div>`
    }`;
}

function toolbar() {
  const addStock = view === "stock" ? `<button class="btn primary" id="add-product">添加货品</button>` : "";
  const addLed = view === "ledger" ? `<button class="btn primary" id="add-ledger">记一笔</button>` : "";
  const hint = view === "flow" ? "搜索进出记录" : "搜索";
  return `
    <div class="toolbar">
      <input class="search grow" id="search" placeholder="${hint}" value="${escapeAttr(q)}">
      ${addStock}${addLed}
      <button class="btn" id="export">导出</button>
      <button class="btn" id="import">导入</button>
    </div>`;
}

function render() {
  kpis();
  if (view === "flow") {
    $("#main").innerHTML = toolbar() + `<div class="stack">${renderFlow()}</div>`;
    return;
  }
  const body =
    view === "stock" ? renderStock() : view === "express" ? renderExpress() : renderLedger();
  $("#main").innerHTML = toolbar() + `<div class="panel">${body}</div>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function escapeAttr(s) {
  return escapeHtml(s);
}

function openDialog(title, fieldsHtml, onOk) {
  const dlg = $("#dlg");
  dlg.innerHTML = `
    <form class="dialog-body" id="dlg-form">
      <h3>${title}</h3>
      ${fieldsHtml}
    </form>
    <div class="dialog-actions">
      <button class="btn" type="button" id="dlg-cancel">取消</button>
      <button class="btn primary" value="ok" form="dlg-form">确定</button>
    </div>`;
  dlg.showModal();
  const form = $("#dlg-form");
  $("#dlg-cancel").addEventListener("click", () => dlg.close());
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      onOk(new FormData(form));
      dlg.close();
      render();
    } catch (err) {
      toast(err.message);
    }
  });
}

function productFields(p = {}) {
  return `
    <label class="label">名称</label><input class="field" name="name" required value="${escapeAttr(p.name || "")}">
    <label class="label" style="margin-top:8px">SKU</label><input class="field" name="sku" value="${escapeAttr(p.sku || "")}">
    <label class="label" style="margin-top:8px">初始库存</label><input class="field" name="qty" inputmode="numeric" value="${p.qty ?? 0}" ${p.id ? "disabled" : ""}>
    <label class="label" style="margin-top:8px">单位</label><input class="field" name="unit" value="${escapeAttr(p.unit || "件")}">
    <label class="label" style="margin-top:8px">成本</label><input class="field" name="cost" inputmode="decimal" value="${p.cost ?? ""}">
    <label class="label" style="margin-top:8px">备注</label><input class="field" name="note" value="${escapeAttr(p.note || "")}">`;
}

function applyQty(id, value) {
  try {
    store.setQty(id, value);
    render();
  } catch (e) {
    toast(e.message);
    render();
  }
}

function bind() {
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-view]");
    if (nav) setView(nav.dataset.view);

    if (e.target.id === "add-product") {
      openDialog("添加货品", productFields(), (fd) => {
        if (!fd.get("name").trim()) throw new Error("请填写名称");
        store.addProduct(Object.fromEntries(fd));
        toast("已添加");
      });
    }

    if (e.target.id === "add-ledger") {
      openDialog(
        "记一笔",
        `
        <label class="label">类型</label>
        <select class="field" name="type"><option value="income">收入</option><option value="expense">支出</option></select>
        <label class="label" style="margin-top:8px">金额</label><input class="field" name="amount" inputmode="decimal" required>
        <label class="label" style="margin-top:8px">类目</label><input class="field" name="category" placeholder="货款 / 运费 / 采购">
        <label class="label" style="margin-top:8px">备注</label><input class="field" name="note">`,
        (fd) => {
          store.addLedger(Object.fromEntries(fd));
          toast("已入账");
        }
      );
    }

    if (e.target.id === "export") {
      const blob = new Blob([store.export()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `aetherbill-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    if (e.target.id === "import") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json";
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        try {
          store.import(await file.text());
          render();
          toast("已导入");
        } catch {
          toast("导入失败");
        }
      };
      input.click();
    }

    if (e.target.id === "add-line") {
      $("#lines").appendChild(lineHtml());
    }

    const act = e.target.closest("[data-act]");
    if (!act) return;
    const id = act.dataset.id;
    const action = act.dataset.act;

    if (action === "inc" || action === "dec") {
      const p = store.data.products.find((x) => x.id === id);
      applyQty(id, p.qty + (action === "inc" ? 1 : -1));
    }
    if (action === "in") {
      openDialog(
        "入库",
        `<label class="label">数量</label><input class="field" name="qty" inputmode="numeric" required>
         <label class="label" style="margin-top:8px">备注</label><input class="field" name="note">`,
        (fd) => {
          store.inbound({ productId: id, qty: fd.get("qty"), note: fd.get("note") });
          toast("已入库");
        }
      );
    }
    if (action === "edit") {
      const p = store.data.products.find((x) => x.id === id);
      openDialog("修改货品", productFields(p), (fd) => {
        store.updateProduct(id, {
          name: fd.get("name").trim(),
          sku: fd.get("sku").trim(),
          unit: fd.get("unit").trim(),
          cost: Number(fd.get("cost")) || 0,
          note: fd.get("note").trim(),
        });
      });
    }
    if (action === "del") {
      if (confirm("删除该货品？进出记录会保留。")) {
        store.removeProduct(id);
        render();
      }
    }
    if (action === "rm-line") {
      const lines = $$("#lines .line");
      if (lines.length > 1) act.closest(".line").remove();
    }
    if (action === "del-led") {
      store.removeLedger(id);
      render();
    }
    if (action === "edit-exp") {
      const o = store.data.orders.find((x) => x.id === id);
      openDialog(
        "改快递",
        `<label class="label">快递公司</label><input class="field" name="company" value="${escapeAttr(o.express.company)}">
         <label class="label" style="margin-top:8px">运单号</label><input class="field" name="tracking" value="${escapeAttr(o.express.tracking)}">
         <label class="label" style="margin-top:8px">运费</label><input class="field" name="freight" value="${o.express.freight}">`,
        (fd) => {
          store.updateOrderExpress(id, {
            company: fd.get("company").trim(),
            tracking: fd.get("tracking").trim(),
            freight: Number(fd.get("freight")) || 0,
          });
        }
      );
    }
  });

  document.addEventListener("change", (e) => {
    const qty = e.target.dataset.qty;
    if (qty) applyQty(qty, e.target.value);
  });

  document.addEventListener("input", (e) => {
    if (e.target.id !== "search") return;
    q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const s = $("#search");
    if (s) {
      s.focus();
      s.setSelectionRange(pos, pos);
    }
  });

  document.addEventListener("submit", (e) => {
    if (e.target.id !== "order-form") return;
    e.preventDefault();
    const form = e.target;
    const lines = $$("#lines .line").map((el) => ({
      productId: $("[name=productId]", el).value,
      qty: $("[name=qty]", el).value,
      price: $("[name=price]", el).value,
    }));
    try {
      store.createOrder({
        customer: form.customer.value,
        phone: form.phone.value,
        address: form.address.value,
        company: form.company.value,
        tracking: form.tracking.value,
        freight: form.freight.value,
        income: form.income.value,
        note: form.note.value,
        items: lines,
      });
      toast("已出单并扣库存");
      render();
    } catch (err) {
      toast(err.message);
    }
  });
}

store.load();
bind();
render();
