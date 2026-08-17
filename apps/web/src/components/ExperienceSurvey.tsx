// Experience survey (CSAT + NPS). Armed by a successful export, rendered
// globally from App.tsx so it survives the project → home navigation, and
// retired permanently the moment the user answers or closes it.
//
// Question order is deliberate: the two scored questions come first because
// they are the metrics, and they cost one tap each. The open-ended question is
// last — it is the most expensive to answer, so putting it earlier would drag
// completion down for the questions we actually report on.
//
// Only the first question is required. Everything after it can be skipped and
// the response still counts, which is why the submit path reports partial
// answers rather than waiting for a complete set.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useT } from '../i18n';
import { toastSlideUp } from '../motion';
import styles from './ExperienceSurvey.module.css';
import {
  SURVEY_DELAY_MS,
  isSurveyRetired,
  markInstallSeen,
  onExportSucceeded,
  retireSurvey,
} from './experience-survey-trigger';

/** Answer payload handed to the host once the user finishes or skips out. */
export interface ExperienceSurveyAnswers {
  /** 1–5. Always present: question one is the only required question. */
  satisfaction: number;
  /** 0–10. Absent when the user skipped the recommendation question. */
  recommendation?: number;
  /** Index into the improvement options, in the order rendered. */
  improvement?: number;
  /** Free text, trimmed. Absent when blank or skipped. */
  comment?: string;
}

interface Props {
  /**
   * Reports a finished response. The card retires itself either way, so this
   * fires at most once per install.
   */
  onSubmit?: (answers: ExperienceSurveyAnswers) => void;
  /** Fires once when the card first becomes visible. */
  onExposure?: () => void;
  /** Fires when the user closes the card without finishing. */
  onDismiss?: (answers: Partial<ExperienceSurveyAnswers>) => void;
}

const IMPROVEMENT_KEYS = [
  'experienceSurvey.improvement.quality',
  'experienceSurvey.improvement.speed',
  'experienceSurvey.improvement.export',
  'experienceSurvey.improvement.collaboration',
  'experienceSurvey.improvement.models',
  'experienceSurvey.improvement.stability',
] as const;

type Step = 'satisfaction' | 'recommendation' | 'improvement' | 'comment' | 'thanks';

const STEP_ORDER: Step[] = ['satisfaction', 'recommendation', 'improvement', 'comment'];

