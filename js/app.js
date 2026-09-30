/**
 * Life ROI Tracker - メインロジック & UIコントローラー
 */

class LifeRoiApp {
  constructor() {
    this.categories = [];
    this.logs = [];
    this.activeTimer = null;
    this.timerInterval = null;
    this.currentPeriod = "7d"; // 'today', '7d', '30d', 'all'
    this.matrixXAxis = "time";
    this.matrixYAxis = "total";
    this.chartManager = new ChartManager();

    // 同期関連
    this.firebaseApp = null;
    this.firestoreDb = null;
    this.syncDocUnsubscribe = null;
    this.isCloudSyncActive = false;

    // 週間タイムライン関連
    this.weekOffset = 0; // 0: 今週, -1: 前週, +1: 翌週...

    this.init();
  }

  // ログの形式を正規化 (date, startTime, endTimeを補完)
  normalizeLog(log) {
    if (!log) return log;
    const duration = log.durationMinutes || 30;

    let timestamp = log.timestamp;
    if (!timestamp) {
      timestamp = new Date().toISOString();
      log.timestamp = timestamp;
    }

    const d = new Date(timestamp);
    const pad = (n) => String(n).padStart(2, "0");

    if (!log.date) {
      log.date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    if (!log.startTime || !log.endTime) {
      const endHour = d.getHours();
      const endMin = d.getMinutes();
      const endTotalMin = endHour * 60 + endMin;
      const startTotalMin = Math.max(0, endTotalMin - duration);

      const startH = Math.floor(startTotalMin / 60) % 24;
      const startM = startTotalMin % 60;

      if (!log.startTime) log.startTime = `${pad(startH)}:${pad(startM)}`;
      if (!log.endTime) log.endTime = `${pad(endHour)}:${pad(endMin)}`;
    }

    return log;
  }

  init() {
    this.loadData();
    this.bindEvents();
    this.initCloudSyncIfConfigured();
    this.renderAll();
    this.checkPersistedTimer();
  }

  // =========================================================================
  // データの永続化 & 初期化
  // =========================================================================
  loadData() {
    const hasInit = localStorage.getItem("liferoi_initialized");

    // カテゴリ読み込み
    const savedCats = localStorage.getItem("liferoi_categories");
    if (savedCats) {
      try {
        this.categories = JSON.parse(savedCats);
      } catch (e) {
        this.categories = [...DEFAULT_CATEGORIES];
      }
    } else {
      this.categories = [...DEFAULT_CATEGORIES];
      this.saveCategories();
    }

    // ログ読み込み
    const savedLogs = localStorage.getItem("liferoi_logs");
    if (savedLogs !== null) {
      try {
        const rawLogs = JSON.parse(savedLogs);
        this.logs = (Array.isArray(rawLogs) ? rawLogs : []).map(l => this.normalizeLog(l));
      } catch (e) {
        this.logs = [];
        this.saveLogs();
      }
    } else if (!hasInit) {
      // 完全な初回アクセス時のみサンプルデータを投入
      this.logs = generateSampleLogs().map(l => this.normalizeLog(l));
      this.saveLogs();
      localStorage.setItem("liferoi_initialized", "true");
    } else {
      this.logs = [];
    }
  }

  saveCategories() {
    localStorage.setItem("liferoi_categories", JSON.stringify(this.categories));
    this.triggerCloudSyncPush();
  }

  saveLogs() {
    localStorage.setItem("liferoi_logs", JSON.stringify(this.logs));
    localStorage.setItem("liferoi_initialized", "true");
    this.triggerCloudSyncPush();
  }

  resetToSampleData() {
    if (confirm("サンプルデータを再読み込みしますか？現在の記録はサンプルデータで置き換えられます。")) {
      this.categories = [...DEFAULT_CATEGORIES];
      this.logs = generateSampleLogs();
      this.saveCategories();
      this.saveLogs();
      this.renderAll();
      this.showToast("サンプルデータを再読み込みしました ✨");
    }
  }

  clearAllData() {
    if (confirm("すべての行動記録を削除して空にしますか？この操作は取り消せません。")) {
      this.logs = [];
      this.saveLogs();
      this.renderAll();
      this.showToast("すべての記録を削除し、空にしました 🗑️");
    }
  }

  // =========================================================================
  // スマホ ⇄ PC 同期機能 (手動 & クラウド)
  // =========================================================================
  openSyncModal() {
    // 既存設定の復元
    const savedKey = localStorage.getItem("liferoi_sync_key") || "";
    const savedConfig = localStorage.getItem("liferoi_firebase_config") || "";
    const keyInput = document.getElementById("syncSecretKey");
    const configInput = document.getElementById("firebaseConfigInput");
    if (keyInput) keyInput.value = savedKey;
    if (configInput) configInput.value = savedConfig;

    const disconnectBtn = document.getElementById("disconnectCloudBtn");
    if (disconnectBtn) {
      disconnectBtn.style.display = this.isCloudSyncActive ? "inline-block" : "none";
    }

    document.getElementById("syncModal").classList.add("open");
  }

  closeSyncModal() {
    document.getElementById("syncModal").classList.remove("open");
  }

  switchSyncTab(tab) {
    const manualSec = document.getElementById("manualSyncSection");
    const cloudSec = document.getElementById("cloudSyncSection");
    const manualBtn = document.getElementById("tabBtnManualSync");
    const cloudBtn = document.getElementById("tabBtnCloudSync");

    if (tab === "manual") {
      manualSec.style.display = "block";
      cloudSec.style.display = "none";
      manualBtn.className = "btn btn-primary btn-sm";
      cloudBtn.className = "btn btn-secondary btn-sm";
    } else {
      manualSec.style.display = "none";
      cloudSec.style.display = "block";
      manualBtn.className = "btn btn-secondary btn-sm";
      cloudBtn.className = "btn btn-primary btn-sm";
    }
  }

  // ① かんたん手動同期（クリップボードコピー＆取り込み）
  copySyncData() {
    const payload = {
      version: 1,
      timestamp: new Date().toISOString(),
      categories: this.categories,
      logs: this.logs
    };
    const jsonStr = JSON.stringify(payload);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(jsonStr).then(() => {
        this.showToast("データをクリップボードにコピーしました！📋 他端末にペーストしてください");
      }).catch(() => {
        prompt("以下のデータを全選択してコピーしてください:", jsonStr);
      });
    } else {
      prompt("以下のデータを全選択してコピーしてください:", jsonStr);
    }
  }

