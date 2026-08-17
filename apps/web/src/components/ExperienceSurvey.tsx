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
import type { Variants } from 'motion/react';
import { Button } from '@open-design/components';
import { useT } from '../i18n';
import styles from './ExperienceSurvey.module.css';
import {
  SURVEY_DELAY_MS,
  isSurveyRetired,
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

/** How long a tapped choice stays lit before the next question replaces it. */
const PICK_ACK_MS = 180;

// Repo motion contract (AGENTS.md): ease-out cubic-bezier(0.23, 1, 0.32, 1),
// enter ~200ms, exit ~140ms because the user has already chosen to dismiss.
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

const cardMotion: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.22, ease: EASE_OUT } },
  exit: { opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.14, ease: EASE_OUT } },
};

const stepMotion: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.12, ease: EASE_OUT } },
};

export function ExperienceSurvey({ onSubmit, onExposure, onDismiss }: Props) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<Step>('satisfaction');
  const [picked, setPicked] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const answersRef = useRef<Partial<ExperienceSurveyAnswers>>({});
  const exposedRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  const later = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  }, []);

  useEffect(
    () => () => {
      for (const id of timersRef.current) window.clearTimeout(id);
    },
    [],
  );

  // Dev-only preview hook, so the card can be eyeballed during development or
  // design review without driving a real export. Never registered in a
  // production build.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const globals = window as typeof window & {
      __odExperienceSurvey?: { open: () => void };
    };
    globals.__odExperienceSurvey = { open: () => setVisible(true) };
    // `?survey=preview` opens it without a console round-trip, so a design
    // review can just follow a link.
    if (new URLSearchParams(window.location.search).get('survey') === 'preview') {
      setVisible(true);
    }
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

  const goTo = useCallback((next: Step) => {
    setPicked(null);
    setStep(next);
  }, []);

  const finish = useCallback(() => {
    retireSurvey();
    const answers = answersRef.current;
    if (typeof answers.satisfaction === 'number') {
      onSubmit?.(answers as ExperienceSurveyAnswers);
    }
    setPicked(null);
    setStep('thanks');
    later(() => setVisible(false), 2_600);
  }, [later, onSubmit]);

  const close = useCallback(() => {
    retireSurvey();
    setVisible(false);
    if (step !== 'thanks') onDismiss?.(answersRef.current);
  }, [onDismiss, step]);

  /** Lights the tapped choice, then advances — the tap needs a receipt. */
  const pick = useCallback(
    (value: number, apply: (value: number) => void, next: Step) => {
      if (picked !== null) return;
      setPicked(value);
      apply(value);
      later(() => goTo(next), PICK_ACK_MS);
    },
    [goTo, later, picked],
  );

  const submitComment = useCallback(() => {
    const trimmed = comment.trim();
    if (trimmed) answersRef.current.comment = trimmed;
    finish();
  }, [comment, finish]);

  if (typeof document === 'undefined') return null;

  const stepIndex = STEP_ORDER.indexOf(step);
  const progress = step === 'thanks' ? 1 : (stepIndex + 1) / STEP_ORDER.length;

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

  const counter = <span className={styles.count}>{stepIndex + 1}/{STEP_ORDER.length}</span>;

  let body: JSX.Element;
  if (step === 'satisfaction') {
    body = (
      <>
        <p className={styles.question}>{t('experienceSurvey.satisfaction')}</p>
        <div className={`${styles.rail} ${styles.five}`}>
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              className={`${styles.cell} ${picked === value ? styles.picked : ''}`}
              onClick={() =>
                pick(
                  value,
                  (v) => {
                    answersRef.current.satisfaction = v;
                  },
                  'recommendation',
                )
              }
            >
              {value}
            </button>
          ))}
        </div>
        <div className={styles.bounds}>
          <span>{t('experienceSurvey.satisfactionLow')}</span>
          <span>{t('experienceSurvey.satisfactionHigh')}</span>
        </div>
        <div className={styles.foot}>{counter}</div>
      </>
    );
  } else if (step === 'recommendation') {
    body = (
      <>
        <p className={styles.question}>{t('experienceSurvey.recommendation')}</p>
        <div className={`${styles.rail} ${styles.eleven}`}>
          {Array.from({ length: 11 }, (_, value) => (
            <button
              key={value}
              type="button"
              className={`${styles.cell} ${picked === value ? styles.picked : ''}`}
              onClick={() =>
                pick(
                  value,
                  (v) => {
                    answersRef.current.recommendation = v;
                  },
                  'improvement',
                )
              }
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
          {counter}
          <button type="button" className={styles.skip} onClick={() => goTo('improvement')}>
            {t('experienceSurvey.skip')}
          </button>
        </div>
      </>
    );
  } else if (step === 'improvement') {
    body = (
      <>
        <p className={styles.question}>{t('experienceSurvey.improvement')}</p>
        <div className={styles.options}>
          {IMPROVEMENT_KEYS.map((key, index) => (
            <button
              key={key}
              type="button"
              className={`${styles.option} ${picked === index ? styles.picked : ''}`}
              onClick={() =>
                pick(
                  index,
                  (v) => {
                    answersRef.current.improvement = v;
                  },
                  'comment',
                )
              }
            >
              {t(key)}
            </button>
          ))}
        </div>
        <div className={styles.foot}>
          {counter}
          <button type="button" className={styles.skip} onClick={() => goTo('comment')}>
            {t('experienceSurvey.skip')}
          </button>
        </div>
      </>
    );
  } else if (step === 'comment') {
    body = (
      <>
        <p className={styles.question}>{t('experienceSurvey.comment')}</p>
        <textarea
          className={styles.textarea}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={t('experienceSurvey.commentPlaceholder')}
        />
        <div className={styles.foot}>
          {counter}
          <button type="button" className={styles.skip} onClick={finish}>
            {t('experienceSurvey.skip')}
          </button>
          {/* Shared primitive rather than a local pill: the hand-rolled one
              used --accent-strong/--accent-contrast directly, which inverts to
              mid-grey on near-black in dark mode and failed contrast. */}
          <Button variant="primary" className={styles.submit} onClick={submitComment}>
            {t('experienceSurvey.submit')}
          </Button>
        </div>
      </>
    );
  } else {
    body = (
      <div className={styles.thanks}>
        <span className={styles.thanksMark} aria-hidden>
          ✓
        </span>
        <span className={styles.thanksText}>
          <p className={styles.thanksTitle}>{t('experienceSurvey.thanksTitle')}</p>
          <p className={styles.thanksBody}>{t('experienceSurvey.thanksBody')}</p>
        </span>
      </div>
    );
  }

  return createPortal(
    <AnimatePresence>
      {visible ? (
        <motion.section
          layout
          className={styles.card}
          role="dialog"
          aria-label={t('experienceSurvey.tag')}
          variants={cardMotion}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <span
            className={styles.progress}
            style={{ transform: `scaleX(${progress})` }}
            aria-hidden
          />
          <div className={styles.body}>
            {head}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                variants={stepMotion}
                initial="hidden"
                animate="visible"
                exit="exit"
                style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
              >
                {body}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.section>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
