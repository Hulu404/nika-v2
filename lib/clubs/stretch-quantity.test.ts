import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const html = readFileSync(new URL("../../public/stretch/index.html", import.meta.url), "utf8");
const controller = html.slice(html.indexOf("function renderOrder(){"), html.indexOf("/* ===== режим покупки ===== */"));

function setup() {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], {
    value: match[1] === "i-quantity" ? "1" : "",
    disabled: false, hidden: false, textContent: "",
    attributes: {} as Record<string, string>,
    events: {} as Record<string, () => void>,
    classList: { toggle: vi.fn() },
    setAttribute(name: string, value: string) { this.attributes[name] = value; },
    addEventListener(name: string, handler: () => void) { this.events[name] = handler; },
  }]));
  const state = {
    document: { getElementById: (id: string) => elements.get(id) },
    PRICE: 1000, QUANTITY: 1, IS_GIFT: false, OUT: false, ORDER_TOKEN: "previous-order",
    plural: (_n: number, _one: string, few: string) => few,
  };
  runInNewContext(controller + "\nrenderOrder();", state);
  const input = elements.get("i-quantity")!;
  const enter = (value: string) => { input.value = value; input.events.input(); };
  return { state, input, enter, minus: elements.get("quantity-minus")!, plus: elements.get("quantity-plus")!, elements };
}

describe("количество билетов на /stretch", () => {
  it("начинается с одного билета и не уменьшается ниже 1", () => {
    const ui = setup();
    expect(ui.input.value).toBe("1");
    expect(ui.minus.disabled).toBe(true);
    ui.minus.events.click();
    expect(ui.state.QUANTITY).toBe(1);
  });

  it("кнопки меняют число и пересчитывают общую сумму", () => {
    const ui = setup();
    ui.plus.events.click();
    expect(ui.input.value).toBe("2");
    expect(ui.state.QUANTITY).toBe(2);
    expect(ui.elements.get("order-total")!.textContent).toBe((2000).toLocaleString("ru-RU"));
    expect(ui.state.ORDER_TOKEN).toBeNull();
    ui.minus.events.click();
    expect(ui.input.value).toBe("1");
    expect(ui.minus.disabled).toBe(true);
  });

  it("принимает ручной ввод 16 и не увеличивается выше 16", () => {
    const ui = setup();
    ui.enter("16");
    expect(ui.state.QUANTITY).toBe(16);
    expect(ui.plus.disabled).toBe(true);
    ui.plus.events.click();
    expect(ui.input.value).toBe("16");
    expect(ui.elements.get("order-total")!.textContent).toBe((16000).toLocaleString("ru-RU"));
  });

  it.each(["", "-1", "0", "0.5", "1.5", "17", "100", "abc"])("отклоняет ручной ввод %j, не использует его для суммы", (value) => {
    const ui = setup();
    ui.enter(value);
    expect(ui.input.attributes["aria-invalid"]).toBe("true");
    expect(ui.elements.get("f-quantity")!.classList.toggle).toHaveBeenLastCalledWith("err", true);
    expect(ui.elements.get("order-total")!.textContent).toBe("—");
    expect(ui.state.QUANTITY).toBe(1);
  });

  it("убирает ошибку после исправления числа", () => {
    const ui = setup();
    ui.enter("-2");
    ui.enter("5");
    expect(ui.input.attributes["aria-invalid"]).toBe("false");
    expect(ui.state.QUANTITY).toBe(5);
    expect(ui.elements.get("order-total")!.textContent).toBe((5000).toLocaleString("ru-RU"));
  });

  it("блокирует обе кнопки на время отправки формы", () => {
    const ui = setup();
    ui.input.disabled = true;
    ui.enter("4");
    expect(ui.minus.disabled).toBe(true);
    expect(ui.plus.disabled).toBe(true);
    ui.plus.events.click();
    expect(ui.state.QUANTITY).toBe(4);
  });
});
