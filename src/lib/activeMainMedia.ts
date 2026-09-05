// The main track's <audio>/<video> element is not reachable from AdPlayer
// through props or the DOM alone — `new Audio()` is never attached to the
// document, so `document.querySelectorAll('audio, video')` can't find it.
// This tiny registry lets useAudioPlayer publish whichever element is
// currently "the clock" so anything else (like an ad about to take over)
// can force-stop it with certainty, independent of React state.
let activeMedia: HTMLMediaElement | null = null;

export function setActiveMainMedia(el: HTMLMediaElement | null) {
  activeMedia = el;
}

export function getActiveMainMedia() {
  return activeMedia;
}

export function pauseActiveMainMedia() {
  if (activeMedia && !activeMedia.paused) {
    activeMedia.pause();
  }
}
