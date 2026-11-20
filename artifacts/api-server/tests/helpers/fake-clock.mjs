/**
 * Test-only clock: preload with `--import` and set SC_FAKE_NOW (epoch ms) to
 * start a server process at that moment. Time still moves from there, so
 * timeouts and cache ages behave; only the starting point is shifted. Nothing
 * in src/ reads this - it is how the Phase 7 rematch tests put the server on
 * either side of the six-day switch.
 */
const fake = Number(process.env.SC_FAKE_NOW);
if (Number.isFinite(fake) && fake > 0) {
  const RealDate = Date;
  const offset = fake - RealDate.now();
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = FakeDate;
}
