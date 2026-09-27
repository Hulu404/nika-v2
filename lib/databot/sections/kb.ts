import { runWhenWhere, spotName } from "../../coffeerun/run";
import { fetchArchive, runKeysFrom, type ArchiveRow } from "../../team/history";
import { mergeRuns } from "../../team/runs";
import { publicOriginFromEnv } from "../../public-origin";
import { can } from "../access";
import {
  CANCEL_TEXT,
  FORM_EXPIRED_TEXT,
  KB_BODY_MAX,
  KB_CHANGED_TEXT,
  KB_EDIT_ASK,
  KB_EMPTY_TEXT,
  KB_NEW_BODY_ASK,
  KB_NEW_TITLE_ASK,
  KB_TITLE_MAX,
  kbArticleScreen,
  kbArticleText,
  kbDeleteConfirmScreen,
  kbDeletedText,
  kbLinksBody,
  kbListScreen,
  kbMembersBody,
  kbPreviewScreens,
  kbRestoredText,
  kbSavedText,
  kbScheduleBody,
  kbSignature,
  kbTitleBadText,
  kbTooLongText,
  kbZonesScreen,
  memberName,
} from "../copy";
import { cb } from "../callback";
import {
  deleteKbArticle,
  getKbArticle,
  insertKbArticle,
  listKbArticles,
  writeKbBody,
  type KbArticle,
} from "../data/kb";
import { fetchActiveLinkCodes, type LinkCode } from "../data/links";
import type { DatabotStore } from "../data/store";
import { formExpired, openForm, type FormState } from "../form";
import { sanitizeKbHtml } from "../kb-html";
import { normalizeText } from "../normalize";
import type { SectionHandler, SectionOutcome, SectionRequest } from "../section";
import { uniqueSlug } from "../slug";
import { ZONES, type Screen, type Subject, type Zone } from "../types";
import { isZone } from "../validate";

/**
 * Справочник (ТЗ 4.9). Статьи двух видов:
 *   • редактируемые — databot_kb, совет правит прямо в боте;
 *   • живые — собираются кодом при открытии и в базе не лежат.
 * Зоны статьи проверяются здесь, при каждом открытии (кнопкой, прямым callback
 * со slug, поиском): конвейер знает только, что справочник зоне открыт, а
 * какие зоны у статьи — это данные.
 */

export interface KbDeps {
  listKbArticles: () => Promise<KbArticle[]>;
  getKbArticle: (slug: string) => Promise<KbArticle | null>;
  insertKbArticle: (a: Pick<KbArticle, "slug" | "title" | "body" | "zones">, by: number, now: Date) => Promise<void>;
  writeKbBody: (
    slug: string,
    expectedBody: string,
    next: { body: string; prevBody: string | null },
    by: number,
    now: Date,
  ) => Promise<boolean>;
  deleteKbArticle: (slug: string) => Promise<boolean>;
  fetchArchive: () => Promise<ArchiveRow[]>;
  fetchActiveLinkCodes: () => Promise<LinkCode[]>;
}

const DEFAULT_DEPS: KbDeps = {
  listKbArticles,
  getKbArticle,
  insertKbArticle,
  writeKbBody,
  deleteKbArticle,
  fetchArchive,
  fetchActiveLinkCodes,
};

// ─────────────────────────────────────────────────────────────────────────────
// Живые статьи
// ─────────────────────────────────────────────────────────────────────────────

type LiveSlug = "raspisanie-kofe-ranov" | "metki-i-ssylki" | "kto-v-bote";

interface LiveArticle {
  slug: LiveSlug;
  title: string;
  aliases: string[];
  /** После редактируемых: живые — справка «на всякий случай». */
  sort: number;
}

export const LIVE_ARTICLES: readonly LiveArticle[] = [
  { slug: "raspisanie-kofe-ranov", title: "Расписание кофе-ранов", aliases: ["расписание", "когда забег", "ближайшие забеги"], sort: 900 },
  { slug: "metki-i-ssylki", title: "Метки и ссылки", aliases: ["метки", "ссылки", "какая ссылка", "короткая ссылка"], sort: 910 },
  { slug: "kto-v-bote", title: "Кто в боте", aliases: ["кто в боте", "состав бота"], sort: 920 },
];

const LIVE_SLUGS = new Set<string>(LIVE_ARTICLES.map((a) => a.slug));

/** Для списка и поиска: у живых — все зоны. */
interface Listed {
  slug: string;
  title: string;
  aliases: string[];
  sort: number;
  zones: readonly Zone[];
}

const ORIGIN_FALLBACK = "https://www.mynika.online";

