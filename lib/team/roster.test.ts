import { describe, expect, it } from "vitest";
import type { TeamMember } from "./access";
import { ROSTER, nameInstr, personLabel, personShort, resolveMention, rosterPatch, stem } from "./roster";

const base = (chat_id: number, username: string, patch: Partial<TeamMember> = {}): TeamMember => ({
  chat_id, username, display_name: username, role: "member", joined_at: "2026-10-01T00:00:00Z",
  added_by: null, last_seen_at: null, digest_opt_in: true, ...patch,
});

/** Команда, как она выглядит после применения roster.ts. */
const team: TeamMember[] = ROSTER.map((r, i) => base(i + 1, r.username, {
  first_name: r.firstName, title: r.title, departments: r.departments, name_aliases: r.aliases,
}));
const who = (name: string, qualifier: string | null = null, sender = 999) => {
  const res = resolveMention(team, { name, qualifier }, sender);
  if (res.kind === "one") return res.member.username;
  if (res.kind === "many") return res.options.map((m) => personLabel(m));
  return null;
};

describe("основа имени", () => {
  it("падежи сводятся к одной основе", () => {
    for (const w of ["Маша", "Маше", "Машу", "Маши", "Машей"]) expect(stem(w)).toBe("маш");
    for (const w of ["Дмитрий", "Дмитрию", "Дмитрия"]) expect(stem(w)).toBe("дмитр");
    expect(stem("Насте")).toBe(stem("Настя"));
  });
});

describe("поиск человека по фразе", () => {
  it("Маша: по отделу, по должности, иначе выбор из двух с должностью", () => {
    expect(who("Маше", "из ивента")).toBe("gusarovame");
    expect(who("Маше-дизайнеру")).toBe("mouserdyuk");
    expect(who("Маше", "дизайнеру")).toBe("mouserdyuk");
    expect(who("Маше")).toEqual(["Маша (Главный дизайнер) @mouserdyuk", "Маша (Ивент-отдел) @gusarovame"]);
  });

  it("Настя: глава смм однозначно, просто Насте — выбор", () => {
    expect(who("Насте", "главе смм")).toBe("zuzya_zyzya");
    expect(who("Насте")).toEqual(["Настя (Глава SMM) @zuzya_zyzya", "Настя (SMM) @ananas_2711"]);
  });

  it("Вика-разработчик", () => {
    expect(who("Вике-разработчику")).toBe("dissidenceandtea");
    expect(who("Вике", "из смм")).toBe("tora_co");
  });

  it("Сальма, Али, Дима — однозначно; ник тоже работает", () => {
    expect(who("Сальме")).toBe("salmasxsx");
    expect(who("с Сальмой")).toBe("salmasxsx");
    expect(who("Али")).toBe("Hulu404");
    expect(who("Диме")).toBe("srbrkvss");
    expect(who("Дмитрию")).toBe("srbrkvss");
    expect(who("@GusarovaMe")).toBe("gusarovame");
  });

  it("«мне», «себе», «со мной» — отправитель", () => {
    for (const w of ["мне", "себе", "со мной", "меня"]) expect(who(w, null, 7)).toBe("salmasxsx");
  });

  it("никого — none с исходным текстом", () => {
    expect(resolveMention(team, { name: "Пете", qualifier: null }, 1)).toEqual({ kind: "none", name: "Пете" });
  });

  it("уточнение, не подходящее никому, не выбирает первого попавшегося", () => {
    expect(who("Маше", "из бухгалтерии")).toEqual(["Маша (Главный дизайнер) @mouserdyuk", "Маша (Ивент-отдел) @gusarovame"]);
  });
});

describe("форматтер человека", () => {
  it("с должностью, без должности, отправитель; внутри отдела — без должности", () => {
    const masha = team.find((m) => m.username === "gusarovame")!;
    const ali = { ...team.find((m) => m.username === "Hulu404")!, title: null };
    expect(personLabel(masha)).toBe("Маша (Ивент-отдел) @gusarovame");
    expect(personLabel(team[0])).toBe("Настя (Глава SMM) @zuzya_zyzya");
    expect(personLabel(ali)).toBe("Али @Hulu404");
    expect(personLabel(masha, masha.chat_id)).toBe("ты");
    expect(personShort(masha)).toBe("Маша @gusarovame");
  });

  it("творительный — готовая форма из roster.ts, не склонение на лету", () => {
    expect(team.map(nameInstr)).toEqual(["Настей", "Настей", "Викой", "Викой", "Машей", "Машей", "Сальмой", "Али", "Дмитрием"]);
    expect(nameInstr({ ...team[0], first_name: "Ксюша", username: "new_one" })).toBeNull();
  });

  it("кривое распознавание имени: одна буква разницы", () => {
    expect(who("сальва")).toBe("salmasxsx");
    expect(who("Сальве")).toBe("salmasxsx");
  });
});

describe("отдел во фразе", () => {
  const dept = (name: string, qualifier: string | null = null, sender = 999) => {
    const res = resolveMention(team, { name, qualifier }, sender);
    return res.kind === "department" ? [res.department.key, res.members.map((m) => m.username)] : res.kind;
  };

  it("отдел, названный сам по себе, — все его участники; кривой STT тоже", () => {
    for (const n of ["ивент-отделом", "ивента дел", "ивент отдел", "ивентам", "отделу ивентов"]) {
      expect(dept(n), n).toEqual(["events", ["gusarovame", "salmasxsx"]]);
    }
    expect(dept("СММ")).toEqual(["smm", ["zuzya_zyzya", "ananas_2711", "tora_co"]]);
    expect(dept("смм-щикам")).toEqual(["smm", ["zuzya_zyzya", "ananas_2711", "tora_co"]]);
    expect(dept("дизайну")).toEqual(["design", ["mouserdyuk"]]);
    expect(dept("разработчикам")).toEqual(["dev", ["dissidenceandtea"]]);
  });

  it("имя с отделом — человек, не отдел; отправитель в раскрытие отдела не входит", () => {
    expect(who("Маше", "из ивента")).toBe("gusarovame");
    expect(who("Машей из ивента")).toBe("gusarovame");
    expect(dept("ивент-отделу", null, 7)).toEqual(["events", ["gusarovame"]]);
  });
});

describe("начальные данные из roster.ts", () => {
  it("заполняются только пустые поля; ник без регистра и @", () => {
    expect(rosterPatch(base(1, "hulu404"))).toEqual({ first_name: "Али", title: "COO, фаундер" });
    expect(rosterPatch(base(1, "srbrkvss", { first_name: "Дмитрий" }))).toEqual({ title: "CEO, фаундер", name_aliases: ["Дима"] });
    expect(rosterPatch(base(1, "gusarovame", { first_name: "Мария", title: "x", departments: ["smm"] }))).toBeNull();
    expect(rosterPatch(base(1, "stranger"))).toBeNull();
  });

  it("повторный запуск не перезаписывает изменённое в боте — даже очищенное", () => {
    const edited = base(1, "mouserdyuk", { first_name: "Мария", profile_edited_at: "2026-10-12T10:00:00Z" });
    expect(rosterPatch(edited)).toBeNull();
    const cleared = base(1, "salmasxsx", { first_name: "Сальма", title: "Ивент-отдел", departments: [], profile_edited_at: "2026-10-12T10:00:00Z" });
    expect(rosterPatch(cleared)).toBeNull();
  });
});
