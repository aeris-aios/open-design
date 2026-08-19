import type { Locale } from '../i18n';

export interface GoPlanCampaignCopy {
  eyebrow: string;
  headline: string;
  description: string;
  benefit: string;
  status: string;
  cta: string;
  firstMonth: string;
  renewal: string;
  boundary: string;
  newBadge: string;
  workbenchBadge: string;
  workbenchBadgeAria: string;
}

const english: GoPlanCampaignCopy = {
  eyebrow: 'NEW PLAN · LAUNCH OFFER',
  headline: 'Meet Go: more room to keep creating.',
  description: 'A lighter plan for everyday design and coding, with popular models ready to use.',
  benefit: 'Go first month $5 · unlimited use',
  status: 'Available now · first month $5',
  cta: 'View Go plan',
  firstMonth: 'first month',
  renewal: 'Then $10 / month',
  boundary: 'Allowance details and offer terms are shown on Pricing.',
  newBadge: 'NEW',
  workbenchBadge: 'Go first month $5 · unlimited use',
  workbenchBadgeAria: 'Go first month $5, unlimited use — view Pricing',
};

const localized: Partial<Record<Locale, GoPlanCampaignCopy>> = {
  'zh-CN': {
    eyebrow: '全新套餐 · 首发特惠',
    headline: 'Go，让灵感不断线。',
    description: '面向日常设计与编码的轻量套餐，热门模型开箱即用。',
    benefit: 'Go 首月 $5 · 无限用',
    status: '现已上线 · 首月 $5',
    cta: '查看 Go 套餐',
    firstMonth: '首月',
    renewal: '之后 $10 / 月',
    boundary: '具体额度与活动规则以 Pricing 页面为准。',
    newBadge: 'NEW',
    workbenchBadge: 'Go 首月 $5 · 无限用',
    workbenchBadgeAria: 'Go 首月 5 美元，无限用，查看 Pricing',
  },
  'zh-TW': {
    eyebrow: '全新方案 · 首發優惠',
    headline: 'Go，讓靈感不中斷。',
    description: '適合日常設計與編碼的輕量方案，熱門模型開箱即用。',
    benefit: 'Go 首月 $5 · 無限用',
    status: '現已上線 · 首月 $5',
    cta: '查看 Go 方案',
    firstMonth: '首月',
    renewal: '之後 $10 / 月',
    boundary: '具體額度與活動規則以 Pricing 頁面為準。',
    newBadge: 'NEW',
    workbenchBadge: 'Go 首月 $5 · 無限用',
    workbenchBadgeAria: 'Go 首月 5 美元，無限用，查看 Pricing',
  },
};

export function getGoPlanCampaignCopy(locale: Locale): GoPlanCampaignCopy {
  return localized[locale] ?? english;
}
