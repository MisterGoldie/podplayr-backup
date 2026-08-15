/** Reset window/document scroll after playback or view changes.

  iOS/WebKit scrolls the window toward a playing <video>. This app's views
  scroll inside nested overflow containers, so a leftover window offset makes
  it look like the page can't reach the top or bottom.
*/
export function restorePageScroll() {
  if (typeof window === 'undefined') return;

  const reset = () => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };

  reset();
  requestAnimationFrame(reset);
  window.setTimeout(reset, 0);
  window.setTimeout(reset, 250);
}
