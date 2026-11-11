/** Owns one asynchronous operation; a superseded result may never update its view. */
export class LatestTask {
  private sequence = 0;
  private controller: AbortController | null = null;
  begin() {
    this.cancel();
    const id = this.sequence;
    const controller = new AbortController();
    this.controller = controller;
    return {
      signal: controller.signal,
      current: () => id === this.sequence && !controller.signal.aborted,
    };
  }
  cancel() {
    this.sequence++;
    this.controller?.abort();
    this.controller = null;
  }
}
