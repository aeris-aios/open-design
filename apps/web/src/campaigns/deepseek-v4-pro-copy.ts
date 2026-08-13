import type { Locale } from '../i18n';

export interface DeepSeekV4ProCampaignCopy {
  headline: string; description: string; badge: string; benefit: string;
  paidEyebrow: string; unpaidEyebrow: string; paidStatus: string; unpaidStatus: string;
  paidCta: string; unpaidCta: string; later: string; unlocked: string; locked: string;
  countdown: string; week: string; close: string; topBadge: string;
  paidTooltip: string; unpaidTooltip: string; restrictedBadge: string; restrictedTooltip: string;
  boundary: string;
}

const en: DeepSeekV4ProCampaignCopy = {
  headline: 'Put smarter intelligence to work—without limits.', description: 'Landing pages, websites, slides and images—create until it is right.',
  badge: 'Unlimited', benefit: 'Unlimited DeepSeek V4 Pro', paidEyebrow: 'Free for 7 days', unpaidEyebrow: 'Free for paid users',
  paidStatus: 'Unlocked · Aug 14—Aug 21', unpaidStatus: 'Upgrade to unlock · Ends Aug 21', paidCta: 'Use now', unpaidCta: 'Upgrade and use now',
  later: 'Maybe later', unlocked: 'Unlocked', locked: 'Locked', countdown: 'Campaign countdown', week: 'Aug 14—Aug 21 · FREE all week', close: 'Close',
  topBadge: 'DeepSeek V4 Pro unlimited', paidTooltip: 'Free for paid users from Aug 14 through Aug 21.', unpaidTooltip: 'Subscribe during the campaign to unlock access through Aug 21.',
  restrictedBadge: 'Paused', restrictedTooltip: 'Campaign access is paused due to abnormal large-scale usage. Contact support if needed.',
  boundary: 'Unlimited model quota and free generations included in a plan are available only in Open Design; they cannot be used through MCP/CLI/API or in other scenarios. The organizer reserves the right of final interpretation.',
};

const zh: DeepSeekV4ProCampaignCopy = {
  headline: '这次，更聪明的模型别省着用。', description: '落地页、网站、幻灯片、图片，无限做，做到满意', badge: '无限使用', benefit: 'DeepSeek V4 Pro 无限使用',
  paidEyebrow: '7 天免费开放', unpaidEyebrow: '付费用户免费开放', paidStatus: '已解锁 · 8 月 14 日—8 月 21 日', unpaidStatus: '升级后可用 · 截止 8 月 21 日',
  paidCta: '立即使用', unpaidCta: '升级套餐，立即使用', later: '稍后再说', unlocked: '已解锁', locked: '待解锁', countdown: '活动倒计时',
  week: '8 月 14 日—8 月 21 日 · 一周免费用', close: '关闭', topBadge: 'DeepSeek V4 Pro 无限免费用',
  paidTooltip: '8 月 14 日至 8 月 21 日，付费用户可在产品内免费使用。', unpaidTooltip: '活动窗口内订阅付费套餐后可用，统一于 8 月 21 日结束。',
  restrictedBadge: '已暂停', restrictedTooltip: '检测到异常的大规模使用，本活动权益已暂停；如有疑问请联系支持。',
  boundary: '套餐内的无限制模型额度与免费生成次数，仅可通过Open Design使用；无法在MCP/CLI/API及其他场景使用。解释权归官方所有。',
};

const local = (headline: string, unlimited: string, week: string, countdown: string): DeepSeekV4ProCampaignCopy => ({ ...en, headline, badge: unlimited, benefit: `DeepSeek V4 Pro ${unlimited}`, week, countdown });

export const DEEPSEEK_V4_PRO_COPY: Record<Locale, DeepSeekV4ProCampaignCopy> = {
  en, 'zh-CN': zh, 'zh-TW': { ...zh, headline: '這次，更聰明的模型別省著用。', badge: '無限使用', benefit: 'DeepSeek V4 Pro 無限使用', topBadge: 'DeepSeek V4 Pro 無限免費用' },
  ja: local('より賢いモデルを、思いきり使おう。', '無制限', '8月14日〜8月21日 · 1週間無料', 'キャンペーン終了まで'),
  ko: local('더 똑똑한 모델, 마음껏 사용하세요.', '무제한', '8월 14일—8월 21일 · 일주일 무료', '이벤트 남은 시간'),
  de: local('Mehr Intelligenz, ohne Zurückhaltung.', 'Unbegrenzt', '14.—21. August · eine Woche kostenlos', 'Aktions-Countdown'),
  fr: local('Mettez une IA plus intelligente au travail, sans limites.', 'Illimité', 'Du 14 au 21 août · gratuit toute la semaine', 'Compte à rebours'),
  'es-ES': local('Pon una inteligencia superior a trabajar, sin límites.', 'Ilimitado', 'Del 14 al 21 de agosto · gratis toda la semana', 'Cuenta atrás'),
  'pt-BR': local('Coloque uma inteligência superior para trabalhar, sem limites.', 'Ilimitado', '14 a 21 de agosto · grátis a semana toda', 'Contagem regressiva'),
  it: local('Metti al lavoro un’intelligenza superiore, senza limiti.', 'Illimitato', '14—21 agosto · gratis per tutta la settimana', 'Conto alla rovescia'),
  ru: local('Больше интеллекта — без ограничений.', 'Без ограничений', '14—21 августа · бесплатно всю неделю', 'До конца акции'),
  tr: local('Daha akıllı modeli sınırsızca çalıştırın.', 'Sınırsız', '14—21 Ağustos · bir hafta ücretsiz', 'Kampanya geri sayımı'),
  id: local('Gunakan kecerdasan yang lebih pintar tanpa batas.', 'Tanpa batas', '14—21 Agustus · gratis seminggu', 'Hitung mundur kampanye'),
  pl: local('Wykorzystaj inteligentniejszy model bez ograniczeń.', 'Bez limitu', '14—21 sierpnia · tydzień za darmo', 'Koniec kampanii za'),
  hu: local('Használj okosabb modellt korlátok nélkül.', 'Korlátlan', 'Augusztus 14–21. · egy hét ingyen', 'Kampány visszaszámlálás'),
  uk: local('Використовуйте розумнішу модель без обмежень.', 'Без обмежень', '14—21 серпня · тиждень безкоштовно', 'До завершення акції'),
  th: local('ใช้โมเดลที่ฉลาดกว่าได้อย่างเต็มที่', 'ไม่จำกัด', '14—21 สิงหาคม · ฟรีหนึ่งสัปดาห์', 'เวลาที่เหลือ'),
  ar: local('استخدم ذكاءً أقوى بلا حدود.', 'غير محدود', '14–21 أغسطس · مجانًا طوال الأسبوع', 'الوقت المتبقي'),
  fa: local('هوشمندی بیشتر را بدون محدودیت به کار بگیرید.', 'نامحدود', '۱۴ تا ۲۱ اوت · یک هفته رایگان', 'زمان باقی‌مانده'),
};

export const getDeepSeekV4ProCopy = (locale: Locale): DeepSeekV4ProCampaignCopy => DEEPSEEK_V4_PRO_COPY[locale];
