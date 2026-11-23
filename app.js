/**
 * SakuKu — Aplikasi Mobile Pencatatan Keuangan Harian
 * Offline-first + Sinkronisasi Google Spreadsheets via Google Apps Script
 */

const EXPENSE_CATEGORIES = [
  { name: 'Makan & Minum', icon: '🍽️' },
  { name: 'Transportasi', icon: '🛵' },
  { name: 'Belanja', icon: '🛍️' },
  { name: 'Tagihan', icon: '⚡' },
  { name: 'Kesehatan', icon: '🩺' },
  { name: 'Hiburan', icon: '🎬' },
  { name: 'Pendidikan', icon: '📚' },
  { name: 'Tabungan', icon: '🏦' },
  { name: 'Lainnya', icon: '📦' }
];

const INCOME_CATEGORIES = [
  { name: 'Gaji', icon: '💼' },
  { name: 'Bonus', icon: '🎁' },
  { name: 'Usaha', icon: '🏪' },
  { name: 'Investasi', icon: '📈' },
  { name: 'Hadiah', icon: '🎉' },
  { name: 'Lainnya', icon: '💰' }
];

const PAYMENT_METHODS = ['Tunai', 'QRIS', 'Transfer Bank', 'E-Wallet', 'Kartu Debit/Kredit'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MONTH_FULL = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const App = {
  currentTab: 'home',
  selectedYear: new Date().getFullYear(),
  selectedMonth: new Date().getMonth(), // 0-11
  txFilterType: 'all',
  txSearch: '',
  wishFilter: 'pending',
  activeBookId: null,
  autoSyncTimer: null,

  init() {
    Store.init();
    this.applyTheme();
    this.bindEvents();
    Store.subscribe(() => this.render());
    this.render();

    // Auto-sync saat kembali online
    window.addEventListener('online', () => {
      this.updateSyncPill();
      if (Store.canSync()) {
        this.showToast('Kembali online — menyinkronkan ke cloud...');
        Store.syncNow(true).then((r) => {
          if (r.ok) this.showToast('Data tersinkronisasi ke Google Sheets');
        });
      }
    });

    window.addEventListener('offline', () => {
      this.updateSyncPill();
      this.showToast('Mode Offline — data tersimpan aman di perangkat');
    });

    // Sinkronisasi awal di latar belakang jika sudah terkonfigurasi
    if (Store.canSync()) {
      Store.syncNow(true);
    }

    // Daftarkan Service Worker untuk mode offline penuh (PWA)
    if ('serviceWorker' in navigator && !Store.isGasEmbedded()) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  },

  applyTheme() {
    const theme = Store.state.settings.theme || 'light';
    const palette = Store.state.settings.palette || 'emerald';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-palette', palette);

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      const colors = { emerald: '#0F766E', ocean: '#0369A1', terracotta: '#B45309', olive: '#3F6212' };
      metaTheme.setAttribute('content', theme === 'dark' ? '#0A1012' : (colors[palette] || '#0F766E'));
    }
  },

  scheduleAutoSync() {
    if (!Store.canSync()) return;
    clearTimeout(this.autoSyncTimer);
    this.autoSyncTimer = setTimeout(() => {
      Store.syncNow(true);
    }, 1800);
  },

  getSelectedYM() {
    return `${this.selectedYear}-${String(this.selectedMonth + 1).padStart(2, '0')}`;
  },

  getActiveTransactions() {
    return Store.state.transactions
      .filter((t) => !t.deleted)
      .sort((a, b) => (b.date + b.updatedAt).localeCompare(a.date + a.updatedAt));
  },

  getMonthTransactions(ym) {
    return this.getActiveTransactions().filter((t) => (t.date || '').startsWith(ym));
  },

  getTotalBalance() {
    return this.getActiveTransactions().reduce((acc, t) => {
      return acc + (t.type === 'income' ? Number(t.amount) : -Number(t.amount));
    }, 0);
  },

  getCategoryIcon(category, type) {
    const list = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    const found = list.find((c) => c.name === category);
    return found ? found.icon : (type === 'income' ? '💰' : '🧾');
  },

  formatDateHuman(isoDate) {
    if (!isoDate) return '-';
    const today = todayIso();
    if (isoDate === today) return 'Hari Ini';
    const d = new Date(isoDate + 'T00:00:00');
    if (isNaN(d.getTime())) return isoDate;
    return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  },

  showToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  },

  bindEvents() {
    // Bottom navigation
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // Month switcher
    document.getElementById('prevMonthBtn').addEventListener('click', () => {
      this.selectedMonth -= 1;
      if (this.selectedMonth < 0) {
        this.selectedMonth = 11;
        this.selectedYear -= 1;
      }
      this.render();
    });

    document.getElementById('nextMonthBtn').addEventListener('click', () => {
      this.selectedMonth += 1;
      if (this.selectedMonth > 11) {
        this.selectedMonth = 0;
        this.selectedYear += 1;
      }
      this.render();
    });

    // FAB
    document.getElementById('fabBtn').addEventListener('click', () => {
      if (this.currentTab === 'savings') {
        this.openBookModal();
      } else if (this.currentTab === 'wishlist') {
        this.openWishlistModal();
      } else {
        this.openTransactionModal(null, 'expense');
      }
    });

    // Sync pill -> Settings modal
    document.getElementById('syncPill').addEventListener('click', () => this.openSettingsModal());

    // Modal backdrop click to close
    document.getElementById('modalBackdrop').addEventListener('click', (e) => {
      if (e.target.id === 'modalBackdrop') this.closeModal();
    });

    // Search transactions
    document.getElementById('txSearchInput').addEventListener('input', (e) => {
      this.txSearch = e.target.value.trim().toLowerCase();
      this.renderTransactionsView();
    });

    // Transaction filter chips
    document.querySelectorAll('#txFilterChips .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#txFilterChips .chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        this.txFilterType = chip.dataset.filter;
        this.renderTransactionsView();
      });
    });

    // Wishlist filter chips
    document.querySelectorAll('#wishFilterChips .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#wishFilterChips .chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        this.wishFilter = chip.dataset.filter;
        this.renderWishlistView();
      });
    });
  },

  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.view').forEach((v) => {
      v.classList.toggle('active', v.id === 'view-' + tab);
    });
    this.render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  render() {
    document.getElementById('monthLabel').textContent =
      `${MONTH_SHORT[this.selectedMonth]} ${this.selectedYear}`;

    this.updateSyncPill();

    if (this.currentTab === 'home') this.renderHomeView();
    if (this.currentTab === 'transactions') this.renderTransactionsView();
    if (this.currentTab === 'analytics') this.renderAnalyticsView();
    if (this.currentTab === 'savings') this.renderSavingsView();
    if (this.currentTab === 'wishlist') this.renderWishlistView();
  },

  updateSyncPill() {
    const pill = document.getElementById('syncPill');
    const text = document.getElementById('syncPillText');
    const pending = Store.getPendingCount();

    pill.classList.remove('offline', 'pending', 'syncing');

    if (Store.isSyncing) {
      pill.classList.add('syncing');
      text.textContent = 'Sync...';
    } else if (!navigator.onLine) {
      pill.classList.add('offline');
      text.textContent = pending > 0 ? `Offline (${pending})` : 'Offline';
    } else if (!Store.canSync()) {
      pill.classList.add('pending');
      text.textContent = 'Lokal';
    } else if (pending > 0) {
      pill.classList.add('pending');
      text.textContent = `Antre (${pending})`;
    } else {
      text.textContent = 'Cloud';
    }
  },

  /* ========================================================================
     VIEW 1: RINGKASAN (HOME)
     ======================================================================== */
  renderHomeView() {
    const ym = this.getSelectedYM();
    const monthTx = this.getMonthTransactions(ym);
    const totalBalance = this.getTotalBalance();

    const monthIncome = monthTx.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const monthExpense = monthTx.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);

    const totalSavings = Store.state.savingsBooks
      .filter((b) => !b.deleted)
      .reduce((s, b) => s + Number(b.balance || 0), 0);

    const activeWish = Store.state.wishlist.filter((w) => !w.deleted && w.status === 'pending');
    const recentTx = monthTx.slice(0, 5);

    const homeEl = document.getElementById('homeContainer');
    homeEl.innerHTML = `
      <div class="hero-card">
        <div class="hero-eyebrow">Saldo Tersedia (Keseluruhan)</div>
        <div class="hero-balance num">${formatRpFull(totalBalance)}</div>
        <div class="hero-metrics">
          <div class="hero-metric">
            <div class="hero-metric-label">↓ Pemasukan ${MONTH_SHORT[this.selectedMonth]}</div>
            <div class="hero-metric-val num">${formatRpFull(monthIncome)}</div>
          </div>
          <div class="hero-metric">
            <div class="hero-metric-label">↑ Pengeluaran ${MONTH_SHORT[this.selectedMonth]}</div>
            <div class="hero-metric-val num">${formatRpFull(monthExpense)}</div>
          </div>
        </div>
      </div>

      <div class="quick-actions">
        <button type="button" class="quick-btn expense-btn" id="quickAddExpense">
          <span class="quick-badge">−</span> Pengeluaran
        </button>
        <button type="button" class="quick-btn income-btn" id="quickAddIncome">
          <span class="quick-badge">+</span> Pemasukan
        </button>
      </div>

      <div class="stat-grid">
        <button type="button" class="stat-box" id="homeGoSavings" style="text-align:left;">
          <div class="stat-box-label">Buku Tabungan</div>
          <div class="stat-box-val num" style="color:var(--savings);">${formatRpFull(totalSavings)}</div>
        </button>
        <button type="button" class="stat-box" id="homeGoWishlist" style="text-align:left;">
          <div class="stat-box-label">Wishlist Aktif</div>
          <div class="stat-box-val num" style="color:var(--wishlist);">${activeWish.length} Item</div>
        </button>
      </div>

      <div class="section-header">
        <h2 class="section-title">Transaksi ${MONTH_FULL[this.selectedMonth]}</h2>
        <button type="button" class="section-link" id="homeSeeAllTx">Lihat Semua</button>
      </div>

      <div class="tx-list" id="homeRecentList">
        ${recentTx.length ? recentTx.map((t) => this.renderTxItemHtml(t)).join('') : '<div class="empty-state">Belum ada transaksi di bulan ini.<br>Ketuk tombol di atas untuk mulai mencatat.</div>'}
      </div>
    `;

    document.getElementById('quickAddExpense').addEventListener('click', () => this.openTransactionModal(null, 'expense'));
    document.getElementById('quickAddIncome').addEventListener('click', () => this.openTransactionModal(null, 'income'));
    document.getElementById('homeGoSavings').addEventListener('click', () => this.switchTab('savings'));
    document.getElementById('homeGoWishlist').addEventListener('click', () => this.switchTab('wishlist'));
    document.getElementById('homeSeeAllTx').addEventListener('click', () => this.switchTab('transactions'));

    homeEl.querySelectorAll('.tx-item').forEach((el) => {
      el.addEventListener('click', () => this.openTransactionDetailSheet(el.dataset.id));
    });
  },

  renderTxItemHtml(t) {
    const icon = this.getCategoryIcon(t.category, t.type);
    const sign = t.type === 'income' ? '+' : '−';
    const subParts = [t.method || 'Tunai'];
    if (t.note) subParts.push(t.note);
    return `
      <button type="button" class="tx-item" data-id="${escapeHtml(t.id)}">
        <span class="tx-icon ${t.type}">${icon}</span>
        <span class="tx-info">
          <div class="tx-title">${escapeHtml(t.category)}</div>
          <div class="tx-sub">${escapeHtml(subParts.join(' · '))}</div>
        </span>
        <span class="tx-amount ${t.type} num">${sign}${formatRpFull(t.amount)}</span>
      </button>
    `;
  },

  /* ========================================================================
     VIEW 2: TRANSAKSI DETAIL
     ======================================================================== */
  renderTransactionsView() {
    const ym = this.getSelectedYM();
    let list = this.getMonthTransactions(ym);

    if (this.txFilterType !== 'all') {
      list = list.filter((t) => t.type === this.txFilterType);
    }

    if (this.txSearch) {
      list = list.filter((t) => {
        const hay = `${t.category} ${t.note} ${t.method} ${t.date}`.toLowerCase();
        return hay.includes(this.txSearch);
      });
    }

    const container = document.getElementById('txListContainer');
    if (!list.length) {
      container.innerHTML = '<div class="card empty-state">Tidak ada transaksi yang cocok dengan filter ini.</div>';
      return;
    }

    // Kelompokkan per tanggal
    const grouped = new Map();
    list.forEach((t) => {
      const key = t.date || 'Tanpa Tanggal';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(t);
    });

    let html = '';
    grouped.forEach((items, dateKey) => {
      html += `<div class="date-group-label">${escapeHtml(this.formatDateHuman(dateKey))}</div>`;
      html += `<div class="tx-list">${items.map((t) => this.renderTxItemHtml(t)).join('')}</div>`;
    });

    container.innerHTML = html;
    container.querySelectorAll('.tx-item').forEach((el) => {
      el.addEventListener('click', () => this.openTransactionDetailSheet(el.dataset.id));
    });
  },

  /* ========================================================================
     VIEW 3: ANALITIK & DIAGRAM INTERAKTIF
     ======================================================================== */
  renderAnalyticsView() {
    const ym = this.getSelectedYM();
    const monthTx = this.getMonthTransactions(ym);
    const income = monthTx.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const expense = monthTx.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    const net = income - expense;
    const saveRate = income > 0 ? Math.round(((income - expense) / income) * 100) : 0;

    document.getElementById('analyticsStats').innerHTML = `
      <div class="stat-box">
        <div class="stat-box-label">Arus Kas Bersih</div>
        <div class="stat-box-val num" style="color:${net >= 0 ? 'var(--income)' : 'var(--expense)'};">
          ${net >= 0 ? '+' : ''}${formatRpFull(net)}
        </div>
      </div>
      <div class="stat-box">
        <div class="stat-box-label">Rasio Sisa Dana</div>
        <div class="stat-box-val num" style="color:var(--brand);">${saveRate}%</div>
      </div>
    `;

    // Donut chart data (pengeluaran per kategori)
    const catMap = new Map();
    monthTx.filter((t) => t.type === 'expense').forEach((t) => {
      catMap.set(t.category, (catMap.get(t.category) || 0) + Number(t.amount));
    });
    const donutItems = Array.from(catMap.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    renderDonutChart(document.getElementById('donutChartBox'), donutItems, expense);

    // 6-Month Cashflow Bar Chart data
    const monthsData = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(this.selectedYear, this.selectedMonth - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      const key = `${y}-${String(m + 1).padStart(2, '0')}`;
      const txs = this.getMonthTransactions(key);
      monthsData.push({
        label: MONTH_SHORT[m],
        fullLabel: `${MONTH_FULL[m]} ${y}`,
        income: txs.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0),
        expense: txs.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
      });
    }

    renderCashflowBarChart(document.getElementById('barChartBox'), monthsData);
  },

  /* ========================================================================
     VIEW 4: BUKU TABUNGAN DIGITAL
     ======================================================================== */
  renderSavingsView() {
    const books = Store.state.savingsBooks.filter((b) => !b.deleted);
    const totalSavings = books.reduce((s, b) => s + Number(b.balance || 0), 0);
    const totalTarget = books.reduce((s, b) => s + Number(b.target || 0), 0);
    const overallPct = totalTarget > 0 ? Math.min(100, Math.round((totalSavings / totalTarget) * 100)) : 0;

    const container = document.getElementById('savingsContainer');
    container.innerHTML = `
      <div class="savings-hero">
        <div class="hero-eyebrow">Total Saldo Buku Tabungan</div>
        <div class="hero-balance num" style="margin-bottom:10px;">${formatRpFull(totalSavings)}</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;opacity:0.9;">
          <span>${books.length} Buku Tabungan Aktif</span>
          <span>Target Tercapai: ${overallPct}%</span>
        </div>
      </div>

      <div class="section-header" style="margin-top:8px;">
        <h2 class="section-title">Daftar Buku Tabungan</h2>
        <button type="button" class="section-link" id="addBookBtn">+ Buku Baru</button>
      </div>

      ${books.length ? books.map((b) => {
        const pct = b.target > 0 ? Math.min(100, Math.round((b.balance / b.target) * 100)) : 0;
        return `
          <div class="book-card" data-id="${escapeHtml(b.id)}">
            <div class="book-header">
              <div>
                <h3 class="book-name">${escapeHtml(b.name)}</h3>
                <div class="book-note">${escapeHtml(b.note || 'Ketuk untuk buka buku mutasi')}</div>
              </div>
              <span class="book-badge num">${pct}%</span>
            </div>
            <div class="book-amounts">
              <span class="book-balance num">${formatRpFull(b.balance)}</span>
              <span class="book-target num">Target ${formatRpFull(b.target)}</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width:${pct}%; background:${escapeHtml(b.color || 'var(--savings)')};"></div>
            </div>
          </div>
        `;
      }).join('') : '<div class="card empty-state">Belum ada buku tabungan.<br>Buat buku tabungan pertama Anda untuk mencatat setoran & penarikan.</div>'}
    `;

    document.getElementById('addBookBtn').addEventListener('click', () => this.openBookModal());
    container.querySelectorAll('.book-card').forEach((card) => {
      card.addEventListener('click', () => this.openBookDetailModal(card.dataset.id));
    });
  },

  /* ========================================================================
     VIEW 5: WISHLIST
     ======================================================================== */
  renderWishlistView() {
    const allWish = Store.state.wishlist.filter((w) => !w.deleted);
    const pendingList = allWish.filter((w) => w.status === 'pending');
    const filtered = allWish.filter((w) => w.status === this.wishFilter);
    const totalPendingCost = pendingList.reduce((s, w) => s + Number(w.price || 0), 0);
    const currentBalance = Math.max(0, this.getTotalBalance());

    const priorityLabel = { high: 'Prioritas Tinggi', medium: 'Sedang', low: 'Santai' };
    const priorityOrder = { high: 1, medium: 2, low: 3 };
    filtered.sort((a, b) => (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2));

    const container = document.getElementById('wishlistContainer');
    container.innerHTML = `
      <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
        <div>
          <div style="font-size:12px;color:var(--text-muted);">Total Estimasi Wishlist Aktif</div>
          <div class="num" style="font-size:20px;font-weight:700;margin-top:2px;">${formatRpFull(totalPendingCost)}</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${pendingList.length} item menunggu</div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="addWishBtn">+ Tambah</button>
      </div>

      ${filtered.length ? filtered.map((w) => {
        const pct = w.price > 0 ? Math.min(100, Math.round((currentBalance / w.price) * 100)) : 100;
        const isDone = w.status === 'achieved';
        return `
          <div class="wish-card">
            <div class="wish-top">
              <div>
                <h3 class="wish-title">${escapeHtml(w.name)}</h3>
                <div class="wish-meta">${escapeHtml(w.category || 'Belanja')}${w.note ? ' · ' + escapeHtml(w.note) : ''}</div>
              </div>
              <span class="priority-pill ${isDone ? 'priority-done' : 'priority-' + (w.priority || 'medium')}">
                ${isDone ? 'Tercapai' : (priorityLabel[w.priority] || 'Sedang')}
              </span>
            </div>
            <div class="wish-price-row">
              <span class="wish-price num">${formatRpFull(w.price)}</span>
              ${!isDone ? `<span style="font-size:12px;color:var(--text-muted);" class="num">Kesiapan saldo ${pct}%</span>` : ''}
            </div>
            ${!isDone ? `
              <div class="progress-track">
                <div class="progress-fill" style="width:${pct}%;background:${pct >= 100 ? 'var(--income)' : 'var(--wishlist)'};"></div>
              </div>
            ` : ''}
            <div class="wish-actions">
              ${!isDone ? `<button type="button" class="btn btn-success btn-sm" style="flex:1;" data-buy="${escapeHtml(w.id)}">✓ Beli & Catat Pengeluaran</button>` : ''}
              <button type="button" class="btn btn-secondary btn-sm" data-edit-wish="${escapeHtml(w.id)}">Edit</button>
              <button type="button" class="btn btn-danger btn-sm" data-del-wish="${escapeHtml(w.id)}">Hapus</button>
            </div>
          </div>
        `;
      }).join('') : '<div class="card empty-state">Belum ada daftar wishlist pada kategori ini.</div>'}
    `;

    document.getElementById('addWishBtn').addEventListener('click', () => this.openWishlistModal());
    container.querySelectorAll('[data-buy]').forEach((btn) => {
      btn.addEventListener('click', () => this.fulfillWishlist(btn.dataset.buy));
    });
    container.querySelectorAll('[data-edit-wish]').forEach((btn) => {
      btn.addEventListener('click', () => this.openWishlistModal(btn.dataset.editWish));
    });
    container.querySelectorAll('[data-del-wish]').forEach((btn) => {
      btn.addEventListener('click', () => this.deleteWishlist(btn.dataset.delWish));
    });
  },

  /* ========================================================================
     MODALS (COMPACT & FLEXIBLE GLASS BOTTOM SHEET + SWIPE TO DISMISS)
     ======================================================================== */
  openModal(title, bodyHtml) {
    const backdrop = document.getElementById('modalBackdrop');
    const sheet = document.getElementById('modalSheet');
    sheet.style.transform = '';
    sheet.style.transition = '';
    sheet.innerHTML = `
      <div class="sheet-drag-zone" id="sheetDragZone">
        <div class="sheet-handle"></div>
      </div>
      <div class="sheet-header">
        <h3 class="sheet-title">${escapeHtml(title)}</h3>
        <button type="button" class="close-btn" id="closeModalBtn" aria-label="Tutup">×</button>
      </div>
      ${bodyHtml}
    `;
    backdrop.classList.add('open');
    document.getElementById('closeModalBtn').addEventListener('click', () => this.closeModal());

    // Gestur tarik ke bawah (swipe-to-dismiss) pada drag handle
    const dragZone = document.getElementById('sheetDragZone');
    let startY = 0;
    let deltaY = 0;

    dragZone.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
      deltaY = 0;
      sheet.style.transition = 'none';
    }, { passive: true });

    dragZone.addEventListener('touchmove', (e) => {
      deltaY = Math.max(0, e.touches[0].clientY - startY);
      sheet.style.transform = `translateY(${deltaY}px)`;
    }, { passive: true });

    dragZone.addEventListener('touchend', () => {
      sheet.style.transition = 'transform 0.26s cubic-bezier(0.34, 1.4, 0.64, 1)';
      if (deltaY > 75) {
        this.closeModal();
      } else {
        sheet.style.transform = 'translateY(0)';
      }
    });
  },

  closeModal() {
    const backdrop = document.getElementById('modalBackdrop');
    const sheet = document.getElementById('modalSheet');
    sheet.style.transform = '';
    backdrop.classList.remove('open');
  },

  openConfirmSheet({ title, message, confirmText = 'Lanjutkan', confirmClass = 'btn-danger', onConfirm }) {
    const html = `
      <p style="margin:0 0 16px;font-size:14px;color:var(--text-secondary);line-height:1.5;">${escapeHtml(message)}</p>
      <div class="row-2">
        <button type="button" class="btn btn-secondary" id="confirmCancelBtn">Batal</button>
        <button type="button" class="btn ${confirmClass}" id="confirmOkBtn">${escapeHtml(confirmText)}</button>
      </div>
    `;
    this.openModal(title, html);
    document.getElementById('confirmCancelBtn').addEventListener('click', () => this.closeModal());
    document.getElementById('confirmOkBtn').addEventListener('click', () => {
      this.closeModal();
      if (onConfirm) onConfirm();
    });
  },

  openTransactionDetailSheet(txId) {
    const t = Store.state.transactions.find((x) => x.id === txId && !x.deleted);
    if (!t) return;
    const isInc = t.type === 'income';
    const icon = this.getCategoryIcon(t.category, t.type);

    const html = `
      <div style="text-align:center;padding:6px 0 14px;">
        <div class="tx-icon ${t.type}" style="width:54px;height:54px;border-radius:20px;margin:0 auto 10px;font-size:24px;">${icon}</div>
        <div class="num" style="font-size:26px;font-weight:800;color:${isInc ? 'var(--income)' : 'var(--expense)'};">
          ${isInc ? '+' : '−'}${formatRpFull(t.amount)}
        </div>
        <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${escapeHtml(t.category)}</div>
      </div>

      <div class="detail-kv-list">
        <div class="detail-kv">
          <span class="detail-kv-label">Tipe</span>
          <span class="detail-kv-val">${isInc ? 'Pemasukan' : 'Pengeluaran'}</span>
        </div>
        <div class="detail-kv">
          <span class="detail-kv-label">Tanggal</span>
          <span class="detail-kv-val">${escapeHtml(this.formatDateHuman(t.date))}</span>
        </div>
        <div class="detail-kv">
          <span class="detail-kv-label">Metode</span>
          <span class="detail-kv-val">${escapeHtml(t.method || 'Tunai')}</span>
        </div>
        <div class="detail-kv">
          <span class="detail-kv-label">Catatan</span>
          <span class="detail-kv-val">${escapeHtml(t.note || '—')}</span>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;">
        <button type="button" class="btn btn-primary btn-sm" id="detailEditTxBtn">Edit</button>
        <button type="button" class="btn btn-tonal btn-sm" id="detailDupTxBtn">Duplikat</button>
        <button type="button" class="btn btn-danger btn-sm" id="detailDelTxBtn">Hapus</button>
      </div>
    `;

    this.openModal('Detail Transaksi', html);

    document.getElementById('detailEditTxBtn').addEventListener('click', () => this.openTransactionModal(t.id));
    document.getElementById('detailDupTxBtn').addEventListener('click', () => {
      Store.state.transactions.push(Object.assign({}, t, {
        id: uid('tx'),
        date: todayIso(),
        updatedAt: new Date().toISOString(),
        syncStatus: 'pending'
      }));
      Store.save();
      this.scheduleAutoSync();
      this.closeModal();
      this.showToast('Transaksi diduplikasi untuk hari ini');
    });
    document.getElementById('detailDelTxBtn').addEventListener('click', () => {
      this.openConfirmSheet({
        title: 'Hapus Transaksi?',
        message: `Transaksi "${t.category}" sebesar ${formatRpFull(t.amount)} akan dihapus dari catatan dan disinkronkan ke cloud.`,
        confirmText: 'Ya, Hapus',
        onConfirm: () => {
          t.deleted = true;
          t.updatedAt = new Date().toISOString();
          t.syncStatus = 'pending';
          Store.save();
          this.scheduleAutoSync();
          this.showToast('Transaksi dihapus');
        }
      });
    });
  },

  /* --- Modal: Tambah / Edit Transaksi --- */
  openTransactionModal(txId = null, defaultType = 'expense') {
    const existing = txId ? Store.state.transactions.find((t) => t.id === txId) : null;
    let currentType = existing ? existing.type : defaultType;

    const buildCategoryOptions = (type, selectedCat) => {
      const list = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
      return list.map((c) => `<option value="${escapeHtml(c.name)}" ${c.name === selectedCat ? 'selected' : ''}>${c.icon} ${escapeHtml(c.name)}</option>`).join('');
    };

    const html = `
      <form id="txForm">
        <div class="form-group">
          <div class="segmented">
            <button type="button" class="seg-btn expense ${currentType === 'expense' ? 'active' : ''}" data-type="expense">Pengeluaran</button>
            <button type="button" class="seg-btn income ${currentType === 'income' ? 'active' : ''}" data-type="income">Pemasukan</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="txAmount">Nominal (Rp)</label>
          <input id="txAmount" class="form-control num" type="number" inputmode="numeric" min="1" required placeholder="Contoh: 50000" value="${existing ? existing.amount : ''}">
        </div>
        <div class="row-2">
          <div class="form-group">
            <label class="form-label" for="txCategory">Kategori</label>
            <select id="txCategory" class="form-control">${buildCategoryOptions(currentType, existing ? existing.category : '')}</select>
          </div>
          <div class="form-group">
            <label class="form-label" for="txDate">Tanggal</label>
            <input id="txDate" class="form-control" type="date" required value="${existing ? existing.date : todayIso()}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="txMethod">Metode Pembayaran</label>
          <select id="txMethod" class="form-control">
            ${PAYMENT_METHODS.map((m) => `<option value="${escapeHtml(m)}" ${existing && existing.method === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="txNote">Catatan Detail</label>
          <textarea id="txNote" class="form-control" placeholder="Contoh: Makan siang nasi padang, struk toko, dll.">${existing ? escapeHtml(existing.note) : ''}</textarea>
        </div>
        <div style="display:flex;gap:8px;margin-top:6px;">
          ${existing ? '<button type="button" class="btn btn-danger" id="deleteTxBtn">Hapus</button>' : ''}
          <button type="submit" class="btn btn-primary" style="flex:1;">${existing ? 'Simpan Perubahan' : 'Simpan Transaksi'}</button>
        </div>
      </form>
    `;

    this.openModal(existing ? 'Edit Transaksi' : 'Catat Transaksi', html);

    const sheet = document.getElementById('modalSheet');
    const catSelect = sheet.querySelector('#txCategory');
    sheet.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentType = btn.dataset.type;
        sheet.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        catSelect.innerHTML = buildCategoryOptions(currentType, '');
      });
    });

    if (existing) {
      sheet.querySelector('#deleteTxBtn').addEventListener('click', () => {
        existing.deleted = true;
        existing.updatedAt = new Date().toISOString();
        existing.syncStatus = 'pending';
        Store.save();
        this.scheduleAutoSync();
        this.closeModal();
        this.showToast('Transaksi dihapus');
      });
    }

    sheet.querySelector('#txForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const amount = Number(sheet.querySelector('#txAmount').value);
      if (!amount || amount <= 0) return;

      const now = new Date().toISOString();
      if (existing) {
        existing.type = currentType;
        existing.amount = amount;
        existing.category = sheet.querySelector('#txCategory').value;
        existing.date = sheet.querySelector('#txDate').value;
        existing.method = sheet.querySelector('#txMethod').value;
        existing.note = sheet.querySelector('#txNote').value.trim();
        existing.updatedAt = now;
        existing.syncStatus = 'pending';
      } else {
        Store.state.transactions.push({
          id: uid('tx'),
          type: currentType,
          amount,
          category: sheet.querySelector('#txCategory').value,
          date: sheet.querySelector('#txDate').value,
          method: sheet.querySelector('#txMethod').value,
          note: sheet.querySelector('#txNote').value.trim(),
          updatedAt: now,
          deleted: false,
          syncStatus: 'pending'
        });
      }

      Store.save();
      this.scheduleAutoSync();
      this.closeModal();
      this.showToast(existing ? 'Transaksi diperbarui' : 'Transaksi dicatat');
    });
  },

  /* --- Modal: Tambah / Edit Buku Tabungan --- */
  openBookModal(bookId = null) {
    const existing = bookId ? Store.state.savingsBooks.find((b) => b.id === bookId) : null;
    const colors = ['#0F766E', '#0284C7', '#059669', '#D97706', '#EA580C'];

    const html = `
      <form id="bookForm">
        <div class="form-group">
          <label class="form-label" for="bookName">Nama Buku / Tujuan Tabungan</label>
          <input id="bookName" class="form-control" required placeholder="Contoh: Dana Darurat, Beli Laptop" value="${existing ? escapeHtml(existing.name) : ''}">
        </div>
        <div class="form-group">
          <label class="form-label" for="bookTarget">Target Nominal (Rp)</label>
          <input id="bookTarget" class="form-control num" type="number" inputmode="numeric" min="0" required placeholder="Contoh: 10000000" value="${existing ? existing.target : ''}">
        </div>
        ${!existing ? `
          <div class="form-group">
            <label class="form-label" for="bookInitial">Saldo Awal (Rp, opsional)</label>
            <input id="bookInitial" class="form-control num" type="number" inputmode="numeric" min="0" placeholder="0" value="">
          </div>
        ` : ''}
        <div class="form-group">
          <label class="form-label" for="bookColor">Warna Label</label>
          <select id="bookColor" class="form-control">
            ${colors.map((c, idx) => `<option value="${c}" ${existing && existing.color === c ? 'selected' : ''}>Tema ${idx + 1} (${c})</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="bookNote">Catatan</label>
          <input id="bookNote" class="form-control" placeholder="Keterangan singkat" value="${existing ? escapeHtml(existing.note) : ''}">
        </div>
        <div style="display:flex;gap:8px;">
          ${existing ? '<button type="button" class="btn btn-danger" id="deleteBookBtn">Hapus</button>' : ''}
          <button type="submit" class="btn btn-primary" style="flex:1;">${existing ? 'Simpan' : 'Buat Buku Tabungan'}</button>
        </div>
      </form>
    `;

    this.openModal(existing ? 'Edit Buku Tabungan' : 'Buku Tabungan Baru', html);

    const sheet = document.getElementById('modalSheet');
    if (existing) {
      sheet.querySelector('#deleteBookBtn').addEventListener('click', () => {
        existing.deleted = true;
        existing.updatedAt = new Date().toISOString();
        existing.syncStatus = 'pending';
        Store.save();
        this.scheduleAutoSync();
        this.closeModal();
        this.showToast('Buku tabungan dihapus');
      });
    }

    sheet.querySelector('#bookForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const now = new Date().toISOString();
      const name = sheet.querySelector('#bookName').value.trim();
      const target = Number(sheet.querySelector('#bookTarget').value) || 0;
      const color = sheet.querySelector('#bookColor').value;
      const note = sheet.querySelector('#bookNote').value.trim();

      if (existing) {
        existing.name = name;
        existing.target = target;
        existing.color = color;
        existing.note = note;
        existing.updatedAt = now;
        existing.syncStatus = 'pending';
      } else {
        const initial = Number(sheet.querySelector('#bookInitial').value) || 0;
        const newBookId = uid('book');
        Store.state.savingsBooks.push({
          id: newBookId,
          name,
          target,
          balance: initial,
          color,
          note,
          updatedAt: now,
          deleted: false,
          syncStatus: 'pending'
        });

        if (initial > 0) {
          Store.state.savingsLedger.push({
            id: uid('ldg'),
            bookId: newBookId,
            date: todayIso(),
            type: 'deposit',
            amount: initial,
            balanceAfter: initial,
            note: 'Saldo awal buku tabungan',
            updatedAt: now,
            deleted: false,
            syncStatus: 'pending'
          });
        }
      }

      Store.save();
      this.scheduleAutoSync();
      this.closeModal();
      this.showToast(existing ? 'Buku tabungan diperbarui' : 'Buku tabungan dibuat');
    });
  },

  /* --- Modal: Detail Buku Tabungan (Mutasi seperti Buku Tabungan Fisik) --- */
  openBookDetailModal(bookId) {
    const book = Store.state.savingsBooks.find((b) => b.id === bookId && !b.deleted);
    if (!book) return;

    const entries = Store.state.savingsLedger
      .filter((l) => l.bookId === bookId && !l.deleted)
      .sort((a, b) => (b.date + b.updatedAt).localeCompare(a.date + a.updatedAt));

    const pct = book.target > 0 ? Math.min(100, Math.round((book.balance / book.target) * 100)) : 0;

    const rowsHtml = entries.length
      ? entries.map((e) => `
          <tr>
            <td>
              <div style="font-weight:600;">${escapeHtml(this.formatDateHuman(e.date))}</div>
              <div style="color:var(--text-muted);font-size:11px;">${escapeHtml(e.note || (e.type === 'deposit' ? 'Setoran' : 'Penarikan'))}</div>
            </td>
            <td class="right num" style="font-weight:700;color:${e.type === 'deposit' ? 'var(--income)' : 'var(--expense)'};">
              ${e.type === 'deposit' ? '+' : '−'}${formatRpFull(e.amount)}
            </td>
            <td class="right num" style="font-weight:600;">${formatRpFull(e.balanceAfter)}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="3" class="empty-state">Belum ada catatan mutasi.</td></tr>';

    const html = `
      <div style="background:var(--surface-subtle);border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-size:12px;color:var(--text-muted);">Saldo Buku Tabungan</span>
          <button type="button" class="section-link" id="editThisBookBtn">Edit Buku</button>
        </div>
        <div class="num" style="font-size:22px;font-weight:700;margin-bottom:8px;">${formatRpFull(book.balance)}</div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${pct}%;background:${escapeHtml(book.color || 'var(--savings)')};"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-top:6px;">
          <span>Tercapai ${pct}%</span>
          <span class="num">Target ${formatRpFull(book.target)}</span>
        </div>
      </div>

      <div class="row-2" style="margin-bottom:14px;">
        <button type="button" class="btn btn-primary" id="btnDeposit">+ Setor</button>
        <button type="button" class="btn btn-secondary" id="btnWithdraw">− Tarik</button>
      </div>

      <div style="font-size:13px;font-weight:700;margin-bottom:4px;">Riwayat Mutasi Buku Tabungan</div>
      <div class="ledger-table-wrap">
        <table class="ledger-table">
          <thead>
            <tr>
              <th>Tanggal & Ket.</th>
              <th class="right">Mutasi</th>
              <th class="right">Saldo</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;

    this.openModal(book.name, html);

    const sheet = document.getElementById('modalSheet');
    sheet.querySelector('#editThisBookBtn').addEventListener('click', () => this.openBookModal(book.id));
    sheet.querySelector('#btnDeposit').addEventListener('click', () => this.openLedgerEntryModal(book.id, 'deposit'));
    sheet.querySelector('#btnWithdraw').addEventListener('click', () => this.openLedgerEntryModal(book.id, 'withdraw'));
  },

  openLedgerEntryModal(bookId, type) {
    const book = Store.state.savingsBooks.find((b) => b.id === bookId);
    if (!book) return;
    const isDeposit = type === 'deposit';

    const html = `
      <form id="ledgerForm">
        <div class="form-group">
          <label class="form-label" for="ldgAmount">Nominal ${isDeposit ? 'Setoran' : 'Penarikan'} (Rp)</label>
          <input id="ldgAmount" class="form-control num" type="number" inputmode="numeric" min="1" required placeholder="Contoh: 250000">
        </div>
        <div class="form-group">
          <label class="form-label" for="ldgDate">Tanggal</label>
          <input id="ldgDate" class="form-control" type="date" required value="${todayIso()}">
        </div>
        <div class="form-group">
          <label class="form-label" for="ldgNote">Keterangan</label>
          <input id="ldgNote" class="form-control" placeholder="${isDeposit ? 'Contoh: Sisihkan uang harian' : 'Contoh: Tarik untuk keperluan darurat'}">
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:14px;cursor:pointer;">
          <input type="checkbox" id="ldgSyncTx" ${isDeposit ? 'checked' : ''}>
          <span>${isDeposit ? 'Catat juga sebagai Pengeluaran (kategori Tabungan)' : 'Catat juga sebagai Pemasukan di saldo utama'}</span>
        </label>
        <button type="submit" class="btn btn-primary btn-full">${isDeposit ? 'Simpan Setoran' : 'Simpan Penarikan'}</button>
      </form>
    `;

    this.openModal(`${isDeposit ? 'Setor' : 'Tarik'} — ${book.name}`, html);

    const sheet = document.getElementById('modalSheet');
    sheet.querySelector('#ledgerForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const amount = Number(sheet.querySelector('#ldgAmount').value);
      if (!amount || amount <= 0) return;

      if (!isDeposit && amount > book.balance) {
        this.showToast('Saldo buku tabungan tidak mencukupi');
        return;
      }

      const now = new Date().toISOString();
      const date = sheet.querySelector('#ldgDate').value;
      const note = sheet.querySelector('#ldgNote').value.trim();
      const syncTx = sheet.querySelector('#ldgSyncTx').checked;

      book.balance = Number(book.balance || 0) + (isDeposit ? amount : -amount);
      book.updatedAt = now;
      book.syncStatus = 'pending';

      Store.state.savingsLedger.push({
        id: uid('ldg'),
        bookId: book.id,
        date,
        type,
        amount,
        balanceAfter: book.balance,
        note: note || (isDeposit ? 'Setoran tabungan' : 'Penarikan tabungan'),
        updatedAt: now,
        deleted: false,
        syncStatus: 'pending'
      });

      if (syncTx) {
        Store.state.transactions.push({
          id: uid('tx'),
          date,
          type: isDeposit ? 'expense' : 'income',
          category: isDeposit ? 'Tabungan' : 'Lainnya',
          amount,
          method: 'Transfer Bank',
          note: `${isDeposit ? 'Setor ke' : 'Tarik dari'} ${book.name}${note ? ' — ' + note : ''}`,
          updatedAt: now,
          deleted: false,
          syncStatus: 'pending'
        });
      }

      Store.save();
      this.scheduleAutoSync();
      this.openBookDetailModal(book.id);
      this.showToast(isDeposit ? 'Setoran dicatat di buku tabungan' : 'Penarikan dicatat di buku tabungan');
    });
  },

  /* --- Modal: Wishlist --- */
  openWishlistModal(wishId = null) {
    const existing = wishId ? Store.state.wishlist.find((w) => w.id === wishId) : null;

    const html = `
      <form id="wishForm">
        <div class="form-group">
          <label class="form-label" for="wishName">Nama Barang / Keinginan</label>
          <input id="wishName" class="form-control" required placeholder="Contoh: Monitor Kerja 24 inch" value="${existing ? escapeHtml(existing.name) : ''}">
        </div>
        <div class="row-2">
          <div class="form-group">
            <label class="form-label" for="wishPrice">Estimasi Harga (Rp)</label>
            <input id="wishPrice" class="form-control num" type="number" inputmode="numeric" min="1" required placeholder="500000" value="${existing ? existing.price : ''}">
          </div>
          <div class="form-group">
            <label class="form-label" for="wishPriority">Prioritas</label>
            <select id="wishPriority" class="form-control">
              <option value="high" ${existing && existing.priority === 'high' ? 'selected' : ''}>Tinggi</option>
              <option value="medium" ${!existing || existing.priority === 'medium' ? 'selected' : ''}>Sedang</option>
              <option value="low" ${existing && existing.priority === 'low' ? 'selected' : ''}>Rendah</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="wishCategory">Kategori</label>
          <select id="wishCategory" class="form-control">
            ${EXPENSE_CATEGORIES.map((c) => `<option value="${escapeHtml(c.name)}" ${existing && existing.category === c.name ? 'selected' : ''}>${c.icon} ${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="wishNote">Catatan / Tautan</label>
          <textarea id="wishNote" class="form-control" placeholder="Contoh: Cek promo akhir bulan">${existing ? escapeHtml(existing.note) : ''}</textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-full">${existing ? 'Simpan Perubahan' : 'Tambahkan ke Wishlist'}</button>
      </form>
    `;

    this.openModal(existing ? 'Edit Wishlist' : 'Tambah Wishlist', html);

    const sheet = document.getElementById('modalSheet');
    sheet.querySelector('#wishForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const now = new Date().toISOString();
      const data = {
        name: sheet.querySelector('#wishName').value.trim(),
        price: Number(sheet.querySelector('#wishPrice').value) || 0,
        priority: sheet.querySelector('#wishPriority').value,
        category: sheet.querySelector('#wishCategory').value,
        note: sheet.querySelector('#wishNote').value.trim()
      };

      if (existing) {
        Object.assign(existing, data, { updatedAt: now, syncStatus: 'pending' });
      } else {
        Store.state.wishlist.push(Object.assign({
          id: uid('wish'),
          status: 'pending',
          updatedAt: now,
          deleted: false,
          syncStatus: 'pending'
        }, data));
      }

      Store.save();
      this.scheduleAutoSync();
      this.closeModal();
      this.showToast(existing ? 'Wishlist diperbarui' : 'Wishlist ditambahkan');
    });
  },

  fulfillWishlist(wishId) {
    const item = Store.state.wishlist.find((w) => w.id === wishId);
    if (!item) return;

    this.openConfirmSheet({
      title: 'Beli & Catat Pengeluaran?',
      message: `"${item.name}" (${formatRpFull(item.price)}) akan ditandai tercapai dan otomatis dicatat ke pengeluaran hari ini.`,
      confirmText: 'Ya, Catat',
      confirmClass: 'btn-primary',
      onConfirm: () => {
        const now = new Date().toISOString();
        item.status = 'achieved';
        item.updatedAt = now;
        item.syncStatus = 'pending';

        Store.state.transactions.push({
          id: uid('tx'),
          date: todayIso(),
          type: 'expense',
          category: item.category || 'Belanja',
          amount: Number(item.price) || 0,
          method: 'Transfer Bank',
          note: `Wishlist tercapai: ${item.name}`,
          updatedAt: now,
          deleted: false,
          syncStatus: 'pending'
        });

        Store.save();
        this.scheduleAutoSync();
        this.showToast(`"${item.name}" dicatat sebagai pengeluaran!`);
      }
    });
  },

  deleteWishlist(wishId) {
    const item = Store.state.wishlist.find((w) => w.id === wishId);
    if (!item) return;

    this.openConfirmSheet({
      title: 'Hapus Wishlist?',
      message: `Item "${item.name}" akan dihapus dari daftar wishlist Anda.`,
      confirmText: 'Ya, Hapus',
      onConfirm: () => {
        item.deleted = true;
        item.updatedAt = new Date().toISOString();
        item.syncStatus = 'pending';
        Store.save();
        this.scheduleAutoSync();
        this.showToast('Wishlist dihapus');
      }
    });
  },

  /* --- Modal: Pengaturan, Tema M3 Expressive & Cloud Sync --- */
  openSettingsModal() {
    const s = Store.state.settings;
    const pending = Store.getPendingCount();
    const lastSyncText = s.lastSyncAt
      ? new Date(s.lastSyncAt).toLocaleString('id-ID')
      : 'Belum pernah';

    const palettes = [
      { id: 'emerald', label: 'Emerald', color: '#0F766E' },
      { id: 'ocean', label: 'Ocean', color: '#0369A1' },
      { id: 'terracotta', label: 'Warm', color: '#B45309' },
      { id: 'olive', label: 'Olive', color: '#3F6212' }
    ];

    const html = `
      <div class="detail-kv-list">
        <div class="detail-kv">
          <span class="detail-kv-label">Status Jaringan</span>
          <span class="detail-kv-val" style="color:${navigator.onLine ? 'var(--income)' : 'var(--expense)'};">${navigator.onLine ? 'Online' : 'Offline'}</span>
        </div>
        <div class="detail-kv">
          <span class="detail-kv-label">Antrean Cloud</span>
          <span class="detail-kv-val num">${pending} perubahan</span>
        </div>
        <div class="detail-kv">
          <span class="detail-kv-label">Sync Terakhir</span>
          <span class="detail-kv-val">${escapeHtml(lastSyncText)}</span>
        </div>
      </div>

      ${Store.isGasEmbedded() ? `
        <div class="form-group">
          <div class="helper-text" style="color:var(--income);font-weight:700;">Terhubung langsung ke Google Apps Script (Mode Embedded).</div>
        </div>
      ` : `
        <div class="form-group">
          <label class="form-label" for="gasUrlInput">URL Web App Google Apps Script</label>
          <input id="gasUrlInput" class="form-control" type="url" placeholder="https://script.google.com/macros/s/.../exec" value="${escapeHtml(s.gasUrl || '')}">
        </div>
      `}

      <button type="button" class="btn btn-primary btn-full" id="saveAndSyncBtn" style="margin-bottom:14px;">
        Sinkronkan ke Google Sheets
      </button>

      <div class="form-group" style="border-top:1px solid var(--md-outline-variant);padding-top:12px;">
        <label class="form-label">Tema Warna Material 3 Expressive</label>
        <div class="palette-row" id="paletteRow">
          ${palettes.map((p) => `
            <button type="button" class="palette-chip ${(s.palette || 'emerald') === p.id ? 'active' : ''}" data-palette="${p.id}">
              <span class="palette-dot" style="background:${p.color};"></span>
              <span>${p.label}</span>
            </button>
          `).join('')}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">
        <button type="button" class="btn btn-tonal btn-full btn-sm" id="toggleThemeBtn">
          ${s.theme === 'dark' ? '☀️ Beralih ke Mode Terang' : '🌙 Beralih ke Mode Gelap'}
        </button>
        <div class="row-2">
          <button type="button" class="btn btn-secondary btn-sm" id="exportCsvBtn">Export CSV</button>
          <button type="button" class="btn btn-secondary btn-sm" id="exportJsonBtn">Backup JSON</button>
        </div>
      </div>
    `;

    this.openModal('Tema & Cloud Sync', html);

    const sheet = document.getElementById('modalSheet');

    sheet.querySelectorAll('#paletteRow .palette-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        Store.state.settings.palette = chip.dataset.palette;
        Store.save();
        this.applyTheme();
        this.openSettingsModal();
      });
    });

    sheet.querySelector('#saveAndSyncBtn').addEventListener('click', async () => {
      const urlInput = sheet.querySelector('#gasUrlInput');
      if (urlInput) {
        Store.state.settings.gasUrl = urlInput.value.trim();
        Store.save();
      }

      if (!navigator.onLine) {
        this.showToast('Perangkat offline — sync otomatis saat online');
        return;
      }

      if (!Store.canSync()) {
        this.showToast('Masukkan URL Web App Google Apps Script dulu');
        return;
      }

      this.showToast('Menyinkronkan ke Google Sheets...');
      const res = await Store.syncNow();
      if (res.ok) {
        this.showToast('Berhasil sinkronisasi dengan Google Sheets!');
        this.openSettingsModal();
      } else {
        this.showToast('Gagal sync: ' + (res.error || 'Periksa URL & izin Web App'));
      }
    });

    sheet.querySelector('#toggleThemeBtn').addEventListener('click', () => {
      Store.state.settings.theme = Store.state.settings.theme === 'dark' ? 'light' : 'dark';
      Store.save();
      this.applyTheme();
      this.openSettingsModal();
    });

    sheet.querySelector('#exportCsvBtn').addEventListener('click', () => this.exportCsv());
    sheet.querySelector('#exportJsonBtn').addEventListener('click', () => this.exportJson());
  },

  exportCsv() {
    const rows = [['Tanggal', 'Tipe', 'Kategori', 'Nominal', 'Metode', 'Catatan']];
    this.getActiveTransactions().forEach((t) => {
      rows.push([t.date, t.type, t.category, t.amount, t.method, `"${String(t.note || '').replace(/"/g, '""')}"`]);
    });
    const csv = rows.map((r) => r.join(',')).join('\n');
    this.downloadFile(`sakuku-transaksi-${todayIso()}.csv`, csv, 'text/csv;charset=utf-8;');
    this.showToast('File CSV diunduh');
  },

  exportJson() {
    const json = JSON.stringify(Store.state, null, 2);
    this.downloadFile(`sakuku-backup-${todayIso()}.json`, json, 'application/json');
    this.showToast('Backup JSON diunduh');
  },

  downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
