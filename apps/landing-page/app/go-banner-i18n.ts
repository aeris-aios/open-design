import type { LandingLocaleCode } from './i18n';

export interface GoBannerCopy {
  badge: string;
  headline: string;
  detail: string;
  ariaLabel: string;
  closeLabel: string;
}

const EN: GoBannerCopy = {
  badge: 'NEW',
  headline: 'Go is here: an AI design and coding plan for everyone',
  detail: '$5 first month · unlimited use',
  ariaLabel: 'Go plan, five dollars for the first month. View pricing',
  closeLabel: 'Dismiss Go announcement',
};

const COPY: Partial<Record<LandingLocaleCode, GoBannerCopy>> = {
  en: EN,
  zh: {
    badge: 'NEW',
    headline: '人人可用的 AI 设计 Coding Plan，Go 上线',
    detail: '首月 $5 · 无限用',
    ariaLabel: 'Go 套餐首月五美元，查看价格方案',
    closeLabel: '关闭 Go 上线公告',
  },
  'zh-tw': {
    badge: 'NEW',
    headline: '人人可用的 AI 設計 Coding Plan，Go 上線',
    detail: '首月 $5 · 無限用',
    ariaLabel: 'Go 套餐首月五美元，查看價格方案',
    closeLabel: '關閉 Go 上線公告',
  },
  ja: {
    badge: 'NEW',
    headline: '誰もが使える AI デザイン & Coding Plan、Go 登場',
    detail: '初月 $5 · 使い放題',
    ariaLabel: 'Go プラン初月 5 ドル、料金を見る',
    closeLabel: 'Go のお知らせを閉じる',
  },
  ko: {
    badge: 'NEW',
    headline: '누구나 쓸 수 있는 AI 디자인 & Coding Plan, Go 출시',
    detail: '첫 달 $5 · 무제한 사용',
    ariaLabel: 'Go 플랜 첫 달 5달러, 요금제 보기',
    closeLabel: 'Go 출시 안내 닫기',
  },
  de: {
    badge: 'NEU',
    headline: 'Go ist da: AI-Design und Coding für alle',
    detail: '5 $ im ersten Monat · unbegrenzt nutzen',
    ariaLabel: 'Go-Tarif für 5 Dollar im ersten Monat, Preise ansehen',
    closeLabel: 'Go-Ankündigung schließen',
  },
  fr: {
    badge: 'NOUVEAU',
    headline: 'Go est là : le design et le coding AI pour tous',
    detail: '5 $ le premier mois · usage illimité',
    ariaLabel: 'Offre Go à 5 dollars le premier mois, voir les tarifs',
    closeLabel: 'Fermer l’annonce Go',
  },
  ru: {
    badge: 'НОВОЕ',
    headline: 'Go уже здесь: AI-дизайн и кодинг для каждого',
    detail: '$5 за первый месяц · безлимитное использование',
    ariaLabel: 'План Go за 5 долларов в первый месяц, посмотреть тарифы',
    closeLabel: 'Закрыть объявление Go',
  },
  es: {
    badge: 'NUEVO',
    headline: 'Llega Go: diseño y coding con AI para todos',
    detail: '$5 el primer mes · uso ilimitado',
    ariaLabel: 'Plan Go por 5 dólares el primer mes, ver precios',
    closeLabel: 'Cerrar el anuncio de Go',
  },
  'pt-br': {
    badge: 'NOVO',
    headline: 'Chegou o Go: design e coding com AI para todos',
    detail: '$5 no primeiro mês · uso ilimitado',
    ariaLabel: 'Plano Go por 5 dólares no primeiro mês, ver preços',
    closeLabel: 'Fechar o anúncio do Go',
  },
  it: {
    badge: 'NUOVO',
    headline: 'Arriva Go: design e coding AI per tutti',
    detail: '$5 il primo mese · uso illimitato',
    ariaLabel: 'Piano Go a 5 dollari il primo mese, vedi i prezzi',
    closeLabel: 'Chiudi l’annuncio Go',
  },
  tr: {
    badge: 'YENİ',
    headline: 'Go geldi: herkes için AI tasarım ve coding',
    detail: 'İlk ay $5 · sınırsız kullanım',
    ariaLabel: 'Go planı ilk ay 5 dolar, fiyatlandırmayı gör',
    closeLabel: 'Go duyurusunu kapat',
  },
};

export function getGoBannerCopy(locale: LandingLocaleCode): GoBannerCopy {
  return COPY[locale] ?? EN;
}
