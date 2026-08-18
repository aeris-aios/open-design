import type { ComponentPropsWithoutRef, PropsWithChildren } from 'react';

export async function initParticlesEngine() {}

let providerLoaded = false;

export function setParticlesProviderLoadedForTests(loaded: boolean) {
  providerLoaded = loaded;
}

export function useParticlesProvider() {
  return { loaded: providerLoaded };
}

export function ParticlesProvider({ children }: PropsWithChildren) {
  return children;
}

export default function ParticlesMock({
  className,
  id,
}: ComponentPropsWithoutRef<'div'>) {
  return <div className={className} id={id} data-testid="particles-canvas" />;
}
