    const SUPABASE_URL = 'https://kibqjztozokohqmhqqqf.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpYnFqenRvem9rb2hxbWhxcXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzQzNjIsImV4cCI6MjA4OTgxMDM2Mn0.J7qJUZhWXYf5b9oey4wXJkjdi66jomEMw_NeV9NWF7M';
    const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // ── Nursery Status state ──────────────────────────────────────────────────
    let comboTab = 'basic';
    let nsdAggregates = null;
    let baseStock = 0;
    let currentOrdersQty = 0;

    async function loadNsd() {
        const now = new Date();
        const cm = now.getMonth();
        const cy = now.getFullYear();
        const startOfNextMonthISO = new Date(cy, cm + 1, 1).toISOString();
        const endOfMonth          = new Date(cy, cm + 1, 0, 23, 59, 59);
        const endOfMonthISO       = endOfMonth.toISOString();
        const endOfMonthDateOnly  = endOfMonthISO.slice(0, 10);

        const monthLabel = now.toLocaleString('en-MY', { month: 'short', year: 'numeric' });
        document.getElementById('current-month-label').innerText = monthLabel;

        try {
            const [transRes, auditRes, collRes, ordCollFallbackRes] = await Promise.all([
                _supabase.from('shared_inventory_logs')
                    .select('batch_name,plot_name,quantity_change,created_at')
                    .in('transaction_type', ['Transplanted','Transplanted_Premium','Transplanted_DoubleTone'])
                    .lte('created_at', endOfMonthISO),
                _supabase.from('audit_height_records')
                    .select('plot,batch,sample_1,sample_2,sample_3,avg_height,date')
                    .lte('date', endOfMonthDateOnly),
                // Multi-pickup table — falls back gracefully if it doesn't exist yet.
                _supabase.from('salesweb_order_collections')
                    .select('collected_qty,collected_at')
                    .lte('collected_at', endOfMonthISO)
                    .then(r => r, e => ({ data: null })),
                // Single-collection fallback on the order itself.
                _supabase.from('salesweb_customer_orders')
                    .select('collected_qty,collected_at')
                    .not('collected_qty', 'is', null)
                    .lte('collected_at', endOfMonthISO)
                    .then(r => r, e => ({ data: null }))
            ]);
            const transLogs = transRes.data || [];
            const audits    = auditRes.data || [];

            const groupKey = (b, p) => `${b||''}||${p||''}`;
            const groups = {};
            transLogs.forEach(l => {
                const k = groupKey(l.batch_name, l.plot_name);
                if (!groups[k]) groups[k] = { qty: 0, firstDate: l.created_at };
                groups[k].qty += (l.quantity_change || 0);
                if (l.created_at < groups[k].firstDate) groups[k].firstDate = l.created_at;
            });

            // Earliest ≥150cm audit per group → its "verified matured" date.
            const TALL_CM = 150;
            const auditFirstByGroup = {};
            audits.forEach(a => {
                const max = Math.max(a.sample_1 || 0, a.sample_2 || 0, a.sample_3 || 0, a.avg_height || 0);
                if (max < TALL_CM) return;
                const k = groupKey(a.batch, a.plot);
                if (!auditFirstByGroup[k] || a.date < auditFirstByGroup[k]) auditFirstByGroup[k] = a.date;
            });

            // Cumulative matured TO-DATE (after 10% culling).
            // - Stock To-Date  → groups whose 9-month maturity has passed
            // - Verified Stock → groups whose earliest of (9-month, audit ≥150cm) has passed
            const today = new Date();

            let rawByAge = 0, rawByAgeOrAudit = 0;
            Object.entries(groups).forEach(([k, g]) => {
                const transplantDate = new Date(g.firstDate);
                const ageMatureDate  = new Date(transplantDate); ageMatureDate.setMonth(ageMatureDate.getMonth() + 9);
                const auditMatureDate = auditFirstByGroup[k] ? new Date(auditFirstByGroup[k]) : null;

                if (ageMatureDate <= today) rawByAge += g.qty;

                let earliest = ageMatureDate;
                if (auditMatureDate && auditMatureDate < earliest) earliest = auditMatureDate;
                if (earliest <= today) rawByAgeOrAudit += g.qty;
            });

            // After 10% culling
            let qtyByAge        = Math.round(rawByAge        * 0.9);
            let qtyByAgeOrAudit = Math.round(rawByAgeOrAudit * 0.9);

            // Subtract all collections to-date so "matured" reflects seedlings still on hand.
            let collectedQty = 0;
            if (collRes?.data && collRes.data.length) {
                collectedQty = collRes.data.reduce((s, c) => s + (c.collected_qty || 0), 0);
            } else if (ordCollFallbackRes?.data) {
                collectedQty = ordCollFallbackRes.data.reduce((s, o) => s + (o.collected_qty || 0), 0);
            }
            qtyByAge        = Math.max(0, qtyByAge        - collectedQty);
            qtyByAgeOrAudit = Math.max(0, qtyByAgeOrAudit - collectedQty);

            const { data: pendingOrders } = await _supabase
                .from('salesweb_customer_orders')
                .select('id,status,created_at')
                .not('status', 'in', '("Pending Payment","Cancelled","Order Completed","Completed")')
                .lt('created_at', startOfNextMonthISO);

            const pendingIds = (pendingOrders || []).map(o => o.id);
            let pendingOrdersQty = 0;
            if (pendingIds.length) {
                const { data: items } = await _supabase
                    .from('salesweb_order_items')
                    .select('order_id,quantity')
                    .in('order_id', pendingIds);
                pendingOrdersQty = (items || []).reduce((s, it) => s + (it.quantity || 0), 0);
            }

            nsdAggregates = { qtyByAge, qtyByAgeOrAudit, pendingOrdersQty, collectedQty };
            renderNsdTab();
        } catch(e) {
            console.warn('NSD load error:', e);
            ['stat-matured','stat-orders-current'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerText = '—';
            });
        }
    }

    function switchComboTab(tab) {
        comboTab = tab;
        document.getElementById('combo-tab-basic').classList.toggle('active',    tab === 'basic');
        document.getElementById('combo-tab-verified').classList.toggle('active', tab === 'verified');
        renderNsdTab();
    }

    function renderNsdTab() {
        const verified = comboTab === 'verified';

        document.getElementById('matured-tile-label').innerText = verified
            ? 'Verified Matured (To-Date)'
            : 'Total Matured (To-Date)';
        document.getElementById('matured-tile-sub').innerText = verified
            ? '9-month + audit ≥ 1.5m, after 10% culling, less collections to-date'
            : '9-month rule, after 10% culling, less collections to-date';
        document.getElementById('nsd-remark-audit').style.display = verified ? '' : 'none';

        const availLabel = document.getElementById('avail-tab-label');
        if (availLabel) {
            availLabel.innerHTML = verified
                ? 'From <span class="text-emerald-700 font-black">Verified Stock</span>'
                : 'From <span class="text-emerald-700 font-black">Stock To-Date</span>';
        }

        if (!nsdAggregates) return;
        const matured = verified ? nsdAggregates.qtyByAgeOrAudit : nsdAggregates.qtyByAge;
        document.getElementById('stat-matured').innerText        = matured.toLocaleString();
        document.getElementById('stat-orders-current').innerText = nsdAggregates.pendingOrdersQty.toLocaleString();

        baseStock = matured;
        currentOrdersQty = nsdAggregates.pendingOrdersQty;
        updateGearing();
    }

    function updateGearing() {
        const matured = baseStock;
        const orders  = currentOrdersQty;
        const g = parseInt(document.getElementById('gearing-slider').value) / 10;

        const gearedMatured = Math.round(matured * g);
        const available     = Math.max(0, gearedMatured - orders);

        const isOversold     = orders > matured;
        const oversoldQty    = Math.max(0, orders - matured);
        const oversoldFactor = matured > 0 ? (orders / matured) : 0;
        const neededGearing  = matured > 0 ? Math.min(3.0, orders / matured) : 1.0;

        document.getElementById('stat-available').innerText  = available.toLocaleString();
        document.getElementById('calc-matured').innerText    = matured.toLocaleString();
        document.getElementById('calc-orders').innerText     = orders.toLocaleString();
        document.getElementById('calc-available').innerText  = available.toLocaleString();
        document.getElementById('gearing-display').innerText = g.toFixed(1) + '×';

        const statusBadge = document.getElementById('avail-status-badge');
        const oversoldBox = document.getElementById('oversold-warning');
        if (isOversold) {
            statusBadge.innerText = 'Oversold';
            statusBadge.className = 'text-[9px] font-black bg-red-100 text-red-700 px-2 py-0.5 rounded-full uppercase tracking-widest';
            oversoldBox.classList.remove('hidden');
            document.getElementById('oversold-qty').innerText            = oversoldQty.toLocaleString();
            document.getElementById('oversold-factor').innerText         = oversoldFactor.toFixed(2) + '×';
            document.getElementById('oversold-needed-gearing').innerText = neededGearing.toFixed(2) + '×';
        } else {
            statusBadge.innerText = 'OK';
            statusBadge.className = 'text-[9px] font-black bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase tracking-widest';
            oversoldBox.classList.add('hidden');
        }

        const badge = document.getElementById('gearing-badge');
        if (g <= 1.5)      { badge.innerText = 'Conservative'; badge.className = 'text-[8px] font-black text-emerald-600 bg-white border border-emerald-200 rounded-full px-1.5 py-0.5 uppercase tracking-wider'; }
        else if (g <= 2.2) { badge.innerText = 'Moderate';     badge.className = 'text-[8px] font-black text-amber-600 bg-white border border-amber-200 rounded-full px-1.5 py-0.5 uppercase tracking-wider'; }
        else               { badge.innerText = 'Aggressive';   badge.className = 'text-[8px] font-black text-red-600 bg-white border border-red-200 rounded-full px-1.5 py-0.5 uppercase tracking-wider'; }
    }

    // ── To-Do list ────────────────────────────────────────────────────────────
    let todoTab = 'unpaid';
    let todoData = { unpaid: [], credit: [] };

    async function loadTodoList() {
        await Promise.all([loadUnpaidScenario(), loadCreditScenario()]);
        document.getElementById('todo-count-unpaid').innerText = todoData.unpaid.length;
        document.getElementById('todo-count-credit').innerText = todoData.credit.length;
        renderTodoTab();
        renderPaymentStatusSummary();
    }

    function renderPaymentStatusSummary() {
        const fmtRM = n => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const unpaidCount  = todoData.unpaid.length;
        const unpaidAmt    = todoData.unpaid.reduce((s, r) => s + (r.totalAmount || 0), 0);
        const creditCount  = todoData.credit.length;
        const creditAmt    = todoData.credit.reduce((s, r) => s + (r.totalAmount || 0), 0);

        const paidPending  = (allCustomerOrders || []).filter(r => r.derivedStatus === 'Paid · Pending Pickup');
        const paidCount    = paidPending.length;
        const paidQty      = paidPending.reduce((s, r) => s + (r.balance || 0), 0);

        const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.innerText = txt; };
        setText('pay-unpaid-count', unpaidCount.toLocaleString());
        setText('pay-unpaid-amt',   unpaidCount ? fmtRM(unpaidAmt) : '—');
        setText('pay-credit-count', creditCount.toLocaleString());
        setText('pay-credit-amt',   creditCount ? fmtRM(creditAmt) : '—');
        setText('pay-paid-count',   paidCount.toLocaleString());
        setText('pay-paid-amt',     paidCount ? `${paidQty.toLocaleString()} qty awaiting` : '—');

        const meta = document.getElementById('pay-status-meta');
        if (meta) meta.innerText = `${unpaidCount + creditCount + paidCount} action items`;
    }

    async function loadUnpaidScenario() {
        // "Unpaid" now means: credit invoices we've already ISSUED but the
        // customer hasn't paid yet. (Previously this tab tracked cash orders
        // in status='Pending Payment'; that semantic was replaced by the
        // monthly-invoice workflow per spec.)
        try {
            const { data: invoices, error } = await _supabase
                .from('salesweb_credit_invoices')
                .select('id,customer_id,invoice_number,billing_period,total_qty,total_amount,issued_at,due_date,status,paid_at,invoice_file_url')
                .eq('status', 'issued')
                .is('paid_at', null)
                .order('issued_at', { ascending: false });
            if (error) throw error;

            const customerIds = [...new Set((invoices || []).map(i => i.customer_id).filter(Boolean))];
            const customerNameById = {};
            if (customerIds.length) {
                const { data: profs } = await _supabase
                    .from('shared_profiles')
                    .select('id,full_name,email')
                    .in('id', customerIds);
                (profs || []).forEach(p => { customerNameById[p.id] = p.full_name || p.email || '—'; });
            }

            todoData.unpaid = (invoices || []).map(inv => ({
                id: inv.id,
                invoiceNumber: inv.invoice_number,
                customerName: customerNameById[inv.customer_id] || '—',
                billingPeriod: inv.billing_period,
                totalQty: inv.total_qty || 0,
                totalAmount: inv.total_amount || 0,
                issuedAt: inv.issued_at,
                dueDate: inv.due_date,
                invoiceFileUrl: inv.invoice_file_url
            }));
        } catch(e) {
            console.warn('[Unpaid Invoices] load failed:', e);
            todoData.unpaid = [];
        }
    }

    async function loadCreditScenario() {
        // "Credit" tab shows credit-term orders that have been COLLECTED but
        // are not yet attached to an invoice. Grouped by (customer, collection
        // month) so the 1st-of-month invoicing flow lists one row per
        // customer-per-month with a single Upload Invoice button.
        try {
            const { data: creditOrders, error } = await _supabase
                .from('salesweb_customer_orders')
                .select('id,order_number,customer_id,customer_name,billing_name,total,created_at,status,payment_terms,credit_billed_at,credit_invoice_id,collected_qty,collected_at')
                .eq('payment_terms', 'credit')
                .is('credit_invoice_id', null)
                .not('collected_at', 'is', null)
                .order('collected_at', { ascending: false });
            if (error) throw error;

            const creditIds = (creditOrders || []).map(o => o.id);
            const itemsByOrder = {};
            if (creditIds.length) {
                const { data: items } = await _supabase
                    .from('salesweb_order_items')
                    .select('order_id,product_name,quantity,unit_price,subtotal')
                    .in('order_id', creditIds);
                (items || []).forEach(it => {
                    if (!itemsByOrder[it.order_id]) itemsByOrder[it.order_id] = [];
                    itemsByOrder[it.order_id].push(it);
                });
            }

            // Group by customer_id + billing period (YYYY-MM derived from collected_at)
            const groups = {};
            (creditOrders || []).forEach(o => {
                const period = (o.collected_at || '').slice(0, 7); // 'YYYY-MM'
                if (!period || !o.customer_id) return;
                const key = o.customer_id + '__' + period;
                const items = itemsByOrder[o.id] || [];
                const orderedTotalQty = items.reduce((s, it) => s + (it.quantity || 0), 0);
                const orderedTotalAmt = items.reduce((s, it) => s + (it.subtotal || 0), 0);
                const unitPrice = orderedTotalQty > 0 ? (orderedTotalAmt / orderedTotalQty) : (items[0]?.unit_price || 0);
                const collectedQty = o.collected_qty != null ? o.collected_qty : orderedTotalQty;
                const billAmount = unitPrice * collectedQty;

                if (!groups[key]) {
                    const [y, m] = period.split('-').map(Number);
                    groups[key] = {
                        key,
                        customerId: o.customer_id,
                        customerName: o.billing_name || o.customer_name || '—',
                        billingPeriod: period,
                        billingLabel: new Date(y, m - 1, 1).toLocaleString('en-MY', { month: 'short', year: 'numeric' }),
                        orderIds: [],
                        orderNumbers: [],
                        orderCount: 0,
                        totalQty: 0,
                        totalAmount: 0
                    };
                }
                groups[key].orderIds.push(o.id);
                groups[key].orderNumbers.push(o.order_number);
                groups[key].orderCount += 1;
                groups[key].totalQty += collectedQty;
                groups[key].totalAmount += billAmount;
            });

            todoData.credit = Object.values(groups)
                .sort((a, b) => b.billingPeriod.localeCompare(a.billingPeriod) || a.customerName.localeCompare(b.customerName));
        } catch(e) {
            console.warn('[Credit] unavailable:', e?.message || e);
            todoData.credit = [];
        }
    }

    function switchTodoTab(tab) {
        todoTab = tab;
        document.getElementById('todo-tab-unpaid').classList.toggle('active', tab === 'unpaid');
        document.getElementById('todo-tab-credit').classList.toggle('active', tab === 'credit');
        renderTodoTab();
    }

    function renderTodoTab() {
        const body = document.getElementById('todo-body');
        const meta = document.getElementById('todo-section-meta');
        const fmtRM = n => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        if (todoTab === 'unpaid') {
            const total = todoData.unpaid.reduce((s, r) => s + (r.totalAmount || 0), 0);
            meta.innerHTML = todoData.unpaid.length
                ? `<span class="text-red-600 font-black">${todoData.unpaid.length}</span> invoices · Total <span class="text-red-600 font-black">${fmtRM(total)}</span>`
                : '';

            if (!todoData.unpaid.length) {
                body.innerHTML = '<div class="text-center py-8 text-slate-500"><span class="text-2xl">✓</span><div class="text-[10px] font-bold uppercase tracking-widest mt-1">No unpaid invoices</div></div>';
                return;
            }

            body.innerHTML = todoData.unpaid.map(r => {
                const daysOverdue = r.dueDate ? Math.floor((Date.now() - new Date(r.dueDate).getTime()) / 86400000) : null;
                const overdueBadge = daysOverdue !== null && daysOverdue > 0
                    ? `<span class="text-[8px] font-black px-1 py-0.5 rounded-full bg-red-200 text-red-800 border border-red-400 uppercase tracking-widest ml-1">${daysOverdue}d overdue</span>` : '';
                const viewLink = r.invoiceFileUrl
                    ? `<a href="${escapeHtml(r.invoiceFileUrl)}" target="_blank" rel="noopener" class="ci-link" title="View invoice PDF">📄</a>` : '';
                return `
                <div class="notebook-row" data-invoice-id="${escapeHtml(r.id)}">
                    <div class="nb-line1">
                        <span class="note-name" title="${escapeHtml(r.customerName || '')}">${escapeHtml(r.customerName || '—')}</span>
                        <span class="note-amt">${fmtRM(r.totalAmount)}</span>
                    </div>
                    <div class="nb-line2">
                        <span><span class="text-[8px] font-black px-1 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-300 uppercase tracking-widest mr-1">${escapeHtml(r.billingPeriod || '')}</span><span class="note-id">${escapeHtml(r.invoiceNumber || '—')}</span>${overdueBadge}</span>
                        <span class="flex items-center gap-1.5">${viewLink}<button class="ci-btn ci-btn-paid" onclick="openMarkPaidModal('${escapeHtml(r.id)}')">Mark Paid</button></span>
                    </div>
                </div>`;
            }).join('');
        } else {
            const total = todoData.credit.reduce((s, r) => s + (r.totalAmount || 0), 0);
            meta.innerHTML = todoData.credit.length
                ? `<span class="text-blue-600 font-black">${todoData.credit.length}</span> customers · Total <span class="text-blue-600 font-black">${fmtRM(total)}</span> to invoice`
                : '';

            if (!todoData.credit.length) {
                body.innerHTML = '<div class="text-center py-8 text-slate-500"><span class="text-2xl">✓</span><div class="text-[10px] font-bold uppercase tracking-widest mt-1">No credit invoices pending</div><div class="text-[9px] mt-1">Credit orders appear here once collected. Use the order modal to set <span class="font-mono">collected_at</span>.</div></div>';
                return;
            }

            body.innerHTML = todoData.credit.map(r => `
                <div class="notebook-row credit" data-group-key="${escapeHtml(r.key)}">
                    <div class="nb-line1">
                        <span class="note-name" title="${escapeHtml(r.customerName || '')}">${escapeHtml(r.customerName || '—')}</span>
                        <span class="note-amt">${fmtRM(r.totalAmount)}</span>
                    </div>
                    <div class="nb-line2">
                        <span><span class="text-[8px] font-black px-1 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-300 uppercase tracking-widest mr-1">${escapeHtml(r.billingLabel)}</span><span class="note-id">${r.orderCount} order${r.orderCount===1?'':'s'} · ${r.totalQty.toLocaleString()} qty</span></span>
                        <button class="ci-btn ci-btn-upload" onclick="openInvoiceUploadModal('${escapeHtml(r.key)}')">📤 Upload Invoice</button>
                    </div>
                </div>
            `).join('');
        }
    }

    // ── Credit invoice modal helpers ──────────────────────────────────────────
    function findCreditGroup(key) { return todoData.credit.find(g => g.key === key); }
    function findUnpaidInvoice(id) { return todoData.unpaid.find(i => i.id === id); }

    function openInvoiceUploadModal(groupKey) {
        const g = findCreditGroup(groupKey);
        if (!g) { console.warn('Credit group not found:', groupKey); return; }
        const modal = document.getElementById('ci-upload-modal');
        document.getElementById('ci-up-customer').innerText = g.customerName;
        document.getElementById('ci-up-period').innerText = g.billingLabel + ' (' + g.billingPeriod + ')';
        document.getElementById('ci-up-summary').innerText = g.orderCount + ' order' + (g.orderCount === 1 ? '' : 's') + ' · ' + g.totalQty.toLocaleString() + ' qty · RM ' + Number(g.totalAmount).toFixed(2);
        document.getElementById('ci-up-key').value = groupKey;
        document.getElementById('ci-up-invoice-no').value = '';
        document.getElementById('ci-up-file').value = '';
        document.getElementById('ci-up-due').value = '';
        document.getElementById('ci-up-notes').value = '';
        document.getElementById('ci-up-error').innerText = '';
        modal.classList.add('open');
    }

    function closeInvoiceUploadModal() { document.getElementById('ci-upload-modal').classList.remove('open'); }

    async function submitInvoiceUpload() {
        if (typeof MJMAccess !== 'undefined' && !MJMAccess.requireOperationAction('stock', 'manage')) return;
        const groupKey = document.getElementById('ci-up-key').value;
        const g = findCreditGroup(groupKey);
        const errEl = document.getElementById('ci-up-error');
        errEl.innerText = '';
        if (!g) { errEl.innerText = 'Group not found — refresh the page.'; return; }

        const invNo = document.getElementById('ci-up-invoice-no').value.trim();
        const fileInput = document.getElementById('ci-up-file');
        const dueDate = document.getElementById('ci-up-due').value || null;
        const notes = document.getElementById('ci-up-notes').value.trim() || null;

        if (!invNo) { errEl.innerText = 'Invoice number is required.'; return; }
        if (!fileInput.files || !fileInput.files[0]) { errEl.innerText = 'Pick a PDF/image to upload.'; return; }
        const file = fileInput.files[0];

        const btn = document.getElementById('ci-up-submit');
        btn.disabled = true; btn.innerText = 'Uploading…';

        try {
            // 1. Upload file to storage
            const safeInv = invNo.replace(/[^A-Za-z0-9_-]/g, '_');
            const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
            const path = 'invoices/' + g.customerId.substring(0, 8) + '_' + g.billingPeriod + '_' + safeInv + '_' + Date.now() + '.' + ext;
            const { error: upErr } = await _supabase.storage.from('order-attachments').upload(path, file, { contentType: file.type, upsert: true });
            if (upErr) throw upErr;
            const { data: urlData } = _supabase.storage.from('order-attachments').getPublicUrl(path);
            const fileUrl = urlData?.publicUrl || '';

            // 2. Current user (for issued_by + audit)
            const { data: { session } } = await _supabase.auth.getSession();
            const uid = session?.user?.id || null;
            const uemail = session?.user?.email || 'operation';

            // 3. Insert invoice row
            const { data: inv, error: invErr } = await _supabase
                .from('salesweb_credit_invoices')
                .insert([{
                    customer_id: g.customerId,
                    billing_period: g.billingPeriod,
                    invoice_number: invNo,
                    total_qty: g.totalQty,
                    total_amount: Number(g.totalAmount.toFixed(2)),
                    status: 'issued',
                    invoice_file_url: fileUrl,
                    due_date: dueDate,
                    issued_by: uid,
                    notes: notes
                }])
                .select()
                .single();
            if (invErr) throw invErr;

            // 4. Attach the invoice to every order in this group
            const nowIso = new Date().toISOString();
            const { error: updErr } = await _supabase
                .from('salesweb_customer_orders')
                .update({
                    credit_invoice_id: inv.id,
                    credit_billed_at: nowIso,
                    credit_billing_period: g.billingPeriod,
                    updated_at: nowIso
                })
                .in('id', g.orderIds);
            if (updErr) throw updErr;

            // 5. Fan-out: insert one attachment row per order so the customer
            //    portal renders the invoice file under each affected order.
            const attRows = g.orderIds.map(oid => ({
                order_id: oid,
                file_name: 'Invoice ' + invNo + '.' + ext,
                file_url: fileUrl,
                file_type: file.type || 'application/pdf',
                uploaded_by: uemail
            }));
            await _supabase.from('salesweb_order_attachments').insert(attRows);

            // 6. Timeline entry per order
            const tlRows = g.orderIds.map(oid => ({
                order_id: oid,
                status: 'Invoiced',
                note: 'Invoice ' + invNo + ' issued for ' + g.billingLabel,
                changed_by: uemail
            }));
            await _supabase.from('salesweb_order_timeline').insert(tlRows);

            closeInvoiceUploadModal();
            await loadTodoList();
            switchTodoTab('unpaid');
        } catch (e) {
            console.error('[Invoice upload] failed:', e);
            errEl.innerText = (e?.message || 'Upload failed') + '';
        } finally {
            btn.disabled = false; btn.innerText = 'Upload & Issue Invoice';
        }
    }

    function openMarkPaidModal(invoiceId) {
        const inv = findUnpaidInvoice(invoiceId);
        if (!inv) return;
        document.getElementById('ci-paid-id').value = invoiceId;
        document.getElementById('ci-paid-summary').innerText =
            inv.invoiceNumber + ' · ' + inv.customerName + ' · RM ' + Number(inv.totalAmount).toFixed(2);
        document.getElementById('ci-paid-file').value = '';
        document.getElementById('ci-paid-error').innerText = '';
        document.getElementById('ci-paid-modal').classList.add('open');
    }
    function closeMarkPaidModal() { document.getElementById('ci-paid-modal').classList.remove('open'); }

    async function submitMarkPaid() {
        if (typeof MJMAccess !== 'undefined' && !MJMAccess.requireOperationAction('stock', 'manage')) return;
        const id = document.getElementById('ci-paid-id').value;
        const errEl = document.getElementById('ci-paid-error');
        errEl.innerText = '';
        const btn = document.getElementById('ci-paid-submit');
        btn.disabled = true; btn.innerText = 'Saving…';
        try {
            let proofUrl = null;
            const fInput = document.getElementById('ci-paid-file');
            if (fInput.files && fInput.files[0]) {
                const f = fInput.files[0];
                const ext = (f.name.split('.').pop() || 'pdf').toLowerCase();
                const path = 'invoice-proofs/' + id.substring(0, 8) + '_' + Date.now() + '.' + ext;
                const { error: upErr } = await _supabase.storage.from('order-attachments').upload(path, f, { contentType: f.type, upsert: true });
                if (upErr) throw upErr;
                const { data: urlData } = _supabase.storage.from('order-attachments').getPublicUrl(path);
                proofUrl = urlData?.publicUrl || null;
            }
            const update = { status: 'paid', paid_at: new Date().toISOString() };
            if (proofUrl) update.payment_proof_url = proofUrl;
            const { error } = await _supabase.from('salesweb_credit_invoices').update(update).eq('id', id);
            if (error) throw error;
            closeMarkPaidModal();
            await loadTodoList();
        } catch (e) {
            console.error('[Mark Paid] failed:', e);
            errEl.innerText = (e?.message || 'Failed to mark paid') + '';
        } finally {
            btn.disabled = false; btn.innerText = 'Mark as Paid';
        }
    }

    // Expose to inline onclicks
    window.openInvoiceUploadModal = openInvoiceUploadModal;
    window.closeInvoiceUploadModal = closeInvoiceUploadModal;
    window.submitInvoiceUpload = submitInvoiceUpload;
    window.openMarkPaidModal = openMarkPaidModal;
    window.closeMarkPaidModal = closeMarkPaidModal;
    window.submitMarkPaid = submitMarkPaid;

    // ── Monthly Maturity Allocation ──────────────────────────────────────────
    let allMatGroups = [];
    let plotAllocations = {};
    let doUnmatchedLines = [];
    let activeMonthKey = null;
    let activeMonthKeys = [];
    let historyMonthKeys = [];

    function monthKey(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); }
    function monthLabel(k) {
        const [y, m] = k.split('-').map(Number);
        return new Date(y, m-1, 1).toLocaleString('en-MY', { month: 'short', year: 'numeric' });
    }

    async function loadMaturity() {
        try {
            const [transRes, plotsRes, allocRes, doRes] = await Promise.all([
                _supabase.from('shared_inventory_logs')
                    .select('batch_name,plot_name,breed_name,quantity_change,created_at,transaction_date')
                    .in('transaction_type', ['Transplanted','Transplanted_Premium','Transplanted_DoubleTone']),
                _supabase.from('shared_plots').select('plot_name,nursery_name'),
                _supabase.from('shared_plot_allocations').select('*').then(r => r, e => ({ data: [], error: e })),
                // Issued DOs are the official stock deduction: each carries up to
                // 5 "Nursery Collection Details" lines (plot_N / batch_N / qty_N).
                _supabase.from('shared_do_records')
                    .select('do_number, total_qty, status, remark, plot_1, qty_1, batch_1, plot_2, qty_2, batch_2, plot_3, qty_3, batch_3, plot_4, qty_4, batch_4, plot_5, qty_5, batch_5')
                    .then(r => r, e => ({ data: [], error: e }))
            ]);

            const trans = transRes.data || [];
            const plots = plotsRes.data || [];

            const plotNurseryMap = {};
            const prefixNurseryMap = {};
            const looksLikePlotCode = s => typeof s === 'string' && /^[A-Za-z]+\d+$/.test(s.trim());
            plots.forEach(p => {
                if (!p.plot_name || !p.nursery_name) return;
                if (looksLikePlotCode(p.nursery_name)) return;
                plotNurseryMap[p.plot_name] = p.nursery_name;
                const prefix = (p.plot_name.match(/^[A-Za-z]+/) || [])[0];
                if (prefix) prefixNurseryMap[prefix] = p.nursery_name;
            });
            const resolveLocation = plot => {
                if (!plot) return '—';
                if (plotNurseryMap[plot]) return plotNurseryMap[plot];
                const prefix = (plot.match(/^[A-Za-z]+/) || [])[0];
                return prefix && prefixNurseryMap[prefix] ? prefixNurseryMap[prefix] : '—';
            };

            const groups = {};
            trans.forEach(l => {
                // Real transplant date keyed in the Batch Record; created_at is
                // only the fallback for very old rows saved without a date.
                const effDate = l.transaction_date || l.created_at;
                const k = (l.batch_name||'') + '||' + (l.plot_name||'');
                if (!groups[k]) groups[k] = {
                    batch: l.batch_name, plot: l.plot_name, breed: l.breed_name,
                    qty: 0, firstDate: effDate
                };
                groups[k].qty += (l.quantity_change || 0);
                if (effDate < groups[k].firstDate) groups[k].firstDate = effDate;
                if (!groups[k].breed && l.breed_name) groups[k].breed = l.breed_name;
            });

            allMatGroups = Object.entries(groups).map(([k, g]) => {
                const t = new Date(g.firstDate);
                const matureDate = new Date(t); matureDate.setMonth(matureDate.getMonth() + 9);
                return {
                    key: k,
                    batch: g.batch,
                    plot: g.plot,
                    breed: g.breed || '—',
                    location: resolveLocation(g.plot),
                    qty: g.qty,
                    afterCulling: Math.round(g.qty * 0.9),
                    doDeducted: 0,
                    transplantDate: t,
                    matureDate
                };
            });

            applyDoDeductions(allMatGroups, doRes?.data || []);

            plotAllocations = {};
            (allocRes?.data || []).forEach(a => {
                const k = (a.batch_name||'') + '||' + (a.plot_name||'');
                plotAllocations[k] = {
                    plot_status: a.plot_status || 'no_status',
                    reserved_for: a.reserved_for || '',
                    reserved_qty: a.reserved_qty || 0,
                    premium: !!a.premium
                };
            });

            const now = new Date();
            const curKey = monthKey(now);
            const monthsWithData = new Set(allMatGroups.map(g => monthKey(g.matureDate)));

            activeMonthKeys = [...monthsWithData].filter(k => k >= curKey).sort();
            historyMonthKeys = [...monthsWithData].filter(k => k < curKey).sort().reverse();

            if (!activeMonthKeys.includes(curKey)) activeMonthKeys.unshift(curKey);

            activeMonthKey = monthsWithData.has(curKey) ? curKey : (activeMonthKeys[0] || curKey);

            renderMonthTabs();
            renderMaturityTable();
        } catch(e) {
            console.warn('Maturity load error:', e);
            document.getElementById('maturity-rows').innerHTML = `<tr><td colspan="13" class="text-center py-8 text-[10px] text-red-500 font-bold uppercase tracking-widest">Failed to load maturity data</td></tr>`;
        }
    }

    function renderMonthTabs() {
        const now = new Date();
        const curKey = monthKey(now);
        const tabsEl = document.getElementById('month-tabs');
        tabsEl.innerHTML = '';
        activeMonthKeys.forEach(k => {
            const isCurrent = k === curKey;
            const btn = document.createElement('button');
            btn.className = 'month-tab' + (k === activeMonthKey ? ' active' : '') + (isCurrent ? ' is-current' : '');
            btn.innerText = monthLabel(k) + (isCurrent ? ' · now' : '');
            btn.onclick = () => { activeMonthKey = k; closeHistoryMenu(); renderMonthTabs(); renderMaturityTable(); renderActiveBanner(); };
            tabsEl.appendChild(btn);
        });

        const menu = document.getElementById('history-menu');
        document.getElementById('history-count').innerText = historyMonthKeys.length;
        if (!historyMonthKeys.length) {
            menu.innerHTML = '<div class="text-[10px] text-slate-400 font-bold uppercase tracking-widest text-center py-3">No past records</div>';
        } else {
            menu.innerHTML = historyMonthKeys.map(k => `
                <button onclick="selectHistoryMonth('${k}')" class="w-full text-left text-[11px] font-bold text-slate-700 hover:bg-slate-50 rounded-lg px-3 py-2 flex justify-between items-center ${k === activeMonthKey ? 'bg-amber-50 text-amber-800' : ''}">
                    <span>${monthLabel(k)}</span>
                    <span class="text-[9px] text-slate-400 uppercase tracking-widest">history</span>
                </button>
            `).join('');
        }

        renderActiveBanner();
    }

    function renderActiveBanner() {
        const banner = document.getElementById('active-month-banner');
        if (historyMonthKeys.includes(activeMonthKey)) {
            banner.classList.remove('hidden');
            banner.innerHTML = `🕘 Viewing <span class="font-black uppercase tracking-widest">history</span> — ${monthLabel(activeMonthKey)} (already matured & past)`;
        } else {
            banner.classList.add('hidden');
        }
    }

    function selectHistoryMonth(k) {
        activeMonthKey = k;
        closeHistoryMenu();
        renderMonthTabs();
        renderMaturityTable();
    }

    function toggleHistoryMenu() {
        const menu = document.getElementById('history-menu');
        menu.classList.toggle('hidden');
        if (!menu.classList.contains('hidden')) {
            setTimeout(() => {
                document.addEventListener('click', closeHistoryOnOutside, { once: true });
            }, 0);
        }
    }
    function closeHistoryMenu() {
        document.getElementById('history-menu').classList.add('hidden');
    }
    function closeHistoryOnOutside(e) {
        const menu = document.getElementById('history-menu');
        const btn  = document.getElementById('history-btn');
        if (!menu.contains(e.target) && !btn.contains(e.target)) closeHistoryMenu();
        else document.addEventListener('click', closeHistoryOnOutside, { once: true });
    }

    // ── DO-based stock deduction ─────────────────────────────────────────────
    // Every issued DO's "Nursery Collection Details" lines (plot_N / batch_N /
    // qty_N) are the official record of stock leaving a plot. Names are read
    // forgivingly, same as Batch Detail Tab 6 and the Summary report:
    //   • batch "239." / " 239" → 239 (punctuation & spaces dropped)
    //   • plot  "U15 (UPB PREMIER HYBRID)" → U15 (label/breed suffix dropped)
    //   • qty blank on the ONLY filled line → fall back to the DO's total qty
    const _normBatchKey = v => String(v == null ? '' : v).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    const _normPlotKey  = v => String(v == null ? '' : v).trim().toUpperCase()
                                  .replace(/^PLOT\s*:?\s*/, '')
                                  .split(/[\s(,\[]/)[0].replace(/[^0-9A-Z\-]/g, '');

    // Mutates each group: g.doDeducted = qty issued via DOs for that batch+plot.
    // DO lines that match no row are collected into doUnmatchedLines so no
    // quantity silently disappears (wrong/missing batch, unknown plot, …).
    function applyDoDeductions(groups, doRecords) {
        doUnmatchedLines = [];

        // Index rows by normalized batch+plot. If two raw names normalize to
        // the same key, deduct into the earliest-maturing row (deterministic).
        const groupByNorm = {};
        groups.forEach(g => {
            const nk = _normBatchKey(g.batch) + '||' + _normPlotKey(g.plot);
            if (!groupByNorm[nk] || g.transplantDate < groupByNorm[nk].transplantDate) groupByNorm[nk] = g;
        });

        (doRecords || []).forEach(d => {
            if (d.status === 'Cancelled' || (d.remark && d.remark.includes('[CANCELLED]'))) return;
            let filled = 0;
            for (let i = 1; i <= 5; i++) if (_normPlotKey(d[`plot_${i}`])) filled++;
            for (let i = 1; i <= 5; i++) {
                const plotKey = _normPlotKey(d[`plot_${i}`]);
                if (!plotKey) continue;
                let qty = Number(d[`qty_${i}`] || 0);
                if (!qty && filled === 1) qty = Number(d.total_qty || 0); // single-line DO
                if (!qty) continue;
                const target = groupByNorm[_normBatchKey(d[`batch_${i}`]) + '||' + plotKey];
                if (target) {
                    target.doDeducted += qty;
                } else {
                    doUnmatchedLines.push({
                        do_number: d.do_number || '—',
                        plot: String(d[`plot_${i}`] || '').trim(),
                        batch: String(d[`batch_${i}`] || '').trim(),
                        qty
                    });
                }
            }
        });
    }

    function renderDoUnmatched() {
        const el = document.getElementById('maturity-unmatched');
        if (!el) return;
        if (!doUnmatchedLines.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
        const totalQty = doUnmatchedLines.reduce((s, u) => s + u.qty, 0);
        const shown = doUnmatchedLines.slice(0, 5)
            .map(u => `DO ${escapeHtml(u.do_number)} (${escapeHtml(u.plot || '?')} / ${escapeHtml(u.batch || 'no batch')}: ${u.qty.toLocaleString()})`)
            .join(', ');
        const more = doUnmatchedLines.length > 5 ? ` and ${doUnmatchedLines.length - 5} more` : '';
        el.innerHTML = `⚠ ${doUnmatchedLines.length} DO line(s) totalling ${totalQty.toLocaleString()} seedlings don't match any row above — check the plot/batch keyed on the DO: ${shown}${more}`;
        el.classList.remove('hidden');
    }

    function plotStatusPill(status) {
        const map = {
            no_status: { label: 'No Status', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
            open:      { label: 'Open',      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
            sisa:      { label: 'Sisa',      cls: 'bg-amber-50 text-amber-700 border-amber-200' },
            finished:  { label: 'Finished',  cls: 'bg-slate-200 text-slate-700 border-slate-300' }
        };
        const m = map[status] || map.no_status;
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${m.cls}">${m.label}</span>`;
    }

    function renderMaturityTable() {
        const tbody = document.getElementById('maturity-rows');
        const tfoot = document.getElementById('maturity-foot');

        const rows = allMatGroups
            .filter(g => monthKey(g.matureDate) === activeMonthKey)
            .sort((a, b) => a.matureDate - b.matureDate);

        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="13" class="text-center py-10 text-slate-400"><div class="text-2xl mb-1">🌱</div><div class="text-[10px] font-bold uppercase tracking-widest">No maturity allocations for this month</div></td></tr>`;
            tfoot.innerHTML = '';
            renderDoUnmatched();
            return;
        }

        let totQty = 0, totCull = 0, totReserved = 0, totCollected = 0;
        tbody.innerHTML = rows.map(r => {
            const alloc = plotAllocations[r.key] || { plot_status: 'no_status', reserved_for: '', reserved_qty: 0, premium: false };
            const rowAllocs = allocsForBatch(r.key);
            const allocSum  = rowAllocs.reduce((s, a) => s + (a.allocated_qty || 0), 0);
            const collected = r.doDeducted || 0;
            const plotBalance       = r.afterCulling - collected;
            const afterDeductReserve = plotBalance - allocSum;

            totQty       += r.qty;
            totCull      += r.afterCulling;
            totReserved  += allocSum;
            totCollected += collected;

            const reservHtml = rowAllocs.length
                ? `<div class="reserv-stack">${rowAllocs.map(a => `
                    <div class="reserv-chip" draggable="true" data-alloc-id="${escapeHtml(a.id)}" title="${escapeHtml(a.order_number || '')} — drag chip to move to another row">
                        <span class="reserv-chip-grip">⋮⋮</span>
                        <span class="reserv-chip-name">${escapeHtml(a.customer_name || '—')}</span>
                        <span class="reserv-chip-qty">${(a.allocated_qty || 0).toLocaleString()}</span>
                        <button class="reserv-chip-x" onclick="event.stopPropagation();removeAllocation('${escapeHtml(a.id)}')" onmousedown="event.stopPropagation()" draggable="false" title="Remove allocation">×</button>
                    </div>`).join('')}</div>`
                : `<div class="reserv-empty"><span class="reserv-empty-emoji">🎯</span><span>Drop card here</span></div>`;

            const status = alloc.plot_status || 'no_status';

            return `
                <tr data-batch-key="${escapeHtml(r.key)}" data-batch-name="${escapeHtml(r.batch || '')}" data-plot-name="${escapeHtml(r.plot || '')}" data-batch-balance="${afterDeductReserve}">
                    <td class="col-prod">${r.matureDate.toLocaleDateString('en-MY',{day:'2-digit',month:'short',year:'numeric'})}</td>
                    <td class="col-prod">${escapeHtml(r.location)}</td>
                    <td class="col-prod"><span class="font-black text-slate-900">${escapeHtml(r.plot || '—')}</span></td>
                    <td class="col-prod font-mono">${escapeHtml(r.batch || '—')}</td>
                    <td class="col-prod">${escapeHtml(r.breed || '—')}</td>
                    <td class="col-prod num">${r.qty.toLocaleString()}</td>
                    <td class="col-prod num text-emerald-700 mat-sep-r">${r.afterCulling.toLocaleString()}</td>
                    <td class="col-plot">
                        <div class="flex items-center gap-2">
                            ${plotStatusPill(status)}
                            <select data-allockey="${r.key}" data-allocfield="plot_status" onchange="updateAllocation(this)"
                                class="text-[9px] font-black uppercase tracking-wider rounded-md border border-slate-200 px-1.5 py-0.5 bg-white">
                                <option value="no_status" ${status === 'no_status' ? 'selected' : ''}>No Status</option>
                                <option value="open"      ${status === 'open'      ? 'selected' : ''}>Open</option>
                                <option value="sisa"      ${status === 'sisa'      ? 'selected' : ''}>Sisa</option>
                                <option value="finished"  ${status === 'finished'  ? 'selected' : ''}>Finished</option>
                            </select>
                        </div>
                    </td>
                    <td class="col-plot num text-blue-700">${collected.toLocaleString()}</td>
                    <td class="col-plot num font-black mat-sep-r ${plotBalance <= 0 ? 'text-red-600' : 'text-slate-800'}">${plotBalance.toLocaleString()}${plotBalance <= 0 ? '<span class="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider bg-red-600 text-white align-middle">Sold Out</span>' : ''}</td>
                    <td class="col-alloc">${reservHtml}</td>
                    <td class="col-alloc num font-black text-slate-700">${allocSum.toLocaleString()}</td>
                    <td class="col-alloc num font-black ${afterDeductReserve < 0 ? 'text-red-600' : afterDeductReserve === 0 ? 'text-slate-400' : 'text-emerald-700'}">${afterDeductReserve.toLocaleString()}</td>
                </tr>
            `;
        }).join('');

        tbody.querySelectorAll('tr[data-batch-key]').forEach(tr => {
            tr.addEventListener('dragover',  onRowDragOver);
            tr.addEventListener('dragleave', onRowDragLeave);
            tr.addEventListener('drop',      onRowDrop);
        });
        tbody.querySelectorAll('.reserv-chip[draggable="true"]').forEach(el => {
            el.addEventListener('dragstart', onChipDragStart);
            el.addEventListener('dragend',   onChipDragEnd);
        });

        const totAfterDeduct = totCull - totCollected - totReserved;
        tfoot.innerHTML = `
            <tr class="bg-slate-50 font-black">
                <td colspan="5" class="text-right text-[10px] uppercase tracking-widest text-slate-500 py-2 px-2">Totals (${rows.length} rows)</td>
                <td class="num text-slate-900">${totQty.toLocaleString()}</td>
                <td class="num text-emerald-700 mat-sep-r">${totCull.toLocaleString()}</td>
                <td></td>
                <td class="num text-blue-700">${totCollected.toLocaleString()}</td>
                <td class="num text-slate-800 mat-sep-r">${(totCull - totCollected).toLocaleString()}</td>
                <td></td>
                <td class="num text-slate-900">${totReserved.toLocaleString()}</td>
                <td class="num ${totAfterDeduct < 0 ? 'text-red-600' : 'text-emerald-700'}">${totAfterDeduct.toLocaleString()}</td>
            </tr>`;

        renderDoUnmatched();
    }

    async function updateAllocation(el) {
        if (typeof MJMAccess !== 'undefined' && !MJMAccess.requireOperationAction('stock', 'manage')) return;
        const key = el.dataset.allockey;
        const field = el.dataset.allocfield;
        let value = el.type === 'checkbox' ? el.checked : el.value;
        if (field === 'reserved_qty') value = parseInt(value) || 0;

        const [batch, plot] = key.split('||');
        if (!plotAllocations[key]) plotAllocations[key] = { plot_status: 'open', reserved_for: '', reserved_qty: 0, premium: false };
        plotAllocations[key][field] = value;

        try {
            const payload = {
                batch_name: batch,
                plot_name: plot,
                plot_status: plotAllocations[key].plot_status,
                reserved_for: plotAllocations[key].reserved_for,
                reserved_qty: plotAllocations[key].reserved_qty,
                premium: plotAllocations[key].premium,
                updated_at: new Date().toISOString()
            };
            const { error } = await _supabase.from('shared_plot_allocations').upsert(payload, { onConflict: 'batch_name,plot_name' });
            if (error) throw error;
            renderMaturityTable();
        } catch(e) {
            console.warn('[Allocation] save failed (table may not exist yet):', e?.message || e);
            renderMaturityTable();
        }
    }

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    let allCustomerOrders = [];
    // All ALs from shared_al_orders. Held at module scope so the Allocate FAB
    // can detect "orphan" ALs (ALs with balance > 0 that have no matching
    // salesweb_customer_orders row, and therefore never appear in either
    // Active or Past tabs).
    let allAls = [];
    // Scheduled collection qty per booking_date (YYYY-MM-DD), summed across
    // every active order. Populated by loadCustomerOrders() so the Order
    // Monitoring dashboard can show week-level totals without re-querying.
    let allBookingsByDate = {};
    // Delivery-order rows for the Collected-by-month chart. Each entry is
    // { delivery_date, total_qty, status } — non-cancelled only.
    let allDoRecords = [];

    async function loadCustomerOrders() {
        try {
            const monthStartStr = (() => {
                const d = new Date(); d.setDate(1);
                return d.toISOString().slice(0,10);
            })();

            const [ordRes, _itemsRes, _collRes, _bookRes, _alRes, _doRes] = await Promise.all([
                _supabase.from('salesweb_customer_orders')
                    .select('id,order_number,customer_name,billing_name,total,status,created_at,payment_terms,collected_qty,collected_at')
                    .order('created_at', { ascending: true }),
                _supabase.from('salesweb_order_items').select('order_id,quantity,unit_price,subtotal'),
                _supabase.from('salesweb_order_collections').select('order_id,collected_qty,collected_at')
                    .then(r => r, e => ({ data: null, error: e })),
                _supabase.from('shared_collection_bookings')
                    .select('order_number,booking_date,collection_qty,status')
                    .gte('booking_date', monthStartStr)
                    .not('status', 'in', '("cancelled")')
                    .then(r => r, e => ({ data: null, error: e })),
                // ── AL (Allocation Letter) is the source of truth for ordered
                //    qty and balance to collect. Customer Order Management
                //    overrides its own numbers with the AL's values so that
                //    any AL amendment flows through here automatically.
                _supabase.from('shared_al_orders')
                    .select('al_number,order_number,order_date,customer_name,quantity_ordered,balance_quantity,status,remark,created_at')
                    .then(r => r, e => ({ data: null, error: e })),
                // ── DO records drive the Collected-qty-by-month chart.
                //    A DO row IS a collection: the customer signed for the
                //    listed qty on that delivery_date. Cancelled DOs are
                //    excluded so they don't inflate the bar.
                _supabase.from('shared_do_records')
                    .select('do_number,al_number,delivery_date,total_qty,status,remark')
                    .then(r => r, e => ({ data: null, error: e }))
            ]);

            const orders = ordRes.data || [];
            const items  = _itemsRes.data || [];
            const collections = _collRes?.data;
            const bookings    = _bookRes?.data || [];
            const alRows      = _alRes?.data || [];
            allAls = alRows;
            allDoRecords = (_doRes?.data || []).filter(d => {
                const s = String(d.status || '').toLowerCase();
                return s !== 'cancelled';
            });

            // Index ALs by the customer order number they're linked to.
            // If a single order_number happens to map to multiple ALs (e.g.
            // partial replacements), prefer the row with the highest
            // balance_quantity so the totals stay consistent for the user.
            const alByOrderNumber = {};
            alRows.forEach(a => {
                if (!a.order_number) return;
                const cur = alByOrderNumber[a.order_number];
                if (!cur || (Number(a.balance_quantity)||0) > (Number(cur.balance_quantity)||0)) {
                    alByOrderNumber[a.order_number] = a;
                }
            });

            const itemsByOrder = {};
            items.forEach(it => {
                if (!itemsByOrder[it.order_id]) itemsByOrder[it.order_id] = { qty: 0, amt: 0 };
                itemsByOrder[it.order_id].qty += (it.quantity || 0);
                itemsByOrder[it.order_id].amt += (it.subtotal || 0);
            });

            const collByOrder = {};
            if (collections && collections.length) {
                collections.forEach(c => {
                    if (!c.collected_at) return;
                    const k = monthKey(new Date(c.collected_at));
                    if (!collByOrder[c.order_id]) collByOrder[c.order_id] = {};
                    collByOrder[c.order_id][k] = (collByOrder[c.order_id][k] || 0) + (c.collected_qty || 0);
                });
            }
            if (!collections || !collections.length) {
                orders.forEach(o => {
                    if (o.collected_qty && o.collected_at) {
                        const k = monthKey(new Date(o.collected_at));
                        collByOrder[o.id] = { [k]: o.collected_qty };
                    }
                });
            }

            const bookByOrderNumber = {};
            allBookingsByDate = {};
            bookings.forEach(b => {
                if (!b.order_number || !b.booking_date) return;
                const monthK = b.booking_date.slice(0, 7);
                const dayK   = b.booking_date.slice(0, 10);
                const qty    = Number(b.collection_qty || 0);
                if (!bookByOrderNumber[b.order_number]) bookByOrderNumber[b.order_number] = {};
                bookByOrderNumber[b.order_number][monthK] = (bookByOrderNumber[b.order_number][monthK] || 0) + qty;
                allBookingsByDate[dayK] = (allBookingsByDate[dayK] || 0) + qty;
            });

            allCustomerOrders = orders.map(o => {
                const it = itemsByOrder[o.id] || { qty: 0, amt: 0 };
                const colByMonth = collByOrder[o.id] || {};
                const bookByMonth = bookByOrderNumber[o.order_number] || {};
                const monthCollected = Object.values(colByMonth).reduce((s, v) => s + v, 0);

                // ── AL override (source-of-truth reconciliation) ──
                // When a matching AL row exists, prefer its quantity_ordered
                // and balance_quantity over what the salesweb tables imply.
                // This keeps Customer Order Management in lock-step with the
                // AL Manager — any AL amendment is reflected on next reload.
                const al = alByOrderNumber[o.order_number];
                let totalQty       = it.qty;
                let totalCollected = monthCollected;
                let balance        = totalQty - totalCollected;
                // An AL is treated as cancelled if its status column is
                // "Cancelled" OR the remark carries a "[CANCELLED]" prefix
                // (the pattern the AL Manager writes when a user cancels
                // an AL without changing the status column directly).
                const alCancelled  = !!al && (
                    al.status === 'Cancelled' ||
                    /\[CANCELLED\]/i.test(String(al.remark || ''))
                );
                if (al) {
                    const alQty = Number(al.quantity_ordered);
                    const alBal = Number(al.balance_quantity);
                    if (!isNaN(alQty)) totalQty = alQty;
                    if (!isNaN(alBal)) {
                        balance        = Math.max(0, alBal);
                        totalCollected = Math.max(0, totalQty - balance);
                    } else {
                        balance = Math.max(0, totalQty - totalCollected);
                    }
                }
                // Cancelling the AL kills the order for fulfillment
                // purposes — zero the balance so it stops inflating the
                // "pending to collect" totals in Customer Order Management.
                if (alCancelled) {
                    balance = 0;
                    totalCollected = 0;
                }

                let derivedStatus = o.status;
                if (alCancelled) {
                    derivedStatus = 'Cancelled';
                } else if (o.status !== 'Cancelled' && o.status !== 'Pending Payment') {
                    if      (totalCollected === 0)         derivedStatus = 'Paid · Pending Pickup';
                    else if (totalCollected >= totalQty)   derivedStatus = 'Completed';
                    else                                   derivedStatus = 'Partial · ' + Math.round((totalCollected/totalQty)*100) + '%';
                }
                return {
                    id: o.id,
                    orderNumber: o.order_number,
                    alNumber: al ? al.al_number : null,
                    customer: o.billing_name || o.customer_name,
                    orderDate: o.created_at ? new Date(o.created_at) : null,
                    totalQty,
                    totalAmount: o.total ?? it.amt,
                    rawStatus: o.status,
                    derivedStatus,
                    alCancelled,
                    paymentMethod: o.payment_terms || 'cash',
                    collectionsByMonth: colByMonth,
                    bookingsByMonth: bookByMonth,
                    totalCollected,
                    balance
                };
            });

            renderCustomerGrid();
            renderMonitoringDashboard();
            // renderPaymentStatusSummary removed — Customer Payment Status block deleted from UI.
        } catch(e) {
            console.warn('[Cust] load failed:', e);
            document.getElementById('cust-tbody').innerHTML = `<tr><td colspan="20" class="text-center py-8 text-[10px] text-red-500 font-bold uppercase tracking-widest">Failed to load customer orders</td></tr>`;
        }
    }

    // ── Order Monitoring Dashboard ───────────────────────────────────────────
    // Six stat cards + a 6-week scheduled trend strip. Driven entirely by
    // already-loaded data: allCustomerOrders (for month-level aggregates)
    // and allBookingsByDate (for week-level slicing).
    function _monStartOfWeek(d) {
        // ISO week — Monday as the first day.
        const x = new Date(d); x.setHours(0, 0, 0, 0);
        const day = x.getDay();              // 0 = Sun .. 6 = Sat
        const offset = (day === 0) ? -6 : (1 - day);
        x.setDate(x.getDate() + offset);
        return x;
    }
    function _monAddDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
    function _monDateKey(d)    { return d.toISOString().slice(0, 10); }
    function _monFmt(n)        { return (Number(n) || 0).toLocaleString(); }
    // A calibration DO is any shared_do_records row whose do_number starts
    // with the `CAL-` prefix — the convention used for bulk stock
    // corrections that are not real customer collections (e.g. BNN/UNN1
    // sales calibrations). The chart shows them in their own Calibration
    // bar so they never inflate the Collection figure, and the current-
    // month Collection card excludes them for the same reason.
    function _isCalibrationDo(d) {
        return /^CAL-/i.test(String((d && d.do_number) || ''));
    }

    function renderMonitoringDashboard() {
        const cardsEl = document.getElementById('mon-dash-cards');
        if (!cardsEl) return;

        const now = new Date();
        const monthKeyNow = now.toISOString().slice(0, 7);

        const asof = document.getElementById('mon-dash-asof');
        if (asof) asof.textContent = now.toLocaleString('en-MY', { month: 'long', year: 'numeric' });

        // Week boundaries — Mon..Sun (inclusive)
        const weekStart    = _monStartOfWeek(now);
        const weekEnd      = _monAddDays(weekStart, 6);
        const weekStartKey = _monDateKey(weekStart);
        const weekEndKey   = _monDateKey(weekEnd);

        // Per-order aggregates
        let monthSched = 0, monthCollected = 0;
        let pendingCollection = 0;
        let activeOrders = 0;
        let unpaidCash = 0;

        (allCustomerOrders || []).forEach(o => {
            const isCash   = (o.paymentMethod || 'cash') === 'cash';
            const isUnpaid = o.rawStatus === 'Pending Payment' || o.derivedStatus === 'Pending Payment';

            if (isCash && isUnpaid) { unpaidCash++; return; }
            if (o.rawStatus === 'Cancelled') return;

            if ((Number(o.balance) || 0) > 0) {
                activeOrders++;
                pendingCollection += Number(o.balance) || 0;
            }
            monthSched     += Number(o.bookingsByMonth    && o.bookingsByMonth[monthKeyNow]    || 0);
        });

        // `monthCollected` now sources from the same DO records the
        // Order & Collection chart uses — sum of total_qty on every
        // non-cancelled DO delivered in the current month. Keeps the
        // card in lock-step with the chart's current-month bar.
        //
        // Excludes calibration DOs (`CAL-…`) so a bulk stock calibration
        // never inflates the month's real collection figure. Those DOs
        // land in the chart's separate Calibration bar instead.
        monthCollected = (allDoRecords || []).reduce((s, d) => {
            if (!d.delivery_date) return s;
            if (_isCalibrationDo(d)) return s;
            return String(d.delivery_date).slice(0, 7) === monthKeyNow
                ? s + Number(d.total_qty || 0)
                : s;
        }, 0);

        // Week-level scheduled — slice the date-keyed map
        let weekSched = 0;
        Object.entries(allBookingsByDate || {}).forEach(([k, qty]) => {
            if (k >= weekStartKey && k <= weekEndKey) weekSched += Number(qty || 0);
        });

        const monthAttainment = (monthSched + monthCollected) > 0
            ? Math.round((monthCollected / (monthSched + monthCollected)) * 100)
            : (monthCollected > 0 ? 100 : 0);

        const dayMon  = (d) => d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short' });
        // "Now"-anchored month label — e.g. "June 2026". Used in both the
        // "<Month> Scheduled" and "<Month> Collection" card labels so the
        // dashboard always names the live month it's reporting on.
        const monthLbl = now.toLocaleString('en-MY', { month: 'long', year: 'numeric' });
        const cards = [
            { label: 'Weekly Scheduled',         value: weekSched,         accent: 'blue',    sub: `${dayMon(weekStart)} – ${dayMon(weekEnd)}` },
            { label: `${monthLbl} Scheduled`,    value: monthSched,        accent: 'indigo',  sub: 'Bookings pending pickup' },
            { label: `${monthLbl} Collection`,   value: monthCollected,    accent: 'emerald', sub: monthCollected ? `${monthAttainment}% of month activity` : 'No pickups recorded yet' },
            { label: 'Pending Collection',       value: pendingCollection, accent: 'amber',   sub: 'Balance across active orders' },
            { label: 'Active Orders',            value: activeOrders,      accent: 'slate',   sub: 'With outstanding balance' },
            { label: 'Unpaid Orders',            value: unpaidCash,        accent: 'rose',    sub: 'Awaiting customer payment' }
        ];
        const accents = {
            blue:    { bg: 'bg-blue-50',    text: 'text-blue-700',    label: 'text-blue-500'    },
            indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-700',  label: 'text-indigo-500'  },
            emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'text-emerald-600' },
            amber:   { bg: 'bg-amber-50',   text: 'text-amber-700',   label: 'text-amber-600'   },
            slate:   { bg: 'bg-slate-50',   text: 'text-slate-700',   label: 'text-slate-500'   },
            rose:    { bg: 'bg-rose-50',    text: 'text-rose-700',    label: 'text-rose-500'    }
        };
        cardsEl.innerHTML = cards.map(c => {
            const a = accents[c.accent];
            return `
              <div class="${a.bg} rounded-xl border border-slate-200 p-3">
                <div class="text-[9px] font-black ${a.label} uppercase tracking-widest leading-tight">${c.label}</div>
                <div class="text-2xl font-black ${a.text} leading-none mt-1">${_monFmt(c.value)}</div>
                <div class="text-[9px] font-bold text-slate-400 mt-1 leading-tight">${c.sub}</div>
              </div>`;
        }).join('');

        // Monthly Order vs Collection trend — 6 months at a time,
        // toggle 1st half (Jan–Jun) / 2nd half (Jul–Dec) of the current year.
        // Defaults to whichever half contains "now" so the chart opens on the
        // active period.
        renderMonthDashChart();
    }

    // ── Order vs Collection vs Calibration chart — full 12-month view of
    // the live year. Ordered qty buckets by the AL's order_date month;
    // Collected qty buckets by shared_do_records.delivery_date month for
    // every non-cancelled DO whose number does NOT start with `CAL-`;
    // Calibration qty buckets those `CAL-…` DOs (bulk stock corrections
    // that should not read as customer collections). The visible bar for
    // "now" is highlighted.
    //
    // Calibration is rendered per-month only when that month has any
    // calibration data — months without still show two bars (Order +
    // Collection) so a stock calibration in one month does not add a
    // zero-height column to every other month. The legend chip and the
    // header total's "· Calibrated N" segment appear only when the year
    // has calibration data at all.
    function renderMonthDashChart() {
        const bars     = document.getElementById('mon-dash-month-bars');
        const yearLbl  = document.getElementById('mon-dash-year');
        const totLabel = document.getElementById('mon-dash-year-total');
        const calLeg   = document.getElementById('mon-dash-cal-legend');
        if (!bars) return;

        const now  = new Date();
        const year = now.getFullYear();

        // "Order" qty buckets by the AL's order_date month — i.e. the
        // Approval Letter tab on Customer Order Monitoring. Falls back
        // to created_at when order_date isn't populated. (Previously this
        // pulled from allCustomerOrders, which is the salesweb-orders
        // table — not the same population as the AL list the user sees.)
        const orderByMonth       = {};
        const collectionByMonth  = {};
        const calibrationByMonth = {};
        (allAls || []).forEach(a => {
            const ds = a.order_date || a.created_at;
            if (!ds) return;
            const k = String(ds).slice(0, 7);
            orderByMonth[k] = (orderByMonth[k] || 0) + Number(a.quantity_ordered || 0);
        });
        (allDoRecords || []).forEach(d => {
            if (!d.delivery_date) return;
            const k   = String(d.delivery_date).slice(0, 7);
            const qty = Number(d.total_qty || 0);
            if (_isCalibrationDo(d)) {
                calibrationByMonth[k] = (calibrationByMonth[k] || 0) + qty;
            } else {
                collectionByMonth[k] = (collectionByMonth[k] || 0) + qty;
            }
        });

        const months = [];
        for (let m = 0; m < 12; m++) {
            const k = `${year}-${String(m + 1).padStart(2, '0')}`;
            months.push({
                key: k,
                idx: m,
                label: new Date(year, m, 1).toLocaleString('en-MY', { month: 'short' }),
                order:       Number(orderByMonth[k]       || 0),
                collection:  Number(collectionByMonth[k]  || 0),
                calibration: Number(calibrationByMonth[k] || 0)
            });
        }
        const maxQ     = Math.max(1, ...months.flatMap(m => [m.order, m.collection, m.calibration]));
        const nowMonth = now.getMonth();

        bars.innerHTML = months.map(m => {
            const hasCal    = m.calibration > 0;
            const isCurrent = m.idx === nowMonth && year === now.getFullYear();
            const labelCls  = isCurrent ? 'text-blue-700 font-black' : 'text-slate-500 font-bold';
            // 3 columns when the month has calibration, 2 otherwise, so
            // an inactive month still reads the same as before this change.
            const colCls    = hasCal ? 'w-1/3' : 'w-1/2';
            const ho = Math.max(2, Math.round((m.order       / maxQ) * 80));
            const hc = Math.max(2, Math.round((m.collection  / maxQ) * 80));
            const hk = Math.max(2, Math.round((m.calibration / maxQ) * 80));
            const orderCol = `
                  <div class="flex flex-col items-center justify-end gap-0.5 ${colCls}">
                    <div class="text-[8px] font-black text-blue-700 leading-none">${m.order ? _monFmt(m.order) : '·'}</div>
                    <div class="w-full rounded-t-md bg-blue-500 hover:bg-blue-600 cursor-pointer transition-colors" style="height:${ho}px" title="${m.label} ${year} — Order: ${_monFmt(m.order)} qty (click for details)" data-month-key="${m.key}" data-bar-type="order"></div>
                  </div>`;
            const collCol = `
                  <div class="flex flex-col items-center justify-end gap-0.5 ${colCls}">
                    <div class="text-[8px] font-black text-emerald-700 leading-none">${m.collection ? _monFmt(m.collection) : '·'}</div>
                    <div class="w-full rounded-t-md bg-emerald-500 hover:bg-emerald-600 cursor-pointer transition-colors" style="height:${hc}px" title="${m.label} ${year} — Collection: ${_monFmt(m.collection)} qty (click for details)" data-month-key="${m.key}" data-bar-type="collection"></div>
                  </div>`;
            const calCol = hasCal ? `
                  <div class="flex flex-col items-center justify-end gap-0.5 ${colCls}">
                    <div class="text-[8px] font-black text-violet-700 leading-none">${_monFmt(m.calibration)}</div>
                    <div class="w-full rounded-t-md bg-violet-500 hover:bg-violet-600 cursor-pointer transition-colors" style="height:${hk}px" title="${m.label} ${year} — Calibration: ${_monFmt(m.calibration)} qty (click for details)" data-month-key="${m.key}" data-bar-type="calibration"></div>
                  </div>` : '';
            return `
              <div class="flex flex-col items-stretch gap-1 h-full">
                <div class="flex items-end justify-center gap-0.5 flex-1">
                  ${orderCol}${collCol}${calCol}
                </div>
                <div class="text-[10px] ${labelCls} leading-tight text-center">${m.label}</div>
              </div>`;
        }).join('');

        const totOrder = months.reduce((s, m) => s + m.order,       0);
        const totColl  = months.reduce((s, m) => s + m.collection,  0);
        const totCal   = months.reduce((s, m) => s + m.calibration, 0);
        if (yearLbl)  yearLbl.textContent  = String(year);
        if (totLabel) {
            // "· Calibrated N" only when there is calibration data this year,
            // matching the per-month rule so the totals line stays clean.
            let text = `Order ${_monFmt(totOrder)} · Collected ${_monFmt(totColl)}`;
            if (totCal > 0) text += ` · Calibrated ${_monFmt(totCal)}`;
            totLabel.textContent = text;
        }
        if (calLeg) calLeg.style.display = totCal > 0 ? '' : 'none';

        // Wire bar clicks once. Delegation handles every month/type pair.
        if (!bars._wiredDrill) {
            bars.addEventListener('click', e => {
                const t = e.target.closest('[data-bar-type]');
                if (!t) return;
                openMonDashDrill(t.dataset.monthKey, t.dataset.barType);
            });
            bars._wiredDrill = true;
        }
    }

    // ── Click-through drilldown ─────────────────────────────────────
    // Show the actual rows behind a single bar:
    //   • order      → every customer order created in that month
    //   • collection → every non-cancelled DO delivered in that month
    function openMonDashDrill(monthKey, barType) {
        if (!monthKey || !barType) return;
        const modal     = document.getElementById('mon-dash-drill-modal');
        const eyebrow   = document.getElementById('mon-dash-drill-eyebrow');
        const titleEl   = document.getElementById('mon-dash-drill-title');
        const subEl     = document.getElementById('mon-dash-drill-sub');
        const body      = document.getElementById('mon-dash-drill-body');
        if (!modal || !body) return;

        const [yStr, mStr] = monthKey.split('-');
        const monthLabel = new Date(Number(yStr), Number(mStr) - 1, 1)
            .toLocaleString('en-MY', { month: 'long', year: 'numeric' });

        let rows = [];
        let columns = [];
        let total = 0;
        // Each entry in `rows` is an aligned array of <td> cells; `columns`
        // is the matching list of headers. Renderer just zips them.
        if (barType === 'order') {
            eyebrow.textContent = '📦 Order qty · click-through';
            titleEl.textContent = `${monthLabel} · Approval Letters`;
            columns = ['Order date', 'AL #', 'Customer', 'Qty'];
            (allAls || []).forEach(a => {
                const ds = a.order_date || a.created_at;
                if (!ds) return;
                if (String(ds).slice(0, 7) !== monthKey) return;
                const qty = Number(a.quantity_ordered || 0);
                total += qty;
                rows.push({
                    sort: String(ds).slice(0, 10),
                    cells: [
                        `<td class="py-2 pr-3 font-bold text-slate-600">${String(ds).slice(0, 10)}</td>`,
                        `<td class="py-2 pr-3 font-black text-blue-700">${a.al_number || '—'}</td>`,
                        `<td class="py-2 pr-3 truncate" style="max-width:280px">${a.customer_name || '—'}</td>`,
                        `<td class="py-2 pr-3 font-black text-emerald-700">${_monFmt(qty)}</td>`
                    ]
                });
            });
        } else if (barType === 'calibration') {
            // Same shape as the Collection drilldown, but filtered to the
            // `CAL-…` DOs that the chart split off into its own bar.
            eyebrow.textContent = '⚙️ Calibration qty · click-through';
            titleEl.textContent = `${monthLabel} · Calibration DOs`;
            columns = ['Delivery date', 'DO #', 'Note', 'Qty'];
            (allDoRecords || []).forEach(d => {
                if (!d.delivery_date) return;
                if (!_isCalibrationDo(d)) return;
                if (String(d.delivery_date).slice(0, 7) !== monthKey) return;
                const qty = Number(d.total_qty || 0);
                total += qty;
                rows.push({
                    sort: String(d.delivery_date).slice(0, 10),
                    cells: [
                        `<td class="py-2 pr-3 font-bold text-slate-600">${String(d.delivery_date).slice(0, 10)}</td>`,
                        `<td class="py-2 pr-3 font-black text-violet-700">${d.do_number || '—'}</td>`,
                        `<td class="py-2 pr-3 truncate" style="max-width:320px">${d.remark || ''}</td>`,
                        `<td class="py-2 pr-3 font-black text-violet-700">${_monFmt(qty)}</td>`
                    ]
                });
            });
        } else {
            eyebrow.textContent = '🚚 Collection qty · click-through';
            titleEl.textContent = `${monthLabel} · Delivery Orders`;
            columns = ['Delivery date', 'AL #', 'DO #', 'Customer', 'Qty'];
            (allDoRecords || []).forEach(d => {
                if (!d.delivery_date) return;
                // Skip calibration DOs — they show under their own bar and
                // must not double-count here.
                if (_isCalibrationDo(d)) return;
                if (String(d.delivery_date).slice(0, 7) !== monthKey) return;
                const qty = Number(d.total_qty || 0);
                total += qty;
                rows.push({
                    sort: String(d.delivery_date).slice(0, 10),
                    cells: [
                        `<td class="py-2 pr-3 font-bold text-slate-600">${String(d.delivery_date).slice(0, 10)}</td>`,
                        `<td class="py-2 pr-3 text-[10px] text-slate-500">${d.al_number || ''}</td>`,
                        `<td class="py-2 pr-3 font-black text-blue-700">${d.do_number || '—'}</td>`,
                        `<td class="py-2 pr-3 truncate" style="max-width:240px">${d.remark || ''}</td>`,
                        `<td class="py-2 pr-3 font-black text-emerald-700">${_monFmt(qty)}</td>`
                    ]
                });
            });
        }
        rows.sort((a, b) => (b.sort || '').localeCompare(a.sort || ''));

        subEl.textContent = `${rows.length} row${rows.length === 1 ? '' : 's'} · ${_monFmt(total)} qty total`;

        if (!rows.length) {
            body.innerHTML = '<div class="text-[12px] text-slate-500 font-bold text-center py-10">No rows for this month.</div>';
        } else {
            body.innerHTML = `
              <div class="overflow-x-auto">
                <table class="w-full text-[11px]">
                  <thead><tr class="text-left text-slate-500 font-black uppercase tracking-widest text-[9px] border-b border-slate-200">
                    ${columns.map(c => `<th class="py-2 pr-3">${c}</th>`).join('')}
                  </tr></thead>
                  <tbody class="text-slate-700">
                    ${rows.map(r => `<tr class="border-b border-slate-100 hover:bg-slate-50">${r.cells.join('')}</tr>`).join('')}
                  </tbody>
                </table>
              </div>`;
        }
        modal.classList.add('open');
    }

    function closeMonDashDrill() {
        const modal = document.getElementById('mon-dash-drill-modal');
        if (modal) modal.classList.remove('open');
    }
    window.openMonDashDrill  = openMonDashDrill;
    window.closeMonDashDrill = closeMonDashDrill;

    function customerActiveMonths() {
        const now = new Date();
        const startKey = monthKey(now);
        const present = new Set([startKey]);

        (allCustomerOrders || []).forEach(r => {
            Object.entries(r.bookingsByMonth || {}).forEach(([k, v]) => {
                if (v && k >= startKey) present.add(k);
            });
            Object.entries(r.collectionsByMonth || {}).forEach(([k, v]) => {
                if (v && k >= startKey) present.add(k);
            });
        });

        return Array.from(present).sort().map(k => {
            const [y, m] = k.split('-').map(Number);
            const d = new Date(y, m - 1, 1);
            return { key: k, label: d.toLocaleString('en-MY', { month: 'short', year: 'numeric' }), date: d };
        });
    }

    function pillFor(derived, paymentMethod) {
        if (!derived) return ['pill-pending', '—'];
        if (derived === 'Cancelled') return ['pill-cancelled', 'Cancelled'];

        // Credit-terms orders carry a "Credit" label regardless of pay status,
        // with the collection stage appended when partial / completed.
        if ((paymentMethod || 'cash') === 'credit') {
            if (derived === 'Completed')             return ['pill-completed', 'Credit · Completed'];
            if (derived === 'Pending Payment')       return ['pill-partial',   'Credit'];
            if (derived === 'Paid · Pending Pickup') return ['pill-paid',      'Credit'];
            if (derived.startsWith('Partial'))       return ['pill-partial',   'Credit · ' + derived.replace(/^Partial\s*·\s*/, '')];
            return ['pill-paid', 'Credit'];
        }

        if (derived === 'Pending Payment')         return ['pill-pending',   'Unpaid'];
        if (derived === 'Completed')               return ['pill-completed', 'Completed'];
        if (derived === 'Paid · Pending Pickup')   return ['pill-paid',      'Paid'];
        if (derived.startsWith('Partial'))         return ['pill-partial',   derived];
        return ['pill-paid', derived];
    }

    // Pagination state for the customer grid. Page resets to 1 whenever
    // the search input or filter dropdown changes (handled below).
    const CUST_PAGE_SIZE = 10;
    let _custPage = 1;
    let _custSearchLast = '';
    let _custFilterLast = '';

    function renderCustomerGrid() {
        const thead  = document.getElementById('cust-thead');
        const tbody  = document.getElementById('cust-tbody');
        const tfoot  = document.getElementById('cust-tfoot');
        const search = (document.getElementById('cust-search')?.value || '').toLowerCase().trim();
        const filter = document.getElementById('cust-filter')?.value || 'active';

        // Reset to page 1 if the user changed the search or filter (so
        // they don't land on an empty page 5 of a fresh result set).
        if (search !== _custSearchLast || filter !== _custFilterLast) {
            _custPage = 1;
            _custSearchLast = search;
            _custFilterLast = filter;
        }

        const months = customerActiveMonths();
        const nowKey = monthKey(new Date());
        const fmtRM  = n => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        thead.innerHTML = `
            <tr>
                <th class="h-cust" style="width:38px;">#</th>
                <th class="h-cust" style="min-width:200px;">Customer</th>
                <th>Order Month</th>
                <th>Status</th>
                <th>Ordered Qty</th>
                ${months.map(m => `<th class="h-mo${m.key===nowKey?' is-now':''}">${m.label.replace(' ','<br>')}</th>`).join('')}
                <th class="h-tot">Total<br>Collected</th>
                <th class="h-tot">Balance</th>
                <th class="h-tot">Order Total</th>
            </tr>`;

        let allRows = allCustomerOrders.filter(r => {
            // Visibility rule (per product spec):
            //   • Cash payment + Unpaid → HIDE (customer hasn't paid yet)
            //   • Cash payment + Paid (any collection state) → SHOW
            //   • Credit payment (any state) → SHOW (treated like an invoice flow)
            const isCash    = (r.paymentMethod || 'cash') === 'cash';
            const isUnpaid  = r.rawStatus === 'Pending Payment' || r.derivedStatus === 'Pending Payment';
            if (isCash && isUnpaid) return false;

            if (search && !(r.orderNumber || '').toLowerCase().includes(search) && !(r.customer || '').toLowerCase().includes(search)) return false;
            // A cancelled AL kills the order for every non-`all` view — the
            // grid's Active / Outstanding / Completed lists all treat it the
            // same as a raw `rawStatus === 'Cancelled'` row so nothing
            // dead-ends in "pending to collect".
            const isCancelled = r.rawStatus === 'Cancelled' || r.alCancelled;
            if (filter === 'all') return true;
            if (filter === 'active')      return !isCancelled;
            if (filter === 'outstanding') return !isCancelled && r.balance > 0;
            if (filter === 'completed')   return !isCancelled && r.totalCollected >= r.totalQty && r.totalQty > 0;
            return true;
        });

        // Latest → oldest by orderDate so the newest row is at the top.
        // Rows with a missing orderDate sink to the bottom.
        allRows.sort((a, b) => {
            const ta = a.orderDate instanceof Date ? a.orderDate.getTime() : 0;
            const tb = b.orderDate instanceof Date ? b.orderDate.getTime() : 0;
            return tb - ta;
        });

        const colsTotal = 5 + months.length + 3;

        if (!allRows.length) {
            tbody.innerHTML = `<tr><td colspan="${colsTotal}" class="text-center py-10 text-slate-400"><div class="text-2xl mb-1">📋</div><div class="text-[10px] font-bold uppercase tracking-widest">No customer orders match the filter</div></td></tr>`;
            tfoot.innerHTML = '';
            return;
        }

        // Slice to the current page (10 rows). The "#" column shows the
        // global row index so rows on page 3 still read 21, 22, 23 etc.
        const totalRows  = allRows.length;
        const totalPages = Math.max(1, Math.ceil(totalRows / CUST_PAGE_SIZE));
        if (_custPage > totalPages) _custPage = totalPages;
        if (_custPage < 1)          _custPage = 1;
        const startIdx = (_custPage - 1) * CUST_PAGE_SIZE;
        const endIdx   = Math.min(startIdx + CUST_PAGE_SIZE, totalRows);
        const rows     = allRows.slice(startIdx, endIdx);

        // Totals reflect the full filtered dataset (every page), not just
        // the visible 10 rows — otherwise the footer line would shrink
        // every time the user paged.
        let totQty = 0, totColl = 0, totBalance = 0, totAmt = 0;
        const colCollTotals = months.map(() => 0);
        const colBookTotals = months.map(() => 0);
        allRows.forEach(r => {
            totQty += r.totalQty; totColl += r.totalCollected;
            totBalance += r.balance; totAmt += (r.totalAmount || 0);
            months.forEach((m, i) => {
                colCollTotals[i] += (r.collectionsByMonth[m.key] || 0);
                colBookTotals[i] += (r.bookingsByMonth[m.key] || 0);
            });
        });

        tbody.innerHTML = rows.map((r, pageIdx) => {
            const idx = startIdx + pageIdx;
            const orderMonth = r.orderDate ? r.orderDate.toLocaleString('en-MY',{month:'short',year:'numeric'}) : '—';
            const [pillCls, pillTxt] = pillFor(r.derivedStatus, r.paymentMethod);
            // Row-level cancel marker: any strike-through / muted styling
            // applies to both raw-cancelled and AL-cancelled rows.
            const rowCancelled = r.rawStatus === 'Cancelled' || r.alCancelled;
            const rowStyle = rowCancelled ? 'style="background:#fef2f2"' : '';
            const cancelStrike = rowCancelled ? 'style="text-decoration:line-through;color:#a83020"' : '';
            const cellsHtml = months.map((m, i) => {
                const collected = r.collectionsByMonth[m.key] || 0;
                const booked    = r.bookingsByMonth[m.key]    || 0;

                const cls = [
                    't-mo',
                    collected ? 'has-qty' : '',
                    !collected && booked ? 'has-booked' : '',
                    m.key === nowKey ? 'is-now' : ''
                ].filter(Boolean).join(' ');

                let inner = '';
                if (collected && booked)      inner = `${collected.toLocaleString()}<span class="booked-tag">+${booked.toLocaleString()} booked</span>`;
                else if (collected)           inner = collected.toLocaleString();
                else if (booked)              inner = `${booked.toLocaleString()}<span class="booked-tag">booked</span>`;
                return `<td class="${cls}">${inner}</td>`;
            }).join('');
            return `
                <tr ${rowStyle}>
                    <td class="t-cust">${idx + 1}</td>
                    <td class="t-cust"><span class="cust-link" ${cancelStrike} data-pickup data-cust="${escapeHtml(r.customer || '')}" data-order="${escapeHtml(r.orderNumber || '')}">${escapeHtml(r.customer || '—')}</span><div class="t-sub" ${cancelStrike}>${escapeHtml(r.orderNumber || '')}${r.alNumber ? ' · <span style="color:#1d4ed8;font-weight:900;">AL ' + escapeHtml(r.alNumber) + '</span>' : ''}</div></td>
                    <td ${cancelStrike}>${orderMonth}</td>
                    <td><span class="pill-status ${pillCls}">${escapeHtml(pillTxt)}</span></td>
                    <td class="font-black" ${cancelStrike}>${r.totalQty.toLocaleString()}</td>
                    ${cellsHtml}
                    <td class="t-tot" ${cancelStrike}>${r.totalCollected.toLocaleString()}</td>
                    <td class="t-tot${r.balance < 0 ? ' text-red-600' : r.balance === 0 ? ' text-emerald-700' : ''}" ${cancelStrike}>${r.balance.toLocaleString()}</td>
                    <td class="t-tot" ${cancelStrike}>${fmtRM(r.totalAmount)}</td>
                </tr>`;
        }).join('');

        const monthFootCells = months.map((m, i) => {
            const c = colCollTotals[i], b = colBookTotals[i];
            if (c && b) return `<td class="t-tot">${c.toLocaleString()}<span class="booked-tag">+${b.toLocaleString()} booked</span></td>`;
            if (c)      return `<td class="t-tot">${c.toLocaleString()}</td>`;
            if (b)      return `<td class="t-tot">${b.toLocaleString()}<span class="booked-tag">booked</span></td>`;
            return       `<td class="t-tot">—</td>`;
        }).join('');

        // Build a compact page-number row: «  1  2  3 … 215  »
        const pages = (() => {
            const out = new Set([1, totalPages, _custPage]);
            for (let d = 1; d <= 2; d++) {
                if (_custPage - d > 1)            out.add(_custPage - d);
                if (_custPage + d < totalPages)   out.add(_custPage + d);
            }
            return Array.from(out).sort((a, b) => a - b);
        })();
        const pageBtns = pages.map((p, i) => {
            const gap = i > 0 && pages[i] - pages[i - 1] > 1
                ? `<span class="px-1 text-slate-400">…</span>` : '';
            const active = p === _custPage
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200';
            return `${gap}<button type="button" class="px-2.5 py-1 rounded text-[10px] font-black ${active}" onclick="goCustPage(${p})">${p}</button>`;
        }).join('');
        const prevDisabled = _custPage <= 1            ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-100';
        const nextDisabled = _custPage >= totalPages   ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-100';

        tfoot.innerHTML = `
            <tr class="bg-slate-50 font-black">
                <td colspan="4" class="text-right text-[10px] uppercase tracking-widest text-slate-500" style="padding:8px;">Totals (${totalRows} orders)</td>
                <td class="t-tot">${totQty.toLocaleString()}</td>
                ${monthFootCells}
                <td class="t-tot">${totColl.toLocaleString()}</td>
                <td class="t-tot">${totBalance.toLocaleString()}</td>
                <td class="t-tot">${fmtRM(totAmt)}</td>
            </tr>
            <tr>
                <td colspan="${colsTotal}" class="bg-white" style="padding:10px 12px;">
                    <div class="flex items-center justify-between gap-3 flex-wrap text-[10px] font-bold text-slate-600">
                        <div>Showing <span class="font-black text-slate-800">${startIdx + 1}</span> to <span class="font-black text-slate-800">${endIdx}</span> of <span class="font-black text-slate-800">${totalRows.toLocaleString()}</span> entries</div>
                        <div class="flex items-center gap-1">
                            <button type="button" class="px-2.5 py-1 rounded bg-white text-slate-700 border border-slate-200 text-[10px] font-black ${prevDisabled}" onclick="goCustPage(${Math.max(1, _custPage - 1)})">‹ Prev</button>
                            ${pageBtns}
                            <button type="button" class="px-2.5 py-1 rounded bg-white text-slate-700 border border-slate-200 text-[10px] font-black ${nextDisabled}" onclick="goCustPage(${Math.min(totalPages, _custPage + 1)})">Next ›</button>
                        </div>
                    </div>
                </td>
            </tr>`;
    }

    function goCustPage(p) {
        const n = Number(p);
        if (!Number.isFinite(n)) return;
        _custPage = Math.max(1, Math.floor(n));
        renderCustomerGrid();
    }
    window.goCustPage = goCustPage;

    let schedWeekStart = getSchedMonday(new Date());

    function getSchedMonday(d) {
        const dt = new Date(d);
        const dow = dt.getDay();
        const diff = dt.getDate() - dow + (dow === 0 ? -6 : 1);
        dt.setDate(diff); dt.setHours(0,0,0,0);
        return dt;
    }
    function fmtSchedDate(d) {
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    function isSchedToday(d) {
        const t = new Date();
        return d.getFullYear()===t.getFullYear() && d.getMonth()===t.getMonth() && d.getDate()===t.getDate();
    }
    function changeSchedWeek(dir) {
        schedWeekStart.setDate(schedWeekStart.getDate() + dir * 7);
        loadScheduledCollection();
    }
    function goSchedToday() {
        schedWeekStart = getSchedMonday(new Date());
        loadScheduledCollection();
    }

    async function loadScheduledCollection() {
        const start = schedWeekStart;
        const end = new Date(start); end.setDate(end.getDate() + 5);
        const startStr = fmtSchedDate(start);
        const endStr = fmtSchedDate(end);

        const lbl = document.getElementById('sched-week-label');
        const fmtShort = d => d.toLocaleDateString('en-MY', { day:'2-digit', month:'short' });
        lbl.innerText = `${fmtShort(start)} — ${fmtShort(end)} ${start.getFullYear()}`;

        const { data, error } = await _supabase
            .from('shared_collection_bookings')
            .select('booking_date,start_time,customer_name,collection_qty,nursery_name,status')
            .gte('booking_date', startStr)
            .lte('booking_date', endStr)
            .neq('status', 'cancelled')
            .order('booking_date', { ascending: true })
            .order('start_time', { ascending: true });

        if (error) {
            console.warn('Scheduled collection load error:', error);
            document.getElementById('sched-week-grid').innerHTML =
                `<div class="text-center py-4 text-[10px] text-red-500 font-bold uppercase tracking-widest col-span-full">Load failed</div>`;
            return;
        }
        renderScheduledCollection(data || []);
    }

    function renderScheduledCollection(rows) {
        const grid = document.getElementById('sched-week-grid');
        const days = ['Mon','Tue','Wed','Thu','Fri','Sat'];
        let html = '';

        for (let i = 0; i < 6; i++) {
            const d = new Date(schedWeekStart);
            d.setDate(d.getDate() + i);
            const ds = fmtSchedDate(d);
            const dayRows = rows.filter(r => (r.booking_date || '').slice(0,10) === ds);
            const isTodayCls = isSchedToday(d);

            const headerCls = isTodayCls
                ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                : 'bg-slate-100 text-slate-600 border-slate-200';
            const cardBorderCls = isTodayCls ? 'border-emerald-300' : 'border-slate-200';

            const dateLabel = d.toLocaleDateString('en-MY', { day:'2-digit', month:'short' });
            const totalQty = dayRows.reduce((s,r) => s + (r.collection_qty || 0), 0);

            html += `<div class="rounded-xl border ${cardBorderCls} bg-white overflow-hidden flex flex-col">`;
            html += `<div class="px-2.5 py-2 border-b ${cardBorderCls} ${headerCls} flex items-center justify-between gap-1">
                       <span class="text-[10px] font-black uppercase tracking-widest">${days[i]} ${dateLabel}</span>
                       ${dayRows.length ? `<span class="text-[9px] font-black bg-white/70 rounded-full px-1.5 py-0.5">${dayRows.length}</span>` : ''}
                     </div>`;
            html += `<div class="flex-1 p-2 space-y-1.5 min-h-[60px]">`;

            if (dayRows.length === 0) {
                html += `<div class="text-[9px] text-slate-300 font-bold uppercase tracking-widest text-center py-3">— No booking —</div>`;
            } else {
                dayRows.forEach(r => {
                    const time = (r.start_time || '').slice(0,5);
                    const nursery = (r.nursery_name || 'PENDING').toUpperCase();
                    const nurseryCls = nursery.startsWith('BNN')
                        ? 'bg-blue-100 text-blue-700 border-blue-200'
                        : nursery.startsWith('UNN')
                        ? 'bg-indigo-100 text-indigo-700 border-indigo-200'
                        : 'bg-amber-100 text-amber-700 border-amber-200';
                    const cust = (r.customer_name || '—');
                    const qty = (r.collection_qty || 0).toLocaleString();
                    html += `<div class="rounded-md border border-slate-100 bg-slate-50/60 p-1.5 text-[10px] leading-tight">
                                <div class="flex items-center justify-between gap-1 mb-0.5">
                                    <span class="font-black text-blue-700">${time}</span>
                                    <span class="text-[8px] font-black ${nurseryCls} border rounded px-1 py-0.5 uppercase tracking-widest">${nursery}</span>
                                </div>
                                <div class="font-bold text-slate-700 truncate" title="${cust}">${cust}</div>
                                <div class="font-black text-emerald-700">${qty} <span class="text-[8px] font-bold text-slate-400 uppercase tracking-widest">pcs</span></div>
                             </div>`;
                });
                if (totalQty > 0) {
                    html += `<div class="text-[9px] font-black text-slate-500 uppercase tracking-widest text-right pt-1 border-t border-slate-100 mt-1">Total: <span class="text-emerald-700">${totalQty.toLocaleString()}</span></div>`;
                }
            }

            html += `</div></div>`;
        }
        grid.innerHTML = html;
    }

    let _ssmStockLoaded = false;
    let _ssmMapLoaded   = false;

    function switchSsmTab(tab) {
        const customerPane = document.getElementById('ssm-pane-customer');
        const stockPane    = document.getElementById('ssm-pane-stock');
        const mapPane      = document.getElementById('ssm-pane-map');
        const customerBtn  = document.getElementById('ssm-tab-customer');
        const stockBtn     = document.getElementById('ssm-tab-stock');
        const mapBtn       = document.getElementById('ssm-tab-map');
        const fab          = document.getElementById('alloc-fab');
        const drawer       = document.getElementById('alloc-drawer');

        // Hide all panes + clear tab actives, then activate selected.
        customerPane.classList.add('hidden');
        stockPane.classList.add('hidden');
        if (mapPane) mapPane.classList.add('hidden');
        customerBtn.classList.remove('active');
        stockBtn.classList.remove('active');
        if (mapBtn) mapBtn.classList.remove('active');
        if (fab) fab.classList.add('hidden-fab');
        if (drawer) drawer.classList.remove('open');

        if (tab === 'stock') {
            stockPane.classList.remove('hidden');
            stockBtn.classList.add('active');
            if (fab) fab.classList.remove('hidden-fab');
            if (!_ssmStockLoaded) { _ssmStockLoaded = true; loadCapacityHeatmap(); }
        } else if (tab === 'map') {
            if (mapPane) mapPane.classList.remove('hidden');
            if (mapBtn) mapBtn.classList.add('active');
            if (!_ssmMapLoaded) { _ssmMapLoaded = true; loadInventoryMap(); }
        } else {
            customerPane.classList.remove('hidden');
            customerBtn.classList.add('active');
        }
    }

    async function loadAgingReport() {
        const tbody = document.getElementById('aging-rows');
        const meta  = document.getElementById('aging-meta');
        try {
            const todayStr = new Date().toISOString().slice(0,10);
            const { data, error } = await _supabase
                .from('shared_collection_bookings')
                .select('id,customer_name,order_number,al_number,booking_date,start_time,collection_qty,status,nursery_name,plot_name')
                .lt('booking_date', todayStr)
                .not('status', 'in', '("completed","cancelled")')
                .order('booking_date', { ascending: true });
            if (error) throw error;
            renderAgingReport(data || []);
        } catch (e) {
            console.warn('Aging report load error:', e);
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-[10px] text-slate-400 font-bold uppercase tracking-widest">Unable to load aging report</td></tr>`;
            meta.textContent = '';
        }
    }

    function renderAgingReport(rows) {
        const tbody = document.getElementById('aging-rows');
        const meta  = document.getElementById('aging-meta');
        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-emerald-700"><div class="text-2xl mb-1">✅</div><div class="text-[10px] font-black uppercase tracking-widest">No overdue collections — well done!</div></td></tr>`;
            meta.textContent = '0 overdue';
            return;
        }
        const today = new Date(); today.setHours(0,0,0,0);
        let totalOverdue = 0, totalQty = 0;

        tbody.innerHTML = rows.map(r => {
            const bd = r.booking_date ? new Date(r.booking_date + 'T00:00:00') : null;
            const days = bd ? Math.max(0, Math.floor((today - bd) / 86400000)) : 0;
            totalOverdue += 1; totalQty += (r.collection_qty || 0);
            const pillCls = days <= 7 ? 'warn' : days <= 14 ? 'bad' : 'severe';
            const dateLabel = bd
                ? bd.toLocaleDateString('en-MY', { day:'2-digit', month:'short', year:'numeric' }) + (r.start_time ? ' · ' + (r.start_time||'').substring(0,5) : '')
                : '—';
            const statusLabel = (r.status || 'booked').replace(/_/g,' ');
            return `
                <tr>
                    <td><span class="cust-link" data-pickup data-cust="${escapeHtml(r.customer_name || '')}" data-order="${escapeHtml(r.order_number || '')}">${escapeHtml(r.customer_name || '—')}</span></td>
                    <td class="font-mono text-[10px]">${escapeHtml(r.order_number || r.al_number || '—')}</td>
                    <td>${dateLabel}</td>
                    <td class="num"><span class="aging-pill ${pillCls}">${days}d</span></td>
                    <td class="num">${(r.collection_qty || 0).toLocaleString()}</td>
                    <td><span class="pill-status pill-pending">${escapeHtml(statusLabel)}</span></td>
                    <td><a href="operation_collection_booking.html" class="text-[10px] font-black text-blue-700 uppercase tracking-widest hover:underline" style="text-decoration:none;">Open booking →</a></td>
                </tr>`;
        }).join('');

        meta.textContent = totalOverdue + ' overdue · ' + totalQty.toLocaleString() + ' seedlings pending';
    }

    async function openPickupHistory(customerName, orderNumber) {
        const modal = document.getElementById('pickup-modal');
        const title = document.getElementById('pickup-modal-title');
        const sub   = document.getElementById('pickup-modal-sub');
        const summ  = document.getElementById('pickup-summary');
        const wrap  = document.getElementById('pickup-table-wrap');

        title.textContent = customerName || '—';
        sub.textContent   = orderNumber ? 'Order: ' + orderNumber : '';
        summ.innerHTML    = '';
        wrap.innerHTML    = `<div class="text-center py-8 text-[10px] text-slate-400 font-bold uppercase tracking-widest animate-pulse">Loading history…</div>`;
        modal.classList.add('open');

        try {
            const filters = [];
            if (customerName) filters.push('customer_name.eq.' + customerName);
            if (orderNumber)  filters.push('order_number.eq.'  + orderNumber);
            const orFilter = filters.join(',');

            const [bookingsRes, ordersRes] = await Promise.all([
                _supabase.from('shared_collection_bookings').select('*').or(orFilter).order('booking_date', { ascending: false }),
                _supabase.from('salesweb_customer_orders').select('id,order_number,customer_name,billing_name,total_amount,balance_amount,status,created_at,collected_qty,collected_at').or(orFilter).order('created_at', { ascending: false })
            ]);

            const bookings = bookingsRes.data || [];
            const orders   = ordersRes.data   || [];

            let collections = [];
            try {
                const orderIds = orders.map(o => o.id).filter(Boolean);
                if (orderIds.length) {
                    const { data } = await _supabase
                        .from('salesweb_order_collections')
                        .select('order_id,collected_qty,collected_at,al_number')
                        .in('order_id', orderIds);
                    collections = data || [];
                }
            } catch(e) { collections = []; }

            const totalOrdered    = orders.reduce((s,o)=> s + (o.total_amount || 0), 0);
            const totalCollected  = (collections.length
                ? collections.reduce((s,c)=> s + (c.collected_qty || 0), 0)
                : orders.reduce((s,o)=> s + (o.collected_qty || 0), 0));
            const totalBookings   = bookings.length;
            const fmtRM = n => 'RM ' + (Number(n)||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});

            summ.innerHTML = `
                <div class="ph-summary-card"><div class="ph-label">Total bookings</div><div class="ph-num">${totalBookings}</div></div>
                <div class="ph-summary-card"><div class="ph-label">Seedlings collected</div><div class="ph-num">${totalCollected.toLocaleString()}</div></div>
                <div class="ph-summary-card"><div class="ph-label">Order value (sum)</div><div class="ph-num">${fmtRM(totalOrdered)}</div></div>
            `;

            const events = [];
            bookings.forEach(b => events.push({
                kind: 'booking',
                date: b.booking_date,
                detail: 'Booked ' + (b.start_time||'').substring(0,5) + ' · ' + (b.collection_qty || 0) + ' pcs',
                ref:   b.al_number || b.order_number || '',
                place: [b.nursery_name, b.plot_name].filter(Boolean).join(' / ') || '—',
                status: b.status || 'booked',
            }));
            collections.forEach(c => events.push({
                kind: 'collection',
                date: (c.collected_at || '').slice(0,10),
                detail: 'Collected ' + (c.collected_qty || 0) + ' pcs',
                ref:   c.al_number || '',
                place: '—',
                status: 'collected',
            }));
            events.sort((a,b)=> (b.date || '').localeCompare(a.date || ''));

            if (!events.length) {
                wrap.innerHTML = `<div class="text-center py-8 text-[10px] text-slate-400 font-bold uppercase tracking-widest">No history found for this customer</div>`;
                return;
            }

            wrap.innerHTML = `
                <table class="ph-table">
                    <thead>
                        <tr>
                            <th>Date</th><th>Type</th><th>Detail</th><th>Ref</th><th>Nursery / Plot</th><th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${events.map(e => `
                            <tr>
                                <td>${e.date || '—'}</td>
                                <td><span class="pill-status ${e.kind==='collection'?'pill-completed':'pill-paid'}">${e.kind}</span></td>
                                <td>${escapeHtml(e.detail)}</td>
                                <td class="font-mono text-[11px]">${escapeHtml(e.ref || '')}</td>
                                <td>${escapeHtml(e.place || '—')}</td>
                                <td><span class="pill-status pill-paid">${escapeHtml((e.status||'').replace(/_/g,' '))}</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>`;
        } catch (e) {
            console.warn('Pickup history error:', e);
            wrap.innerHTML = `<div class="text-center py-8 text-[10px] text-red-500 font-bold uppercase tracking-widest">Unable to load history</div>`;
        }
    }

    function closePickupHistory() {
        document.getElementById('pickup-modal').classList.remove('open');
    }

    document.getElementById('pickup-modal').addEventListener('click', e => {
        if (e.target.id === 'pickup-modal') closePickupHistory();
    });

    document.addEventListener('click', e => {
        const el = e.target.closest('[data-pickup]');
        if (!el) return;
        openPickupHistory(el.dataset.cust || '', el.dataset.order || '');
    });

    async function loadCapacityHeatmap() {
        const area = document.getElementById('heatmap-area');
        try {
            const months = [];
            const start = new Date(); start.setDate(1); start.setHours(0,0,0,0);
            for (let i = 0; i < 6; i++) {
                const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
                const next = new Date(start.getFullYear(), start.getMonth() + i + 1, 1);
                months.push({
                    key:   d.toISOString().slice(0,7),
                    label: d.toLocaleString('en-MY', { month:'short', year:'2-digit' }),
                    start: d.toISOString(),
                    end:   next.toISOString(),
                    endDate: next.toISOString().slice(0,10),
                });
            }

            const earliestStart = months[0].start;
            const latestEnd     = months[months.length-1].end;

            const [transRes, plotsRes, bookingsRes] = await Promise.all([
                _supabase.from('shared_inventory_logs')
                    .select('batch_name,plot_name,quantity_change,created_at')
                    .in('transaction_type', ['Transplanted','Transplanted_Premium','Transplanted_DoubleTone']),
                _supabase.from('shared_plots').select('plot_name,nursery_name'),
                _supabase.from('shared_collection_bookings')
                    .select('booking_date,collection_qty,nursery_name,status')
                    .gte('booking_date', earliestStart.slice(0,10))
                    .lt('booking_date',  latestEnd.slice(0,10))
                    .neq('status', 'cancelled'),
            ]);

            const transLogs = transRes.data    || [];
            const plots     = plotsRes.data    || [];
            const bookings  = bookingsRes.data || [];

            const plotToNursery = {};
            plots.forEach(p => { if (p.plot_name) plotToNursery[p.plot_name] = p.nursery_name || 'Unassigned'; });

            const nurserySet = new Set(plots.map(p => p.nursery_name).filter(Boolean));
            bookings.forEach(b => { if (b.nursery_name) nurserySet.add(b.nursery_name); });
            const nurseries = Array.from(nurserySet).sort().slice(0, 6);
            if (!nurseries.length) {
                area.innerHTML = `<div class="text-center py-6 text-[10px] text-slate-400 font-bold uppercase tracking-widest">No nursery data yet</div>`;
                return;
            }

            const groupKey = (b, p) => (b||'') + '||' + (p||'');
            const groups = {};
            transLogs.forEach(l => {
                const k = groupKey(l.batch_name, l.plot_name);
                if (!groups[k]) groups[k] = { qty: 0, firstDate: l.created_at, plot: l.plot_name };
                groups[k].qty += (l.quantity_change || 0);
                if (l.created_at < groups[k].firstDate) groups[k].firstDate = l.created_at;
            });

            const matured = {};
            Object.values(groups).forEach(g => {
                const tDate = new Date(g.firstDate);
                const matureDate = new Date(tDate); matureDate.setMonth(matureDate.getMonth() + 9);
                const mKey = matureDate.toISOString().slice(0,7);
                const nursery  = plotToNursery[g.plot] || 'Unassigned';
                if (!nurseries.includes(nursery)) return;
                const k = mKey + '|' + nursery;
                matured[k] = (matured[k] || 0) + Math.round(g.qty * 0.9);
            });

            const pending = {};
            bookings.forEach(b => {
                if (!b.booking_date) return;
                const mKey = b.booking_date.slice(0,7);
                const nursery  = b.nursery_name || 'Unassigned';
                if (!nurseries.includes(nursery)) return;
                const k = mKey + '|' + nursery;
                pending[k] = (pending[k] || 0) + (b.collection_qty || 0);
            });

            const cols = '120px ' + months.map(()=> 'minmax(80px,1fr)').join(' ');
            let html = `<div class="heat-grid" style="grid-template-columns:${cols};">`;
            html += `<div class="heat-cell h-label">Nursery</div>`;
            months.forEach(m => { html += `<div class="heat-cell h-month-label">${m.label}</div>`; });

            nurseries.forEach(n => {
                html += `<div class="heat-cell h-label">${escapeHtml(n)}</div>`;
                months.forEach(m => {
                    const k = m.key + '|' + n;
                    const mat = matured[k] || 0;
                    const pen = pending[k] || 0;
                    if (!mat && !pen) {
                        html += `<div class="heat-cell heat-na" title="No matured stock or bookings"><span class="h-pct">—</span><span class="h-meta">no data</span></div>`;
                        return;
                    }
                    const pct = mat > 0 ? Math.round((pen / mat) * 100) : (pen > 0 ? 999 : 0);
                    let bucket = 'heat-0';
                    if (pct > 100)      bucket = 'heat-5';
                    else if (pct >= 80) bucket = 'heat-4';
                    else if (pct >= 60) bucket = 'heat-3';
                    else if (pct >= 40) bucket = 'heat-2';
                    else if (pct >= 20) bucket = 'heat-1';
                    const pctLabel = pct > 100 ? 'OVER' : pct + '%';
                    html += `<div class="heat-cell ${bucket}" title="Matured ${mat.toLocaleString()} · Pending ${pen.toLocaleString()}"><span class="h-pct">${pctLabel}</span><span class="h-meta">${pen.toLocaleString()} / ${mat.toLocaleString()}</span></div>`;
                });
            });

            html += `<div class="heat-cell h-label" style="background:#f1f5f9;font-weight:900;color:#0f172a;">📦 Total Matured</div>`;
            months.forEach(m => {
                let totMat = 0, totPen = 0;
                nurseries.forEach(n => {
                    const k = m.key + '|' + n;
                    totMat += matured[k] || 0;
                    totPen += pending[k] || 0;
                });
                if (!totMat && !totPen) {
                    html += `<div class="heat-cell heat-na" style="background:#f8fafc;border-top:2px solid #cbd5e1;"><span class="h-pct">—</span><span class="h-meta">no data</span></div>`;
                    return;
                }
                html += `<div class="heat-cell" style="background:#0f172a;color:white;border-top:2px solid #cbd5e1;justify-content:center;align-items:center;display:flex;flex-direction:column;" title="Month total matured ${totMat.toLocaleString()} · Pending ${totPen.toLocaleString()}">
                    <span class="h-pct" style="color:#bae6fd;font-size:13px;">${totMat.toLocaleString()}</span>
                    <span class="h-meta" style="color:#94a3b8;">matured · pending ${totPen.toLocaleString()}</span>
                </div>`;
            });

            html += `</div>`;
            area.innerHTML = html;
        } catch (e) {
            console.warn('Heatmap error:', e);
            area.innerHTML = `<div class="text-center py-6 text-[10px] text-red-500 font-bold uppercase tracking-widest">Unable to load capacity heatmap</div>`;
        }
    }

    let batchAllocations = [];
    let _allocTab = 'active';
    let _allocBcaTableExists = true;
    let _draggingOrder = null;

    async function loadBatchAllocations() {
        try {
            const { data, error } = await _supabase
                .from('shared_batch_customer_allocations')
                .select('*');
            if (error) throw error;
            batchAllocations = data || [];
            _allocBcaTableExists = true;
        } catch (e) {
            console.warn('[BCA] table missing or read failed — drag-drop will not persist:', e?.message || e);
            batchAllocations = [];
            _allocBcaTableExists = false;
        }
    }

    function allocsForBatch(batchKey) {
        const [b, p] = batchKey.split('||');
        return batchAllocations.filter(a => a.batch_name === b && a.plot_name === p);
    }

    function allocsForOrder(orderId) {
        if (!orderId) return [];
        return batchAllocations.filter(a => a.order_id === orderId);
    }

    function orderUnallocatedQty(o) {
        const allocated = allocsForOrder(o.id).reduce((s, a) => s + (a.allocated_qty || 0), 0);
        return Math.max(0, (o.totalQty || 0) - (o.totalCollected || 0) - allocated);
    }

    function isPastMonthOrder(o) {
        if (!o.orderDate) return false;
        const now = new Date();
        const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        return o.orderDate < firstOfThisMonth;
    }

    function isAllocatableStatus(o) {
        return o.rawStatus !== 'Cancelled' && o.rawStatus !== 'Pending Payment';
    }

    let _allocSearch = '';

    function toggleAllocDrawer() {
        const drawer = document.getElementById('alloc-drawer');
        drawer.classList.toggle('open');
        if (drawer.classList.contains('open')) renderAllocDrawer();
    }

    function switchAllocTab(tab) {
        _allocTab = tab;
        document.getElementById('alloc-tab-active').classList.toggle('active', tab === 'active');
        document.getElementById('alloc-tab-past').classList.toggle('active', tab === 'past');
        renderAllocDrawer();
    }

    function setAllocSearch(value) {
        _allocSearch = (value || '').toLowerCase().trim();
        const clear = document.getElementById('alloc-search-clear');
        if (clear) clear.classList.toggle('hidden', !_allocSearch);
        renderAllocDrawer();
    }

    function clearAllocSearch() {
        const input = document.getElementById('alloc-search');
        if (input) input.value = '';
        setAllocSearch('');
    }

    function matchesAllocSearch(o) {
        if (!_allocSearch) return true;
        const c = (o.customer || '').toLowerCase();
        const n = (o.orderNumber || '').toString().toLowerCase();
        return c.includes(_allocSearch) || n.includes(_allocSearch);
    }

    function renderAllocDrawer() {
        const body = document.getElementById('alloc-drawer-body');
        if (!allCustomerOrders.length) {
            body.innerHTML = `<div class="alloc-drawer-empty">No customer orders yet</div>`;
            updateAllocCounts(0, 0);
            return;
        }

        const eligible = allCustomerOrders.filter(isAllocatableStatus);
        const active = eligible.filter(o => !isPastMonthOrder(o) && orderUnallocatedQty(o) > 0);
        const past   = eligible.filter(o =>  isPastMonthOrder(o) && o.balance > 0);

        updateAllocCounts(active.length, past.length);

        const baseList = _allocTab === 'active' ? active : past;
        const showList = baseList.filter(matchesAllocSearch);

        if (!showList.length) {
            let msg;
            if (_allocSearch && baseList.length) {
                msg = `🔎 No orders match "${_allocSearch}"`;
            } else {
                msg = _allocTab === 'active'
                    ? '✅ All current orders are fully allocated'
                    : '✅ No past-month uncollected orders';
            }
            body.innerHTML = `<div class="alloc-drawer-empty">${msg}</div>`;
            return;
        }

        body.innerHTML = showList.map(o => orderCardHtml(o, _allocTab)).join('');

        if (_allocTab === 'active') {
            body.querySelectorAll('.order-card[draggable="true"]').forEach(el => {
                el.addEventListener('dragstart', onCardDragStart);
                el.addEventListener('dragend',   onCardDragEnd);
            });
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const input = document.getElementById('alloc-search');
        const clear = document.getElementById('alloc-search-clear');
        if (input) input.addEventListener('input', (e) => setAllocSearch(e.target.value));
        if (clear) clear.addEventListener('click', clearAllocSearch);
        setupAllocDrawerDrag();
    });

    function setupAllocDrawerDrag() {
        const drawer = document.getElementById('alloc-drawer');
        if (!drawer) return;
        const handle = drawer.querySelector('.alloc-drawer-head');
        if (!handle) return;

        try {
            const saved = JSON.parse(localStorage.getItem('mjm_alloc_drawer_pos') || 'null');
            if (saved) {
                if (Number.isFinite(saved.width) && Number.isFinite(saved.height)) {
                    drawer.style.width  = saved.width  + 'px';
                    drawer.style.height = saved.height + 'px';
                }
                if (Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
                    applyDrawerPos(saved.left, saved.top);
                }
            }
        } catch (e) { }

        const resizeHandle = drawer.querySelector('#alloc-resize-handle');
        if (resizeHandle) {
            let resizing = false, rsX = 0, rsY = 0, rsW = 0, rsH = 0, rsPid = null;
            resizeHandle.addEventListener('pointerdown', (e) => {
                resizing = true; rsPid = e.pointerId;
                try { resizeHandle.setPointerCapture(rsPid); } catch (err) { }
                const rect = drawer.getBoundingClientRect();
                rsX = e.clientX; rsY = e.clientY; rsW = rect.width; rsH = rect.height;
                e.preventDefault(); e.stopPropagation();
            });
            resizeHandle.addEventListener('pointermove', (e) => {
                if (!resizing) return;
                const minW = 300, minH = 280;
                const maxW = window.innerWidth  - drawer.getBoundingClientRect().left - 8;
                const maxH = window.innerHeight - drawer.getBoundingClientRect().top  - 8;
                const newW = Math.max(minW, Math.min(maxW, rsW + (e.clientX - rsX)));
                const newH = Math.max(minH, Math.min(maxH, rsH + (e.clientY - rsY)));
                drawer.style.width  = newW + 'px';
                drawer.style.height = newH + 'px';
            });
            const endResize = () => {
                if (!resizing) return;
                resizing = false;
                try { resizeHandle.releasePointerCapture(rsPid); } catch (err) { }
                const rect = drawer.getBoundingClientRect();
                try {
                    const prev = JSON.parse(localStorage.getItem('mjm_alloc_drawer_pos') || '{}');
                    localStorage.setItem('mjm_alloc_drawer_pos',
                        JSON.stringify({ ...prev, left: rect.left, top: rect.top, width: rect.width, height: rect.height }));
                } catch (e) { }
            };
            resizeHandle.addEventListener('pointerup',     endResize);
            resizeHandle.addEventListener('pointercancel', endResize);
        }

        function applyDrawerPos(left, top) {
            const rect = drawer.getBoundingClientRect();
            const w = rect.width  || 380;
            const h = rect.height || 400;
            const maxLeft = Math.max(0, window.innerWidth  - w - 4);
            const maxTop  = Math.max(0, window.innerHeight - h - 4);
            const clampedLeft = Math.min(Math.max(0, left), maxLeft);
            const clampedTop  = Math.min(Math.max(0, top),  maxTop);
            drawer.style.left  = clampedLeft + 'px';
            drawer.style.top   = clampedTop  + 'px';
            drawer.style.right = 'auto';
        }

        let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0, pid = null;

        handle.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button, input, select, textarea, a')) return;
            dragging = true;
            pid = e.pointerId;
            try { handle.setPointerCapture(pid); } catch (err) { }
            const rect = drawer.getBoundingClientRect();
            startX = e.clientX; startY = e.clientY;
            origLeft = rect.left; origTop = rect.top;
            drawer.style.left  = origLeft + 'px';
            drawer.style.top   = origTop  + 'px';
            drawer.style.right = 'auto';
            e.preventDefault();
        });

        handle.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            applyDrawerPos(origLeft + (e.clientX - startX), origTop + (e.clientY - startY));
        });

        function endDrag() {
            if (!dragging) return;
            dragging = false;
            try { handle.releasePointerCapture(pid); } catch (err) { }
            const rect = drawer.getBoundingClientRect();
            try {
                const prev = JSON.parse(localStorage.getItem('mjm_alloc_drawer_pos') || '{}');
                localStorage.setItem('mjm_alloc_drawer_pos',
                    JSON.stringify({ ...prev, left: rect.left, top: rect.top, width: rect.width, height: rect.height }));
            } catch (e) { }
        }
        handle.addEventListener('pointerup',     endDrag);
        handle.addEventListener('pointercancel', endDrag);

        window.addEventListener('resize', () => {
            if (!drawer.classList.contains('open')) return;
            const rect = drawer.getBoundingClientRect();
            applyDrawerPos(rect.left, rect.top);
        });
    }

    function updateAllocCounts(active, past) {
        document.getElementById('alloc-count-active').textContent = active;
        document.getElementById('alloc-count-past').textContent   = past;
        const fab   = document.getElementById('alloc-fab');
        const badge = document.getElementById('alloc-fab-badge');

        // Orphan ALs: ALs with balance > 0 whose order_number doesn't match
        // any customer order. They never appear in Active or Past tabs because
        // the drawer only lists rows that exist in salesweb_customer_orders.
        const customerOrderNumbers = new Set(
            (allCustomerOrders || [])
                .filter(o => o.rawStatus !== 'Cancelled')
                .map(o => (o.orderNumber || '').toString())
        );
        const orphan = (allAls || []).filter(a => {
            if (!a) return false;
            if (a.status === 'Cancelled') return false;
            if ((Number(a.balance_quantity) || 0) <= 0) return false;
            const num = (a.order_number || '').toString();
            return !customerOrderNumbers.has(num);
        }).length;

        // Show the combined outstanding-work count so the FAB lines up with
        // the AL list's "balance > 0" total. Tooltip exposes the split.
        const total = active + past + orphan;
        badge.textContent = total;
        if (fab) {
            const parts = [`${active} current`, `${past} past due`];
            if (orphan) parts.push(`${orphan} AL${orphan === 1 ? '' : 's'} without a linked customer order`);
            fab.title = `${total} order${total === 1 ? '' : 's'} need allocation work · ${parts.join(' · ')}`;
        }
    }

    function orderCardHtml(o, tab) {
        const remaining   = orderUnallocatedQty(o);
        const allocated   = allocsForOrder(o.id).reduce((s, a) => s + (a.allocated_qty || 0), 0);
        const total       = o.totalQty || 0;
        const collected   = o.totalCollected || 0;
        const pctAlloc    = total ? Math.min(100, ((allocated + collected) / total) * 100) : 0;
        const fullyAlloc  = remaining === 0 && tab === 'active';
        const dateLabel   = o.orderDate ? o.orderDate.toLocaleDateString('en-MY', { day:'2-digit', month:'short' }) : '—';
        const dragAttrs   = (tab === 'active' && remaining > 0)
            ? `draggable="true" data-order-id="${escapeHtml(o.id || '')}"`
            : '';
        const cls = (tab === 'past') ? 'order-card past-due' : (fullyAlloc ? 'order-card fully-allocated' : 'order-card');
        const grip = (tab === 'active' && remaining > 0) ? '<span class="order-card-grip">⋮⋮</span>' : '';

        let qtyDisplay, qtySubLabel;
        if (tab === 'past') {
            qtyDisplay = (o.balance || 0).toLocaleString();
            qtySubLabel = 'pcs uncollected · ordered ' + dateLabel;
        } else if (fullyAlloc) {
            qtyDisplay = '✓';
            qtySubLabel = 'fully allocated · ' + total.toLocaleString() + ' pcs';
        } else {
            qtyDisplay = remaining.toLocaleString();
            qtySubLabel = 'pcs to allocate · of ' + total.toLocaleString();
        }

        const remarkHtml = (tab === 'past')
            ? `<div class="order-card-remark">⏳ Customer not yet collected — follow up reminder only</div>`
            : '';

        return `
            <div class="${cls}" ${dragAttrs}>
                ${grip}
                <div class="order-card-name">${escapeHtml(o.customer || '—')}</div>
                <div class="order-card-meta">${escapeHtml(o.orderNumber || '')} · ${dateLabel}</div>
                <div class="order-card-qty-row">
                    <span class="order-card-qty-big">${qtyDisplay}</span>
                    <span class="order-card-qty-sub">${qtySubLabel}</span>
                </div>
                <div class="order-card-progress"><div class="order-card-progress-bar${pctAlloc >= 100 ? ' full' : ''}" style="width:${pctAlloc}%;"></div></div>
                ${remarkHtml}
            </div>`;
    }

    let _draggingAlloc = null;

    function onCardDragStart(e) {
        const orderId = e.currentTarget.dataset.orderId;
        const order = allCustomerOrders.find(o => o.id === orderId);
        if (!order) return;
        _draggingOrder = {
            orderId,
            customer:    order.customer || '',
            orderNumber: order.orderNumber || '',
            remaining:   orderUnallocatedQty(order),
        };
        e.currentTarget.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'copy';
        try { e.dataTransfer.setData('text/plain', orderId); } catch(_) {}

        document.querySelectorAll('#maturity-rows tr[data-batch-key]').forEach(tr => {
            const balance = parseInt(tr.dataset.batchBalance || '0', 10);
            if (balance > 0) tr.classList.add('drop-target');
            else             tr.classList.add('drop-disabled');
        });
    }

    function onCardDragEnd(e) {
        e.currentTarget.classList.remove('dragging');
        _draggingOrder = null;
        document.querySelectorAll('#maturity-rows tr').forEach(tr => {
            tr.classList.remove('drop-target', 'drop-hover', 'drop-disabled');
        });
    }

    function onChipDragStart(e) {
        if (e.target && e.target.closest && e.target.closest('.reserv-chip-x')) {
            e.preventDefault();
            return;
        }
        const allocId = e.currentTarget.dataset.allocId;
        const alloc = batchAllocations.find(a => a.id === allocId);
        if (!alloc) return;
        _draggingAlloc = {
            id: allocId,
            qty: alloc.allocated_qty || 0,
            sourceBatch: alloc.batch_name || '',
            sourcePlot:  alloc.plot_name  || '',
            customer:    alloc.customer_name || '',
        };
        e.currentTarget.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', 'alloc:' + allocId); } catch(_) {}

        document.querySelectorAll('#maturity-rows tr[data-batch-key]').forEach(tr => {
            const isSource = tr.dataset.batchName === _draggingAlloc.sourceBatch
                          && tr.dataset.plotName  === _draggingAlloc.sourcePlot;
            if (isSource) return;
            const balance = parseInt(tr.dataset.batchBalance || '0', 10);
            if (balance > 0) tr.classList.add('drop-target');
            else             tr.classList.add('drop-disabled');
        });
    }

    function onChipDragEnd(e) {
        e.currentTarget.classList.remove('dragging');
        _draggingAlloc = null;
        document.querySelectorAll('#maturity-rows tr').forEach(tr => {
            tr.classList.remove('drop-target', 'drop-hover', 'drop-disabled');
        });
    }

    function onRowDragOver(e) {
        if (!_draggingOrder && !_draggingAlloc) return;
        const tr = e.currentTarget;
        if (_draggingAlloc) {
            const isSource = tr.dataset.batchName === _draggingAlloc.sourceBatch
                          && tr.dataset.plotName  === _draggingAlloc.sourcePlot;
            if (isSource) return;
        }
        const balance = parseInt(tr.dataset.batchBalance || '0', 10);
        if (balance <= 0) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = _draggingAlloc ? 'move' : 'copy';
        tr.classList.add('drop-hover');
    }
    function onRowDragLeave(e) { e.currentTarget.classList.remove('drop-hover'); }

    async function onRowDrop(e) {
        if (!_draggingOrder && !_draggingAlloc) return;
        e.preventDefault();
        const tr = e.currentTarget;
        tr.classList.remove('drop-hover');
        const balance   = parseInt(tr.dataset.batchBalance || '0', 10);
        const batchName = tr.dataset.batchName || '';
        const plotName  = tr.dataset.plotName  || '';
        if (balance <= 0) return;

        if (_draggingAlloc) {
            const isSource = batchName === _draggingAlloc.sourceBatch && plotName === _draggingAlloc.sourcePlot;
            if (isSource) return;
            const newQty = Math.min(balance, _draggingAlloc.qty);
            if (newQty <= 0) return;
            await moveAllocationToBatch(_draggingAlloc.id, batchName, plotName, newQty);
            return;
        }

        const { orderId, customer, orderNumber, remaining } = _draggingOrder;
        const allocQty = Math.min(balance, remaining);
        if (allocQty <= 0) return;

        await allocateOrderToBatch({
            orderId, customer, orderNumber,
            batchName, plotName, qty: allocQty,
        });
    }

    async function moveAllocationToBatch(allocId, batchName, plotName, qty) {
        if (typeof MJMAccess !== 'undefined' && !MJMAccess.requireOperationAction('stock', 'manage')) return;
        const idx = batchAllocations.findIndex(a => a.id === allocId);
        if (idx === -1) return;
        const orig = batchAllocations[idx];
        const updated = { ...orig, batch_name: batchName, plot_name: plotName, allocated_qty: qty, updated_at: new Date().toISOString() };
        batchAllocations[idx] = updated;

        if (_allocBcaTableExists && !String(allocId).startsWith('local-')) {
            try {
                const { error } = await _supabase
                    .from('shared_batch_customer_allocations')
                    .update({ batch_name: batchName, plot_name: plotName, allocated_qty: qty, updated_at: updated.updated_at })
                    .eq('id', allocId);
                if (error) throw error;
            } catch (err) {
                console.warn('[BCA] move failed — restoring local state:', err?.message || err);
                batchAllocations[idx] = orig;
            }
        }
        renderMaturityTable();
        renderAllocDrawer();
    }

    async function allocateOrderToBatch({ orderId, customer, orderNumber, batchName, plotName, qty }) {
        if (typeof MJMAccess !== 'undefined' && !MJMAccess.requireOperationAction('stock', 'manage')) return;
        const payload = {
            batch_name:    batchName,
            plot_name:     plotName,
            order_id:      orderId || null,
            order_number:  orderNumber || null,
            customer_name: customer || '—',
            allocated_qty: qty,
            updated_at:    new Date().toISOString(),
        };

        let saved = null;
        if (_allocBcaTableExists) {
            try {
                const { data, error } = await _supabase
                    .from('shared_batch_customer_allocations')
                    .insert(payload)
                    .select()
                    .single();
                if (error) throw error;
                saved = data;
            } catch (e) {
                console.warn('[BCA] insert failed (table may not exist):', e?.message || e);
                _allocBcaTableExists = false;
            }
        }
        if (!saved) saved = { id: 'local-' + Date.now() + '-' + Math.random().toString(16).slice(2), ...payload };
        batchAllocations.push(saved);

        renderMaturityTable();
        renderAllocDrawer();
    }

    async function removeAllocation(allocId) {
        if (typeof MJMAccess !== 'undefined' && !MJMAccess.requireOperationAction('stock', 'manage')) return;
        const idx = batchAllocations.findIndex(a => a.id === allocId);
        if (idx === -1) return;
        const removed = batchAllocations[idx];
        batchAllocations.splice(idx, 1);

        if (_allocBcaTableExists && !String(allocId).startsWith('local-')) {
            try {
                const { error } = await _supabase
                    .from('shared_batch_customer_allocations')
                    .delete()
                    .eq('id', allocId);
                if (error) throw error;
            } catch (e) {
                console.warn('[BCA] delete failed — restoring local state:', e?.message || e);
                batchAllocations.splice(idx, 0, removed);
            }
        }
        renderMaturityTable();
        renderAllocDrawer();
    }

    window.removeAllocation = removeAllocation;

    // ── INVENTORY MAP TAB ────────────────────────────────────────────────────
    // Map shows collection % per plot (color-coded). Sidebar holds the full
    // breakdown: By Batch (default) or By Breed (click a breed to filter map).
    //   Full qty       = Σ Transplanted-type quantity_change per (batch, plot)
    //   Collected qty  = Σ collection_qty from shared_collection_bookings where
    //                    status='completed', matched by plot_name + batch_name
    //                    (or just plot_name when the booking has no batch_name)
    //   Balance        = max(0, Full − Collected)
    //   Collection %   = Collected / Full
    const _invmap = {
        nurseries: [],
        plots: [],
        plotBatches: {},      // plot -> [{batch, breed, full, collected, balance}]
        breedToPlots: {},     // breed -> Set of plot_names
        breedTotals: {},      // breed -> {full, collected, balance, batches: Set, plots: Set}
        active: 'all',        // 'all' or nursery name
        selectedBreed: null,
        batchSearch: ''        // lowercase substring to match batch numbers
    };

    async function loadInventoryMap() {
        const tabBar = document.getElementById('invmap-nursery-tabs');
        try {
            const [nursRes, plotsRes, transRes, bookRes] = await Promise.all([
                _supabase.from('operation_nurseries').select('*').order('name'),
                _supabase.from('shared_plots').select('*'),
                _supabase.from('shared_inventory_logs')
                    .select('batch_name,plot_name,breed_name,quantity_change')
                    .in('transaction_type', ['Transplanted','Transplanted_Premium','Transplanted_DoubleTone']),
                _supabase.from('shared_collection_bookings')
                    .select('plot_name,nursery_name,batch_name,collection_qty,status')
                    .eq('status', 'completed')
            ]);

            _invmap.nurseries = nursRes.data || [];
            _invmap.plots     = plotsRes.data || [];

            // Aggregate full qty + breed per (plot, batch).
            const fullByPlotBatch = {};
            const breedByPlotBatch = {};
            (transRes.data || []).forEach(l => {
                if (!l.plot_name || !l.batch_name) return;
                const key = l.plot_name + '|' + l.batch_name;
                fullByPlotBatch[key] = (fullByPlotBatch[key] || 0) + (l.quantity_change || 0);
                if (l.breed_name && !breedByPlotBatch[key]) breedByPlotBatch[key] = l.breed_name;
            });

            const collectedByPlotBatch = {};
            const collectedByPlot      = {};
            (bookRes.data || []).forEach(b => {
                if (!b.plot_name) return;
                const qty = Number(b.collection_qty) || 0;
                if (b.batch_name) {
                    collectedByPlotBatch[b.plot_name + '|' + b.batch_name] = (collectedByPlotBatch[b.plot_name + '|' + b.batch_name] || 0) + qty;
                } else {
                    collectedByPlot[b.plot_name] = (collectedByPlot[b.plot_name] || 0) + qty;
                }
            });

            const plotBatches = {};
            Object.keys(fullByPlotBatch).forEach(key => {
                const [plot, batch] = key.split('|');
                if (!plotBatches[plot]) plotBatches[plot] = [];
                plotBatches[plot].push({
                    batch,
                    breed: breedByPlotBatch[key] || '—',
                    full: fullByPlotBatch[key] || 0,
                    collected: collectedByPlotBatch[key] || 0,
                    balance: 0
                });
            });
            // Distribute plot-level (no-batch) collected proportionally.
            Object.entries(plotBatches).forEach(([plot, list]) => {
                const remaining = collectedByPlot[plot] || 0;
                if (remaining > 0 && list.length) {
                    const totalAvail = list.reduce((s, b) => s + Math.max(0, b.full - b.collected), 0);
                    if (totalAvail > 0) {
                        list.forEach(b => {
                            const avail = Math.max(0, b.full - b.collected);
                            b.collected += Math.round(remaining * (avail / totalAvail));
                        });
                    }
                }
                list.forEach(b => { b.balance = Math.max(0, b.full - b.collected); });
                list.sort((a, b) => b.balance - a.balance);
            });
            _invmap.plotBatches = plotBatches;

            // Build breed indexes for the By Breed sidebar.
            const breedToPlots = {};
            const breedTotals  = {};
            Object.entries(plotBatches).forEach(([plot, list]) => {
                list.forEach(b => {
                    if (!breedToPlots[b.breed]) breedToPlots[b.breed] = new Set();
                    breedToPlots[b.breed].add(plot);
                    if (!breedTotals[b.breed]) breedTotals[b.breed] = { full:0, collected:0, balance:0, batches:new Set(), plots:new Set() };
                    breedTotals[b.breed].full      += b.full;
                    breedTotals[b.breed].collected += b.collected;
                    breedTotals[b.breed].balance   += b.balance;
                    breedTotals[b.breed].batches.add(b.batch);
                    breedTotals[b.breed].plots.add(plot);
                });
            });
            _invmap.breedToPlots = breedToPlots;
            _invmap.breedTotals  = breedTotals;

            // Render nursery sub-tabs (All Maps + per-nursery).
            tabBar.innerHTML = '';
            if (!_invmap.nurseries.length) {
                tabBar.innerHTML = '<span class="text-[10px] font-bold text-slate-400 p-3">No nurseries configured</span>';
                return;
            }
            const mkTab = (key, label) => {
                const btn = document.createElement('button');
                btn.className = 'invmap-tab-btn';
                btn.id = 'invmap-tab-' + key.replace(/\s+/g, '-');
                btn.innerText = label;
                btn.onclick = () => switchInvmapNursery(key);
                tabBar.appendChild(btn);
            };
            mkTab('all', '🗂️ All Maps (Stacked)');
            _invmap.nurseries.forEach(n => mkTab(n.name, '🏠 ' + n.name));

            switchInvmapNursery('all');
        } catch (e) {
            console.error('[InventoryMap] load failed:', e);
            tabBar.innerHTML = '<span class="text-[10px] font-bold text-rose-500 p-3">Failed to load: ' + (e.message || e) + '</span>';
        }
    }

    function switchInvmapNursery(key) {
        _invmap.active = key;
        document.querySelectorAll('.invmap-tab-btn').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById('invmap-tab-' + key.replace(/\s+/g, '-'));
        if (btn) btn.classList.add('active');
        renderInvmapStack();
        renderInvmapSidebar();
    }

    function activeNurseryList() {
        return _invmap.active === 'all'
            ? _invmap.nurseries
            : _invmap.nurseries.filter(n => n.name === _invmap.active);
    }

    function renderInvmapStack() {
        const stack = document.getElementById('invmap-stack');
        if (!stack) return;
        const list = activeNurseryList();
        if (!list.length) {
            stack.innerHTML = '<div class="text-center py-12 text-slate-400 text-[10px] font-bold uppercase tracking-widest">No nursery selected.</div>';
            return;
        }
        const isStacked = _invmap.active === 'all';
        stack.innerHTML = list.map(n => {
            const slug = n.name.replace(/\s+/g, '-');
            const has = !!n.map_image_url;
            const heightCss = isStacked ? 'height:42vh; min-height:340px;' : 'height:65vh; min-height:520px;';
            const innerImgMax = isStacked ? 'calc(42vh - 24px)' : 'calc(65vh - 24px)';
            return `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div class="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50">
                    <div class="text-[11px] font-black text-slate-700 uppercase tracking-widest">🏠 ${n.name}</div>
                    <div class="text-[9px] font-bold text-slate-400" id="invmap-stat-${slug}">—</div>
                </div>
                <div class="relative w-full bg-slate-100" style="${heightCss}">
                    ${has ? `
                        <div class="invmap-viewport" id="invmap-viewport-${slug}">
                            <div class="invmap-stage" id="invmap-stage-${slug}">
                                <div class="relative inline-block" id="invmap-canvas-${slug}">
                                    <img src="${n.map_image_url}" alt="Map for ${n.name}" style="max-height:${innerImgMax}; width:auto; object-fit:contain; display:block; user-select:none; -webkit-user-drag:none;">
                                    <svg id="invmap-svg-${slug}" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute; inset:0; width:100%; height:100%;"></svg>
                                    <div id="invmap-labels-${slug}" style="position:absolute; inset:0; width:100%; height:100%; pointer-events:none;"></div>
                                </div>
                            </div>
                            <div class="invmap-zoom-controls">
                                <button class="invmap-zoom-btn" title="Zoom in" onclick="invmapZoom('${slug}', 0.25)">＋</button>
                                <div class="invmap-zoom-level" id="invmap-zoom-lvl-${slug}">100%</div>
                                <button class="invmap-zoom-btn" title="Zoom out" onclick="invmapZoom('${slug}', -0.25)">－</button>
                                <button class="invmap-zoom-btn" title="Reset zoom" onclick="invmapResetZoom('${slug}')">↺</button>
                            </div>
                        </div>
                    ` : `
                        <div class="flex flex-col items-center justify-center text-slate-400 gap-2 py-8 h-full">
                            <span class="font-bold uppercase tracking-widest text-[10px]">No map uploaded for this nursery</span>
                        </div>
                    `}
                </div>
            </div>`;
        }).join('');

        // Draw plots + wire up zoom/pan handlers for each rendered map.
        list.forEach(n => {
            if (!n.map_image_url) return;
            renderInvmapPlotsForNursery(n.name);
            const slug = n.name.replace(/\s+/g, '-');
            wireInvmapZoom(slug);
            applyInvmapTransform(slug);
        });
        updateInvmapTotals();
    }

    // Per-nursery zoom state (slug -> {zoom, panX, panY}).
    _invmap.zoomState = _invmap.zoomState || {};
    function getZoomState(slug) {
        if (!_invmap.zoomState[slug]) _invmap.zoomState[slug] = { zoom: 1, panX: 0, panY: 0 };
        return _invmap.zoomState[slug];
    }
    function applyInvmapTransform(slug) {
        const z = getZoomState(slug);
        const stage = document.getElementById('invmap-stage-' + slug);
        if (!stage) return;
        stage.style.transform = `translate(${z.panX}px, ${z.panY}px) scale(${z.zoom})`;
        // Inverse-scale all labels so their pixel size stays constant while
        // the polygon centroids spread apart at higher zoom.
        const labels = document.getElementById('invmap-labels-' + slug);
        if (labels) labels.style.setProperty('--inv-zoom', z.zoom);
        const lvl = document.getElementById('invmap-zoom-lvl-' + slug);
        if (lvl) lvl.innerText = Math.round(z.zoom * 100) + '%';
    }
    function invmapZoom(slug, delta) {
        const z = getZoomState(slug);
        z.zoom = Math.max(0.5, Math.min(5, z.zoom + delta));
        // Snap pan back to 0 when fully zoomed out.
        if (z.zoom <= 1.01) { z.panX = 0; z.panY = 0; }
        applyInvmapTransform(slug);
    }
    function invmapResetZoom(slug) {
        _invmap.zoomState[slug] = { zoom: 1, panX: 0, panY: 0 };
        applyInvmapTransform(slug);
    }
    function wireInvmapZoom(slug) {
        const viewport = document.getElementById('invmap-viewport-' + slug);
        const stage    = document.getElementById('invmap-stage-' + slug);
        if (!viewport || !stage || viewport._wired) return;
        viewport._wired = true;

        // Mouse wheel zoom (centered on cursor).
        viewport.addEventListener('wheel', (e) => {
            e.preventDefault();
            const z = getZoomState(slug);
            const oldZoom = z.zoom;
            const delta = e.deltaY < 0 ? 0.15 : -0.15;
            z.zoom = Math.max(0.5, Math.min(5, z.zoom + delta));
            // Adjust pan so the point under the cursor stays put.
            const rect = viewport.getBoundingClientRect();
            const cx = e.clientX - rect.left - rect.width / 2;
            const cy = e.clientY - rect.top  - rect.height / 2;
            const k = z.zoom / oldZoom;
            z.panX = (z.panX - cx) * k + cx;
            z.panY = (z.panY - cy) * k + cy;
            if (z.zoom <= 1.01) { z.panX = 0; z.panY = 0; }
            applyInvmapTransform(slug);
        }, { passive: false });

        // Drag to pan.
        let dragging = false, lastX = 0, lastY = 0;
        const onDown = (e) => {
            if (e.target.closest('.invmap-zoom-controls')) return;
            dragging = true;
            stage.classList.add('is-dragging');
            const pt = e.touches ? e.touches[0] : e;
            lastX = pt.clientX; lastY = pt.clientY;
            e.preventDefault();
        };
        const onMove = (e) => {
            if (!dragging) return;
            const pt = e.touches ? e.touches[0] : e;
            const dx = pt.clientX - lastX, dy = pt.clientY - lastY;
            lastX = pt.clientX; lastY = pt.clientY;
            const z = getZoomState(slug);
            z.panX += dx; z.panY += dy;
            applyInvmapTransform(slug);
        };
        const onUp = () => { if (dragging) { dragging = false; stage.classList.remove('is-dragging'); } };

        viewport.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup',   onUp);
        viewport.addEventListener('touchstart', onDown, { passive: false });
        window.addEventListener('touchmove',  onMove,  { passive: false });
        window.addEventListener('touchend',   onUp);
    }

    function plotMatchesBreed(plotName) {
        if (!_invmap.selectedBreed) return true;
        return (_invmap.breedToPlots[_invmap.selectedBreed] || new Set()).has(plotName);
    }

    function plotMatchesBatchSearch(plotName) {
        const q = (_invmap.batchSearch || '').trim().toLowerCase();
        if (!q) return true;
        const list = _invmap.plotBatches[plotName] || [];
        return list.some(b => String(b.batch).toLowerCase().includes(q));
    }

    function batchMatchesSearch(batch) {
        const q = (_invmap.batchSearch || '').trim().toLowerCase();
        if (!q) return true;
        return String(batch).toLowerCase().includes(q);
    }

    function renderInvmapPlotsForNursery(nurseryName) {
        const slug   = nurseryName.replace(/\s+/g, '-');
        const svg    = document.getElementById('invmap-svg-' + slug);
        const labels = document.getElementById('invmap-labels-' + slug);
        const statEl = document.getElementById('invmap-stat-' + slug);
        if (!svg || !labels) return;
        svg.innerHTML = '';
        labels.innerHTML = '';

        let nurseryFull = 0, nurseryColl = 0;
        const plots = _invmap.plots.filter(p => p.nursery_name === nurseryName);

        plots.forEach(p => {
            if (!p.map_top || !p.map_top.startsWith('[')) return;
            let pts;
            try { pts = JSON.parse(p.map_top); } catch (e) { return; }
            const ptsStr = pts.map(pt => pt.x + ',' + pt.y).join(' ');

            // Restrict to selected breed + batch search if active.
            let batches = _invmap.plotBatches[p.plot_name] || [];
            const matchesBreed  = plotMatchesBreed(p.plot_name);
            const matchesSearch = plotMatchesBatchSearch(p.plot_name);
            const matches = matchesBreed && matchesSearch;
            if (_invmap.selectedBreed) batches = batches.filter(b => b.breed === _invmap.selectedBreed);
            if (_invmap.batchSearch)   batches = batches.filter(b => batchMatchesSearch(b.batch));

            const totalFull = batches.reduce((s, b) => s + b.full, 0);
            const totalColl = batches.reduce((s, b) => s + b.collected, 0);
            const totalBal  = batches.reduce((s, b) => s + b.balance, 0);
            const pct = totalFull > 0 ? Math.round((totalColl / totalFull) * 100) : 0;
            const remainingPct = 100 - pct;

            nurseryFull += totalFull;
            nurseryColl += totalColl;

            // Color by remaining %. Dim if not matching breed filter.
            let fill = 'rgba(148, 163, 184, .25)', stroke = '#94a3b8';
            if (totalFull > 0) {
                if      (remainingPct >= 80) { fill = 'rgba(74, 222, 128, .40)'; stroke = '#22c55e'; }
                else if (remainingPct >= 20) { fill = 'rgba(251, 191, 36, .40)';  stroke = '#f59e0b'; }
                else                         { fill = 'rgba(244, 114, 128, .40)'; stroke = '#ef4444'; }
            }
            if (!matches) {
                fill   = 'rgba(203, 213, 225, .15)';
                stroke = '#cbd5e1';
            }

            const safePlot = p.plot_name.replace(/'/g, "\\'");
            svg.innerHTML += `<polygon points="${ptsStr}" fill="${fill}" stroke="${stroke}" stroke-width=".4" class="invmap-plot-shape" onclick="openInvmapModal('${safePlot}')"/>`;

            const cx = pts.reduce((s, pt) => s + pt.x, 0) / pts.length;
            const cy = pts.reduce((s, pt) => s + pt.y, 0) / pts.length;

            // Label: plot name + collection percentage only.
            const pctLabel = totalFull > 0
                ? `<div class="invmap-batch-line" title="Full ${totalFull.toLocaleString()} · Collected ${totalColl.toLocaleString()} · Balance ${totalBal.toLocaleString()}">${pct}% collected</div>`
                : `<div class="invmap-batch-line empty">No batch</div>`;
            const dimStyle = !matches ? 'opacity:.35' : '';
            labels.innerHTML += `
                <div class="invmap-label" style="left:${cx}%; top:${cy}%; ${dimStyle}">
                    <div class="invmap-plot-tag">${p.plot_name}</div>
                    ${pctLabel}
                </div>`;
        });
        if (statEl) {
            const pct = nurseryFull > 0 ? Math.round((nurseryColl / nurseryFull) * 100) : 0;
            statEl.innerText = nurseryFull > 0 ? (nurseryColl.toLocaleString() + ' / ' + nurseryFull.toLocaleString() + '  (' + pct + '% collected)') : 'No batch data';
        }
    }

    function visiblePlotBatchPairs() {
        // Return [{plot, batch, breed, full, collected, balance}] for the active
        // nursery scope, optionally filtered by selected breed.
        const nurseryNames = _invmap.active === 'all'
            ? new Set(_invmap.plots.map(p => p.nursery_name))
            : new Set([_invmap.active]);
        const plotToNursery = {};
        _invmap.plots.forEach(p => { plotToNursery[p.plot_name] = p.nursery_name; });

        const out = [];
        Object.entries(_invmap.plotBatches).forEach(([plot, list]) => {
            const nursery = plotToNursery[plot];
            if (nursery && !nurseryNames.has(nursery)) return;
            list.forEach(b => {
                if (_invmap.selectedBreed && b.breed !== _invmap.selectedBreed) return;
                if (!batchMatchesSearch(b.batch)) return;
                out.push({ plot, nursery, ...b });
            });
        });
        return out;
    }

    function updateInvmapTotals() {
        const pairs = visiblePlotBatchPairs();
        const tot = pairs.reduce((s, p) => ({ full:s.full+p.full, collected:s.collected+p.collected, balance:s.balance+p.balance }), { full:0, collected:0, balance:0 });
        const fmt = n => Number(n||0).toLocaleString();
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
        set('invmap-tot-full', fmt(tot.full));
        set('invmap-tot-coll', fmt(tot.collected));
        set('invmap-tot-bal',  fmt(tot.balance));
    }

    function renderInvmapSidebar() {
        const body       = document.getElementById('invmap-side-body');
        const chipsEl    = document.getElementById('invmap-breed-chips');
        const clearBtn   = document.getElementById('invmap-breed-clear');
        if (!body || !chipsEl) return;

        // Toggle "clear" link visibility based on whether a breed is selected.
        if (clearBtn) clearBtn.classList.toggle('hidden', !_invmap.selectedBreed);

        updateInvmapTotals();
        const fmt = n => Number(n||0).toLocaleString();

        // Render breed chips (sorted by balance desc).
        const breeds = Object.entries(_invmap.breedTotals)
            .map(([breed, t]) => ({ breed, ...t }))
            .sort((a, b) => b.balance - a.balance);
        if (!breeds.length) {
            chipsEl.innerHTML = '<span class="text-[10px] text-slate-400">No breed data yet</span>';
        } else {
            chipsEl.innerHTML = breeds.map(b => {
                const active = _invmap.selectedBreed === b.breed;
                const safe   = b.breed.replace(/'/g, "\\'");
                return `<button class="invmap-breed-chip ${active ? 'active' : ''}" onclick="selectInvmapBreed('${safe}')" title="Bal ${fmt(b.balance)} · Coll ${fmt(b.collected)} · Full ${fmt(b.full)} · ${b.plots.size} plot${b.plots.size===1?'':'s'}">${b.breed}<span class="invmap-breed-chip-count">${fmt(b.balance)}</span></button>`;
            }).join('');
        }

        // Render the by-plot batch breakdown (filtered when a breed is active).
        const pairs = visiblePlotBatchPairs();
        if (!pairs.length) {
            body.innerHTML = '<div class="text-center py-8 text-slate-400 text-[10px] font-bold uppercase tracking-widest">No batch data for this scope.</div>';
            return;
        }
        const byPlot = {};
        pairs.forEach(r => { (byPlot[r.plot] = byPlot[r.plot] || []).push(r); });
        body.innerHTML = Object.entries(byPlot).map(([plot, list]) => {
            const totFull = list.reduce((s,b)=>s+b.full,0);
            const totColl = list.reduce((s,b)=>s+b.collected,0);
            const totBal  = list.reduce((s,b)=>s+b.balance,0);
            const pct = totFull > 0 ? Math.round((totColl/totFull)*100) : 0;
            const rowsHtml = list.map(b => `
                <tr class="border-t border-slate-100">
                    <td class="py-1.5 text-[11px] font-black text-slate-800">#${b.batch}</td>
                    <td class="py-1.5 text-[10px] text-slate-500">${b.breed}</td>
                    <td class="py-1.5 text-[11px] text-right tabular-nums text-slate-700">${fmt(b.full)}</td>
                    <td class="py-1.5 text-[11px] text-right tabular-nums text-blue-700">${fmt(b.collected)}</td>
                    <td class="py-1.5 text-[11px] text-right tabular-nums font-black ${b.balance>0?'text-emerald-700':'text-slate-400'}">${fmt(b.balance)}</td>
                </tr>`).join('');
            return `
            <div class="bg-white border border-slate-200 rounded-xl p-3 mb-3">
                <div class="flex items-center justify-between gap-2 mb-2">
                    <div class="font-black text-slate-800 text-[12px] uppercase tracking-wider">${plot}</div>
                    <div class="text-[9px] font-black text-slate-500"><span class="text-blue-700">${pct}%</span> collected · bal ${fmt(totBal)}/${fmt(totFull)}</div>
                </div>
                <table class="w-full">
                    <thead><tr>
                        <th class="text-left text-[8px] font-black text-slate-400 uppercase tracking-widest">Batch</th>
                        <th class="text-left text-[8px] font-black text-slate-400 uppercase tracking-widest">Breed</th>
                        <th class="text-right text-[8px] font-black text-slate-400 uppercase tracking-widest">Full</th>
                        <th class="text-right text-[8px] font-black text-blue-400 uppercase tracking-widest">Coll</th>
                        <th class="text-right text-[8px] font-black text-emerald-500 uppercase tracking-widest">Bal</th>
                    </tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>`;
        }).join('');
    }

    function selectInvmapBreed(breed) {
        // Toggle off if clicking the same breed.
        _invmap.selectedBreed = (_invmap.selectedBreed === breed) ? null : breed;
        renderInvmapStack();
        renderInvmapSidebar();
    }

    function clearInvmapBreed() {
        _invmap.selectedBreed = null;
        renderInvmapStack();
        renderInvmapSidebar();
    }

    // Debounced batch search — keeps typing responsive.
    let _invmapSearchTimer = null;
    function onInvmapBatchSearch(v) {
        _invmap.batchSearch = (v || '').trim();
        const clr = document.getElementById('invmap-batch-search-clear');
        if (clr) clr.classList.toggle('hidden', !_invmap.batchSearch);
        if (_invmapSearchTimer) clearTimeout(_invmapSearchTimer);
        _invmapSearchTimer = setTimeout(() => {
            renderInvmapStack();
            renderInvmapSidebar();
        }, 120);
    }
    function clearInvmapBatchSearch() {
        const input = document.getElementById('invmap-batch-search');
        if (input) input.value = '';
        _invmap.batchSearch = '';
        const clr = document.getElementById('invmap-batch-search-clear');
        if (clr) clr.classList.add('hidden');
        renderInvmapStack();
        renderInvmapSidebar();
    }

    function openInvmapModal(plotName) {
        const modal = document.getElementById('invmap-modal');
        const titleEl = document.getElementById('invmap-modal-plot');
        const body = document.getElementById('invmap-modal-body');
        const fmt = n => Number(n||0).toLocaleString();
        titleEl.innerText = plotName;
        let batches = _invmap.plotBatches[plotName] || [];
        if (_invmap.selectedBreed) batches = batches.filter(b => b.breed === _invmap.selectedBreed);
        if (!batches.length) {
            body.innerHTML = '<div class="text-center py-8 text-slate-400 text-xs font-bold uppercase tracking-widest">No batches in scope for this plot.</div>';
        } else {
            const totFull = batches.reduce((s,b)=>s+b.full,0);
            const totColl = batches.reduce((s,b)=>s+b.collected,0);
            const totBal  = batches.reduce((s,b)=>s+b.balance,0);
            body.innerHTML = `
                <div class="grid grid-cols-3 gap-2 mb-4">
                    <div class="bg-slate-50 rounded-lg p-3 text-center"><div class="text-[9px] font-bold text-slate-400 uppercase">Full</div><div class="text-xl font-black text-slate-800">${fmt(totFull)}</div></div>
                    <div class="bg-blue-50 rounded-lg p-3 text-center"><div class="text-[9px] font-bold text-blue-400 uppercase">Collected</div><div class="text-xl font-black text-blue-700">${fmt(totColl)}</div></div>
                    <div class="bg-emerald-50 rounded-lg p-3 text-center"><div class="text-[9px] font-bold text-emerald-500 uppercase">Balance</div><div class="text-xl font-black text-emerald-700">${fmt(totBal)}</div></div>
                </div>
                <table class="w-full text-left">
                    <thead><tr class="border-b border-slate-200">
                        <th class="py-2 text-[9px] font-bold text-slate-400 uppercase tracking-widest">Batch</th>
                        <th class="py-2 text-[9px] font-bold text-slate-400 uppercase tracking-widest">Breed</th>
                        <th class="py-2 text-[9px] font-bold text-slate-400 uppercase tracking-widest text-right">Full</th>
                        <th class="py-2 text-[9px] font-bold text-slate-400 uppercase tracking-widest text-right">Collected</th>
                        <th class="py-2 text-[9px] font-bold text-slate-400 uppercase tracking-widest text-right">Balance</th>
                    </tr></thead>
                    <tbody>${batches.map(b => `
                        <tr class="border-b border-slate-50">
                            <td class="py-2 text-sm font-black text-slate-800">#${b.batch}</td>
                            <td class="py-2 text-[11px] text-slate-500">${b.breed}</td>
                            <td class="py-2 text-sm text-right tabular-nums">${fmt(b.full)}</td>
                            <td class="py-2 text-sm text-right tabular-nums text-blue-700">${fmt(b.collected)}</td>
                            <td class="py-2 text-sm text-right tabular-nums font-black ${b.balance > 0 ? 'text-emerald-700' : 'text-slate-400'}">${fmt(b.balance)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>`;
        }
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function closeInvmapModal() {
        const modal = document.getElementById('invmap-modal');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    window.switchInvmapNursery = switchInvmapNursery;
    window.selectInvmapBreed   = selectInvmapBreed;
    window.clearInvmapBreed    = clearInvmapBreed;
    window.openInvmapModal     = openInvmapModal;
    window.closeInvmapModal    = closeInvmapModal;
    window.invmapZoom          = invmapZoom;
    window.invmapResetZoom     = invmapResetZoom;
    window.onInvmapBatchSearch = onInvmapBatchSearch;
    window.clearInvmapBatchSearch = clearInvmapBatchSearch;

    document.getElementById('gearing-slider').addEventListener('input', updateGearing);
    _supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) { window.location.href = 'operation_dashboard.html'; return; }
        loadNsd();
        loadTodoList();
        loadMaturity();
        loadCustomerOrders().then(() => renderAllocDrawer());
        loadScheduledCollection();
        // loadAgingReport removed — Aging Report block deleted from UI.
        loadBatchAllocations().then(() => { renderMaturityTable(); renderAllocDrawer(); });
    });
