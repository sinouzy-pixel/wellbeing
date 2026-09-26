/**
 * Life ROI Tracker - Chart.js によるグラフビジュアライゼーションマネージャー
 */

class ChartManager {
  constructor() {
    this.charts = {};
  }

  // 既存チャートの破棄
  destroyChart(key) {
    if (this.charts[key]) {
      this.charts[key].destroy();
      this.charts[key] = null;
    }
  }

  // 1. 日別推移グラフ（幸福度 & 成長ポイント vs 時間）
  renderTimelineChart(canvasId, logs, days = 7) {
    this.destroyChart("timeline");
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    // 過去N日間の日付キーを生成
    const dateMap = {};
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
      dateMap[key] = {
        dateStr: key,
        rawDate: d,
        happiness: 0,
        growth: 0,
        hours: 0,
        cost: 0
      };
    }

    // ログを集計
    logs.forEach(log => {
      const d = new Date(log.timestamp);
      const key = d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
      if (dateMap[key]) {
        dateMap[key].happiness += log.happinessPoints || 0;
        dateMap[key].growth += log.growthPoints || 0;
        dateMap[key].hours += (log.durationMinutes || 0) / 60;
        dateMap[key].cost += log.cost || 0;
      }
    });

    const labels = Object.keys(dateMap);
    const happinessData = labels.map(k => Math.round(dateMap[k].happiness * 10) / 10);
    const growthData = labels.map(k => Math.round(dateMap[k].growth * 10) / 10);
    const hoursData = labels.map(k => Math.round(dateMap[k].hours * 10) / 10);

