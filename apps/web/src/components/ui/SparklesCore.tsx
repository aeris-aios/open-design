"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { ParticlesProvider, useParticlesProvider } from '@tsparticles/react';
import {
  tsParticles,
  type Container,
  type Engine,
  type ISourceOptions,
} from '@tsparticles/engine';
import { loadSlim } from '@tsparticles/slim';
import { motion, useReducedMotion } from 'motion/react';

import styles from './SparklesCore.module.css';

async function registerSparklesEngine(engine: Engine) {
  await loadSlim(engine);
}

export interface SparklesCoreProps {
  id?: string;
  className?: string;
  style?: CSSProperties;
  background?: string;
  particleSize?: number;
  minSize?: number;
  maxSize?: number;
  speed?: number;
  particleColor?: string;
  particleDensity?: number;
}

function SparklesRenderer({
  id,
  className = '',
  style,
  background = 'transparent',
  particleSize,
  minSize = particleSize ?? 0.4,
  maxSize = particleSize ?? 1.2,
  speed = 0.35,
  particleColor = '#848484',
  particleDensity = 120,
}: SparklesCoreProps) {
  const generatedId = useId();
  const resolvedId = id ?? generatedId;
  const reducedMotion = useReducedMotion();
  const { loaded: engineLoaded } = useParticlesProvider();
  const particlesHostRef = useRef<HTMLDivElement | null>(null);
  const [loaded, setLoaded] = useState(false);

  const options = useMemo<ISourceOptions>(() => ({
    background: {
      color: { value: background },
    },
    detectRetina: true,
    fpsLimit: reducedMotion ? 1 : 60,
    fullScreen: {
      enable: false,
      zIndex: 0,
    },
    interactivity: {
      events: {
        onClick: { enable: false, mode: 'push' },
        onHover: { enable: false, mode: 'repulse' },
        resize: { enable: true, delay: 0 },
      },
    },
    pauseOnBlur: true,
    pauseOnOutsideViewport: true,
    particles: {
      color: { value: particleColor },
      links: { enable: false },
      move: {
        direction: 'none',
        enable: !reducedMotion,
        outModes: { default: 'out' },
        random: true,
        speed: { min: 0.08, max: speed },
        straight: false,
      },
      number: {
        density: {
          enable: true,
          width: 400,
          height: 400,
        },
        value: particleDensity,
      },
      opacity: {
        value: { min: 0.08, max: 0.55 },
        animation: {
          enable: !reducedMotion,
          speed: 1,
          sync: false,
          startValue: 'random',
        },
      },
      shape: { type: 'circle' },
      size: {
        value: { min: minSize, max: maxSize },
      },
    },
  }), [
    background,
    maxSize,
    minSize,
    particleColor,
    particleDensity,
    reducedMotion,
    speed,
  ]);

  useEffect(() => {
    const host = particlesHostRef.current;
    if (!engineLoaded || !host) return;

    let cancelled = false;
    let activeContainer: Container | undefined;
    setLoaded(false);

    void tsParticles.load({
      id: resolvedId,
      element: host,
      options,
    }).then((container) => {
      if (!container || container.destroyed) return;
      if (cancelled || particlesHostRef.current !== host || !host.isConnected) {
        container.destroy();
        return;
      }
      activeContainer = container;
      setLoaded(true);
    }).catch(() => {
      if (!cancelled) setLoaded(false);
    });

    return () => {
      cancelled = true;
      if (activeContainer && !activeContainer.destroyed) activeContainer.destroy();
      activeContainer = undefined;
    };
  }, [engineLoaded, options, resolvedId]);

  const classes = [styles.root, className].filter(Boolean).join(' ');

  return (
    <motion.div
      className={classes}
      style={style}
      initial={false}
      animate={{ opacity: loaded ? 1 : 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.25 }}
      aria-hidden="true"
    >
      <div
        ref={particlesHostRef}
        id={resolvedId}
        className={styles.particles}
      />
    </motion.div>
  );
}

export function SparklesCore(props: SparklesCoreProps) {
  return (
    <ParticlesProvider init={registerSparklesEngine}>
      <SparklesRenderer {...props} />
    </ParticlesProvider>
  );
}
