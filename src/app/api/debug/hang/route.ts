import { NextRequest, NextResponse } from 'next/server';

/**
 * TEMP PLAYBACK TEST HARNESS — delete with playbackDebug.ts.
 *
 * Reproduces the gateway failures the byte watchdog exists for, which normal
 * browsing can't trigger on demand: a healthy CDN either works or errors, and
 * neither path exercises `watchdogTick`.
 *
 * Modes:
 *   frozen (default) — full WAV header + a little PCM, then the stream stalls
 *                      forever. The element reaches HAVE_METADATA and parks
 *                      with a non-growing buffer. This is `parsed-but-frozen`.
 *   silent           — headers only, never a byte of body. readyState stays 0
 *                      in NETWORK_LOADING. Exercises the one-shot grace.
 *   slow             — trickles real PCM. Buffer keeps growing, so the
 *                      watchdog must stay patient (Ghost Producer regression
 *                      check) until MEDIA_BYTES_MAX_WAIT_MS.
 *
 * Never enabled in production — see the guard in GET.
 */

export const dynamic = 'force-dynamic';

const SAMPLE_RATE = 44100;
const CHANNELS = 1;
const BITS = 16;
const BYTES_PER_SEC = (SAMPLE_RATE * CHANNELS * BITS) / 8;
/** Declared length in the header. Long enough that 25% is never reached. */
const DECLARED_SECONDS = 600;
/** Hard ceiling so a forgotten tab can't pin a dev-server connection forever. */
const MAX_HOLD_MS = 120000;

function wavHeader(dataBytes: number): Uint8Array {
  const buf = new ArrayBuffer(44);
  const view = new DataView(buf);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, BYTES_PER_SEC, true);
  view.setUint16(32, (CHANNELS * BITS) / 8, true);
  view.setUint16(34, BITS, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return new Uint8Array(buf);
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not available' }, { status: 404 });
  }

  const mode = request.nextUrl.searchParams.get('mode') || 'frozen';
  const dataBytes = BYTES_PER_SEC * DECLARED_SECONDS;

  let timers: ReturnType<typeof setTimeout>[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const stop = () => {
        timers.forEach(clearTimeout);
        timers = [];
        try {
          controller.close();
        } catch {
          // already closed by client disconnect
        }
      };
      timers.push(setTimeout(stop, MAX_HOLD_MS));

      if (mode === 'silent') {
        // Nothing at all — the connection stays open with zero body bytes.
        return;
      }

      controller.enqueue(wavHeader(dataBytes));

      if (mode === 'slow') {
        // ~0.25s of audio every 2s: slow, but the buffer genuinely advances.
        let sent = 0;
        const tick = () => {
          if (sent >= dataBytes) return stop();
          const chunk = new Uint8Array(Math.floor(BYTES_PER_SEC / 4));
          sent += chunk.length;
          try {
            controller.enqueue(chunk);
          } catch {
            return stop();
          }
          timers.push(setTimeout(tick, 2000));
        };
        timers.push(setTimeout(tick, 500));
        return;
      }

      // frozen: enough PCM for the demuxer to settle, then silence forever.
      controller.enqueue(new Uint8Array(BYTES_PER_SEC / 2));
    },
    cancel() {
      timers.forEach(clearTimeout);
      timers = [];
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(44 + dataBytes),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
