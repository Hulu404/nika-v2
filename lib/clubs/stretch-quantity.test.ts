import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const html = readFileSync(new URL("../../public/stretch/index.html", import.meta.url), "utf8");
const controller = html.slice(html.indexOf("function renderOrder(){"), html.indexOf("/* ===== режим покупки ===== */"));

function setup() {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], {
    value: match[1] === "i-quantity" ? "1" : "",
    disabled: false, hidden: false, textContent: "", max: "16",
    attributes: {} as Record<string, string>,
    events: {} as Record<string, () => void>,
    classList: { toggle: vi.fn() },
    setAttribute(name: string, value: string) { this.attributes[name] = value; },
    addEventListener(name: string, handler: () => void) { this.events[name] = handler; },
  }]));
  const state = {
    document: { getElementById: (id: string) => elements.get(id) },
    PRICE: 1000, QUANTITY: 1, IS_GIFT: false, OUT: false, ORDER_TOKEN: "previous-order",
    MAX_TICKETS: 16 as number | null, SUBMITTING: false, AVAILABILITY_FAILED: false, ADDITIONAL_ORDER: false,
    renderSeats: vi.fn(),
    plural: (_n: number, _one: string, few: string) => few,
  };
  runInNewContext(controller + "\nrenderOrder();", state);
  const input = elements.get("i-quantity")!;
  const enter = (value: string) => { input.value = value; input.events.input(); };
  const availability = (available: number) => runInNewContext(`applyAvailability({available:${available}});renderOrder();`, state);
  const validate = () => runInNewContext("validateQuantity()", state);
  return { state, input, enter, availability, validate, minus: elements.get("quantity-minus")!, plus: elements.get("quantity-plus")!, elements };
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
    ui.state.SUBMITTING = true;
    ui.enter("4");
    expect(ui.minus.disabled).toBe(true);
    expect(ui.plus.disabled).toBe(true);
    ui.plus.events.click();
    expect(ui.state.QUANTITY).toBe(4);
  });

  it("при остатке 5 разрешает купить 5, но не 6 билетов", () => {
    const ui = setup();
    ui.availability(5);
    expect(ui.input.max).toBe("5");
    ui.enter("5");
    expect(ui.validate()).toBe(true);
    expect(ui.plus.disabled).toBe(true);
    ui.plus.events.click();
    expect(ui.input.value).toBe("5");
    ui.enter("6");
    expect(ui.validate()).toBe(false);
    expect(ui.elements.get("quantity-error")!.textContent).toContain("от 1 до 5");
    expect(ui.elements.get("order-total")!.textContent).toBe("—");
    ui.minus.events.click();
    expect(ui.input.value).toBe("5");
    expect(ui.validate()).toBe(true);
  });

  it("ограничивает максимум и при остатке больше 5", () => {
    const ui = setup();
    ui.availability(9);
    ui.enter("10");
    expect(ui.input.max).toBe("9");
    expect(ui.validate()).toBe(false);
  });

  it("обновление остатка делает прежний выбор недопустимым", () => {
    const ui = setup();
    ui.enter("5");
    ui.availability(3);
    expect(ui.input.value).toBe("5");
    expect(ui.input.attributes["aria-invalid"]).toBe("true");
    expect(ui.validate()).toBe(false);
    ui.enter("3");
    expect(ui.validate()).toBe(true);
    expect(ui.plus.disabled).toBe(true);
  });

  it("последний билет блокирует обе кнопки", () => {
    const ui = setup();
    ui.availability(1);
    expect(ui.minus.disabled).toBe(true);
    expect(ui.plus.disabled).toBe(true);
    ui.enter("2");
    expect(ui.validate()).toBe(false);
  });

  it("при нулевом остатке скрывает покупку и оставляет лист ожидания", () => {
    const ui = setup();
    ui.availability(0);
    expect(ui.elements.get("f-quantity")!.hidden).toBe(true);
    expect(ui.input.disabled).toBe(true);
    expect(ui.elements.get("submit")!.textContent).toBe("Встать в лист ожидания");
    expect(ui.elements.get("order-total")!.textContent).toBe("—");
    ui.availability(4);
    expect(ui.elements.get("f-quantity")!.hidden).toBe(false);
    expect(ui.input.disabled).toBe(false);
    expect(ui.input.max).toBe("4");
  });

  it("без данных об остатке не разрешает покупку", () => {
    const ui = setup();
    ui.state.MAX_TICKETS = null;
    ui.enter("1");
    expect(ui.validate()).toBe(false);
    expect(ui.input.disabled).toBe(true);
    expect(ui.elements.get("submit")!.disabled).toBe(true);
    ui.availability(5);
    expect(ui.elements.get("submit")!.disabled).toBe(false);
  });

  it.each(["", "?purchase=more"])("докупка (%s) начинает новый заказ и сохраняет контакты", (search) => {
    const ui = setup();
    ui.enter("4");
    ui.state.IS_GIFT = true;
    ui.state.ORDER_TOKEN = "old-order";
    ui.elements.get("i-name")!.value = "Анна";
    ui.elements.get("i-tg")!.value = "@anna_test";
    ui.elements.get("i-mail")!.value = "anna@example.com";
    ui.elements.get("i-recipient")!.value = "Мария";
    const purchase = ["self", "gift"].map((value) => ({ value, checked: value === "gift", parentNode: { classList: { toggle: vi.fn() } } }));
    const form = Object.assign(ui.elements.get("form")!, { hidden: true, scrollIntoView: vi.fn() });
    const done = ui.elements.get("done")!;
    done.hidden = false;
    const consent = Object.assign(ui.elements.get("i-ok")!, { checked: true });
    const refresh = vi.fn();
    Object.assign(ui.state, {
      form, done, PROTOTYPE: false, LEFT: 5,
      refreshAvailability: refresh,
      $$: (selector: string) => selector === 'input[name="purchase"]' ? purchase : [],
      URLSearchParams, location: { search },
    });
    const source = html.slice(html.indexOf("/* ===== докупка билетов ===== */"), html.indexOf("/* ===== отправка заказа ===== */"));
    runInNewContext(source, ui.state);
    if (!search) ui.elements.get("another-order")!.events.click();
    expect(ui.state.ORDER_TOKEN).toBeNull();
    expect(ui.state.ADDITIONAL_ORDER).toBe(true);
    expect(ui.state.QUANTITY).toBe(1);
    expect(ui.input.value).toBe("1");
    expect(ui.state.IS_GIFT).toBe(false);
    expect(ui.elements.get("i-recipient")!.value).toBe("");
    expect(consent.checked).toBe(false);
    expect(ui.elements.get("i-name")!.value).toBe("Анна");
    expect(ui.elements.get("i-tg")!.value).toBe("@anna_test");
    expect(ui.elements.get("i-mail")!.value).toBe("anna@example.com");
    expect(form.hidden).toBe(false);
    expect(done.hidden).toBe(true);
    expect(refresh).toHaveBeenCalledOnce();
    expect(ui.state.MAX_TICKETS).toBeNull();
    expect(ui.elements.get("submit")!.disabled).toBe(true);
    ui.availability(1);
    expect(ui.elements.get("submit")!.textContent).toBe("Докупить билет");
    expect(ui.plus.disabled).toBe(true);
  });
});
