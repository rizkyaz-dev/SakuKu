/**
 * SakuKu Offline-First Storage & Cloud Sync Engine
 * - Menyimpan seluruh data di localStorage secara instan (0ms latency).
 * - Mengantrekan perubahan (syncStatus: 'pending') saat offline.
 * - Otomatis mengunggah & menyinkronkan ke Google Spreadsheets via Google Apps Script saat online.
 */

const STORAGE_KEY = 'sakuku_state_v1';

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function createSampleState() {
  const today = todayIso();
  const ym = today.slice(0, 7);
  const book1Id = 'book_darurat';
  const book2Id = 'book_liburan';
  const now = new Date().toISOString();

  return {
    transactions: [
      {
        id: 'tx_sample_1',
        date: `${ym}-01`,
        type: 'income',
        category: 'Gaji',
        amount: 6500000,
        method: 'Transfer Bank',
        note: 'Gaji bulanan',
        updatedAt: now,
        deleted: false,
        syncStatus: 'pending'
      },
      {
        id: 'tx_sample_2',
        date: `${ym}-03`,
        type: 'expense',
        category: 'Makan & Minum',
        amount: 45000,
        method: 'QRIS',
        note: 'Makan siang & kopi',
        updatedAt: now,
        deleted: false,
        syncStatus: 'pending'
      },
      {
        id: 'tx_sample_3',
        date: `${ym}-05`,
        type: 'expense',
        category: 'Tagihan',
        amount: 450000,
        method: 'Transfer Bank',
        note: 'Listrik & internet bulanan',
        updatedAt: now,
        deleted: false,
        syncStatus: 'pending'
      },
      {
        id: 'tx_sample_4',
        date: today,
        type: 'expense',
        category: 'Transportasi',
        amount: 35000,
        method: 'E-Wallet',
        note: 'Ojek online & bensin',
        updatedAt: now,
        deleted: false,
        syncStatus: 'pending'
      }
    ],
    savingsBooks: [
      {
        id: book1Id,
        name: 'Dana Darurat',
        target: 15000000,
        balance: 4500000,
        color: '#0F766E',
        note: 'Target 6x pengeluaran bulanan',
        updatedAt: now,
        deleted: false,
        syncStatus: 'pending'
      },
      {
        id: book2Id,
        name: 'Tabungan Liburan',
        target: 5000000,
        balance: 1250000,
        color: '#0284C7',
        note: 'Rencana akhir tahun',
        updatedAt: now,
        deleted: false,
        syncStatus: 'pending'
      }
    ],
    savingsLedger: [
      {
        id: 'ldg_sample_1',
        bookId: book1Id,
        date: `${ym}-01`,
        type: 'deposit',
        amount: 3500000,
        balanceAfter: 3500000,
        note: 'Saldo awal buku tabungan',
        updatedAt: now,
        deleted: false,
        syncStatus: 'pending'
      },
      {
        id: 'ldg_sample_2',
        bookId: book1Id,
        date: `${ym}-02`,
        type: 'deposit',
        amount: 1000000,
        balanceAfter: 4500000,
        note: 'Sisihkan dari gaji',
        updatedAt: now,
        deleted: false,
        syncStatus: 'pending'
      },
      {
        id: 'ldg_sample_3',
        bookId: book2Id,
        date: `${ym}-02`,
        type: 'deposit',
        amount: 1250000,
        balanceAfter: 1250000,
        note: 'Setoran awal liburan',
        updatedAt: now,
        deleted: false,
        syncStatus: 'pending'
      }
    ],
    wishlist: [
      {
        id: 'wish_sample_1',
        name: 'Earphone Wireless ANC',
        price: 850000,
        priority: 'medium',
        category: 'Belanja',
        status: 'pending',
        note: 'Untuk fokus kerja & perjalanan',
        updatedAt: now,
        deleted: false,
        syncStatus: 'pending'
      },
      {
        id: 'wish_sample_2',
        name: 'Sepatu Lari Harian',
        price: 1200000,
        priority: 'high',
        category: 'Kesehatan',
        status: 'pending',
        note: 'Tunggu promo tanggal kembar',
        updatedAt: now,
        deleted: false,
        syncStatus: 'pending'
      }
    ],
    settings: {
      gasUrl: '',
      theme: 'light',
      palette: 'emerald',
      lastSyncAt: ''
    }
  };
}

