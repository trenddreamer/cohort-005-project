// App-level flag: is a Lesson video playing right now? The video player
// reports to it; the toast component reads it when a Notification arrives.
// A plain module value (not React state) because nothing re-renders on it.
let playing = false;

export function setVideoPlaying(value: boolean): void {
  playing = value;
}

export function isVideoPlaying(): boolean {
  return playing;
}