    this.charts["timeline"] = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "成長ポイント",
            data: growthData,
            backgroundColor: "rgba(139, 92, 246, 0.75)",
            borderColor: "#8b5cf6",
            borderWidth: 1.5,
            borderRadius: 6,
            stack: "returns",
            yAxisID: "y"
          },
          {
            label: "幸福度ポイント",
            data: happinessData,
            backgroundColor: "rgba(16, 185, 129, 0.75)",
            borderColor: "#10b981",
            borderWidth: 1.5,
            borderRadius: 6,
            stack: "returns",
            yAxisID: "y"
          },
          {
            label: "投資時間 (時間)",
            data: hoursData,
            type: "line",
            borderColor: "#38bdf8",
            backgroundColor: "rgba(56, 189, 248, 0.2)",
            borderWidth: 3,
            pointBackgroundColor: "#38bdf8",
            pointBorderColor: "#fff",
            pointHoverRadius: 6,
            tension: 0.35,
            fill: false,
            yAxisID: "y1"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: "index",
          intersect: false
        },
        plugins: {
          legend: {
            position: "top",
            labels: {
              color: "#cbd5e1",
              font: { family: "'Outfit', 'Inter', sans-serif", size: 12 },
              usePointStyle: true,
              boxWidth: 8
            }
          },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.9)",
            titleColor: "#f8fafc",
            bodyColor: "#e2e8f0",
            borderColor: "rgba(148, 163, 184, 0.2)",
            borderWidth: 1,
            padding: 12,
            boxPadding: 6,
            usePointStyle: true
          }
        },
        scales: {
          x: {
            grid: { color: "rgba(255, 255, 255, 0.05)" },
            ticks: { color: "#94a3b8" }
          },
          y: {
            type: "linear",
            display: true,
            position: "left",
            title: { display: true, text: "獲得ポイント (pt)", color: "#94a3b8" },
            grid: { color: "rgba(255, 255, 255, 0.06)" },
            ticks: { color: "#94a3b8" },
            stacked: true
          },
          y1: {
            type: "linear",
            display: true,
            position: "right",
            title: { display: true, text: "投資時間 (h)", color: "#38bdf8" },
            grid: { drawOnChartArea: false },
            ticks: { color: "#38bdf8" },
            min: 0
          }
        }
      }
    });
  }

  // 2. 4象限 ROI マトリクス (時間 vs 総合ポイント / コスト vs ポイント)
  renderMatrixChart(canvasId, categories, logs, xAxisMode = "time", yAxisMode = "total") {
    this.destroyChart("matrix");
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    // カテゴリごとに集計
    const stats = {};
    categories.forEach(c => {
      stats[c.id] = {
        category: c,
        totalHours: 0,
        totalCost: 0,
        totalHappiness: 0,
        totalGrowth: 0,
        count: 0
      };
    });

    logs.forEach(log => {
      if (stats[log.categoryId]) {
        stats[log.categoryId].totalHours += (log.durationMinutes || 0) / 60;
        stats[log.categoryId].totalCost += log.cost || 0;
        stats[log.categoryId].totalHappiness += log.happinessPoints || 0;
        stats[log.categoryId].totalGrowth += log.growthPoints || 0;
        stats[log.categoryId].count++;
      }
    });

    const datasets = Object.values(stats)
      .filter(s => s.count > 0 || s.totalHours > 0)
      .map(s => {
        let xVal = xAxisMode === "time" ? s.totalHours : s.totalCost;
        let yVal = 0;
        if (yAxisMode === "happiness") yVal = s.totalHappiness;
        else if (yAxisMode === "growth") yVal = s.totalGrowth;
        else yVal = s.totalHappiness + s.totalGrowth; // 総合リターン

        return {
          label: `${s.category.icon} ${s.category.name}`,
          data: [{
            x: Math.round(xVal * 10) / 10,
            y: Math.round(yVal * 10) / 10,
            r: Math.max(8, Math.min(26, Math.sqrt(s.count) * 7 + 4)),
            cat: s.category,
            hours: Math.round(s.totalHours * 10) / 10,
            cost: s.totalCost,
            happiness: Math.round(s.totalHappiness),
            growth: Math.round(s.totalGrowth),
            count: s.count
          }],
          backgroundColor: s.category.color + "99",
          borderColor: s.category.color,
          borderWidth: 2,
          hoverBorderWidth: 3
        };
      });

    const xLabel = xAxisMode === "time" ? "投入時間 (時間)" : "投入コスト (円)";
    const yLabel = yAxisMode === "happiness" ? "獲得幸福度 (pt)" : (yAxisMode === "growth" ? "獲得成長度 (pt)" : "総合リターン (幸福+成長 pt)");

    this.charts["matrix"] = new Chart(ctx, {
      type: "bubble",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: "#cbd5e1",
              font: { family: "'Outfit', 'Inter', sans-serif", size: 11 },
              usePointStyle: true,
              boxWidth: 8,
              padding: 12
            }
          },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.95)",
            titleColor: "#f8fafc",
            bodyColor: "#e2e8f0",
            borderColor: "rgba(148, 163, 184, 0.3)",
            borderWidth: 1,
            padding: 12,
            callbacks: {
              title: (items) => {
                const raw = items[0].raw;
                return `${raw.cat.icon} ${raw.cat.name} (${raw.count}回の記録)`;
              },
              label: (item) => {
                const raw = item.raw;
                return [
                  `⏱ 時間: ${raw.hours}時間 / 💰 費用: ¥${raw.cost.toLocaleString()}`,
                  `✨ 幸福度: +${raw.happiness} pt / 🚀 成長度: +${raw.growth} pt`,
                  `📊 時間効率: ${(raw.hours > 0 ? ((raw.happiness + raw.growth) / raw.hours).toFixed(1) : 0)} pt/h`
                ];
              }
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: xLabel, color: "#94a3b8" },
            grid: { color: "rgba(255, 255, 255, 0.08)" },
            ticks: { color: "#94a3b8" }
          },
          y: {
            title: { display: true, text: yLabel, color: "#94a3b8" },
            grid: { color: "rgba(255, 255, 255, 0.08)" },
            ticks: { color: "#94a3b8" }
          }
        }
      }
    });
  }

  // 3. カテゴリ別時間・費用配分（ドーナツチャート）
  renderDistributionChart(canvasId, categories, logs, mode = "time") {
    this.destroyChart("distribution");
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const catMap = {};
    categories.forEach(c => {
      catMap[c.id] = { name: c.name, icon: c.icon, color: c.color, value: 0 };
    });

    logs.forEach(log => {
      if (catMap[log.categoryId]) {
        if (mode === "time") {
          catMap[log.categoryId].value += (log.durationMinutes || 0) / 60;
        } else if (mode === "cost") {
          catMap[log.categoryId].value += log.cost || 0;
        } else if (mode === "happiness") {
          catMap[log.categoryId].value += log.happinessPoints || 0;
        } else if (mode === "growth") {
          catMap[log.categoryId].value += log.growthPoints || 0;
        }
      }
    });

    const filtered = Object.values(catMap).filter(item => item.value > 0);
    const labels = filtered.map(item => `${item.icon} ${item.name}`);
    const data = filtered.map(item => Math.round(item.value * 10) / 10);
    const bgColors = filtered.map(item => item.color);

    this.charts["distribution"] = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: bgColors,
          borderColor: "#0f172a",
          borderWidth: 2,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "right",
            labels: {
              color: "#cbd5e1",
              font: { family: "'Outfit', 'Inter', sans-serif", size: 11 },
              boxWidth: 10,
              padding: 10
            }
          },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.9)",
            callbacks: {
              label: (item) => {
                const unit = mode === "time" ? "時間" : (mode === "cost" ? "円" : "pt");
                const val = item.raw.toLocaleString();
                return ` ${val} ${unit}`;
              }
            }
          }
        },
        cutout: "68%"
      }
    });
  }

  // 4. カテゴリ別 時間あたりROI効率ランキング（横棒グラフ）
  renderEfficiencyChart(canvasId, categories, logs) {
    this.destroyChart("efficiency");
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const stats = {};
    categories.forEach(c => {
      stats[c.id] = { category: c, totalHours: 0, happiness: 0, growth: 0 };
    });

    logs.forEach(log => {
      if (stats[log.categoryId]) {
        stats[log.categoryId].totalHours += (log.durationMinutes || 0) / 60;
        stats[log.categoryId].happiness += log.happinessPoints || 0;
        stats[log.categoryId].growth += log.growthPoints || 0;
      }
    });

    // 時間が15分以上あるものを対象にROI効率計算
    const items = Object.values(stats)
      .filter(s => s.totalHours >= 0.25)
      .map(s => {
        const hROI = s.happiness / s.totalHours;
        const gROI = s.growth / s.totalHours;
        return {
          name: `${s.category.icon} ${s.category.name}`,
          color: s.category.color,
          hROI: Math.round(hROI * 10) / 10,
          gROI: Math.round(gROI * 10) / 10,
          totalROI: Math.round((hROI + gROI) * 10) / 10
        };
      })
      .sort((a, b) => b.totalROI - a.totalROI);

    const labels = items.map(i => i.name);
    const happinessROI = items.map(i => i.hROI);
    const growthROI = items.map(i => i.gROI);

    this.charts["efficiency"] = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "成長効率 (pt/h)",
            data: growthROI,
            backgroundColor: "rgba(139, 92, 246, 0.8)",
            borderRadius: 4
          },
          {
            label: "幸福度効率 (pt/h)",
            data: happinessROI,
            backgroundColor: "rgba(16, 185, 129, 0.8)",
            borderRadius: 4
          }
        ]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "top",
            labels: { color: "#cbd5e1", font: { size: 11 }, boxWidth: 10 }
          },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.9)",
            callbacks: {
              afterBody: (items) => {
                const total = items.reduce((sum, item) => sum + item.raw, 0);
                return `合計時間効率: ${total.toFixed(1)} pt/h`;
              }
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            title: { display: true, text: "1時間あたりの獲得ポイント (pt/h)", color: "#94a3b8" },
            grid: { color: "rgba(255, 255, 255, 0.05)" },
            ticks: { color: "#94a3b8" }
          },
          y: {
            stacked: true,
            grid: { display: false },
            ticks: { color: "#cbd5e1" }
          }
        }
      }
    });
  }
}

window.ChartManager = ChartManager;
