import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SLOW_UPDATE_MS, processInBackground } from "./background";

/** Дожидается, пока отработают все уже поставленные в очередь промисы. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("processInBackground", () => {
  it("возвращается сразу, не дожидаясь обработчика", () => {
    let finished = false;
    processInBackground("[test]", 1, async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      finished = true;
    });
    expect(finished).toBe(false);
  });

  it("ошибку обработчика пишет в лог и не выбрасывает наружу", async () => {
    processInBackground("[test]", 2, async () => {
      throw new Error("boom");
    });
    await flush();
    expect(console.error).toHaveBeenCalledWith("[test] handleUpdate:", "boom");
  });

  it("быструю обработку не логирует", async () => {
    processInBackground("[test]", 3, async () => {});
    await flush();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("медленную обработку логирует с номером апдейта и временем", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(1_000 + SLOW_UPDATE_MS + 200);
    processInBackground("[test]", 4, async () => {});
    await flush();
    expect(console.warn).toHaveBeenCalledWith(
      `[test] апдейт 4 обработан за ${SLOW_UPDATE_MS + 200} мс`,
    );
  });
});