const Store = {
  state: null,
  isSyncing: false,
  listeners: [],

  init() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.state = {
          transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
          savingsBooks: Array.isArray(parsed.savingsBooks) ? parsed.savingsBooks : [],
          savingsLedger: Array.isArray(parsed.savingsLedger) ? parsed.savingsLedger : [],
          wishlist: Array.isArray(parsed.wishlist) ? parsed.wishlist : [],
          settings: Object.assign({ gasUrl: '', theme: 'light', palette: 'emerald', lastSyncAt: '' }, parsed.settings || {})
        };
      } else {
        this.state = createSampleState();
        this.save();
      }
    } catch (e) {
      this.state = createSampleState();
      this.save();
    }
    return this.state;
  },

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.error('Gagal menyimpan ke localStorage:', e);
    }
    this.notify();
  },

  subscribe(fn) {
    this.listeners.push(fn);
  },

  notify() {
    this.listeners.forEach((fn) => fn(this.state));
  },

  getPendingCount() {
    const s = this.state;
    const countPending = (arr) => arr.filter((x) => x.syncStatus === 'pending').length;
    return (
      countPending(s.transactions) +
      countPending(s.savingsBooks) +
      countPending(s.savingsLedger) +
      countPending(s.wishlist)
    );
  },

  isGasEmbedded() {
    return typeof google !== 'undefined' && google.script && google.script.run;
  },

  canSync() {
    return navigator.onLine && (this.isGasEmbedded() || Boolean(this.state.settings.gasUrl));
  },

  /**
   * Sinkronisasi dua arah: kirim data pending ke Google Sheets & ambil data terbaru
   */
  async syncNow(silent = false) {
    if (this.isSyncing) return { ok: false, reason: 'busy' };
    if (!navigator.onLine) return { ok: false, reason: 'offline' };
    if (!this.isGasEmbedded() && !this.state.settings.gasUrl) {
      return { ok: false, reason: 'no_url' };
    }

    this.isSyncing = true;
    this.notify();

    const payload = {
      transactions: this.state.transactions.filter((x) => x.syncStatus === 'pending'),
      savingsBooks: this.state.savingsBooks.filter((x) => x.syncStatus === 'pending'),
      savingsLedger: this.state.savingsLedger.filter((x) => x.syncStatus === 'pending'),
      wishlist: this.state.wishlist.filter((x) => x.syncStatus === 'pending')
    };

    try {
      let result;
      if (this.isGasEmbedded()) {
        result = await new Promise((resolve, reject) => {
          google.script.run
            .withSuccessHandler(resolve)
            .withFailureHandler(reject)
            .syncFromClient(payload);
        });
      } else {
        const res = await fetch(this.state.settings.gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });
        result = await res.json();
      }

      if (!result || !result.ok) {
        throw new Error((result && result.error) || 'Respons server tidak valid');
      }

      this.mergeServerData(result.data);
      this.state.settings.lastSyncAt = result.serverTime || new Date().toISOString();
      this.save();

      this.isSyncing = false;
      this.notify();
      return { ok: true };
    } catch (err) {
      this.isSyncing = false;
      this.notify();
      if (!silent) console.error('Sync gagal:', err);
      return { ok: false, error: err.message || 'Gagal terhubung ke Google Sheets' };
    }
  },

  mergeServerData(serverData) {
    if (!serverData) return;

    const mergeList = (localArr, remoteArr) => {
      const map = new Map();
      localArr.forEach((item) => {
        map.set(item.id, Object.assign({}, item, { syncStatus: 'synced' }));
      });
      (remoteArr || []).forEach((rItem) => {
        const existing = map.get(rItem.id);
        if (!existing || String(rItem.updatedAt || '') >= String(existing.updatedAt || '')) {
          map.set(rItem.id, Object.assign({}, rItem, { syncStatus: 'synced' }));
        }
      });
      return Array.from(map.values());
    };

    this.state.transactions = mergeList(this.state.transactions, serverData.transactions);
    this.state.savingsBooks = mergeList(this.state.savingsBooks, serverData.savingsBooks);
    this.state.savingsLedger = mergeList(this.state.savingsLedger, serverData.savingsLedger);
    this.state.wishlist = mergeList(this.state.wishlist, serverData.wishlist);
  }
};