export function ExperienceSurvey({ onSubmit, onExposure, onDismiss }: Props) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<Step>('satisfaction');
  const [comment, setComment] = useState('');
  const answersRef = useRef<Partial<ExperienceSurveyAnswers>>({});
  const exposedRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    markInstallSeen();
  }, []);

  // Dev-only preview hook. The real card needs three lifetime exports and a
  // seven-day-old install, which makes it impossible to eyeball during
  // development or design review. Never registered in a production build.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const globals = window as typeof window & {
      __odExperienceSurvey?: { open: () => void };
    };
    globals.__odExperienceSurvey = { open: () => setVisible(true) };
    return () => {
      delete globals.__odExperienceSurvey;
    };
  }, []);

  // Arm on export. The delay gives the user a beat to see their export land
  // before anything else asks for attention.
  useEffect(() => {
    let armTimer: number | null = null;
    const unsubscribe = onExportSucceeded(() => {
      if (isSurveyRetired() || exposedRef.current || armTimer !== null) return;
      armTimer = window.setTimeout(() => {
        armTimer = null;
        if (isSurveyRetired()) return;
        setVisible(true);
      }, SURVEY_DELAY_MS);
    });
    return () => {
      unsubscribe();
      if (armTimer !== null) window.clearTimeout(armTimer);
    };
  }, []);

  useEffect(() => {
    if (!visible || exposedRef.current) return;
    exposedRef.current = true;
    onExposure?.();
  }, [visible, onExposure]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  const finish = useCallback(() => {
    retireSurvey();
    const answers = answersRef.current;
    if (typeof answers.satisfaction === 'number') {
      onSubmit?.(answers as ExperienceSurveyAnswers);
    }
    setStep('thanks');
    closeTimerRef.current = window.setTimeout(() => setVisible(false), 2_600);
  }, [onSubmit]);

  const close = useCallback(() => {
    retireSurvey();
    setVisible(false);
    if (step !== 'thanks') onDismiss?.(answersRef.current);
  }, [onDismiss, step]);

  const answerSatisfaction = useCallback((value: number) => {
    answersRef.current.satisfaction = value;
    setStep('recommendation');
  }, []);

  const answerRecommendation = useCallback((value: number) => {
    answersRef.current.recommendation = value;
    setStep('improvement');
  }, []);

  const answerImprovement = useCallback((index: number) => {
    answersRef.current.improvement = index;
    setStep('comment');
  }, []);

  const submitComment = useCallback(() => {
    const trimmed = comment.trim();
    if (trimmed) answersRef.current.comment = trimmed;
    finish();
  }, [comment, finish]);

  if (typeof document === 'undefined') return null;

  const stepIndex = STEP_ORDER.indexOf(step);

  const head = (
    <div className={styles.head}>
      <span className={styles.tag}>{t('experienceSurvey.tag')}</span>
      <button
        type="button"
        className={styles.close}
        onClick={close}
        aria-label={t('experienceSurvey.close')}
      >
        ×
      </button>
    </div>
  );

  const steps = (
    <span className={styles.steps} aria-hidden>
      {STEP_ORDER.map((name, index) => (
        <span
          key={name}
          className={`${styles.step} ${index <= stepIndex ? styles.on : ''}`}
        />
      ))}
    </span>
  );

  let body: JSX.Element;
  if (step === 'satisfaction') {
    body = (
      <>
        {head}
        <p className={styles.question}>{t('experienceSurvey.satisfaction')}</p>
        <div className={styles.scale}>
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              className={styles.scaleButton}
              onClick={() => answerSatisfaction(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <div className={styles.bounds}>
          <span>{t('experienceSurvey.satisfactionLow')}</span>
          <span>{t('experienceSurvey.satisfactionHigh')}</span>
        </div>
        <div className={styles.foot}>{steps}</div>
      </>
    );
  } else if (step === 'recommendation') {
    body = (
      <>
        {head}
        <p className={styles.question}>{t('experienceSurvey.recommendation')}</p>
        <div className={`${styles.scale} ${styles.wide}`}>
          {Array.from({ length: 11 }, (_, value) => (
            <button
              key={value}
              type="button"
              className={styles.scaleButton}
              onClick={() => answerRecommendation(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <div className={styles.bounds}>
          <span>{t('experienceSurvey.recommendationLow')}</span>
          <span>{t('experienceSurvey.recommendationHigh')}</span>
        </div>
        <div className={styles.foot}>
          {steps}
          <button
            type="button"
            className={styles.skip}
            onClick={() => setStep('improvement')}
          >
            {t('experienceSurvey.skip')}
          </button>
        </div>
      </>
    );
  } else if (step === 'improvement') {
    body = (
      <>
        {head}
        <p className={styles.question}>{t('experienceSurvey.improvement')}</p>
        <div className={styles.options}>
          {IMPROVEMENT_KEYS.map((key, index) => (
            <button
              key={key}
              type="button"
              className={styles.option}
              onClick={() => answerImprovement(index)}
            >
              {t(key)}
            </button>
          ))}
        </div>
        <div className={styles.foot}>
          {steps}
          <button
            type="button"
            className={styles.skip}
            onClick={() => setStep('comment')}
          >
            {t('experienceSurvey.skip')}
          </button>
        </div>
      </>
    );
  } else if (step === 'comment') {
    body = (
      <>
        {head}
        <p className={styles.question}>{t('experienceSurvey.comment')}</p>
        <textarea
          className={styles.textarea}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={t('experienceSurvey.commentPlaceholder')}
        />
        <div className={styles.foot}>
          {steps}
          <button type="button" className={styles.skip} onClick={finish}>
            {t('experienceSurvey.skip')}
          </button>
          <button type="button" className={styles.submit} onClick={submitComment}>
            {t('experienceSurvey.submit')}
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        {head}
        <div className={styles.thanks}>
          <span className={styles.thanksMark} aria-hidden>
            ✓
          </span>
          <p className={styles.thanksTitle}>{t('experienceSurvey.thanksTitle')}</p>
          <p className={styles.thanksBody}>{t('experienceSurvey.thanksBody')}</p>
        </div>
      </>
    );
  }

  return createPortal(
    <AnimatePresence>
      {visible ? (
        <motion.section
          className={styles.card}
          role="dialog"
          aria-label={t('experienceSurvey.tag')}
          variants={toastSlideUp}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {body}
        </motion.section>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
