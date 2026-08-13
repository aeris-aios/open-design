import type { LandingLocaleCode } from '../i18n';

export interface PricingCampaignContent {
  badge: string;
  headline: string;
  body: string;
  windowLabel: string;
  dayUnit: string;
  modelBenefit: string;
  paidBenefitNote: string;
  teamBenefitNote: string;
  disclaimer: string;
  linkLabel: string;
  closeLabel: string;
}

export const PRICING_CAMPAIGN_CONTENT_BY_LOCALE = {
  en: {
    badge: 'Unlimited',
    headline: 'Put smarter intelligence to work—without limits.',
    body: 'FREE all week, Aug 14—Aug 21',
    windowLabel: 'Campaign countdown',
    dayUnit: 'd',
    modelBenefit: 'Unlimited DeepSeek V4 Pro',
    paidBenefitNote: 'Aug 14—Aug 21 · FREE all week',
    teamBenefitNote: 'Aug 14—Aug 21 · FREE all week',
    disclaimer: 'Unlimited model quota and free generations included in a plan are available only in Open Design; they cannot be used through MCP/CLI/API or in other scenarios. The organizer reserves the right of final interpretation.',
    linkLabel: 'View campaign benefits', closeLabel: 'Dismiss campaign banner',
  },
  zh: {
    badge: '无限使用',
    headline: '这次，更聪明的模型别省着用。',
    body: '8月14日—8月21日，一周免费用',
    windowLabel: '活动倒计时',
    dayUnit: '天',
    modelBenefit: 'DeepSeek V4 Pro 无限使用',
    paidBenefitNote: '8月14日—8月21日 · 一周免费用',
    teamBenefitNote: '8月14日—8月21日 · 一周免费用',
    disclaimer: '套餐内的无限制模型额度与免费生成次数，仅可通过Open Design使用；无法在MCP/CLI/API及其他场景使用。解释权归官方所有。',
    linkLabel: '查看活动权益', closeLabel: '关闭活动横幅',
  },
  ja: {
    badge: '無制限',
    headline: 'より賢いモデルを、思いきり使おう。',
    body: '8月14日〜8月21日、1週間無料',
    windowLabel: 'キャンペーン終了まで',
    dayUnit: '日',
    modelBenefit: 'DeepSeek V4 Proを無制限で利用',
    paidBenefitNote: '8月14日〜8月21日 · 1週間無料',
    teamBenefitNote: '8月14日〜8月21日 · 1週間無料',
    disclaimer: 'プランに含まれる無制限のモデル枠と無料生成回数は、Open Design内でのみ利用できます。MCP/CLI/APIなど、その他の環境では利用できません。最終的な解釈権は運営者に帰属します。',
    linkLabel: '特典を見る', closeLabel: 'キャンペーンバナーを閉じる',
  },
  ko: {
    badge: '무제한 사용',
    headline: '더 똑똑한 모델, 마음껏 사용하세요.',
    body: '8월 14일—8월 21일, 일주일 무료',
    windowLabel: '이벤트 남은 시간',
    dayUnit: '일',
    modelBenefit: 'DeepSeek V4 Pro 무제한 사용',
    paidBenefitNote: '8월 14일—8월 21일 · 일주일 무료',
    teamBenefitNote: '8월 14일—8월 21일 · 일주일 무료',
    disclaimer: '플랜에 포함된 무제한 모델 한도와 무료 생성 횟수는 Open Design에서만 사용할 수 있으며 MCP/CLI/API 또는 기타 환경에서는 사용할 수 없습니다. 최종 해석 권한은 운영사에 있습니다.',
    linkLabel: '이벤트 혜택 보기', closeLabel: '이벤트 배너 닫기',
  },
  de: {
    badge: 'Unbegrenzt',
    headline: 'Mehr Intelligenz, ohne Zurückhaltung.',
    body: '14.—21. August · eine Woche kostenlos',
    windowLabel: 'Aktions-Countdown',
    dayUnit: 'T',
    modelBenefit: 'DeepSeek V4 Pro unbegrenzt nutzen',
    paidBenefitNote: '14.—21. August · eine Woche kostenlos',
    teamBenefitNote: '14.—21. August · eine Woche kostenlos',
    disclaimer: 'Das im Tarif enthaltene unbegrenzte Modellkontingent und die kostenlosen Generierungen können nur in Open Design genutzt werden, nicht über MCP/CLI/API oder in anderen Umgebungen. Der Veranstalter behält sich die endgültige Auslegung vor.',
    linkLabel: 'Aktionsvorteile ansehen', closeLabel: 'Aktionsbanner schließen',
  },
  fr: {
    badge: 'Illimité',
    headline: 'Mettez une IA plus intelligente au travail, sans limites.',
    body: 'Du 14 au 21 août · gratuit toute la semaine',
    windowLabel: 'Compte à rebours',
    dayUnit: 'j',
    modelBenefit: 'DeepSeek V4 Pro en illimité',
    paidBenefitNote: 'Du 14 au 21 août · gratuit toute la semaine',
    teamBenefitNote: 'Du 14 au 21 août · gratuit toute la semaine',
    disclaimer: 'Le quota de modèles illimité et les générations gratuites inclus dans le forfait sont utilisables uniquement dans Open Design, et non via MCP/CLI/API ni dans d’autres contextes. L’organisateur se réserve le droit d’interprétation finale.',
    linkLabel: 'Voir les avantages', closeLabel: 'Fermer la bannière',
  },
  ru: {
    badge: 'Без ограничений',
    headline: 'Больше интеллекта — без ограничений.',
    body: '14—21 августа · бесплатно всю неделю',
    windowLabel: 'До конца акции',
    dayUnit: 'д',
    modelBenefit: 'DeepSeek V4 Pro без ограничений',
    paidBenefitNote: '14—21 августа · бесплатно всю неделю',
    teamBenefitNote: '14—21 августа · бесплатно всю неделю',
    disclaimer: 'Безлимитная квота моделей и бесплатные генерации, включённые в тариф, доступны только в Open Design и недоступны через MCP/CLI/API или в других сценариях. Организатор оставляет за собой право окончательного толкования.',
    linkLabel: 'Посмотреть преимущества', closeLabel: 'Закрыть баннер',
  },
  es: {
    badge: 'Uso ilimitado',
    headline: 'Pon una inteligencia superior a trabajar, sin límites.',
    body: 'Del 14 al 21 de agosto · gratis toda la semana',
    windowLabel: 'Cuenta atrás de la promoción',
    dayUnit: 'd',
    modelBenefit: 'Uso ilimitado de DeepSeek V4 Pro',
    paidBenefitNote: 'Del 14 al 21 de agosto · gratis toda la semana',
    teamBenefitNote: 'Del 14 al 21 de agosto · gratis toda la semana',
    disclaimer: 'La cuota ilimitada de modelos y las generaciones gratuitas incluidas en el plan solo pueden utilizarse en Open Design, no mediante MCP/CLI/API ni en otros entornos. El organizador se reserva el derecho de interpretación final.',
    linkLabel: 'Ver beneficios', closeLabel: 'Cerrar el banner',
  },
  'pt-br': {
    badge: 'Uso ilimitado',
    headline: 'Coloque uma inteligência superior para trabalhar, sem limites.',
    body: '14 a 21 de agosto · grátis a semana toda',
    windowLabel: 'Contagem regressiva',
    dayUnit: 'd',
    modelBenefit: 'Uso ilimitado do DeepSeek V4 Pro',
    paidBenefitNote: '14 a 21 de agosto · grátis a semana toda',
    teamBenefitNote: '14 a 21 de agosto · grátis a semana toda',
    disclaimer: 'A cota ilimitada de modelos e as gerações gratuitas incluídas no plano só podem ser usadas no Open Design, e não via MCP/CLI/API nem em outros cenários. O organizador se reserva o direito de interpretação final.',
    linkLabel: 'Ver benefícios', closeLabel: 'Fechar banner',
  },
  it: {
    badge: 'Uso illimitato',
    headline: 'Metti al lavoro un’intelligenza superiore, senza limiti.',
    body: '14—21 agosto · gratis per tutta la settimana',
    windowLabel: 'Conto alla rovescia',
    dayUnit: 'g',
    modelBenefit: 'DeepSeek V4 Pro senza limiti',
    paidBenefitNote: '14—21 agosto · gratis per tutta la settimana',
    teamBenefitNote: '14—21 agosto · gratis per tutta la settimana',
    disclaimer: 'La quota modelli illimitata e le generazioni gratuite incluse nel piano sono utilizzabili solo in Open Design, non tramite MCP/CLI/API né in altri contesti. L’organizzatore si riserva il diritto di interpretazione finale.',
    linkLabel: 'Scopri i vantaggi', closeLabel: 'Chiudi il banner',
  },
  tr: {
    badge: 'Sınırsız kullanım',
    headline: 'Daha akıllı modeli sınırsızca çalıştırın.',
    body: '14—21 Ağustos · bir hafta ücretsiz',
    windowLabel: 'Kampanya geri sayımı',
    dayUnit: 'g',
    modelBenefit: 'DeepSeek V4 Pro sınırsız kullanım',
    paidBenefitNote: '14—21 Ağustos · bir hafta ücretsiz',
    teamBenefitNote: '14—21 Ağustos · bir hafta ücretsiz',
    disclaimer: 'Paket kapsamındaki sınırsız model kotası ve ücretsiz üretim hakları yalnızca Open Design içinde kullanılabilir; MCP/CLI/API veya diğer senaryolarda kullanılamaz. Nihai yorum hakkı organizatöre aittir.',
    linkLabel: 'Kampanya avantajlarını gör', closeLabel: 'Kampanya bandını kapat',
  },
} satisfies Partial<Record<LandingLocaleCode, PricingCampaignContent>>;

export function getPricingCampaignContent(
  locale: LandingLocaleCode,
): PricingCampaignContent {
  return PRICING_CAMPAIGN_CONTENT_BY_LOCALE[locale as keyof typeof PRICING_CAMPAIGN_CONTENT_BY_LOCALE]
    ?? PRICING_CAMPAIGN_CONTENT_BY_LOCALE.en;
}
