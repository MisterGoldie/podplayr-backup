'use client';

import { useRef, useState } from 'react';

const FIRST_AD_MIN = 1;
const FIRST_AD_MAX = 3;
const NEXT_AD_MIN = 4;
const NEXT_AD_MAX = 7;
const MIN_MS_BETWEEN_ADS = 3 * 60 * 1000;

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Pre-roll only: decide before a new play starts. Never inserts mid-track. */
export function usePrerollAd() {
  const [showAd, setShowAd] = useState(false);
  const uniquePlaysRef = useRef(0);
  const playsUntilNextAdRef = useRef(randomInt(FIRST_AD_MIN, FIRST_AD_MAX));
  const lastAdAtRef = useRef(0);
  const afterAdRef = useRef<(() => void) | null>(null);
  const adsWarmedRef = useRef(false);

  const warmAds = () => {
    if (adsWarmedRef.current) return;
    adsWarmedRef.current = true;
    void import('../components/player/adQueue').then((mod) => {
      mod.preloadUpcomingAdWhenIdle();
    });
  };

  const beforePlay = (run: () => void, pauseCurrent?: () => void) => {
    uniquePlaysRef.current += 1;
    warmAds();
    const due = uniquePlaysRef.current >= playsUntilNextAdRef.current;
    const cooledDown =
      lastAdAtRef.current === 0 ||
      Date.now() - lastAdAtRef.current >= MIN_MS_BETWEEN_ADS;

    if (due && cooledDown) {
      afterAdRef.current = run;
      pauseCurrent?.();
      setShowAd(true);
      return;
    }

    run();
  };

  const onAdComplete = () => {
    lastAdAtRef.current = Date.now();
    playsUntilNextAdRef.current =
      uniquePlaysRef.current + randomInt(NEXT_AD_MIN, NEXT_AD_MAX);
    const run = afterAdRef.current;
    afterAdRef.current = null;
    setShowAd(false);
    run?.();
  };

  return { showAd, beforePlay, onAdComplete };
}