  importSyncData() {
    const text = document.getElementById("importSyncText").value.trim();
    if (!text) {
      alert("コピーしたデータを貼り付けてください。");
      return;
    }

    try {
      const data = JSON.parse(text);
      if (!Array.isArray(data.logs) || !Array.isArray(data.categories)) {
        throw new Error("無効なデータ形式です");
      }

      if (confirm(`データを取り込みますか？\n・行動記録: ${data.logs.length}件\n・項目数: ${data.categories.length}個`)) {
        this.categories = data.categories;
        this.logs = data.logs;
        this.saveCategories();
        this.saveLogs();
        this.renderAll();
        document.getElementById("importSyncText").value = "";
        this.closeSyncModal();
        this.showToast("他端末のデータを取り込み、同期しました！✨");
      }
    } catch (e) {
      alert("データの解析に失敗しました。正しいデータ形式かご確認ください。");
    }
  }

  // ② Firebase による全自動クラウド同期
  initCloudSyncIfConfigured() {
    const savedKey = localStorage.getItem("liferoi_sync_key");
    const savedConfig = localStorage.getItem("liferoi_firebase_config");
    if (savedKey && savedConfig) {
      this.connectCloudSync(true);
    }
  }

  connectCloudSync(isSilent = false) {
    const key = document.getElementById("syncSecretKey")?.value.trim() || localStorage.getItem("liferoi_sync_key");
    const configRaw = document.getElementById("firebaseConfigInput")?.value.trim() || localStorage.getItem("liferoi_firebase_config");

    if (!key) {
      if (!isSilent) alert("同期キー（合言葉）を入力してください。");
      return;
    }
    if (!configRaw) {
      if (!isSilent) alert("Firebaseの設定を入力してください。");
      return;
    }

    try {
      let configObj;
      if (configRaw.includes("{")) {
        const jsonMatch = configRaw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          configObj = JSON.parse(jsonMatch[0]);
        }
      }
      if (!configObj) throw new Error("設定コードを読み取れませんでした");

      if (window.firebase) {
        if (!firebase.apps.length) {
          this.firebaseApp = firebase.initializeApp(configObj);
        } else {
          this.firebaseApp = firebase.app();
        }
        this.firestoreDb = firebase.firestore();

        localStorage.setItem("liferoi_sync_key", key);
        localStorage.setItem("liferoi_firebase_config", JSON.stringify(configObj));

        // リアルタイムリスナー開始
        this.startCloudSyncListener(key);
        this.isCloudSyncActive = true;
        this.updateSyncStatusUI();

        if (!isSilent) {
          this.closeSyncModal();
          this.showToast("☁️ クラウド自動同期に接続しました！");
        }
      }
    } catch (e) {
      if (!isSilent) alert("Firebaseへの接続に失敗しました: " + e.message);
    }
  }

  startCloudSyncListener(secretKey) {
    if (!this.firestoreDb) return;
    if (this.syncDocUnsubscribe) this.syncDocUnsubscribe();

    const docRef = this.firestoreDb.collection("liferoi_vault").doc(secretKey);

    this.syncDocUnsubscribe = docRef.onSnapshot(doc => {
      if (doc.exists) {
        const data = doc.data();
        if (data && data.updatedAt) {
          const remoteTime = new Date(data.updatedAt).getTime();
          const localTime = parseInt(localStorage.getItem("liferoi_last_sync") || "0", 10);

          if (remoteTime > localTime) {
            // クラウドの方が新しい場合は反映
            if (data.categories) this.categories = data.categories;
            if (data.logs) this.logs = data.logs;
            localStorage.setItem("liferoi_categories", JSON.stringify(this.categories));
            localStorage.setItem("liferoi_logs", JSON.stringify(this.logs));
            localStorage.setItem("liferoi_last_sync", String(remoteTime));
            this.renderAll();
            this.showToast("☁️ クラウドから最新データを同期しました");
          }
        }
      } else {
        // クラウドにまだデータがない場合は初期アップロード
        this.triggerCloudSyncPush();
      }
    }, err => {
      console.warn("Sync listener warning:", err);
    });
  }

  triggerCloudSyncPush() {
    if (!this.isCloudSyncActive || !this.firestoreDb) return;
    const key = localStorage.getItem("liferoi_sync_key");
    if (!key) return;

    const now = Date.now();
    localStorage.setItem("liferoi_last_sync", String(now));

    this.firestoreDb.collection("liferoi_vault").doc(key).set({
      categories: this.categories,
      logs: this.logs,
      updatedAt: new Date(now).toISOString()
    }, { merge: true }).catch(err => {
      console.warn("Cloud push failed:", err);
    });
  }

  disconnectCloudSync() {
    if (confirm("クラウド同期を解除しますか？ローカルのデータはそのまま残ります。")) {
      if (this.syncDocUnsubscribe) this.syncDocUnsubscribe();
      this.isCloudSyncActive = false;
      localStorage.removeItem("liferoi_sync_key");
      this.updateSyncStatusUI();
      this.closeSyncModal();
      this.showToast("クラウド同期を解除しました");
    }
  }

  updateSyncStatusUI() {
    const btn = document.getElementById("syncStatusBtn");
    if (!btn) return;
    if (this.isCloudSyncActive) {
      btn.innerHTML = "☁️ 同期中 🟢";
      btn.classList.add("btn-success");
      btn.classList.remove("btn-secondary");
    } else {
      btn.innerHTML = "☁️ 端末同期";
      btn.classList.remove("btn-success");
      btn.classList.add("btn-secondary");
    }
  }

  // =========================================================================
  // タイマー機能 (ワンタップ計測)
  // =========================================================================
  startTimer(categoryId) {
    if (this.activeTimer) {
      if (this.activeTimer.categoryId === categoryId) {
        // 同じカテゴリを再度タップした場合は完了モーダルへ
        this.promptCompleteTimer();
        return;
      }
      if (!confirm("別のタイマーが稼働中です。現在のタイマーを終了して新しい活動を開始しますか？")) {
        return;
      }
      this.stopTimerInternal(false);
    }

    const cat = this.categories.find(c => c.id === categoryId);
    if (!cat) return;

    this.activeTimer = {
      categoryId: cat.id,
      categoryName: cat.name,
      categoryIcon: cat.icon,
      startTime: Date.now(),
      elapsedSeconds: 0,
      isPaused: false,
      lastTick: Date.now()
    };

    localStorage.setItem("liferoi_active_timer", JSON.stringify(this.activeTimer));
    this.startTimerTicker();
    this.updateTimerUI();
    this.renderActivityCards();
    this.showToast(`「${cat.name}」の計測を開始しました ⏱`);
  }

  startTimerTicker() {
    clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (!this.activeTimer || this.activeTimer.isPaused) return;

      const now = Date.now();
      const deltaSec = Math.floor((now - this.activeTimer.lastTick) / 1000);
      if (deltaSec >= 1) {
        this.activeTimer.elapsedSeconds += deltaSec;
        this.activeTimer.lastTick = now;
        this.updateTimerDisplay();
        // 定期的に状態保存
        if (this.activeTimer.elapsedSeconds % 10 === 0) {
          localStorage.setItem("liferoi_active_timer", JSON.stringify(this.activeTimer));
        }
      }
    }, 500);
  }

  togglePauseTimer() {
    if (!this.activeTimer) return;
    this.activeTimer.isPaused = !this.activeTimer.isPaused;
    if (!this.activeTimer.isPaused) {
      this.activeTimer.lastTick = Date.now();
    }
    localStorage.setItem("liferoi_active_timer", JSON.stringify(this.activeTimer));
    this.updateTimerUI();
  }

  promptCompleteTimer() {
    if (!this.activeTimer) return;
    const cat = this.categories.find(c => c.id === this.activeTimer.categoryId);
    const elapsedMinutes = Math.max(1, Math.round(this.activeTimer.elapsedSeconds / 60));

    const startDate = new Date(this.activeTimer.startTime);
    const endDate = new Date();
    const pad = (n) => String(n).padStart(2, "0");

    this.openLogModal({
      categoryId: cat.id,
      title: cat.name,
      date: `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}`,
      startTime: `${pad(startDate.getHours())}:${pad(startDate.getMinutes())}`,
      endTime: `${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`,
      durationMinutes: elapsedMinutes,
      cost: cat.defaultCost || 0,
      rating: 4,
      note: ""
    }, true);
  }

  cancelTimer() {
    if (confirm("現在の計測を破棄しますか？")) {
      this.stopTimerInternal(false);
      this.showToast("タイマーをキャンセルしました");
    }
  }

  stopTimerInternal(saveActiveState = false) {
    clearInterval(this.timerInterval);
    this.activeTimer = null;
    localStorage.removeItem("liferoi_active_timer");
    this.updateTimerUI();
    this.renderActivityCards();
  }

  checkPersistedTimer() {
    const saved = localStorage.getItem("liferoi_active_timer");
    if (saved) {
      try {
        this.activeTimer = JSON.parse(saved);
        if (!this.activeTimer.isPaused) {
          const now = Date.now();
          const extra = Math.floor((now - this.activeTimer.lastTick) / 1000);
          this.activeTimer.elapsedSeconds += Math.max(0, extra);
          this.activeTimer.lastTick = now;
        }
        this.startTimerTicker();
        this.updateTimerUI();
        this.renderActivityCards();
      } catch (e) {
        localStorage.removeItem("liferoi_active_timer");
      }
    }
  }

  updateTimerUI() {
    const banner = document.getElementById("activeTimerBar");
    if (!this.activeTimer) {
      banner.classList.remove("running");
      banner.style.display = "none";
      return;
    }

    banner.classList.add("running");
    banner.style.display = "flex";

    const cat = this.categories.find(c => c.id === this.activeTimer.categoryId);
    document.getElementById("timerCategoryTitle").innerHTML = `${cat.icon} ${cat.name}`;
    document.getElementById("timerRatesBadge").innerHTML = `
      <span>🚀 成長: +${cat.growthRate}pt/h</span>
      <span>✨ 幸福: +${cat.happinessRate}pt/h</span>
    `;

    const pauseBtn = document.getElementById("timerPauseBtn");
    pauseBtn.innerHTML = this.activeTimer.isPaused ? "▶ 再開" : "⏸ 一時停止";

    this.updateTimerDisplay();
  }

  updateTimerDisplay() {
    if (!this.activeTimer) return;
    const totalSec = this.activeTimer.elapsedSeconds;
    const hrs = String(Math.floor(totalSec / 3600)).padStart(2, "0");
    const mins = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
    const secs = String(totalSec % 60).padStart(2, "0");
    document.getElementById("timerDisplay").innerText = `${hrs}:${mins}:${secs}`;
  }

  // =========================================================================
  // 記録 & ポイント計算モーダル
  // =========================================================================
  openLogModal(initialData = {}, isFromActiveTimer = false) {
    const targetCatId = initialData.categoryId || (this.categories[0] ? this.categories[0].id : "");
    this.pendingCompletion = {
      ...initialData,
      categoryId: targetCatId,
      isFromActiveTimer
    };
    this.selectedRating = initialData.rating || 4;

    const modal = document.getElementById("logModal");
    const catSelect = document.getElementById("logCategorySelect");

    // カテゴリオプション生成
    catSelect.innerHTML = this.categories.map(c => `
      <option value="${c.id}" ${c.id === targetCatId ? "selected" : ""}>
        ${c.icon} ${c.name}
      </option>
    `).join("");

    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    const dateVal = initialData.date || todayStr;
    const duration = initialData.durationMinutes || 30;

    let startVal = initialData.startTime;
    let endVal = initialData.endTime;

    if (!startVal || !endVal) {
      const endTotalMin = now.getHours() * 60 + now.getMinutes();
      const startTotalMin = Math.max(0, endTotalMin - duration);
      const startH = Math.floor(startTotalMin / 60) % 24;
      const startM = startTotalMin % 60;

      if (!startVal) startVal = `${pad(startH)}:${pad(startM)}`;
      if (!endVal) endVal = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }

    const dateInput = document.getElementById("logDateInput");
    const startInput = document.getElementById("logStartTimeInput");
    const endInput = document.getElementById("logEndTimeInput");
    const minInput = document.getElementById("logMinutesInput");

    if (dateInput) dateInput.value = dateVal;
    if (startInput) startInput.value = startVal;
    if (endInput) endInput.value = endVal;
    if (minInput) minInput.value = duration;

    document.getElementById("logCostInput").value = initialData.cost !== undefined ? initialData.cost : 0;
    document.getElementById("logNoteInput").value = initialData.note || "";

    this.updateRatingStarsUI();
    this.recalculateModalPoints();

    modal.classList.add("open");
  }

  closeLogModal() {
    document.getElementById("logModal").classList.remove("open");
    this.pendingCompletion = null;
  }

  setRating(rating) {
    this.selectedRating = rating;
    this.updateRatingStarsUI();
    this.recalculateModalPoints();
  }

  updateRatingStarsUI() {
    const buttons = document.querySelectorAll(".rating-star-btn");
    buttons.forEach(btn => {
      const r = parseInt(btn.dataset.rating, 10);
      btn.classList.toggle("selected", r === this.selectedRating);
    });

    const descMap = {
      1: "★☆☆☆☆ (不完全燃焼・気分乗らず: ×0.2)",
      2: "★★☆☆☆ (やや微妙・途切れがち: ×0.6)",
      3: "★★★☆☆ (標準的・日常通り: ×1.0)",
      4: "★★★★☆ (充実・集中できた: ×1.5)",
      5: "★★★★★ (最高！超充実・ゾーン体験: ×2.0)"
    };
    document.getElementById("ratingDesc").innerText = descMap[this.selectedRating];
  }

  recalculateModalPoints(forceReset = false) {
    const catId = document.getElementById("logCategorySelect").value;
    const minutes = parseFloat(document.getElementById("logMinutesInput").value) || 0;
    const cat = this.categories.find(c => c.id === catId);
    if (!cat) return;

    const multiplier = RATING_MULTIPLIERS[this.selectedRating] || 1.0;
    const hours = minutes / 60;
    const calcHappiness = Math.round(hours * cat.happinessRate * multiplier * 10) / 10;
    const calcGrowth = Math.round(hours * cat.growthRate * multiplier * 10) / 10;

    const growthInput = document.getElementById("previewGrowthInput");
    const happinessInput = document.getElementById("previewHappinessInput");

    if (growthInput) {
      growthInput.value = calcGrowth;
    }
    if (happinessInput) {
      happinessInput.value = calcHappiness;
    }

    if (forceReset) {
      this.showToast("ポイントを自動計算値にリセットしました 🔄");
    }
  }

  saveLogFromModal() {
    const catId = document.getElementById("logCategorySelect").value;
    const minutes = parseInt(document.getElementById("logMinutesInput").value, 10) || 0;
    const cost = parseInt(document.getElementById("logCostInput").value, 10) || 0;
    const note = document.getElementById("logNoteInput").value.trim();

    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    const dateVal = document.getElementById("logDateInput")?.value || todayStr;
    const startTimeVal = document.getElementById("logStartTimeInput")?.value || "12:00";
    const endTimeVal = document.getElementById("logEndTimeInput")?.value || "12:30";

    if (minutes <= 0) {
      alert("時間は1分以上を入力してください。");
      return;
    }

    const cat = this.categories.find(c => c.id === catId);
    const multiplier = RATING_MULTIPLIERS[this.selectedRating] || 1.0;
    const hours = minutes / 60;
    const defaultHappiness = Math.round(hours * cat.happinessRate * multiplier * 10) / 10;
    const defaultGrowth = Math.round(hours * cat.growthRate * multiplier * 10) / 10;

    // 手動入力値を取得（無効値なら自動計算値を採用）
    const inputGrowthVal = parseFloat(document.getElementById("previewGrowthInput")?.value);
    const inputHappinessVal = parseFloat(document.getElementById("previewHappinessInput")?.value);

    const growthPoints = !isNaN(inputGrowthVal) && inputGrowthVal >= 0 ? Math.round(inputGrowthVal * 10) / 10 : defaultGrowth;
    const happinessPoints = !isNaN(inputHappinessVal) && inputHappinessVal >= 0 ? Math.round(inputHappinessVal * 10) / 10 : defaultHappiness;

    // 正確なタイムスタンプ生成
    let timestamp = new Date().toISOString();
    try {
      const parsedTime = new Date(`${dateVal}T${startTimeVal}:00`);
      if (!isNaN(parsedTime.getTime())) {
        timestamp = parsedTime.toISOString();
      }
    } catch (e) {}

    const newLog = {
      id: "log_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
      categoryId: cat.id,
      title: cat.name,
      date: dateVal,
      startTime: startTimeVal,
      endTime: endTimeVal,
      durationMinutes: minutes,
      cost,
      rating: this.selectedRating,
      happinessPoints,
      growthPoints,
      timestamp,
      note
    };

    this.logs.unshift(newLog);
    this.saveLogs();

    if (this.pendingCompletion && this.pendingCompletion.isFromActiveTimer) {
      this.stopTimerInternal(false);
    }

    this.closeLogModal();
    this.renderAll();
    this.showToast(`✨ ${cat.name} (${startTimeVal}〜${endTimeVal}) を記録しました！ (+${happinessPoints}幸福 / +${growthPoints}成長)`);
  }

  deleteLog(logId) {
    if (confirm("この記録を削除しますか？")) {
      this.logs = this.logs.filter(l => l.id !== logId);
      this.saveLogs();
      this.renderAll();
      this.showToast("記録を削除しました");
    }
  }

  // =========================================================================
  // フィルタリング & KPI集計
  // =========================================================================
  getFilteredLogs() {
    if (this.currentPeriod === "all") return this.logs;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    let thresholdTime = 0;
    if (this.currentPeriod === "today") {
      thresholdTime = startOfToday;
    } else if (this.currentPeriod === "7d") {
      thresholdTime = startOfToday - (6 * 24 * 60 * 60 * 1000);
    } else if (this.currentPeriod === "30d") {
      thresholdTime = startOfToday - (29 * 24 * 60 * 60 * 1000);
    }

    return this.logs.filter(l => new Date(l.timestamp).getTime() >= thresholdTime);
  }

  renderKPIs(filteredLogs) {
    let totalMinutes = 0;
    let totalCost = 0;
    let totalHappiness = 0;
    let totalGrowth = 0;

    filteredLogs.forEach(log => {
      totalMinutes += log.durationMinutes || 0;
      totalCost += log.cost || 0;
      totalHappiness += log.happinessPoints || 0;
      totalGrowth += log.growthPoints || 0;
    });

    const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
    const totalPoints = Math.round((totalHappiness + totalGrowth) * 10) / 10;

    // ROI 計算: 1時間あたり総合pt & 1000円あたり総合pt
    const timeROI = totalHours > 0 ? (totalPoints / totalHours).toFixed(1) : "0.0";
    const costROI = totalCost > 0 ? ((totalPoints / totalCost) * 1000).toFixed(1) : "—";

    document.getElementById("kpiTotalTime").innerText = `${totalHours}h`;
    document.getElementById("kpiTotalTimeSub").innerText = `${totalMinutes}分 投資`;

    document.getElementById("kpiTotalCost").innerText = `¥${totalCost.toLocaleString()}`;
    document.getElementById("kpiTotalCostSub").innerText = `自己投資支出`;

    document.getElementById("kpiGrowthPt").innerText = `+${Math.round(totalGrowth)}`;
    document.getElementById("kpiGrowthPtSub").innerText = `スキル・自己研鑽`;

    document.getElementById("kpiHappinessPt").innerText = `+${Math.round(totalHappiness)}`;
    document.getElementById("kpiHappinessPtSub").innerText = `心の充足・リフレッシュ`;

    document.getElementById("kpiRoiScore").innerText = `${timeROI} pt/h`;
    document.getElementById("kpiRoiSub").innerText = totalCost > 0 ? `費用対: ${costROI} pt/1千円` : `時間効率最重視`;
  }

  // =========================================================================
  // UIレンダリング
  // =========================================================================
  renderAll() {
    const filteredLogs = this.getFilteredLogs();
    this.renderKPIs(filteredLogs);
    this.renderActivityCards();
    this.renderWeeklyTimeline();
    this.renderCharts(filteredLogs);
    this.renderLogsList(filteredLogs);
  }

  // 週間24時間アクティビティ タイムテーブル描画
  navigateWeek(delta) {
    if (delta === 0) {
      this.weekOffset = 0;
    } else {
      this.weekOffset += delta;
    }
    this.renderWeeklyTimeline();
  }

  renderWeeklyTimeline() {
    const grid = document.getElementById("weeklyTimelineGrid");
    const label = document.getElementById("weeklyDateRangeLabel");
    if (!grid) return;

    const pad = (n) => String(n).padStart(2, "0");
    const now = new Date();
    // 基準日 (今週 + weekOffset * 7日)
    const baseDate = new Date(now.getTime() + this.weekOffset * 7 * 86400000);

    // 月曜日を週の起点とする
    const dayOfWeek = baseDate.getDay(); // 0(日)〜6(土)
    const diffToMonday = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek;
    const monday = new Date(baseDate);
    monday.setDate(baseDate.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const weekDays = [];
    const dayNames = ["月", "火", "水", "木", "金", "土", "日"];
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const isToday = (dateStr === todayStr);

      weekDays.push({
        date: d,
        dateStr,
        dayName: dayNames[i],
        isToday,
        logs: []
      });
    }

    // 期間ラベルの更新
    if (label) {
      const first = weekDays[0].date;
      const last = weekDays[6].date;
      label.innerText = `${first.getFullYear()}年 ${first.getMonth() + 1}/${first.getDate()}(月) 〜 ${last.getMonth() + 1}/${last.getDate()}(日)${this.weekOffset === 0 ? " 【今週】" : ""}`;
    }

    // ログを日付ごとにマッピング
    this.logs.forEach(rawLog => {
      const log = this.normalizeLog(rawLog);
      const targetDay = weekDays.find(w => w.dateStr === log.date);
      if (targetDay) {
        targetDay.logs.push(log);
      }
    });

    // HTMLの構築
    // 1. 左端の時間軸カラム (0:00 〜 24:00、3時間刻み)
    let html = `<div class="weekly-time-axis">`;
    const hoursMark = [0, 3, 6, 9, 12, 15, 18, 21, 24];
    hoursMark.forEach(h => {
      const topPct = (h / 24) * 100;
      html += `<div class="weekly-time-label" style="top:${topPct}%;">${pad(h)}:00</div>`;
    });
    html += `</div>`;

    // 2. 7つの曜日カラム
    weekDays.forEach(day => {
      const totalMin = day.logs.reduce((sum, l) => sum + (l.durationMinutes || 0), 0);
      const totalHours = Math.round((totalMin / 60) * 10) / 10;

      html += `
        <div class="weekly-day-col ${day.isToday ? "is-today" : ""}">
          <div class="weekly-col-header">
            <div class="weekly-col-dayname ${day.isToday ? "today-text" : ""}">${day.dayName}曜日</div>
            <div class="weekly-col-date ${day.isToday ? "today-text" : ""}">${day.date.getMonth() + 1}/${day.date.getDate()}</div>
            ${totalHours > 0 ? `<div style="font-size:0.68rem; color:var(--text-muted); font-weight:700; margin-top:2px;">⏱ ${totalHours}h</div>` : ""}
          </div>
      `;

      // 3時間ごとの横ガイドライン
      hoursMark.forEach(h => {
        const topPct = (h / 24) * 100;
        html += `<div class="weekly-hour-line ${h % 6 === 0 ? "major" : ""}" style="top:${topPct}%;"></div>`;
      });

      // イベントブロックの配置
      day.logs.forEach(log => {
        const cat = this.categories.find(c => c.id === log.categoryId) || { color: "#8b5cf6", icon: "📝" };
        const timeParts = (log.startTime || "12:00").split(":");
        const startH = parseInt(timeParts[0], 10) || 0;
        const startM = parseInt(timeParts[1], 10) || 0;
        const startTotalMin = startH * 60 + startM;
        const duration = log.durationMinutes || 30;

        const topPercent = (startTotalMin / 1440) * 100;
        const heightPercent = Math.max(3.2, (duration / 1440) * 100);

        const bgColor = cat.color + "33"; // 20% opacity
        const borderColor = cat.color;

        html += `
          <div class="timeline-event-block" 
               style="top:${topPercent}%; height:${heightPercent}%; background:${bgColor}; border-color:${borderColor};"
               onclick="app.showEventDetails('${log.id}')"
               title="${log.title}\n時間: ${log.startTime} 〜 ${log.endTime} (${duration}分)\n成長: +${log.growthPoints}pt / 幸福: +${log.happinessPoints}pt">
            <div class="timeline-block-time" style="color:${cat.color};">${log.startTime} - ${log.endTime}</div>
            <div class="timeline-block-title">${cat.icon} ${log.title}</div>
            ${heightPercent >= 5.5 ? `
              <div class="timeline-block-pts">
                <span>🚀+${log.growthPoints}</span> <span>✨+${log.happinessPoints}</span>
              </div>
            ` : ""}
          </div>
        `;
      });

      html += `</div>`;
    });

    grid.innerHTML = html;
  }

  showEventDetails(logId) {
    const log = this.logs.find(l => l.id === logId);
    if (!log) return;
    const cat = this.categories.find(c => c.id === log.categoryId) || { icon: "📝" };

    const detailMsg = `【${cat.icon} ${log.title}】\n` +
      `📅 実施日: ${log.date || "日付未設定"}\n` +
      `⏱ 時間帯: ${log.startTime} 〜 ${log.endTime} (${log.durationMinutes}分)\n` +
      `💰 費用: ¥${(log.cost || 0).toLocaleString()}\n` +
      `🚀 成長: +${log.growthPoints} pt / ✨ 幸福: +${log.happinessPoints} pt\n` +
      (log.note ? `💭 メモ: ${log.note}` : "");

    alert(detailMsg);
  }

  renderLogsList(filteredLogs) {
    const container = document.getElementById("logsList");
    if (!container) return;

    if (filteredLogs.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🌱</div>
          <p>この期間の記録はまだありません。</p>
          <p style="font-size:0.8rem; margin-top:4px;">上部のアクティビティをタップして行動を記録しましょう！</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filteredLogs.slice(0, 20).map(log => {
      const cat = this.categories.find(c => c.id === log.categoryId) || { icon: "📝", color: "#8b5cf6" };
      const stars = "★".repeat(log.rating || 3);
      const timeRangeStr = (log.startTime && log.endTime) ? `${log.startTime} 〜 ${log.endTime}` : "";

      return `
        <div class="log-item">
          <div class="log-left">
            <div class="log-icon">${cat.icon}</div>
            <div class="log-details">
              <h4>${log.title} <span style="font-size:0.75rem; color:#f59e0b; margin-left:6px;">${stars}</span></h4>
              <div class="log-meta">
                <span>📅 ${log.date || log.timestamp.slice(0, 10)}</span>
                ${timeRangeStr ? `<span style="font-weight:700; color:var(--text-main);">⏱ ${timeRangeStr} (${log.durationMinutes}分)</span>` : `<span>⏱ ${log.durationMinutes}分</span>`}
                <span>💰 ¥${(log.cost || 0).toLocaleString()}</span>
                ${log.note ? `<span style="color:#cbd5e1;">💭 ${log.note}</span>` : ""}
              </div>
            </div>
          </div>
          <div class="log-right">
            <div class="log-points">
              <div class="log-points-val log-pt-growth">🚀 +${log.growthPoints} pt</div>
              <div class="log-points-val log-pt-happiness">✨ +${log.happinessPoints} pt</div>
            </div>
            <button class="log-del-btn" onclick="app.deleteLog('${log.id}')" title="削除">
              ✕
            </button>
          </div>
        </div>
      `;
    }).join("");
  }

  // =========================================================================
  // カテゴリ管理モーダル
  // =========================================================================
  openCategoryModal() {
    this.renderCategoryManagerList();
    document.getElementById("categoryModal").classList.add("open");
  }

  closeCategoryModal() {
    document.getElementById("categoryModal").classList.remove("open");
  }

  renderCategoryManagerList() {
    const list = document.getElementById("categoryManagerList");
    if (!list) return;

    list.innerHTML = this.categories.map(c => `
      <div style="background:rgba(30,41,59,0.7); border-radius:12px; padding:12px 14px; margin-bottom:10px; border:1px solid var(--border-subtle); display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:1.5rem;">${c.icon}</span>
            <div>
              <span style="font-weight:700; font-size:0.95rem;">${c.name}</span>
              ${c.defaultCost ? `<span style="font-size:0.75rem; color:var(--text-muted); margin-left:6px;">(基準: ¥${c.defaultCost.toLocaleString()})</span>` : ""}
            </div>
          </div>
          ${this.categories.length > 1 ? `
            <button class="btn btn-sm btn-danger" style="padding:3px 8px; font-size:0.75rem;" onclick="app.deleteCategory('${c.id}')" title="削除">
              ✕ 削除
            </button>
          ` : ""}
        </div>

        <!-- レート直接編集ボックス -->
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; background:rgba(15,23,42,0.6); padding:8px 12px; border-radius:8px;">
          <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
            <label style="font-size:0.78rem; color:#c4b5fd; display:flex; align-items:center; gap:4px;">
              🚀 成長:
              <input type="number" id="edit_growth_${c.id}" value="${c.growthRate}" 
                     style="width:58px; padding:4px 6px; background:#1e293b; border:1px solid #475569; border-radius:6px; color:#fff; font-size:0.85rem; text-align:center;" min="0" step="1">
              pt/h
            </label>
            <label style="font-size:0.78rem; color:#6ee7b7; display:flex; align-items:center; gap:4px;">
              ✨ 幸福:
              <input type="number" id="edit_happiness_${c.id}" value="${c.happinessRate}" 
                     style="width:58px; padding:4px 6px; background:#1e293b; border:1px solid #475569; border-radius:6px; color:#fff; font-size:0.85rem; text-align:center;" min="0" step="1">
              pt/h
            </label>
          </div>
          <button class="btn btn-sm btn-primary" style="padding:4px 10px; font-size:0.78rem;" onclick="app.updateCategoryRates('${c.id}')">
            💾 レート変更を保存
          </button>
        </div>
      </div>
    `).join("");
  }

  updateCategoryRates(catId) {
    const cat = this.categories.find(c => c.id === catId);
    if (!cat) return;

    const growthInput = document.getElementById(`edit_growth_${catId}`);
    const happinessInput = document.getElementById(`edit_happiness_${catId}`);

    const newGrowth = parseFloat(growthInput.value);
    const newHappiness = parseFloat(happinessInput.value);

    if (isNaN(newGrowth) || isNaN(newHappiness) || newGrowth < 0 || newHappiness < 0) {
      alert("0以上の数値を入力してください。");
      return;
    }

    cat.growthRate = newGrowth;
    cat.happinessRate = newHappiness;

    this.saveCategories();
    this.renderAll();
    this.renderCategoryManagerList();
    this.showToast(`✨「${cat.name}」のレートを更新しました！ (成長:+${newGrowth}pt/h, 幸福:+${newHappiness}pt/h)`);
  }

  saveNewCategory() {
    const name = document.getElementById("newCatName").value.trim();
    const icon = document.getElementById("newCatIcon").value.trim() || "🎯";
    const color = document.getElementById("newCatColor").value || "#8b5cf6";
    const growthRate = parseFloat(document.getElementById("newCatGrowth").value) || 10;
    const happinessRate = parseFloat(document.getElementById("newCatHappiness").value) || 10;
    const defaultCost = parseInt(document.getElementById("newCatCost").value, 10) || 0;
    const desc = document.getElementById("newCatDesc").value.trim();

    if (!name) {
      alert("項目名を入力してください。");
      return;
    }

    const newCat = {
      id: "cat_" + Date.now(),
      name,
      icon,
      color,
      growthRate,
      happinessRate,
      defaultCost,
      description: desc
    };

    this.categories.push(newCat);
    this.saveCategories();
    this.renderCategoryManagerList();
    this.renderAll();

    // フォームリセット
    document.getElementById("newCatName").value = "";
    document.getElementById("newCatDesc").value = "";
    this.showToast(`新しいカテゴリ「${name}」を追加しました 🎉`);
  }

  deleteCategory(catId) {
    if (confirm("この項目を削除しますか？（過去のログは保持されます）")) {
      this.categories = this.categories.filter(c => c.id !== catId);
      this.saveCategories();
      this.renderCategoryManagerList();
      this.renderAll();
      this.showToast("項目を削除しました");
    }
  }

  // =========================================================================
  // イベント登録
  // =========================================================================
  bindEvents() {
    // 期間フィルター
    document.querySelectorAll(".filter-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
        e.target.classList.add("active");
        this.currentPeriod = e.target.dataset.period;
        this.renderAll();
      });
    });

    // 4象限マトリクス軸切り替え
    const matrixX = document.getElementById("matrixXSelect");
    if (matrixX) {
      matrixX.addEventListener("change", (e) => {
        this.matrixXAxis = e.target.value;
        const filteredLogs = this.getFilteredLogs();
        this.chartManager.renderMatrixChart("matrixChart", this.categories, filteredLogs, this.matrixXAxis, this.matrixYAxis);
      });
    }

    const matrixY = document.getElementById("matrixYSelect");
    if (matrixY) {
      matrixY.addEventListener("change", (e) => {
        this.matrixYAxis = e.target.value;
        const filteredLogs = this.getFilteredLogs();
        this.chartManager.renderMatrixChart("matrixChart", this.categories, filteredLogs, this.matrixXAxis, this.matrixYAxis);
      });
    }

    // 内訳チャートモード切り替え
    const distSelect = document.getElementById("distributionModeSelect");
    if (distSelect) {
      distSelect.addEventListener("change", (e) => {
        const filteredLogs = this.getFilteredLogs();
        this.chartManager.renderDistributionChart("distributionChart", this.categories, filteredLogs, e.target.value);
      });
    }

    // モーダル内リアルタイム再計算
    const logCat = document.getElementById("logCategorySelect");
    const logMin = document.getElementById("logMinutesInput");
    if (logCat) logCat.addEventListener("change", () => this.recalculateModalPoints());

    // モーダル内 時刻・所要時間の自動連動
    const startTimeInput = document.getElementById("logStartTimeInput");
    const endTimeInput = document.getElementById("logEndTimeInput");
    const pad = (n) => String(n).padStart(2, "0");

    const updateMinutesFromTimes = () => {
      if (!startTimeInput || !endTimeInput || !logMin) return;
      const [sh, sm] = (startTimeInput.value || "").split(":").map(Number);
      const [eh, em] = (endTimeInput.value || "").split(":").map(Number);
      if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return;

      let startMin = sh * 60 + sm;
      let endMin = eh * 60 + em;
      if (endMin < startMin) {
        endMin += 1440; // 日跨ぎ対応
      }
      const diff = Math.max(1, endMin - startMin);
      logMin.value = diff;
      this.recalculateModalPoints();
    };

    const updateEndTimeFromMinutes = () => {
      if (!startTimeInput || !endTimeInput || !logMin) return;
      const [sh, sm] = (startTimeInput.value || "").split(":").map(Number);
      const duration = parseInt(logMin.value, 10) || 0;
      if (isNaN(sh) || isNaN(sm) || duration <= 0) return;

      const endTotalMin = (sh * 60 + sm + duration) % 1440;
      const eh = Math.floor(endTotalMin / 60);
      const em = endTotalMin % 60;
      endTimeInput.value = `${pad(eh)}:${pad(em)}`;
      this.recalculateModalPoints();
    };

    if (startTimeInput) startTimeInput.addEventListener("change", updateMinutesFromTimes);
    if (endTimeInput) endTimeInput.addEventListener("change", updateMinutesFromTimes);
    if (logMin) logMin.addEventListener("input", updateEndTimeFromMinutes);
  }


  // =========================================================================
  // トースト通知
  // =========================================================================
  showToast(message) {
    const toast = document.getElementById("appToast");
    if (!toast) return;
    toast.innerHTML = `<span>✨</span><span>${message}</span>`;
    toast.classList.add("show");
    setTimeout(() => {
      toast.classList.remove("show");
    }, 3200);
  }
}

// グローバルインスタンス化
window.addEventListener("DOMContentLoaded", () => {
  window.app = new LifeRoiApp();
});
