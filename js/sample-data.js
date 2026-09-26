/**
 * Life ROI Tracker - 初期プリセットデータ & サンプルデータ
 */

const DEFAULT_CATEGORIES = [
  {
    id: "reading",
    name: "読書・インプット",
    icon: "📖",
    color: "#3b82f6",
    happinessRate: 15,  // 1時間あたりの幸福度pt
    growthRate: 28,     // 1時間あたりの成長pt
    defaultCost: 0,
    description: "本から知識を得て視野を広げる"
  },
  {
    id: "workout",
    name: "筋トレ・運動",
    icon: "🏋️",
    color: "#10b981",
    happinessRate: 22,
    growthRate: 26,
    defaultCost: 500,
    description: "身体を鍛えてエネルギーを高める"
  },
  {
    id: "study",
    name: "プログラミング・学習",
    icon: "💻",
    color: "#8b5cf6",
    happinessRate: 12,
    growthRate: 36,
    defaultCost: 0,
    description: "将来につながる技術・専門知識の習得"
  },
  {
    id: "sauna",
    name: "サウナ・スパ",
    icon: "🧖",
    color: "#f59e0b",
    happinessRate: 38,
    growthRate: 6,
    defaultCost: 1500,
    description: "最高のリフレッシュと自律神経の回復"
  },
  {
    id: "cafe",
    name: "カフェ集中ワーク",
    icon: "☕",
    color: "#ec4899",
    happinessRate: 18,
    growthRate: 20,
    defaultCost: 650,
    description: "心地よい空間での創作・思索時間"
  },
  {
    id: "hobby",
    name: "趣味・ゲーム・エンタメ",
    icon: "🎮",
    color: "#06b6d4",
    happinessRate: 32,
    growthRate: 4,
    defaultCost: 0,
    description: "純粋に没頭して楽しむ時間"
  },
  {
    id: "social",
    name: "大切な人との時間",
    icon: "🥂",
    color: "#f97316",
    happinessRate: 35,
    growthRate: 12,
    defaultCost: 3500,
    description: "友人・家族・パートナーとの絆を深める"
  },
  {
    id: "mindfulness",
    name: "散歩・マインドフルネス",
    icon: "🌿",
    color: "#14b8a6",
    happinessRate: 25,
    growthRate: 14,
    defaultCost: 0,
    description: "デジタルデトックスと心を整える時間"
  }
];

// 充実度 (Rating 1~5) による倍率補正
const RATING_MULTIPLIERS = {
  1: 0.2,   // 不完全燃焼・気分乗らず (20%)
  2: 0.6,   // やや微妙・途切れ途切れ (60%)
  3: 1.0,   // 標準的・普段通り (100%基準)
  4: 1.5,   // 充実・満足・集中できた (150%)
  5: 2.0    // 最高！超充実・ゾーン体験 (200%)
};

// 初回体験を豊かにするための過去7日間のサンプルログ
function generateSampleLogs() {
  const now = new Date();
  const logs = [];

  const helper = (dayOffset, hour, categoryId, minutes, cost, rating, note) => {
    const d = new Date(now);
    d.setDate(d.getDate() - dayOffset);
    d.setHours(hour, 15, 0, 0);

    const cat = DEFAULT_CATEGORIES.find(c => c.id === categoryId);
    const multiplier = RATING_MULTIPLIERS[rating] || 1.0;
    const hours = minutes / 60;
    const happinessPoints = Math.round(hours * cat.happinessRate * multiplier * 10) / 10;
    const growthPoints = Math.round(hours * cat.growthRate * multiplier * 10) / 10;

    return {
      id: "log_" + d.getTime() + "_" + Math.random().toString(36).substring(2, 7),
      categoryId,
      title: cat.name,
      durationMinutes: minutes,
      cost,
      rating,
      happinessPoints,
      growthPoints,
      timestamp: d.toISOString(),
      note
    };
  };

  // 今日
  logs.push(helper(0, 9, "study", 90, 0, 5, "新技術のアーキテクチャ設計と実装"));
  logs.push(helper(0, 14, "cafe", 60, 680, 4, "アイスラテを飲みながら読書とアイデア出し"));
  logs.push(helper(0, 18, "workout", 45, 0, 4, "HIITトレーニングとストレッチ"));

  // 昨日
  logs.push(helper(1, 8, "mindfulness", 30, 0, 4, "朝の公園を散歩。頭がすっきりした"));
  logs.push(helper(1, 19, "sauna", 100, 1600, 5, "3セットしっかり整った。最高の疲労回復"));
  logs.push(helper(1, 21, "reading", 50, 0, 4, "ビジネス書を1章読了"));

  // 2日前
  logs.push(helper(2, 10, "study", 120, 0, 4, "アルゴリズム学習とコードリファクタリング"));
  logs.push(helper(2, 19, "social", 150, 4500, 5, "旧友と近況報告ディナー。刺激をもらった"));

  // 3日前
  logs.push(helper(3, 7, "workout", 60, 500, 4, "ジムでベンチプレスとスクワット"));
  logs.push(helper(3, 21, "hobby", 90, 0, 3, "気になっていた新作ゲームをプレイ"));

  // 4日前
  logs.push(helper(4, 9, "study", 100, 0, 4, "英語での技術ドキュメント読解"));
  logs.push(helper(4, 15, "cafe", 75, 750, 4, "集中してタスクを前倒し完了"));
  logs.push(helper(4, 22, "reading", 45, 0, 3, "寝る前の読書習慣"));

  // 5日前
  logs.push(helper(5, 14, "sauna", 90, 1400, 5, "週末のリセットサウナ"));
  logs.push(helper(5, 18, "social", 120, 3200, 4, "カフェで家族と団らん"));

  // 6日前
  logs.push(helper(6, 8, "workout", 50, 500, 5, "朝トレ完了、自己ベスト更新"));
  logs.push(helper(6, 13, "study", 110, 0, 4, "API連携の実装"));
  logs.push(helper(6, 20, "hobby", 80, 0, 4, "好きな映画鑑賞で感動"));

  return logs;
}