// ─────────────────────────────────────────────────────────────────────────────
// Поиск (4.3 п. 1–2): совпадение с заголовком или алиасом, только в статьях зоны
// ─────────────────────────────────────────────────────────────────────────────

/** Целыми словами: «строка» не должна находиться внутри «перестройка». */
function containsWords(hay: string, needle: string): boolean {
  return ` ${hay} `.includes(` ${needle} `);
}

/**
 * Совпадение вопроса с заголовком или алиасом:
 *   • равны после нормализации;
 *   • вопрос содержит заголовок/алиас целиком («где строка цифр»);
 *   • заголовок содержит вопрос целиком («строка цифр» → «Строка цифр кофе-рана»),
 *     если в вопросе хотя бы 4 знака — иначе «про» находило бы всё подряд.
 */
export function kbMatches(query: string, candidate: string): boolean {
  const q = normalizeText(query);
  const c = normalizeText(candidate);
  if (!q || !c) return false;
  if (q === c) return true;
  if (c.length >= 4 && containsWords(q, c)) return true;
  if (q.length >= 4 && containsWords(c, q)) return true;
  return false;
}

export function visibleTo(subject: Subject, zones: readonly Zone[]): boolean {
  return can(subject, "kb.article", { articleZones: zones });
}

function sortListed(items: Listed[]): Listed[] {
  return [...items].sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title, "ru"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Обработчик
// ─────────────────────────────────────────────────────────────────────────────

export function createKbHandler(deps: KbDeps = DEFAULT_DEPS) {
  async function listed(): Promise<Listed[]> {
    const rows = await deps.listKbArticles();
    return sortListed([
      ...rows.map((a) => ({ slug: a.slug, title: a.title, aliases: a.aliases, sort: a.sort, zones: a.zones })),
      ...LIVE_ARTICLES.map((a) => ({ ...a, zones: ZONES })),
    ]);
  }

  async function liveBody(slug: LiveSlug, store: DatabotStore, now: Date): Promise<string> {
    switch (slug) {
      case "raspisanie-kofe-ranov": {
        const runs = mergeRuns(runKeysFrom(await deps.fetchArchive()), now);
        const upcoming = runs
          .filter((r) => !r.past)
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((r) => ({
            date: r.date,
            spotName: r.scheduled?.spotName ?? spotName(r.spot),
            when: r.scheduled ? runWhenWhere(r.scheduled) : null,
          }));
        const recent = runs
          .filter((r) => r.past)
          .slice(0, 3)
          .map((r) => ({ date: r.date, spotName: r.scheduled?.spotName ?? spotName(r.spot) }));
        return kbScheduleBody(upcoming, recent);
      }
      case "metki-i-ssylki":
        return kbLinksBody(await deps.fetchActiveLinkCodes(), publicOriginFromEnv() ?? ORIGIN_FALLBACK);
      case "kto-v-bote": {
        const members = await store.listMembers();
        return kbMembersBody(members.map((m) => ({ name: memberName(m), username: m.username, zone: m.zone })));
      }
    }
  }

  /** Экран статьи. null — статьи нет; "forbidden" — зоне не видна. */
  async function article(req: SectionRequest, slug: string): Promise<Screen | null | "forbidden"> {
    const live = LIVE_ARTICLES.find((a) => a.slug === slug);
    if (live) {
      return {
        text: kbArticleText(live.title, await liveBody(live.slug, req.store, req.now), null),
        buttons: [[{ text: "К списку", data: cb("kb", "list") }]],
      };
    }
    const a = await deps.getKbArticle(slug);
    if (!a) return null;
    if (!visibleTo(req.subject, a.zones)) return "forbidden";
    const author = a.updatedBy === null ? null : await req.store.findMember(a.updatedBy);
    return kbArticleScreen({
      slug: a.slug,
      title: a.title,
      body: a.body,
      signature: kbSignature(a.updatedAt, author ? memberName(author) : null),
      canEdit: can(req.subject, "kb.edit"),
      hasPrev: a.prevBody !== null,
    });
  }

  function listScreenFrom(req: SectionRequest, items: Listed[]): Screen {
    return kbListScreen(
      items.filter((a) => visibleTo(req.subject, a.zones)),
      can(req.subject, "kb.edit"),
    );
  }

  /** Форма этого вида, живая. null — нет или устарела (тогда уже стёрта). */
  async function activeForm(req: SectionRequest, kind: FormState["kind"]): Promise<FormState | "expired" | null> {
    const form = await req.store.getForm(req.subject.chatId);
    if (!form || form.kind !== kind) return null;
    if (formExpired(form, req.now)) {
      await req.store.clearSession(req.subject.chatId);
      return "expired";
    }
    return form;
  }

  /** Текст статьи из формы: санитизирован и не длиннее 3500 знаков. */
  function bodyFrom(req: SectionRequest): { ok: true; body: string } | { ok: false; screen: Screen } {
    const body = sanitizeKbHtml(req.intent.params.value_html ?? req.intent.params.value ?? "").trim();
    if (!body) return { ok: false, screen: { text: KB_EMPTY_TEXT } };
    // Лимит — на то, что уйдёт в базу (check char_length(body) <= 3500).
    if (body.length > KB_BODY_MAX) return { ok: false, screen: { text: kbTooLongText(body.length, KB_BODY_MAX) } };
    return { ok: true, body };
  }

  const handler: SectionHandler = async (req) => {
    const { intent, now, subject } = req;
    const slug = intent.params.slug;

    switch (intent.action) {
      case "list":
        return screensOf(listScreenFrom(req, await listed()));

      case "art": {
        if (!slug) return { kind: "stale" };
        const screen = await article(req, slug);
        if (screen === "forbidden") return { kind: "forbidden" };
        return screen ? screensOf(screen) : { kind: "stale" };
      }

      // ── Замена текста ─────────────────────────────────────────────────────
      case "edit": {
        if (!slug || LIVE_SLUGS.has(slug)) return { kind: "stale" };
        if (!(await deps.getKbArticle(slug))) return { kind: "stale" };
        await req.store.setForm(subject.chatId, openForm("kb.edit", { slug, stage: "text" }, now), now);
        return screensOf({ text: KB_EDIT_ASK });
      }
      case "edit_text": {
        const a = slug ? await deps.getKbArticle(slug) : null;
        if (!a) {
          await req.store.clearSession(subject.chatId);
          return screensOf({ text: KB_CHANGED_TEXT });
        }
        const parsed = bodyFrom(req);
        if (!parsed.ok) return screensOf(parsed.screen);
        await req.store.setForm(
          subject.chatId,
          openForm("kb.edit", { slug: a.slug, stage: "preview", body: parsed.body }, now),
          now,
        );
        return screensOf(...kbPreviewScreens(a.title, parsed.body, cb("kb", "save")));
      }
      case "save": {
        const form = await activeForm(req, "kb.edit");
        if (form === "expired") return screensOf({ text: FORM_EXPIRED_TEXT });
        if (!form || form.params.stage !== "preview") return { kind: "stale" };
        const a = await deps.getKbArticle(form.params.slug);
        if (!a) {
          await req.store.clearSession(subject.chatId);
          return screensOf({ text: KB_CHANGED_TEXT });
        }
        const ok = await deps.writeKbBody(a.slug, a.body, { body: form.params.body, prevBody: a.body }, subject.chatId, now);
        await req.store.clearSession(subject.chatId);
        if (!ok) return screensOf({ text: KB_CHANGED_TEXT });
        const screen = await article(req, a.slug);
        return screensOf({ text: kbSavedText(a.title) }, ...(screen && screen !== "forbidden" ? [screen] : []));
      }

      // ── Вернуть прошлую версию: body и prev_body меняются местами ─────────
      case "restore": {
        const a = slug && !LIVE_SLUGS.has(slug) ? await deps.getKbArticle(slug) : null;
        if (!a || a.prevBody === null) return { kind: "stale" };
        const ok = await deps.writeKbBody(a.slug, a.body, { body: a.prevBody, prevBody: a.body }, subject.chatId, now);
        if (!ok) return screensOf({ text: KB_CHANGED_TEXT });
        const screen = await article(req, a.slug);
        return screensOf({ text: kbRestoredText(a.title) }, ...(screen && screen !== "forbidden" ? [screen] : []));
      }

      // ── Удаление с подтверждением ──────────────────────────────────────────
      case "del": {
        const a = slug && !LIVE_SLUGS.has(slug) ? await deps.getKbArticle(slug) : null;
        if (!a) return { kind: "stale" };
        if (intent.params.confirm !== "ok") return screensOf(kbDeleteConfirmScreen(a.slug, a.title));
        await deps.deleteKbArticle(a.slug);
        return screensOf({ text: kbDeletedText(a.title) }, listScreenFrom(req, await listed()));
      }

      // ── Новая статья: заголовок → текст → зоны → сохранить ────────────────
      case "new":
        await req.store.setForm(subject.chatId, openForm("kb.new", { stage: "title" }, now), now);
        return screensOf({ text: KB_NEW_TITLE_ASK });

      case "new_text": {
        const form = await activeForm(req, "kb.new");
        if (!form || form === "expired") return screensOf({ text: FORM_EXPIRED_TEXT });
        const stage = form.params.stage;
        if (stage === "title") {
          // Заголовок — обычный текст: разметки в нём нет, экранируется при показе.
          const title = (intent.params.value ?? "").trim().replace(/\s+/g, " ");
          if (title.length < 2 || title.length > KB_TITLE_MAX) return screensOf({ text: kbTitleBadText() });
          await req.store.setForm(subject.chatId, openForm("kb.new", { stage: "body", title }, now), now);
          return screensOf({ text: KB_NEW_BODY_ASK });
        }
        if (stage === "body" || stage === "zones") {
          const parsed = bodyFrom(req);
          if (!parsed.ok) return screensOf(parsed.screen);
          const zones = form.params.zones ?? ZONES.join(",");
          await req.store.setForm(
            subject.chatId,
            openForm("kb.new", { stage: "zones", title: form.params.title, body: parsed.body, zones }, now),
            now,
          );
          const [intro, preview] = kbPreviewScreens(form.params.title, parsed.body, cb("kb", "zsave"));
          return screensOf(intro, { text: preview.text }, kbZonesScreen(zonesOf(zones)));
        }
        return { kind: "stale" };
      }
      case "z": {
        const form = await activeForm(req, "kb.new");
        if (form === "expired") return screensOf({ text: FORM_EXPIRED_TEXT });
        const zone = intent.params.zone;
        if (!form || form.params.stage !== "zones" || !isZone(zone)) return { kind: "stale" };
        const current = zonesOf(form.params.zones ?? "");
        const next = current.includes(zone) ? current.filter((z) => z !== zone) : [...current, zone];
        const ordered = ZONES.filter((z) => next.includes(z));
        await req.store.setForm(
          subject.chatId,
          { ...form, params: { ...form.params, zones: ordered.join(",") } },
          now,
        );
        return screensOf(kbZonesScreen(ordered));
      }
      case "zsave": {
        const form = await activeForm(req, "kb.new");
        if (form === "expired") return screensOf({ text: FORM_EXPIRED_TEXT });
        if (!form || form.params.stage !== "zones") return { kind: "stale" };
        const zones = zonesOf(form.params.zones ?? "");
        // Статья без зон не видна никому — и check в базе её не пустит.
        if (zones.length === 0) return screensOf(kbZonesScreen([]));
        const taken = new Set([...(await deps.listKbArticles()).map((a) => a.slug), ...LIVE_SLUGS]);
        const newSlug = uniqueSlug(form.params.title, taken);
        await deps.insertKbArticle({ slug: newSlug, title: form.params.title, body: form.params.body, zones }, subject.chatId, now);
        await req.store.clearSession(subject.chatId);
        const screen = await article(req, newSlug);
        return screensOf({ text: kbSavedText(form.params.title) }, ...(screen && screen !== "forbidden" ? [screen] : []));
      }

      case "cancel":
        await req.store.clearSession(subject.chatId);
        return screensOf({ text: CANCEL_TEXT });

      default:
        return { kind: "stale" };
    }
  };

  /**
   * Поиск статьи по тексту среди статей зоны — для временного маршрутизатора
   * (router/interim.ts) до полного разбора в Промте 14.
   */
  async function search(subject: Subject, query: string): Promise<Array<{ slug: string; title: string }>> {
    return (await listed())
      .filter((a) => visibleTo(subject, a.zones))
      .filter((a) => [a.title, ...a.aliases].some((c) => kbMatches(query, c)))
      .map((a) => ({ slug: a.slug, title: a.title }));
  }

  /** Статья «Кто за что отвечает» для только что вошедшего, если она есть и видна. */
  async function welcome(req: SectionRequest): Promise<Screen | null> {
    const rows = await deps.listKbArticles();
    const found = rows.find((a) => normalizeText(a.title).startsWith("кто за что отвечает") && visibleTo(req.subject, a.zones));
    if (!found) return null;
    const screen = await article(req, found.slug);
    return screen && screen !== "forbidden" ? screen : null;
  }

  return { handler, search, welcome, article };
}

function zonesOf(csv: string): Zone[] {
  return ZONES.filter((z) => csv.split(",").includes(z));
}

function screensOf(...screens: Screen[]): SectionOutcome {
  return { kind: "screens", screens };
}

const kb = createKbHandler();
export const handleKb: SectionHandler = kb.handler;
export const searchKb = kb.search;
export const welcomeKbArticle = kb.welcome;
export const kbArticle = kb.article;
